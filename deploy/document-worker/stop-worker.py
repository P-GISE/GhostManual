"""Stop only the immutable-image/role-verified container owned by this unit."""
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

CIDFILE = Path("/run/ghostmanual-document-worker-state/container.cid")


def command(*args):
    return subprocess.run(["/usr/bin/docker", *args], capture_output=True, text=True, timeout=140)


def image_identity():
    image = os.environ.get("GHOSTMANUAL_WORKER_IMAGE", "")
    if not re.fullmatch("sha256:[0-9a-f]{64}", image):
        raise RuntimeError("invalid worker image")
    return image


def stop():
    if not CIDFILE.exists():
        return
    info = CIDFILE.lstat()
    if not (stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() == 1000
            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1):
        raise RuntimeError("unsafe worker receipt")
    identifier = CIDFILE.read_text().strip()
    image = image_identity()
    if not re.fullmatch("[0-9a-f]{64}", identifier):
        raise RuntimeError("invalid worker identity")
    inspected = command("inspect", "--format", '{{.Id}} {{index .Config.Labels "ghostmanual.role"}} {{.Image}}', identifier)
    if inspected.returncode:
        absent = command("ps", "-a", "--no-trunc", "--filter", "id=" + identifier, "--format", "{{.ID}}")
        if absent.returncode or absent.stdout.strip():
            raise RuntimeError("worker state unavailable")
    else:
        if inspected.stdout.strip().split() != [identifier, "document-worker", image]:
            raise RuntimeError("worker ownership mismatch")
        stopped = command("stop", "--time=130", identifier)
        if stopped.returncode:
            raise RuntimeError("worker stop failed")
        deadline = time.monotonic() + 5
        while True:
            absent = command("ps", "-a", "--no-trunc", "--filter", "id=" + identifier, "--format", "{{.ID}}")
            if absent.returncode:
                raise RuntimeError("worker state unavailable")
            if not absent.stdout.strip():
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("worker removal incomplete")
            time.sleep(0.1)
    current = CIDFILE.lstat()
    if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino) or CIDFILE.read_text().strip() != identifier:
        raise RuntimeError("worker receipt changed")
    CIDFILE.unlink()


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--check-image"]:
            image_identity()
        elif not sys.argv[1:]:
            stop()
        else:
            raise RuntimeError("invalid arguments")
    except Exception:
        raise SystemExit("document worker stop rejected")
