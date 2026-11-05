"""Fail-closed per-job sandbox. Requires unprivileged namespaces and delegated cgroup v2."""
import base64
import ctypes
import os
from pathlib import Path
import resource
import selectors
import signal
import subprocess
import time
import uuid

FORMATS = {"hwp", "doc", "ppt", "pdf"}
OUTPUT_LIMIT = 2 * 1024 * 1024
CGROUP = Path("/sys/fs/cgroup/extractor")
COVERAGE = ["본문 텍스트", "서식·이미지·표 구조 비교 제외", "PDF 읽기 순서 추정", "PPT 발표자 노트·숨김 슬라이드 제외"]


def failure(reason, status="failed"):
    return {"status": status, "snapshot": None, "reason": reason, "coverage": []}


def sandbox_command(format):
    if format not in FORMATS:
        raise ValueError("invalid_document")
    command = ["/usr/bin/bwrap", "--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--uid", "65534", "--gid", "65534", "--cap-drop", "ALL"]
    for path in ["/usr", "/lib", "/lib64", "/opt/tika", "/opt/parser", "/etc/java-17-openjdk", "/etc/fonts", "/etc/ld.so.cache"]:
        if Path(path).exists():
            command += ["--ro-bind", path, path]
    command += ["--proc", "/proc", "--dev", "/dev", "--size", "134217728", "--tmpfs", "/tmp", "--chdir", "/tmp", "--setenv", "HOME", "/tmp", "--setenv", "PATH", "/usr/bin", "--setenv", "LANG", "C.UTF-8", "--", "/usr/lib/jvm/java-17-openjdk-amd64/bin/java", "-Xmx256m", "-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC", "-Djava.io.tmpdir=/tmp", "-Djava.awt.headless=true", "-cp", "/opt/parser:/opt/tika/lib/*:/opt/tika/*", "Parser", format]
    return command


def drop_parser_privileges():
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)
    # A non-root -> non-root UID change does not clear ambient/permitted capabilities.
    libc = ctypes.CDLL(None, use_errno=True)
    class Header(ctypes.Structure):
        _fields_ = [("version", ctypes.c_uint32), ("pid", ctypes.c_int)]
    class Data(ctypes.Structure):
        _fields_ = [("effective", ctypes.c_uint32), ("permitted", ctypes.c_uint32), ("inheritable", ctypes.c_uint32)]
    header = Header(0x20080522, 0)
    data = (Data * 2)()
    if libc.prctl(47, 4, 0, 0, 0) != 0 or libc.capset(ctypes.byref(header), ctypes.byref(data)) != 0 or libc.prctl(38, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "parser privilege drop failed")


def bounded_process(command, data, group, timeout):
    def enter_group():
        (group / "cgroup.procs").write_text(str(os.getpid()))
        drop_parser_privileges()
        resource.setrlimit(resource.RLIMIT_FSIZE, (20 * 1024 * 1024, 20 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={}, close_fds=True, start_new_session=True, preexec_fn=enter_group)
    selector = selectors.DefaultSelector()
    output = bytearray()
    deadline = time.monotonic() + timeout
    try:
        os.set_blocking(process.stdin.fileno(), False)
        os.set_blocking(process.stdout.fileno(), False)
        selector.register(process.stdin, selectors.EVENT_WRITE)
        selector.register(process.stdout, selectors.EVENT_READ)
        offset = 0
        while selector.get_map():
            if time.monotonic() > deadline:
                return 124, b""
            for key, _ in selector.select(min(0.2, max(0, deadline - time.monotonic()))):
                if key.fileobj is process.stdin:
                    try:
                        offset += os.write(process.stdin.fileno(), data[offset:offset + 65536])
                    except BrokenPipeError:
                        offset = len(data)
                    if offset == len(data):
                        selector.unregister(process.stdin)
                        process.stdin.close()
                else:
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        selector.unregister(process.stdout)
                    output.extend(chunk)
                    if len(output) > OUTPUT_LIMIT:
                        return 42, b""
        return process.wait(timeout=max(0.1, deadline - time.monotonic())), bytes(output)
    except subprocess.TimeoutExpired:
        return 124, b""
    finally:
        # The gateway can write its cgroup but cannot signal the different parser UID.
        cleanup_error = None
        try:
            (group / "cgroup.kill").write_text("1")
        except OSError as error:
            cleanup_error = error
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError as error:
            if cleanup_error is not None:
                cleanup_error = error
        except OSError as error:
            cleanup_error = error
        try:
            process.wait(timeout=2)
            events = group / "cgroup.events"
            deadline = time.monotonic() + 2
            while events.exists() and "populated 1" in events.read_text():
                if time.monotonic() >= deadline:
                    raise OSError("sandbox_cleanup_failed")
                time.sleep(0.02)
        except (OSError, subprocess.TimeoutExpired) as error:
            cleanup_error = error
        finally:
            selector.close()
            process.stdout.close()
            if not process.stdin.closed:
                process.stdin.close()
        if cleanup_error is not None:
            raise OSError("sandbox_cleanup_failed") from cleanup_error


def normalize(format, code, output):
    if code != 0:
        return failure({42: "limit_exceeded", 43: "unsafe_document", 44: "invalid_document", 124: "timeout"}.get(code, "parser_failed"), "rejected" if code in (42, 43, 44) else "failed")
    blocks = []
    chars = 0
    mode = "native"
    try:
        for line in output.decode("utf-8", errors="strict").splitlines():
            if line == "mode\tocr":
                mode = "ocr"
                continue
            kind, path, encoded = line.split("\t")
            if kind not in {"paragraph", "slide", "page"} or len(path) > 200:
                raise ValueError()
            text = base64.b64decode(encoded, validate=True).decode("utf-8", errors="strict")
            chars += len(text)
            blocks.append({"kind": kind, "path": path, "text": text})
            if chars > 200000 or len(blocks) > 5000:
                raise ValueError()
        if sum(b["kind"] in {"slide", "page"} for b in blocks) > 20:
            raise ValueError()
    except (ValueError, UnicodeError):
        return failure("parser_failed")
    reason = "ocr_uncertain" if mode == "ocr" else None
    if not blocks or not any(b["text"].strip() for b in blocks):
        reason = "empty_document"
    return {"status": "limited" if reason else "ready", "reason": reason, "coverage": COVERAGE, "snapshot": {"v": 1, "format": format, "parserVersion": "tika-4.2.0-gm1", "normalizationVersion": 1, "extractionMode": mode, "blocks": blocks, "coverage": COVERAGE, "warnings": ["OCR 결과 원본 대조 필요"] if mode == "ocr" else []}}


def extract(format, data):
    if format not in FORMATS or not 0 < len(data) <= 5 * 1024 * 1024:
        return failure("invalid_document", "rejected")
    group = CGROUP / ("job-" + uuid.uuid4().hex)
    try:
        if not (CGROUP / "cgroup.controllers").is_file():
            return failure("sandbox_unavailable")
        group.mkdir(mode=0o700)
        for name, value in {"memory.max": "402653184", "memory.swap.max": "0", "pids.max": "64", "cpu.max": "50000 100000", "memory.oom.group": "1"}.items():
            (group / name).write_text(value)
        if not (group / "cgroup.kill").is_file():
            return failure("sandbox_unavailable")
        code, output = bounded_process(sandbox_command(format), data, group, 120 if format == "pdf" else 60)
        return normalize(format, code, output)
    except (OSError, subprocess.SubprocessError):
        return failure("sandbox_unavailable")
    finally:
        if group.exists():
            try:
                (group / "cgroup.kill").write_text("1")
                group.rmdir()
            except OSError:
                pass
