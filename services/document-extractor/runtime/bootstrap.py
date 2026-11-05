"""Bounded, delegated readiness runtime. No arbitrary commands or production credentials."""
import base64
import ctypes
import errno
import json
import os
from pathlib import Path
import unittest
import sys
import time
from unittest.mock import patch

OUTER_LIMITS = {"memory.max": "536870912", "memory.swap.max": "0", "pids.max": "128", "cpu.max": "50000 100000"}
CONTROLLERS = {"cpu", "memory", "pids"}


def require_outer_permissions(root):
    for name in OUTER_LIMITS:
        control = root / name
        if control.stat().st_uid != 0 or os.access(control, os.W_OK):
            raise RuntimeError("outer resource control must be root-owned and not writable")
    for name in ("cgroup.procs", "cgroup.subtree_control"):
        if not os.access(root / name, os.W_OK):
            raise RuntimeError("missing delegated cgroup permission")


def configure(root=Path("/sys/fs/cgroup")):
    require_outer_permissions(root)
    if any((root / name).read_text().strip() != value for name, value in OUTER_LIMITS.items()):
        raise RuntimeError("incorrect outer resource guard")
    if not CONTROLLERS <= set((root / "cgroup.controllers").read_text().split()):
        raise RuntimeError("missing resource controller")
    if (root / "cgroup.procs").read_text().strip():
        raise RuntimeError("supervisor must be in DelegateSubgroup")
    enabled = set((root / "cgroup.subtree_control").read_text().split())
    missing = CONTROLLERS - enabled
    if missing:
        (root / "cgroup.subtree_control").write_text(" ".join("+" + name for name in sorted(missing)))
    if not CONTROLLERS <= set((root / "cgroup.subtree_control").read_text().split()):
        raise RuntimeError("outer controllers could not be enabled")
    child = root / "extractor"
    child.mkdir(exist_ok=True)
    if any(entry.is_dir() for entry in child.iterdir()):
        raise RuntimeError("unexpected existing job cgroup")
    if not CONTROLLERS <= set((child / "cgroup.controllers").read_text().split()):
        raise RuntimeError("missing child controller")
    (child / "cgroup.subtree_control").write_text("+cpu +memory +pids")
    return child


def probe_outer_readonly(root=Path("/sys/fs/cgroup")):
    values = {name: (root / name).read_bytes() for name in OUTER_LIMITS}
    aliases = []
    if root == Path("/sys/fs/cgroup"):
        membership = next(line.split(":", 2)[2] for line in Path("/proc/self/cgroup").read_text().splitlines() if line.startswith("0::"))
        if not membership.endswith("/gateway"):
            raise RuntimeError("unexpected supervisor cgroup")
        unit_path = membership.removesuffix("/gateway").lstrip("/")
        aliases = [Path("/proc/self/root/sys/fs/cgroup"), Path("/proc/1/root/sys/fs/cgroup") / unit_path]
    pid = os.fork()
    if pid == 0:
        try:
            os.setuid(0)
            if os.geteuid() != 0:
                os._exit(2)
            for base in [root, *aliases]:
                for name, value in values.items():
                    fd = None
                    try:
                        fd = os.open(base / name, os.O_WRONLY | os.O_CLOEXEC)
                        os.write(fd, value)
                    except OSError as error:
                        accepted = {errno.EROFS, errno.EACCES} if base == root else {errno.EROFS, errno.EACCES, errno.EPERM, errno.ENOENT}
                        if error.errno not in accepted:
                            os._exit(1)
                    else:
                        os._exit(1)
                    finally:
                        if fd is not None:
                            os.close(fd)
            os._exit(0)
        except BaseException:
            os._exit(2)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        finished, status = os.waitpid(pid, os.WNOHANG)
        if finished:
            if status != 0 or any((root / name).read_bytes() != value for name, value in values.items()):
                raise RuntimeError("root UID can reach a writable outer resource control")
            return
        time.sleep(0.01)
    raise RuntimeError("outer control proof timed out")


def probe():
    import sandbox
    status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
    if os.getuid() != 1000 or os.getgid() != 1000 or int(status["CapEff"], 16) != 0xC0 or int(status["CapBnd"], 16) != 0xC0 or status["NoNewPrivs"].strip() != "1":
        raise RuntimeError("incorrect UID, host capabilities, or no-new-privileges")
    if ctypes.CDLL(None).prctl(39, 0, 0, 0, 0) != 1:
        raise RuntimeError("no-new-privileges missing")
    probe_outer_readonly()
    original = sandbox.sandbox_command
    command = original("pdf")
    capability_check = "from pathlib import Path; status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line); assert all(int(status[name],16)==0 for name in ['CapEff','CapPrm','CapInh','CapAmb']); assert status['NoNewPrivs'].strip()=='1'; "
    payload = "import os; assert os.getuid()==65534 and os.getgid()==65534; " + capability_check + "print('paragraph\tprobe\t" + base64.b64encode(b"SYNTHETIC_NAMESPACE_PROBE").decode() + "')"
    command = command[:command.index("--") + 1] + ["/usr/bin/python3", "-c", payload]
    before_unshare = "import os,sys; assert os.getuid()==65534 and os.getgid()==65534; " + capability_check + "assert int(status['CapBnd'],16)==0xC0; \ntry: os.setuid(0)\nexcept PermissionError: pass\nelse: raise RuntimeError('parser can regain host UID0')\nos.execv(sys.argv[1],sys.argv[1:])"
    command = ["/usr/bin/python3", "-c", before_unshare, *command]
    with patch("sandbox.sandbox_command", return_value=command):
        result = sandbox.extract("pdf", b"synthetic probe")
    if result["status"] != "ready" or result["snapshot"]["blocks"][0]["text"] != "SYNTHETIC_NAMESPACE_PROBE":
        raise RuntimeError("namespace probe failed: " + str(result["reason"]))
    print(json.dumps({"probe": "passed", "gatewayUid": 1000, "parserUid": 65534, "hostCapabilities": "SETUID,SETGID", "outerControlsWritable": False}))


def smoke_formats():
    from sandbox import extract
    for format, prefix in [("hwp", "sample"), ("doc", "office"), ("ppt", "slides"), ("pdf", "text"), ("pdf", "scan-ko")]:
        versions = []
        for version in (1, 2):
            result = extract(format, Path(f"/fixtures/{prefix}-v{version}.{format}").read_bytes())
            expected = "limited" if prefix == "scan-ko" else "ready"
            if result["status"] != expected or result["snapshot"] is None:
                raise RuntimeError("final-image format gate failed: " + prefix)
            text = "\n".join(block["text"] for block in result["snapshot"]["blocks"])
            required = f"한글 합성 문서 {version}" if prefix == "sample" else f"GhostManual synthetic version {version}"
            if prefix == "scan-ko":
                if not all(value in text for value in ("한글", "GhostManual", str(version))) or result["snapshot"]["extractionMode"] != "ocr":
                    raise RuntimeError("final-image Korean OCR gate failed")
            elif required not in text:
                raise RuntimeError("final-image text mismatch: " + prefix)
            if "SECRET_HIDDEN" in text or (prefix == "slides" and f"TABLE CELL {version}" not in text):
                raise RuntimeError("final-image coverage mismatch")
            versions.append(text)
            print(json.dumps({"format": format, "fixture": prefix, "version": version, "status": result["status"]}), flush=True)
        if versions[0] == versions[1]:
            raise RuntimeError("version difference missing: " + prefix)
    print("PASS: 10 final-image extractions through the real sandbox", flush=True)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"probe", "gate"}:
        raise SystemExit("expected probe or gate")
    sys.path.insert(0, "/service")
    configure()
    probe()
    if sys.argv[1] == "gate":
        suite = unittest.defaultTestLoader.discover("/service/tests", pattern="test_isolation.py")
        if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
            raise SystemExit(1)
        smoke_formats()


if __name__ == "__main__":
    main()
