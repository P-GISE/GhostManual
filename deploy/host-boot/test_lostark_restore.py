import importlib.util
import json
import fcntl
import os
import runpy
import tempfile
from contextlib import nullcontext
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("restore", Path(__file__).with_name("lostark-restore.py"))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class BootRecovery(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.ip_after = 0
        self.failed = None
        self.health = "healthy"
        self.starts = []
        self.inspects = []
        self.services = ("postgres", "web", "worker", "character-worker")
        self.ids = {service: str(i) * 64 for i, service in enumerate(self.services, 1)}
        self.states = dict.fromkeys(self.services, "exited")
        self.projects = dict.fromkeys(self.services, "lostark-party")
        self.identity_change = False
        locks = patch.object(restore, "deployment_locks", return_value=nullcontext())
        self.locks = locks.start()
        self.addCleanup(locks.stop)
        clock = patch.object(restore.time, "monotonic", side_effect=lambda: self.now)
        sleep = patch.object(restore.time, "sleep", side_effect=self.advance)
        run = patch.object(restore.subprocess, "check_output", side_effect=self.run_command)
        for mock in (clock, sleep, run):
            mock.start()
            self.addCleanup(mock.stop)

    def advance(self, seconds):
        self.now += seconds

    def run_command(self, args, *, text, timeout):
        self.assertTrue(text)
        self.assertGreater(timeout, 0)
        if args[0] == "/usr/sbin/ip":
            interface = "tailscale0" if self.now >= self.ip_after else "eth0"
            return json.dumps([{"ifname": interface, "flags": ["UP"], "addr_info": [
                {"family": "inet", "local": "100.97.248.52"}
            ]}])
        self.assertEqual(args[0], "/usr/bin/docker")
        key = args[-1]
        service = next(s for s, i in self.ids.items() if key in (i, f"lostark-party-{s}-1"))
        if args[1] == "start":
            self.assertEqual(key, self.ids[service])
            self.starts.append(service)
            if self.failed == ("start", service):
                raise subprocess.CalledProcessError(1, args)
            self.states[service] = "running"
            return key
        self.assertEqual(args[1], "inspect")
        self.inspects.append(service)
        if self.failed == ("inspect", service):
            raise subprocess.CalledProcessError(1, args)
        inspected_id = self.ids[service]
        if self.identity_change and service == "web" and key == inspected_id:
            inspected_id = "a" * 64
        return "|".join((inspected_id, "/lostark-party-" + service + "-1",
                         self.projects[service], service, self.states[service],
                         self.health if service == "postgres" else "none"))

    def test_no_address_times_out_without_docker(self):
        self.ip_after = 121
        with self.assertRaises(TimeoutError):
            restore.main()
        self.assertEqual(self.now, 120)
        self.assertEqual(self.inspects + self.starts, [])

    def test_missing_app_blocks_all_starts(self):
        self.failed = ("inspect", "worker")
        with self.assertRaises(subprocess.CalledProcessError):
            restore.main()
        self.assertEqual(self.starts, [])

    def test_wrong_project_blocks_all_starts(self):
        self.projects["character-worker"] = "some-other-service"
        with self.assertRaises(RuntimeError):
            restore.main()
        self.assertEqual(self.starts, [])

    def test_unhealthy_db_does_not_start_apps(self):
        self.health = "unhealthy"
        with self.assertRaises(TimeoutError):
            restore.main()
        self.assertEqual(self.now, 180)
        self.assertEqual(self.starts, ["postgres"])

    def test_already_running_is_untouched(self):
        self.states = dict.fromkeys(self.services, "running")
        restore.main()
        self.assertEqual(self.starts, [])

    def test_delayed_address_starts_only_four_existing_ids(self):
        self.ip_after = 5
        restore.main()
        self.assertGreaterEqual(self.now, self.ip_after)
        self.assertEqual(self.starts, list(self.services))

    def test_container_identity_change_prevents_app_start(self):
        self.identity_change = True
        with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
            restore.main()
        self.assertEqual(self.starts, ["postgres"])

    @unittest.skipUnless(os.geteuid() == 0 and Path("/usr/local/lib/lostark-event/trust.py").exists(),
                         "requires installed root-owned host deployment lock helper")
    def test_real_busy_lock_prevents_inspect_and_start(self):
        helper = runpy.run_path("/usr/local/lib/lostark-event/trust.py")["deployment_locks"]
        with tempfile.TemporaryDirectory(dir="/run") as tmp:
            files = [Path(tmp, name) for name in ("poll.lock", "app.lock")]
            for file in files:
                file.touch(mode=0o600)
            observed = []

            def map_path(path):
                original = ("/var/lib/lostark-deploy/poll.lock", "/opt/lostark-party/.app-deploy.lock")
                observed.append(path)
                return files[original.index(path)]

            with patch.dict(helper.__wrapped__.__globals__, {"Path": map_path}):
                self.locks.side_effect = helper
                with files[1].open("r+") as contender:
                    fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    with self.assertRaisesRegex(RuntimeError, "lock_timeout"):
                        restore.main()
                self.assertEqual(self.now, 60)
                self.assertEqual(observed, ["/var/lib/lostark-deploy/poll.lock",
                                            "/opt/lostark-party/.app-deploy.lock"])
                self.assertEqual(self.inspects + self.starts, [])
                with files[0].open("r+") as released:
                    fcntl.flock(released, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_start_error_stops_sequence(self):
        self.failed = ("start", "web")
        with self.assertRaises(subprocess.CalledProcessError):
            restore.main()
        self.assertEqual(self.starts, ["postgres", "web"])


if __name__ == "__main__":
    unittest.main()
