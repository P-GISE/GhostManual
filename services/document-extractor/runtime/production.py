"""Private-network gateway using only one host-loopback activation socket."""
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import struct
import sys
import unittest

sys.path.insert(0, "/service")

import bootstrap
from gateway import Gateway, Handler


def activation_socket():
    if (os.environ.get("LISTEN_PID") != str(os.getpid()) or os.environ.get("LISTEN_FDS") != "1"
            or os.environ.get("LISTEN_FDNAMES") != "ghostmanual-extractor"):
        raise RuntimeError("invalid activation contract")
    listener = socket.socket(fileno=3)
    try:
        if (listener.family != socket.AF_INET or listener.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM
                or listener.getsockname() != ("127.0.0.1", 18443)
                or listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) != 1):
            raise RuntimeError("invalid activation socket")
        listener.set_inheritable(False)
        for name in ("LISTEN_PID", "LISTEN_FDS", "LISTEN_FDNAMES"):
            os.environ.pop(name, None)
        return listener
    except BaseException:
        listener.close()
        raise


def credential_directory():
    value = os.environ.get("CREDENTIALS_DIRECTORY", "")
    if not re.fullmatch(r"/run/credentials/ghostmanual-extractor@[0-9a-f]{64}\.service", value):
        raise RuntimeError("invalid credential directory")
    return Path(value)


def require_credential_metadata(descriptor, directory=False):
    info = os.fstat(descriptor)
    permission = 5 if directory else 4
    expected_mode = 0o550 if directory else 0o440
    expected_type = stat.S_IFDIR if directory else stat.S_IFREG
    if not (stat.S_IFMT(info.st_mode) == expected_type and info.st_uid == info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == expected_mode
            and os.fstatvfs(descriptor).f_flag & os.ST_RDONLY
            and (directory or (info.st_nlink == 1 and 0 < info.st_size <= 65536))):
        raise RuntimeError("unsafe credential metadata")
    # systemd255 keeps root ownership and adds only the service UID's read/search ACL.
    entries = ((1, permission, 0xFFFFFFFF), (2, permission, 1000), (4, 0, 0xFFFFFFFF),
               (16, permission, 0xFFFFFFFF), (32, 0, 0xFFFFFFFF))
    expected_acl = struct.pack("<I", 2) + b"".join(struct.pack("<HHI", *entry) for entry in entries)
    if os.getxattr(descriptor, "system.posix_acl_access") != expected_acl:
        raise RuntimeError("unsafe credential ACL")


def tls_context():
    if os.getuid() != 1000 or os.getgid() != 1000:
        raise RuntimeError("incorrect credential identity")
    directory = credential_directory()
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        require_credential_metadata(directory_fd, directory=True)
        for name in ("client-ca.pem", "server-cert.pem", "server-key.pem"):
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory_fd)
            try:
                require_credential_metadata(descriptor)
            finally:
                os.close(descriptor)
    finally:
        os.close(directory_fd)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_verify_locations(directory / "client-ca.pem")
    context.load_cert_chain(directory / "server-cert.pem", directory / "server-key.pem")
    return context


class ActivatedGateway(Gateway):
    def handle_error(self, *_):
        # BaseServer's default error log includes peer addresses.
        pass


def main(args):
    if args not in ([], ["--gate"]):
        raise RuntimeError("invalid startup arguments")
    with activation_socket() as listener:
        bootstrap.configure()
        bootstrap.probe()
        if args == ["--gate"]:
            suite = unittest.defaultTestLoader.discover("/service/tests", pattern="test_isolation.py")
            if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
                raise RuntimeError("production isolation gate failed")
            bootstrap.smoke_formats()
            return
        context = tls_context()
        with ActivatedGateway(listener.getsockname(), Handler, bind_and_activate=False) as server:
            server.socket.close()
            server.socket = listener
            server.server_name, server.server_port = "localhost", 18443
            server.context = context
            server.serve_forever()


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception:
        print("external extractor startup rejected", file=sys.stderr)
        raise SystemExit(1)
