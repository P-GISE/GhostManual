import builtins
import hashlib
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import types
import unittest
from unittest.mock import Mock, patch

import entry
try:
    import fcntl
except ModuleNotFoundError:
    with patch.dict('sys.modules', {'fcntl': types.SimpleNamespace(flock=Mock(), LOCK_EX=2, LOCK_NB=4)}):
        import install
else:
    import install

SHA = 'c' * 40
IMAGE = 'sha256:' + 'd' * 64
HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('prepare_review', HERE / 'prepare-review.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class ExistingBaselineTests(unittest.TestCase):
    def test_manual_and_existing_run_are_observed_without_claiming_artifact_origin(self):
        for run in (None, 17):
            with self.subTest(run=run):
                entry.validate_initial_receipt(dict(sha=SHA, image=IMAGE, run_id=run),
                                               dict(sha=SHA, image=IMAGE, run_id=run))

    def test_invalid_or_changed_run_is_rejected(self):
        for actual, expected in ((0, 0), (True, True), ('17', '17'), (-1, -1),
                                 (17, 18), (17, None), (None, 17), (17, True)):
            with self.subTest(actual=actual, expected=expected), self.assertRaises(entry.Refusal):
                entry.validate_initial_receipt(dict(sha=SHA, image=IMAGE, run_id=actual),
                                               dict(sha=SHA, image=IMAGE, run_id=expected))

    def test_changed_sha_or_image_and_invalid_identity_are_rejected(self):
        for change in (dict(sha='a' * 40), dict(image='sha256:' + 'e' * 64)):
            with self.subTest(change=change), self.assertRaises(entry.Refusal):
                entry.validate_initial_receipt(dict(sha=SHA, image=IMAGE) | change,
                                               dict(sha=SHA, image=IMAGE))
        for change in (dict(sha='bad'), dict(image='bad'), dict(sha=None)):
            with self.subTest(change=change), self.assertRaises(entry.Refusal):
                entry.validate_initial_receipt(dict(sha=SHA, image=IMAGE) | change,
                                               dict(sha=SHA, image=IMAGE) | change)

    def test_prepare_binds_current_receipt_and_keeps_review_unapproved(self):
        for run in (None, 17):
            with self.subTest(run=run), TemporaryDirectory() as folder:
                root = Path(folder)
                meta = dict(sha256='e' * 64, uid=0, gid=0, mode=384, inode=7, device=3)
                files = {'/opt/ghostmanual/' + name: meta for name in entry.FILES}
                files['/usr/local/libexec/ghostmanual-event-entry'] = {'exists': False}
                files['/var/lib/ghostmanual-deploy/deployed.json'] = {'sha256': 'f' * 64}
                files['/var/lib/ghostmanual-deploy/deploy.lock'] = {'device': 3, 'inode': 9}
                app = dict(id='current-app', image=IMAGE, revision=SHA, running=True, oom=False, restarts=0)
                rt = dict(read_only=True, receipt=dict(sha=SHA, image=IMAGE, run_id=run),
                          containers={'ghostmanual-app-1': app}, files=files, state_markers={})
                model = dict(read_only=True, baseline_app_id=app['id'], baseline_image=IMAGE,
                             baseline_sha=SHA, source_files={n: meta for n in entry.FILES},
                             model_sha256='a' * 64)
                (root / 'runtime.json').write_text(json.dumps(rt))
                (root / 'model.json').write_text(json.dumps(model))
                raw = b'synthetic reviewed module'
                blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
                tree = {n: blob for n in ('deploy/event/entry.py', 'scripts/deploy-poll.py', 'deploy/event/install.py')}
                with patch.object(prepare.entry, 'protected_tree', return_value=tree), \
                     patch.object(prepare, 'api', return_value={}), \
                     patch.object(prepare.entry, 'canonical', return_value={'id': 19}), \
                     patch.object(prepare.subprocess, 'check_output', return_value=raw):
                    prepare.main(str(root / 'runtime.json'), str(root / 'model.json'), 'b' * 40, '23', str(root / 'out.json'))
                cfg = json.loads((root / 'out.json').read_text())
                self.assertEqual(cfg['initial']['run_id'], run)
                self.assertEqual(cfg['initial']['source'], 'observed_existing_release')
                self.assertFalse(cfg['approved'])
                self.assertFalse(cfg['semantic_review'])

    def test_installer_checks_expected_run_before_runtime_or_any_write(self):
        class ReachedRuntime(Exception):
            pass
        for actual, expected, accepted in ((None, None, True), (17, 17, True),
                                           (17, None, False), (17, 18, False),
                                           (True, True, False), ('17', '17', False)):
            with self.subTest(actual=actual, expected=expected), TemporaryDirectory() as folder:
                root = Path(folder)
                state = root / 'state'
                state.mkdir()
                (state / 'deploy.lock').write_bytes(b'')
                (state / 'deployed.json').write_text(json.dumps(dict(sha=SHA, image=IMAGE, run_id=actual)))
                lock = (state / 'deploy.lock').stat()
                sources = {n: (HERE / ('../../scripts/deploy-poll.py' if n == 'deploy-poll.py' else n)).read_bytes()
                           for n in ('entry.py', 'deploy-poll.py', 'install.py')}
                cfg = dict(approved=True, semantic_review=True, first_sha='b' * 40, first_run_id=23,
                           first_artifact={'id': 19}, protected_tree={}, lock_identity=[lock.st_dev, lock.st_ino],
                           initial=dict(sha=SHA, image=IMAGE, run_id=expected),
                           module_hashes={n: hashlib.sha256(raw).hexdigest() for n, raw in sources.items()})
                staged = sources | {'review.json': json.dumps(cfg).encode()}
                class Stage:
                    parent = Path('/root')
                    name = 'ghostmanual-event-install-test'
                    def __truediv__(self, name): return root / name
                    def lstat(self): return types.SimpleNamespace(st_mode=0o40700)
                stage = Stage()
                def path(value):
                    if value == install.__file__:
                        return types.SimpleNamespace(absolute=lambda: types.SimpleNamespace(parent=stage))
                    return Path(value)
                def execute(code, namespace):
                    builtins.exec(code, namespace)
                    if namespace.get('__name__') == 'entry':
                        namespace.update(STATE=state, EVENT=state / 'event', LIB=root / 'lib',
                                         legacy_guard=Mock(), canonical=Mock(return_value={'id': 19}),
                                         trusted_file=lambda p: p.read_bytes(),
                                         runtime=Mock(side_effect=ReachedRuntime()))
                with patch.object(install, 'Path', side_effect=path), \
                     patch.object(install, 'WRAPPER', root / 'wrapper'), \
                     patch.object(install.os, 'geteuid', return_value=0, create=True), \
                     patch.object(install.os, 'O_NOFOLLOW', getattr(install.os, 'O_NOFOLLOW', 0), create=True), \
                     patch.object(install, 'trusted_dir'), \
                     patch.object(install, 'staged', side_effect=lambda p: staged[p.name]), \
                     patch.object(install, 'exec', side_effect=execute, create=True), \
                     patch.object(install.sys, 'argv', ['install.py']), \
                     patch.object(install.fcntl, 'flock'):
                    if accepted:
                        with self.assertRaises(ReachedRuntime):
                            install.run()
                    else:
                        with self.assertRaisesRegex(Exception, 'initial_receipt_changed'):
                            install.run()
                self.assertFalse((root / 'lib').exists())
                self.assertFalse((root / 'attempt.json').exists())


if __name__ == '__main__':
    unittest.main()
