"""Actual launcher readiness gate. Missing prerequisites FAIL; no skips or privilege fallback."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sandbox import CGROUP, bounded_process, extract, sandbox_command


class IsolationGate(unittest.TestCase):
    def setUp(self):
        self.assertTrue((CGROUP / "cgroup.controllers").is_file(), "BLOCKED: no delegated cgroup v2")
        self.assertTrue(Path("/sys/fs/cgroup/memory.max").is_file(), "BLOCKED: outer cgroup memory guard missing")
        outer_limit = Path("/sys/fs/cgroup/memory.max").read_text().strip()
        self.assertTrue(outer_limit.isdigit() and int(outer_limit) <= 512 * 1024 * 1024,
                        "BLOCKED: gate requires an outer <=512MiB cgroup before OOM probes")
        fixture = Path("/fixtures/text-v1.pdf")
        self.assertTrue(fixture.is_file(), "BLOCKED: mount synthetic fixtures at /fixtures")
        self.assertTrue(Path("/run/secrets/server-key.pem").is_file(), "BLOCKED: mount synthetic gateway key fixture at /run/secrets/server-key.pem")
        self.assertNotEqual(os.getuid(), 65534, "Gateway and parser must have different host UIDs")
        self.document = fixture.read_bytes()

    def ready(self):
        result = extract("pdf", self.document)
        self.assertEqual(result["status"], "ready", "BLOCKED: actual UID/cgroup/namespace/parser launcher failed: " + str(result["reason"]))
        self.assertIn("GhostManual synthetic version 1", result["snapshot"]["blocks"][0]["text"])

    def probe(self, source, timeout=5, marker=None):
        captured = {}
        real_bounded_process = bounded_process
        def launch(command, data, group, _timeout):
            # Substitute only the test payload; production cgroup creation, UID drop,
            # namespace/mount command, byte pipe, limits, wait and cleanup stay real.
            expected = {"memory.max": "402653184", "memory.swap.max": "0", "pids.max": "64", "cpu.max": "50000 100000", "memory.oom.group": "1"}
            for name, value in expected.items():
                self.assertEqual((group / name).read_text().strip(), value)
            payload = command[:command.index("--") + 1] + ["/usr/bin/python3", "-c", source]
            marker_seen = False
            if marker is None:
                code, output = real_bounded_process(payload, data, group, timeout)
            else:
                # Timeout discards output; observe the real stdout reads without changing bytes.
                real_popen, real_read = subprocess.Popen, os.read
                stdout_fd, marker_tail = None, b""
                def track_stdout(*args, **kwargs):
                    nonlocal stdout_fd
                    process = real_popen(*args, **kwargs)
                    stdout_fd = process.stdout.fileno()
                    return process
                def read_stdout(fd, size):
                    nonlocal marker_seen, marker_tail
                    chunk = real_read(fd, size)
                    if fd == stdout_fd:
                        window = marker_tail + chunk
                        marker_seen = marker_seen or marker in window
                        marker_tail = window[-len(marker):]
                    return chunk
                with patch("sandbox.subprocess.Popen", new=track_stdout), patch("sandbox.os.read", new=read_stdout):
                    code, output = real_bounded_process(payload, data, group, timeout)
            deadline = time.monotonic() + 2
            while "populated 1" in (group / "cgroup.events").read_text() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertIn("populated 0", (group / "cgroup.events").read_text(), "Descendant survived launcher cleanup")
            self.assertEqual((group / "cgroup.procs").read_text().strip(), "")
            self.assertGreater(int((group / "memory.peak").read_text()), 0, "Child did not enter job cgroup")
            captured.update(code=code, output=output, markerSeen=marker_seen, group=group, events=(group / "memory.events").read_text())
            return code, output
        with patch("sandbox.bounded_process", new=launch):
            result = extract("pdf", self.document)
        self.assertTrue(captured, "BLOCKED: production extract did not reach the launcher: " + str(result["reason"]))
        self.assertFalse(captured["group"].exists(), "Job cgroup was not removed")
        return captured

    def test_actual_parser_reads_input_after_uid_drop(self):
        self.ready()

    def test_real_uid_network_files_proc_and_other_jobs_are_denied(self):
        with tempfile.TemporaryDirectory(prefix="gm-gate-") as tmp:
            secret = Path(tmp, "gateway-key"); secret.write_text("SYNTHETIC_GATEWAY_SECRET")
            other = Path(tmp, "other-job"); other.write_text("SYNTHETIC_OTHER_JOB")
            paths = [str(secret), str(other), "/run/secrets/server-key.pem", "/home/ubuntu", "/service", "/sys/fs/cgroup", f"/proc/{os.getpid()}/root{secret}"]
            parent_namespaces = {name: os.stat("/proc/self/ns/" + name).st_ino for name in ("net", "mnt", "pid")}
            source = """import base64,errno,hashlib,json,os,socket,sys
from pathlib import Path
body=sys.stdin.buffer.read()
assert os.getuid()==65534 and os.getgid()==65534
mapping=[line.split() for line in Path('/proc/self/uid_map').read_text().splitlines()]
# The second column is this nested namespace's immediate parent UID, not the host UID.
assert mapping==[['65534','0','1']],mapping
assert not any(name in os.environ for name in ['DATABASE_URL','DOCUMENT_EXTRACTOR_KEY'])
for namespace,inode in PARENT_NAMESPACES.items():
 assert os.stat('/proc/self/ns/'+namespace).st_ino != inode,namespace
for path in PATHS:
 assert not os.path.exists(path),path
for host,port in [('169.254.169.254',80),('1.1.1.1',443),('172.17.0.1',5432)]:
 with socket.socket() as connection:
  connection.settimeout(.25)
  assert connection.connect_ex((host,port)) != 0,host
descriptors=os.listdir('/proc/self/fd')
assert len(descriptors) <= 5
for descriptor in descriptors:
 if int(descriptor)<=2: continue
 try: os.fstat(int(descriptor))
 except OSError as error:
  assert error.errno==errno.EBADF
 else: raise AssertionError('unexpected non-stdio descriptor')
try: init_descriptors=os.listdir('/proc/1/fd')
except PermissionError: pass
else:
 for descriptor in init_descriptors:
  if int(descriptor)<=2: continue
  try: directory=os.open('/proc/1/fd/'+descriptor,os.O_PATH|os.O_DIRECTORY|os.O_CLOEXEC)
  except OSError as error:
   assert error.errno in (errno.EACCES,errno.EPERM,errno.ENOENT,errno.ENOTDIR)
  else:
   os.close(directory)
   raise AssertionError('PID1 retains an accessible directory descriptor')
value=json.dumps({'inputSha256':hashlib.sha256(body).hexdigest(),'uid':os.getuid()})
print('page\\tpage/1\\t'+base64.b64encode(value.encode()).decode())
""".replace("PATHS", repr(paths)).replace("PARENT_NAMESPACES", repr(parent_namespaces)).replace("\\t", "\t")
            before_unshare = """import os,sys
from pathlib import Path
status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert status['Uid'].split()==['65534']*4 and status['Gid'].split()==['65534']*4
assert all(int(status[name],16)==0 for name in ['CapEff','CapPrm','CapInh','CapAmb'])
assert int(status['CapBnd'],16)==0xc0 and status['NoNewPrivs'].strip()=='1'
try: os.setuid(0)
except PermissionError: pass
else: raise AssertionError('parser can regain host UID0')
os.execv(sys.argv[1],sys.argv[1:])
"""
            def host_checked_command(format):
                return ["/usr/bin/python3", "-c", before_unshare, *sandbox_command(format)]
            with patch.dict(os.environ, {"DATABASE_URL": "SYNTHETIC_DATABASE_SENTINEL", "DOCUMENT_EXTRACTOR_KEY": "SYNTHETIC_KEY_SENTINEL"}), patch("sandbox.sandbox_command", new=host_checked_command):
                captured = self.probe(source)
            self.assertEqual(captured["code"], 0)
            row = captured["output"].decode().strip().split("\t")
            report = json.loads(base64.b64decode(row[2]))
            self.assertEqual(report["inputSha256"], hashlib.sha256(self.document).hexdigest())

    def test_detached_descendants_die_at_timeout_then_parser_recovers(self):
        source = """import os,signal,sys,time
sys.stdin.buffer.read()
if os.fork()==0:
 os.setsid()
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 assert os.getsid(0)==os.getpid()
 print('SYNTHETIC_DETACHED_READY',flush=True)
 while True: time.sleep(1)
while True: time.sleep(1)
"""
        captured = self.probe(source, timeout=2, marker=b"SYNTHETIC_DETACHED_READY\n")
        self.assertTrue(captured["markerSeen"], "Detached child did not confirm setsid before timeout")
        self.assertEqual(captured["code"], 124)
        self.ready()

    def test_real_cgroup_oom_kills_job_then_parser_recovers(self):
        captured = self.probe("import sys; sys.stdin.buffer.read(); memory=bytearray(768*1024*1024)")
        self.assertNotIn(captured["code"], (0, 124))
        events = dict(line.split() for line in captured["events"].splitlines())
        self.assertGreater(int(events["oom_kill"]), 0, "Memory cgroup did not enforce its limit")
        self.ready()

    def test_output_bomb_is_killed_then_parser_recovers(self):
        captured = self.probe("import sys; sys.stdin.buffer.read(); sys.stdout.buffer.write(b'x'*(3*1024*1024))")
        self.assertEqual(captured["code"], 42)
        self.assertEqual(captured["output"], b"")
        self.ready()


if __name__ == "__main__":
    unittest.main()
