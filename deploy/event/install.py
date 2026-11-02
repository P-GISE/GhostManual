"""One-time offline-reviewed installation. Creates the fixed entry last; never switches the app."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import types

WRAPPER = Path('/usr/local/libexec/ghostmanual-event-entry')
WRAPPER_BYTES = (b'#!/bin/sh\nexec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root '
                 b'/usr/bin/python3 -I -B /usr/local/lib/ghostmanual-event/entry.py "$@"\n')


def check(condition):
    if not condition:
        raise ValueError('install_precondition_failed')


def trusted_dir(path):
    for parent in (path, *path.parents):
        info = parent.lstat()
        check(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and not info.st_mode & 0o022)


def staged(path):
    info = path.lstat()
    check(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and
          info.st_uid == info.st_gid == 0 and info.st_nlink == 1)
    return path.read_bytes()


def new_file(path, raw, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def run():
    check(os.geteuid() == 0 and len(sys.argv) == 1)
    os.umask(0o077)
    stage = Path(__file__).absolute().parent
    trusted_dir(stage)
    check(stage.parent == Path('/root') and stage.name.startswith('ghostmanual-event-install-')
          and stat.S_IMODE(stage.lstat().st_mode) == 0o700)
    cfg_raw = staged(stage / 'review.json')
    cfg = json.loads(cfg_raw)
    check(cfg['approved'] is True and cfg['semantic_review'] is True)
    files = {n: staged(stage / n) for n in ('entry.py', 'deploy-poll.py', 'install.py')}
    check(all(hashlib.sha256(raw).hexdigest() == cfg['module_hashes'][name] for name, raw in files.items()))
    entry = types.ModuleType('entry')
    entry.__file__ = str(stage / 'entry.py')
    exec(compile(files['entry.py'], entry.__file__, 'exec'), vars(entry))
    legacy = types.ModuleType('legacy')
    exec(compile(files['deploy-poll.py'], str(stage / 'deploy-poll.py'), 'exec'), vars(legacy))
    entry.legacy_guard(legacy)
    for directory in (WRAPPER.parent, entry.LIB.parent, entry.STATE):
        trusted_dir(directory)
    check(not any(os.path.lexists(p) for p in (WRAPPER, entry.LIB, entry.EVENT, stage / 'attempt.json')))
    lock_path = entry.STATE / 'deploy.lock'
    entry.trusted_file(lock_path)
    with os.fdopen(os.open(lock_path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as lock:
        info = os.fstat(lock.fileno())
        check([info.st_dev, info.st_ino] == cfg['lock_identity'])
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        actual = entry.canonical(legacy.api, cfg['first_sha'], cfg['first_run_id'], cfg['protected_tree'])
        check(actual == cfg['first_artifact'])
        previous = json.loads(entry.trusted_file(entry.STATE / 'deployed.json'))
        entry.validate_initial_receipt(previous, cfg['initial'])
        before = entry.runtime(legacy, cfg['initial'])
        expected = entry.normalized_others(legacy)
        originals = {n: entry.read_origin(n, cfg['config_hashes'][n]) for n in entry.FILES}
        with tempfile.TemporaryDirectory(prefix='preflight-', dir=stage) as folder:
            test_shadow = Path(folder)
            for name, data in originals.items():
                new_file(test_shadow / name, data)
            entry.config_matches(legacy, before, cfg, root=test_shadow)
        entry.forward_only(legacy.api, cfg['initial']['sha'], cfg['first_sha'])
        check(hashlib.sha256(entry.trusted_file(entry.STATE / 'deployed.json')).hexdigest() == cfg['legacy_receipt_sha256'])
        check(not any(os.path.lexists(entry.STATE / name) for name in
                      ('failed-sha', 'in-progress', 'import-in-progress', 'recovery-required')))
        with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet):
            legacy.health(cfg['initial']['image'])
        check(expected == entry.normalized_others(legacy))
        entry.fence(stage / 'attempt.json', {'first_sha': cfg['first_sha'], 'first_run_id': cfg['first_run_id']})
        entry.LIB.mkdir(mode=0o700)
        entry.EVENT.mkdir(mode=0o700)
        shadow = entry.LIB / 'config'
        shadow.mkdir(mode=0o700)
        for name, data in originals.items():
            new_file(shadow / name, data)
        for name in ('entry.py', 'deploy-poll.py'):
            new_file(entry.LIB / name, files[name])
        new_file(entry.LIB / 'review.json', cfg_raw)
        entry.config_guard(cfg)
        entry.config_matches(legacy, before, cfg)
        with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet):
            legacy.health(cfg['initial']['image'])
        entry.runtime(legacy, cfg['initial'])
        check(expected == entry.normalized_others(legacy))
        for folder in (shadow, entry.LIB, entry.LIB.parent, entry.EVENT, entry.STATE):
            entry.sync(folder)
        new_file(WRAPPER, WRAPPER_BYTES, 0o700)
        entry.sync(WRAPPER.parent)
    print(json.dumps(dict(installed=True, app_switched=False, timer_changed=False)))


if __name__ == '__main__':
    try:
        run()
    except Exception as exc:
        print(json.dumps({'installed': False, 'reason': type(exc).__name__, 'inspect_stage_before_retry': True}))
        raise SystemExit(1)
