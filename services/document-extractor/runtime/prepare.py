"""Export one already-verified local image into an immutable, digest-named rootfs."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile

BASE = Path("/opt/ghostmanual-extractor")
GUARD = 2 * 1024**3
MAX_ROOTFS = 1500 * 1024**2
MAX_EXPORT = MAX_ROOTFS + 64 * 1024**2
CHUNK_SIZE = 64 * 1024
WRITE_SLACK = 64 * 1024


def require_headroom(path, reserve=0):
    if shutil.disk_usage(path).free < GUARD + reserve + WRITE_SLACK:
        raise RuntimeError("insufficient temporary disk headroom")


def bounded_copy(source, output, path, *, limit, reserve=0):
    total = 0
    while chunk := source.read(CHUNK_SIZE):
        if total + len(chunk) > limit:
            raise RuntimeError("export or rootfs size limit exceeded")
        require_headroom(path, reserve + len(chunk))
        if output.write(chunk) != len(chunk):
            raise OSError("incomplete bounded write")
        total += len(chunk)
    return total


def export_image(container, path):
    require_headroom(path.parent, MAX_ROOTFS + CHUNK_SIZE)
    process = subprocess.Popen(["docker", "export", container], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        with path.open("wb") as output:
            bounded_copy(process.stdout, output, path.parent, limit=MAX_EXPORT, reserve=MAX_ROOTFS)
        code = process.wait(timeout=30)
        if code:
            raise subprocess.CalledProcessError(code, ["docker", "export", container])
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


class BoundedTarFile(tarfile.TarFile):
    def makefile(self, member, target):
        require_headroom(Path(target).parent, CHUNK_SIZE)
        with self.extractfile(member) as source, open(target, "wb") as output:
            bounded_copy(source, output, Path(target).parent, limit=member.size)


def image_digest(value):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", value):
        raise ValueError("exact local sha256 image ID required")
    return value.removeprefix("sha256:")


def relative_path(value):
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("unsafe export path")
    return path


def extract_export(source, root):
    root.mkdir()
    total = 0
    with BoundedTarFile.open(fileobj=source, mode="r:*") as archive:
        for member in archive:
            relative_path(member.name)
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError("special export entry rejected")
            total += member.size
            if total > MAX_ROOTFS:
                raise ValueError("rootfs size limit exceeded")
            if member.issym() and member.linkname.startswith("/"):
                target = relative_path(member.linkname.lstrip("/"))
                member.linkname = os.path.relpath(root / str(target), (root / member.name).parent)
            elif member.islnk():
                relative_path(member.linkname)
            member.mode &= ~0o6000
            member.pax_headers = {}
            require_headroom(root, (len(PurePosixPath(member.name).parts) + 1) * WRITE_SLACK)
            archive.extract(member, path=root, filter="data")


def verify_sources(root, expected):
    required = {"service/Parser.java", "service/sandbox.py", "service/gateway.py", "service/runtime/bootstrap.py"}
    if not isinstance(expected, dict) or not required <= expected.keys():
        raise ValueError("incomplete expected source manifest")
    for name, digest in expected.items():
        relative_path(name)
        if not re.fullmatch(r"[0-9a-f]{64}", digest) or hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
            raise ValueError("image source hash mismatch: " + name)


def inventory(root):
    rows = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            rows.append({"path": relative, "link": os.readlink(path)})
        elif path.is_file():
            with path.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            rows.append({"path": relative, "mode": oct(path.stat().st_mode & 0o7777), "sha256": digest})
        elif not path.is_dir():
            raise ValueError("unexpected special rootfs entry")
    return rows


def prepare(image_id, expected):
    digest = image_digest(image_id)
    if os.geteuid() != 0:
        raise RuntimeError("root-owned rootfs preparation required")
    data = json.loads(subprocess.check_output(["docker", "image", "inspect", image_id]))[0]
    if data["Id"] != image_id:
        raise ValueError("image ID mismatch")
    require_headroom(BASE if BASE.exists() else BASE.parent, MAX_EXPORT + MAX_ROOTFS)
    BASE.mkdir(mode=0o755, exist_ok=True)
    if BASE.is_symlink() or BASE.stat().st_uid != 0 or BASE.stat().st_mode & 0o022:
        raise RuntimeError("rootfs base must be root-owned and not writable by others")
    target = BASE / digest
    if target.exists():
        raise FileExistsError("digest destination already exists; do not overwrite")
    require_headroom(BASE, MAX_EXPORT + MAX_ROOTFS)
    stage = Path(tempfile.mkdtemp(prefix=".prepare-", dir=BASE))
    container = None
    try:
        container = subprocess.check_output(["docker", "create", "--label", "ghostmanual.task=extractor-rootfs", "--network", "none", "--entrypoint", "/bin/false", image_id], text=True).strip()
        if not re.fullmatch(r"[0-9a-f]{64}", container):
            raise RuntimeError("invalid temporary container ID")
        archive_path = stage / "rootfs.tar"
        export_image(container, archive_path)
        with archive_path.open("rb") as source:
            export_sha = hashlib.file_digest(source, "sha256").hexdigest()
        root = stage / "rootfs"
        with archive_path.open("rb") as source:
            extract_export(source, root)
        verify_sources(root, expected)
        for directory in ["sys/fs/cgroup", "proc", "dev", "tmp", "run/secrets", "fixtures"]:
            (root / directory).mkdir(parents=True, exist_ok=True)
        (root / "run/secrets/server-key.pem").touch()
        (root / "etc/passwd").write_text("root:x:0:0:root:/root:/usr/sbin/nologin\ngateway:x:1000:1000:gateway:/nonexistent:/usr/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n")
        (root / "etc/group").write_text("root:x:0:\ngateway:x:1000:\nnogroup:x:65534:\n")
        (root / "etc/nsswitch.conf").write_text("passwd: files\ngroup: files\nhosts: files\n")
        (root / "etc/hosts").write_text("127.0.0.1 localhost\n::1 localhost\n")
        (root / "etc/resolv.conf").write_text("")
        archive_path.unlink()
        manifest = {"imageId": image_id, "exportSha256": export_sha, "expectedSources": expected, "files": inventory(root)}
        serialized = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        require_headroom(stage, len(serialized) + CHUNK_SIZE)
        (stage / "rootfs-manifest.json").write_bytes(serialized)
        (stage / "rootfs-manifest.sha256").write_text(hashlib.sha256(serialized).hexdigest() + "\n")
        stage.chmod(0o755)
        stage.rename(target)
        return target
    finally:
        if container:
            info = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
            if info["Id"] != container or info["Config"]["Labels"].get("ghostmanual.task") != "extractor-rootfs":
                raise RuntimeError("temporary container identity mismatch")
            subprocess.run(["docker", "rm", container], check=True, stdout=subprocess.DEVNULL)
        if stage.exists():
            if stage.parent != BASE or not stage.name.startswith(".prepare-"):
                raise RuntimeError("invalid staging cleanup path")
            shutil.rmtree(stage)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image-id", required=True)
    parser.add_argument("--source-manifest", type=Path, required=True)
    args = parser.parse_args()
    print(prepare(args.image_id, json.loads(args.source_manifest.read_text())))
