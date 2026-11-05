"""Offline production startup/activation contract; no host policy or credential use."""
import configparser
import importlib.util
import os
from pathlib import Path
import re
import socket
import sys
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).parent

def load():
    spec = importlib.util.spec_from_file_location("extractor_production", HERE / "production.py")
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"bootstrap": Mock(), "gateway": Mock(Gateway=type("Gateway", (), {}), Handler=Mock())}):
        spec.loader.exec_module(module)
    return module

class ProductionTests(unittest.TestCase):
    def environment(self):
        return {"LISTEN_PID": str(os.getpid()), "LISTEN_FDS": "1", "LISTEN_FDNAMES": "ghostmanual-extractor"}

    def listener(self):
        value = Mock(family=socket.AF_INET)
        value.getsockopt.side_effect = lambda level, option: {socket.SO_TYPE: socket.SOCK_STREAM, socket.SO_ACCEPTCONN: 1}[option]
        value.getsockname.return_value = ("127.0.0.1", 18443)
        return value

    def test_exact_activation_fd_is_cloexec_and_environment_is_cleared(self):
        module = load(); listener = self.listener()
        with patch.dict(os.environ, self.environment(), clear=True), patch.object(module.socket, "socket", return_value=listener) as opened:
            self.assertIs(module.activation_socket(), listener)
            opened.assert_called_once_with(fileno=3)
            listener.set_inheritable.assert_called_once_with(False)
            self.assertFalse(any(name.startswith("LISTEN_") for name in os.environ))

    def test_wrong_pid_count_or_name_is_rejected_before_socket_access(self):
        module = load()
        for name, value in [("LISTEN_PID", "0"), ("LISTEN_FDS", "2"), ("LISTEN_FDS", "01"), ("LISTEN_FDNAMES", "other")]:
            env = self.environment(); env[name] = value
            with self.subTest(name=name, value=value), patch.dict(os.environ, env, clear=True), patch.object(module.socket, "socket") as opened, self.assertRaises(RuntimeError):
                module.activation_socket()
            opened.assert_not_called()

    def test_non_loopback_or_non_listening_socket_is_closed_and_rejected(self):
        module = load()
        for address, listening in [(("0.0.0.0", 18443), 1), (("127.0.0.1", 8443), 1), (("127.0.0.1", 18443), 0)]:
            listener = self.listener(); listener.getsockname.return_value = address
            listener.getsockopt.side_effect = lambda level, option: socket.SOCK_STREAM if option == socket.SO_TYPE else listening
            with self.subTest(address=address, listening=listening), patch.dict(os.environ, self.environment(), clear=True), patch.object(module.socket, "socket", return_value=listener), self.assertRaises(RuntimeError):
                module.activation_socket()
            listener.close.assert_called_once_with()

    def test_credential_directory_is_exact_own_systemd_unit(self):
        module = load(); expected = "/run/credentials/ghostmanual-extractor@" + "a" * 64 + ".service"
        with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": expected}, clear=True):
            self.assertEqual(module.credential_directory(), Path(expected))
        for path in ["/tmp/keys", expected + "/../other", expected.replace("a" * 64, "a" * 63), expected.replace("extractor@", "other@")]:
            with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": path}, clear=True), self.assertRaises(RuntimeError):
                module.credential_directory()

    def test_production_policy_is_base_with_own_peers_and_three_credentials_only(self):
        base = (HERE / "ghostmanual-extractor-runtime.apparmor").read_text()
        production = (HERE / "ghostmanual-extractor-production.apparmor").read_text()
        additions = "  /run/credentials/ r,\n  /run/credentials/ghostmanual-extractor@*.service/ r,\n  /run/credentials/ghostmanual-extractor@*.service/{client-ca,server-cert,server-key}.pem r,\n"
        self.assertEqual(production.replace(additions, ""), base.replace("ghostmanual-extractor-runtime", "ghostmanual-extractor-production"))
        self.assertNotRegex(production, r"flags=\([^)]*unconfined")

    def test_tls_context_keeps_client_auth_tls13_and_fixed_private_files(self):
        import stat
        from types import SimpleNamespace
        module = load(); directory = Path("/run/credentials/ghostmanual-extractor@" + "a" * 64 + ".service")
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=os.getuid(), st_size=100)
        context = Mock()
        with patch.object(module, "credential_directory", return_value=directory), patch.object(module.os, "open", return_value=9) as opened, patch.object(module.os, "fstat", return_value=info), patch.object(module.os, "close"), patch.object(module.ssl, "SSLContext", return_value=context):
            self.assertIs(module.tls_context(), context)
        self.assertEqual(context.minimum_version, module.ssl.TLSVersion.TLSv1_3)
        self.assertEqual(context.verify_mode, module.ssl.CERT_REQUIRED)
        self.assertEqual([args.args[0] for args in opened.call_args_list], [directory / name for name in ("client-ca.pem", "server-cert.pem", "server-key.pem")])
        self.assertTrue(all(args.args[1] & os.O_NOFOLLOW and args.args[1] & os.O_CLOEXEC for args in opened.call_args_list))
        context.load_verify_locations.assert_called_once_with(directory / "client-ca.pem")
        context.load_cert_chain.assert_called_once_with(directory / "server-cert.pem", directory / "server-key.pem")
        for mode, size, uid in [(0o444, 100, os.getuid()), (0o400, 65537, os.getuid()), (0o400, 100, os.getuid() + 1)]:
            bad = SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=uid, st_size=size)
            with patch.object(module, "credential_directory", return_value=directory), patch.object(module.os, "open", return_value=9), patch.object(module.os, "fstat", return_value=bad), patch.object(module.os, "close") as closed, self.assertRaises(RuntimeError):
                module.tls_context()
            closed.assert_called_once_with(9)

    def test_compiled_credential_paths_do_not_match_other_keys(self):
        import shutil
        import subprocess
        if not shutil.which("apparmor_parser"):
            self.skipTest("requires offline AppArmor compiler")
        result = subprocess.run(["apparmor_parser", "-Q", "-K", "-D", "rule-exprs", str(HERE / "ghostmanual-extractor-production.apparmor")], capture_output=True, text=True, check=True)
        expressions = []
        for line in (result.stdout + result.stderr).splitlines():
            if line.startswith("aare: "):
                path, expression = line[6:].split("   ->   ", 1)
                if path.startswith("/run/credentials/"):
                    expressions.append(re.compile(expression))
        prefix = "/run/credentials/ghostmanual-extractor@" + "a" * 64 + ".service/"
        for name in ["client-ca.pem", "server-cert.pem", "server-key.pem"]:
            self.assertTrue(any(expression.fullmatch(prefix + name) for expression in expressions))
        for path in [prefix + "other-key.pem", prefix + "server-key.pem.bak", prefix + "server-key.pem/child", prefix.replace("extractor@", "other@") + "server-key.pem", "/etc/ssl/private/server-key.pem"]:
            self.assertFalse(any(expression.fullmatch(path) for expression in expressions))

    def test_units_preserve_network_capability_and_resource_boundary(self):
        unit = configparser.ConfigParser(interpolation=None, strict=False)
        unit.read(HERE / "ghostmanual-extractor@.service"); service = unit["Service"]
        for name in ["PrivateNetwork", "NoNewPrivileges", "PrivateDevices", "PrivateTmp", "ProtectKernelModules", "ProtectClock"]:
            self.assertTrue(service.getboolean(name))
        for name in ["CapabilityBoundingSet", "AmbientCapabilities"]:
            self.assertEqual(set(service[name].split()), {"CAP_SETUID", "CAP_SETGID"})
        self.assertEqual(service["MemoryMax"], "512M")
        self.assertEqual(service["LimitCORE"], "0")
        self.assertEqual(service["IPAddressDeny"], "any")
        self.assertEqual(service["IPAddressAllow"], "localhost")
        self.assertEqual(service["DelegateSubgroup"], "gateway")
        self.assertEqual(service["AppArmorProfile"], "ghostmanual-extractor-production")
        self.assertEqual(service["ReadOnlyPaths"], "/sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max")
        socket_unit = configparser.ConfigParser(interpolation=None)
        socket_unit.read(HERE / "ghostmanual-extractor@.socket")
        self.assertEqual(socket_unit["Socket"]["ListenStream"], "127.0.0.1:18443")
        self.assertFalse(socket_unit["Socket"].getboolean("Accept"))
        self.assertEqual(socket_unit["Socket"]["IPAddressDeny"], "any")
        self.assertEqual(socket_unit["Socket"]["IPAddressAllow"], "localhost")

    def test_worker_uses_slice_parent_and_no_daemon_or_public_mounts(self):
        root = HERE.parents[2] / "deploy/document-worker"
        unit = configparser.ConfigParser(interpolation=None, strict=False); unit.read(root / "ghostmanual-document-worker.service")
        service = unit["Service"]; command = service["ExecStart"]
        self.assertEqual(service["User"], "1000")
        self.assertEqual(service["Slice"], "ghostmanual-document-worker.slice")
        self.assertIn("--cgroup-parent=ghostmanual-document-worker.slice", command)
        self.assertIn("--user=1000:1000", command)
        self.assertIn("--cap-drop=ALL", command)
        self.assertIn("--read-only", command)
        self.assertIn("--ulimit=core=0", command)
        self.assertEqual(service["LimitCORE"], "0")
        self.assertTrue(service["ExecStartPre"].endswith("stop-worker.py --check-image"))
        self.assertNotIn("/var/run/docker.sock,target", command)
        self.assertNotRegex(command, r"(?:^| )--(?:publish|privileged|cap-add)")
        slice_unit = configparser.ConfigParser(interpolation=None)
        slice_unit.read(root / "ghostmanual-document-worker.slice")
        self.assertEqual(slice_unit["Slice"]["MemoryMax"], "256M")
        self.assertEqual(slice_unit["Slice"]["IPAddressDeny"], "any")
        self.assertEqual(slice_unit["Slice"]["IPAddressAllow"], "localhost")

class WorkerStopTests(unittest.TestCase):
    def load_stop(self):
        spec = importlib.util.spec_from_file_location("document_worker_stop", HERE.parents[2] / "deploy/document-worker/stop-worker.py")
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        return module

    def receipt(self):
        import stat
        from types import SimpleNamespace
        value = Mock()
        value.exists.return_value = True
        value.lstat.return_value = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=1000, st_nlink=1, st_dev=1, st_ino=2)
        value.read_text.return_value = "a" * 64 + "\n"
        return value

    def response(self, code, stdout=""):
        from types import SimpleNamespace
        return SimpleNamespace(returncode=code, stdout=stdout)

    def test_image_guard_rejects_mutable_or_invalid_values(self):
        module = self.load_stop()
        for image in ["", "ghostmanual:latest", "sha256:" + "b" * 63]:
            with patch.dict(os.environ, {"GHOSTMANUAL_WORKER_IMAGE": image}), self.assertRaises(RuntimeError):
                module.image_identity()

    def test_verified_exact_id_is_stopped_then_own_receipt_removed(self):
        module = self.load_stop(); receipt = self.receipt(); identifier = "a" * 64; image = "sha256:" + "b" * 64
        with patch.object(module, "CIDFILE", receipt), patch.object(module.os, "getuid", return_value=1000), patch.dict(os.environ, {"GHOSTMANUAL_WORKER_IMAGE": image}), patch.object(module, "command", side_effect=[self.response(0, f"{identifier} document-worker {image}"), self.response(0, identifier), self.response(0)]) as command:
            module.stop()
        self.assertEqual(command.call_args_list[1].args, ("stop", "--time=130", identifier))
        receipt.unlink.assert_called_once_with()

    def test_auto_remove_can_finish_after_stop_returns(self):
        module = self.load_stop(); receipt = self.receipt(); identifier = "a" * 64; image = "sha256:" + "b" * 64
        results = [self.response(0, f"{identifier} document-worker {image}"), self.response(0, identifier), self.response(0, identifier), self.response(0)]
        with patch.object(module, "CIDFILE", receipt), patch.object(module.os, "getuid", return_value=1000), patch.dict(os.environ, {"GHOSTMANUAL_WORKER_IMAGE": image}), patch.object(module, "command", side_effect=results), patch("time.sleep"):
            module.stop()
        receipt.unlink.assert_called_once_with()

    def test_incomplete_auto_remove_keeps_receipt_after_bounded_wait(self):
        module = self.load_stop(); receipt = self.receipt(); identifier = "a" * 64; image = "sha256:" + "b" * 64
        results = [self.response(0, f"{identifier} document-worker {image}"), self.response(0, identifier), self.response(0, identifier)]
        with patch.object(module, "CIDFILE", receipt), patch.object(module.os, "getuid", return_value=1000), patch.dict(os.environ, {"GHOSTMANUAL_WORKER_IMAGE": image}), patch.object(module, "command", side_effect=results), patch("time.monotonic", side_effect=[0, 6]), self.assertRaisesRegex(RuntimeError, "removal incomplete"):
            module.stop()
        receipt.unlink.assert_not_called()

    def test_wrong_owner_or_image_and_unknown_daemon_never_stop_or_unlink(self):
        for output in ["a" * 64 + " other-role sha256:" + "b" * 64, "a" * 64 + " document-worker sha256:" + "c" * 64, None]:
            module = self.load_stop(); receipt = self.receipt()
            results = [self.response(0, output)] if output else [self.response(1), self.response(1)]
            with self.subTest(output=output), patch.object(module, "CIDFILE", receipt), patch.object(module.os, "getuid", return_value=1000), patch.dict(os.environ, {"GHOSTMANUAL_WORKER_IMAGE": "sha256:" + "b" * 64}), patch.object(module, "command", side_effect=results) as command, self.assertRaises(RuntimeError):
                module.stop()
            self.assertFalse(any(call.args[0] == "stop" for call in command.call_args_list))
            receipt.unlink.assert_not_called()

    def test_already_removed_owned_id_can_clear_receipt_without_stopping(self):
        module = self.load_stop(); receipt = self.receipt()
        with patch.object(module, "CIDFILE", receipt), patch.object(module.os, "getuid", return_value=1000), patch.dict(os.environ, {"GHOSTMANUAL_WORKER_IMAGE": "sha256:" + "b" * 64}), patch.object(module, "command", side_effect=[self.response(1), self.response(0)]) as command:
            module.stop()
        self.assertFalse(any(call.args[0] == "stop" for call in command.call_args_list))
        receipt.unlink.assert_called_once_with()

if __name__ == "__main__": unittest.main()
