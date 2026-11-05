"""Download the reviewed bytes only. Run before docker build, never in the gateway."""
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request

root = Path(__file__).resolve().parent
for item in json.loads((root / "dependencies.lock.json").read_text()):
    destination = root / ".vendor" / item["file"]
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == item["sha256"]:
        continue
    if shutil.disk_usage(root).free < 2 * 1024**3 + 256 * 1024**2:
        raise SystemExit("Insufficient free disk: preserve 2 GiB")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    with urllib.request.urlopen(item["url"], timeout=30) as response, temporary.open("wb") as output:
        remaining = item["bytes"]
        while remaining:
            chunk = response.read(min(65536, remaining))
            if not chunk:
                raise SystemExit("Truncated dependency")
            output.write(chunk)
            remaining -= len(chunk)
        if response.read(1):
            raise SystemExit("Oversize dependency")
    if hashlib.sha256(temporary.read_bytes()).hexdigest() != item["sha256"]:
        raise SystemExit("Dependency checksum mismatch")
    temporary.replace(destination)
print("All pinned dependencies verified")
