"""Private-network gateway using only one host-loopback activation socket."""
import os
from pathlib import Path
import re
import socket
import ssl
import stat
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


def tls_context():
    directory = credential_directory()
    for name in ("client-ca.pem", "server-cert.pem", "server-key.pem"):
        descriptor = os.open(directory / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            info = os.fstat(descriptor)
            if not (stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                    and stat.S_IMODE(info.st_mode) == 0o400 and 0 < info.st_size <= 65536):
                raise RuntimeError("unsafe credential")
        finally:
            os.close(descriptor)
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
