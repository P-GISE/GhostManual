#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
from urllib.parse import quote
import zipfile

REPO = "P-GISE/GhostManual"
BRANCH = "feat/ghostmanual-mvp"
ROOT = Path("/opt/ghostmanual")
STATE = Path("/var/lib/ghostmanual-deploy")
APP = "ghostmanual-app-1"
IMAGE = re.compile(r"sha256:[0-9a-f]{64}")
SHA = re.compile(r"[0-9a-f]{40}")


class DeployError(Exception):
    pass


class Interrupted(DeployError):
    pass


def command(args, *, output=None, timeout=120):
    result = subprocess.run(args, stdout=output or subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=timeout, check=False, env={**os.environ, "LC_ALL": "C.UTF-8"})
    if result.returncode:
        raise DeployError("command_failed")
    return result.stdout.decode() if output is None else ""


def api(endpoint, *, output=None):
    value = command(["runuser", "-u", "ubuntu", "--", "env", "HOME=/home/ubuntu",
                     "GH_PROMPT_DISABLED=1", "gh", "api", f"repos/{REPO}/{endpoint}"],
                    output=output, timeout=300)
    return json.loads(value) if output is None else None


def verified_run(run, sha):
    return all((run.get("head_sha") == sha, run.get("head_branch") == BRANCH,
                run.get("event") == "push", run.get("path") == ".github/workflows/ci.yml",
                run.get("status") == "completed", run.get("conclusion") == "success"))


def protected_tree(tree):
    if tree.get("truncated"):
        raise DeployError("truncated_schema_tree")
    result = {item["path"]: item["sha"] for item in tree["tree"]
              if item["type"] == "blob" and (item["path"].startswith("db/") or
                 item["path"] in ("scripts/migrate.ts", "compose.yaml"))}
    if not result:
        raise DeployError("missing_schema_tree")
    return result


def image_environment(text, image):
    if not IMAGE.fullmatch(image):
        raise DeployError("invalid_image")
    result, count = re.subn(r"^GHOSTMANUAL_IMAGE=.*$", f"GHOSTMANUAL_IMAGE={image}", text,
                            flags=re.MULTILINE)
    if count != 1:
        raise DeployError("ambiguous_image_setting")
    return result


def atomic_write(path, content):
    fd, temporary = tempfile.mkstemp(prefix=".deploy-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def inspect(name):
    return json.loads(command(["docker", "inspect", name], timeout=20))[0]


def other_containers():
    names = command(["docker", "ps", "-a", "--format", "{{.Names}}"]).splitlines()
    result = {}
    for name in names:
        if name == APP:
            continue
        item = inspect(name)
        result[name] = (item["Id"], item["State"]["StartedAt"], item["State"]["Running"],
                        item["RestartCount"], item["State"]["OOMKilled"])
    return result


def switch_app(image):
    if not IMAGE.fullmatch(image):
        raise DeployError("invalid_image")
    command(["docker", "compose", "--project-directory", str(ROOT), "-p", "ghostmanual",
             "--env-file", str(ROOT / ".env"), "-f", str(ROOT / "compose.yaml"),
             "-f", str(ROOT / "compose.no-logs.yaml"),
             "up", "-d", "--no-deps", "--no-build", "--pull", "never", "app"])


def health(image):
    for attempt in range(6):
        item = inspect(APP)
        good = item["Image"] == image and item["State"]["Running"] and not item["State"]["OOMKilled"]
        if good:
            try:
                for url in ("http://127.0.0.1:3200/", "https://ghostmanual.pigs0516.com/"):
                    code = command(["curl", "--silent", "--max-time", "8", "--output", "/dev/null",
                                    "--write-out", "%{http_code}", url])
                    if code != "200":
                        raise DeployError("http_health")
                command(["docker", "exec", APP, "node", "--input-type=module", "-e",
                         "import pg from 'pg'; const c=new pg.Client({connectionString:process.env.DATABASE_URL});"
                         "try {await c.connect(); await c.query('SELECT 1');} finally {await c.end();}"], timeout=5)
                return
            except Interrupted:
                raise
            except (DeployError, subprocess.TimeoutExpired):
                print("ghostmanual_deploy status=health_retry attempt=" + str(attempt + 1), flush=True)
        if attempt < 5:
            time.sleep(2)
    raise DeployError("health_failed")


def replace_app(old, new, write_environment, switch, check_health, preserved):
    try:
        write_environment(new)
        switch(new)
        check_health(new)
        preserved()
    except BaseException:
        write_environment(old)
        switch(old)
        check_health(old)
        raise


def poll():
    sha = api(f"commits/{quote(BRANCH, safe='')}")["sha"]
    if not SHA.fullmatch(sha):
        raise DeployError("invalid_head")
    previous = json.loads((STATE / "deployed.json").read_text())
    if previous["sha"] == sha:
        return "unchanged"
    if (STATE / "failed-sha").exists() and (STATE / "failed-sha").read_text().strip() == sha:
        return "blocked_after_failure"
    runs = api("actions/workflows/ci.yml/runs?event=push&head_sha=" + sha +
               "&branch=" + quote(BRANCH, safe="") + "&per_page=1")["workflow_runs"]
    if not runs or not verified_run(runs[0], sha):
        return "waiting_for_successful_ci"
    run = runs[0]
    for revision in (previous["sha"], sha):
        if not SHA.fullmatch(revision):
            raise DeployError("invalid_baseline")
    before = protected_tree(api(f"git/trees/{previous['sha']}?recursive=1"))
    after = protected_tree(api(f"git/trees/{sha}?recursive=1"))
    if before != after:
        raise DeployError("schema_or_compose_change_requires_review")
    artifacts = api(f"actions/runs/{int(run['id'])}/artifacts")["artifacts"]
    artifacts = [item for item in artifacts if item["name"] == f"ghostmanual-image-{sha}" and not item["expired"]]
    if len(artifacts) != 1:
        raise DeployError("missing_unique_artifact")
    artifact = artifacts[0]
    digest = artifact.get("digest", "")
    if not IMAGE.fullmatch(digest) or not 0 < artifact["size_in_bytes"] < 1024 ** 3:
        raise DeployError("artifact_metadata_invalid")
    if shutil.disk_usage(ROOT).free < 2 * 1024 ** 3:
        raise DeployError("insufficient_disk")
    env_path = ROOT / ".env"
    if env_path.is_symlink() or env_path.stat().st_uid != 0 or env_path.stat().st_mode & 0o777 != 0o600:
        raise DeployError("unsafe_environment_permissions")
    original_environment = env_path.read_text()
    old = inspect(APP)
    if old["Image"] != previous["image"] or not old["State"]["Running"]:
        raise DeployError("running_release_mismatch")
    others = other_containers()
    tunnel = command(["systemctl", "show", "cloudflared", "-p", "MainPID", "-p", "ActiveEnterTimestampMonotonic"])
    def preserved():
        if other_containers() != others or command(["systemctl", "show", "cloudflared", "-p", "MainPID",
                                                    "-p", "ActiveEnterTimestampMonotonic"]) != tunnel:
            raise DeployError("unrelated_service_changed")
    with tempfile.TemporaryDirectory(prefix="download-", dir=STATE) as temporary:
        archive = Path(temporary) / "artifact.zip"
        with archive.open("wb") as stream:
            api(f"actions/artifacts/{int(artifact['id'])}/zip", output=stream)
        with archive.open("rb") as stream:
            actual = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != digest:
            raise DeployError("artifact_digest_mismatch")
        image_archive = Path(temporary) / "image.tar.gz"
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if len(members) != 1 or members[0].filename != "ghostmanual-image.tar.gz" or members[0].file_size > 1536 * 1024 ** 2:
                raise DeployError("unexpected_artifact_contents")
            with bundle.open(members[0]) as source, image_archive.open("wb") as target:
                shutil.copyfileobj(source, target)
        command(["docker", "load", "--input", str(image_archive)], timeout=300)
    candidate = inspect(f"ghostmanual:{sha}")
    image = candidate["Id"]
    config = candidate["Config"]
    if not IMAGE.fullmatch(image) or (config.get("Labels") or {}).get("org.opencontainers.image.revision") != sha:
        raise DeployError("image_revision_mismatch")
    if config.get("User") != "node" or config.get("Cmd") != ["node", "server.js"]:
        raise DeployError("unexpected_runtime")
    command(["docker", "run", "--rm", "--network", "none", "--read-only", "--entrypoint", "node",
             image, "--check", "/app/server.js"])
    if api(f"commits/{quote(BRANCH, safe='')}")["sha"] != sha:
        return "superseded"
    preserved()
    atomic_write(STATE / "previous-environment", original_environment)
    def set_image(value):
        atomic_write(env_path, image_environment(original_environment, value))
    def finish_release():
        preserved()
        atomic_write(STATE / "deployed.json", json.dumps({"sha": sha, "image": image,
                     "previous_sha": previous["sha"], "previous_image": previous["image"],
                     "run_id": run["id"], "deployed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}) + "\n")
    try:
        replace_app(previous["image"], image, set_image, switch_app, health, finish_release)
    except BaseException:
        atomic_write(STATE / "deployed.json", json.dumps(previous) + "\n")
        atomic_write(STATE / "failed-sha", sha + "\n")
        raise
    return "deployed_" + sha


def main():
    import fcntl
    if os.geteuid() != 0:
        raise DeployError("root_required")
    os.umask(0o077)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    with (STATE / "deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("ghostmanual_deploy status=another_deployment_running", flush=True)
            return
        print("ghostmanual_deploy status=" + poll(), flush=True)


def interrupted(signum, frame):
    raise Interrupted("deployment_interrupted")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never print subprocess output, URLs with credentials, or environment contents.
        category = str(error) if isinstance(error, DeployError) else type(error).__name__
        print("ghostmanual_deploy status=failed reason=" + category, flush=True)
        raise SystemExit(1)
