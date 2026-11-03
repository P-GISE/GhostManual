import json
import re
import runpy
import subprocess
import time

PROJECT = "lostark-party"
SERVICES = ("postgres", "web", "worker", "character-worker")
ADDRESS = "100.97.248.52"
FORMAT = '|'.join(('{{.Id}}', '{{.Name}}', '{{index .Config.Labels "com.docker.compose.project"}}',
                   '{{index .Config.Labels "com.docker.compose.service"}}', '{{.State.Status}}',
                   '{{with index .State "Health"}}{{.Status}}{{else}}none{{end}}'))


def address_ready():
    raw = subprocess.check_output(["/usr/sbin/ip", "-j", "-4", "address", "show", "to",
                                   ADDRESS + "/32"], text=True, timeout=5)
    return any(link["ifname"] == "tailscale0" and "UP" in link["flags"]
               and any(addr["local"] == ADDRESS for addr in link["addr_info"])
               for link in json.loads(raw))


def wait(check, seconds, description):
    deadline = time.monotonic() + seconds
    while not check():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(description)
        time.sleep(min(2, remaining))


def inspect(service, reference):
    raw = subprocess.check_output(["/usr/bin/docker", "inspect", "--type", "container",
                                   "--format", FORMAT, reference], text=True, timeout=5)
    cid, name, project, label, status, health = raw.strip().split("|")
    if (reference not in (cid, name.removeprefix("/")) or not re.fullmatch("[0-9a-f]{64}", cid) or name != f"/{PROJECT}-{service}-1"
            or project != PROJECT or label != service):
        raise RuntimeError(f"container identity mismatch for {service}")
    if status not in ("created", "exited", "running", "restarting"):
        raise RuntimeError(f"unexpected state for {service}: {status}")
    return cid, status, health


def deployment_locks():
    # Share the deployer's lock order, timeout, and inode safety checks.
    return runpy.run_path("/usr/local/lib/lostark-event/trust.py")["deployment_locks"]()


def main():
    wait(address_ready, 120, "Tailscale bind address unavailable")
    with deployment_locks():
        recover()


def recover():
    # Validate the entire set before starting anything, then act by immutable IDs.
    ids = {s: inspect(s, f"{PROJECT}-{s}-1")[0] for s in SERVICES}
    for service, cid in ids.items():
        _, status, _ = inspect(service, cid)
        if status in ("created", "exited"):
            subprocess.check_output(["/usr/bin/docker", "start", cid], text=True, timeout=20)
        if service == "postgres":
            wait(lambda: inspect("postgres", ids["postgres"])[1:] == ("running", "healthy"),
                 180, "Postgres did not become healthy")
    wait(lambda: all(inspect(s, ids[s])[1] == "running" for s in SERVICES[1:]),
         20, "LostArk services did not reach running state")


if __name__ == "__main__":
    main()
