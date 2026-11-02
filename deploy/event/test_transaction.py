import contextlib
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

import entry

SHA = 'a' * 40
OLD_SHA = 'c' * 40
OLD = 'sha256:' + 'b' * 64
NEW = 'sha256:' + 'd' * 64


def archive(path, *, tag=None, bad_layer=False):
    objects = {}
    def add(raw, media):
        data = raw if isinstance(raw, bytes) else json.dumps(raw).encode()
        digest = hashlib.sha256(data).hexdigest()
        objects['blobs/sha256/' + digest] = data
        return dict(mediaType='application/vnd.oci.image.' + media, size=len(data), digest='sha256:' + digest)
    layer = add(b'synthetic-layer', 'layer.v1.tar')
    config = add(dict(os='linux', architecture='amd64', config={'User': 'node', 'Cmd': ['node', 'server.js'],
                 'Labels': {'org.opencontainers.image.revision': SHA}}), 'config.v1+json')
    manifest = add(dict(schemaVersion=2, config=config, layers=[layer]), 'manifest.v1+json')
    manifest['annotations'] = {'io.containerd.image.name': tag or 'docker.io/library/ghostmanual:' + SHA,
                               'org.opencontainers.image.ref.name': SHA}
    objects['index.json'] = json.dumps(dict(schemaVersion=2, manifests=[manifest])).encode()
    objects['oci-layout'] = b'{"imageLayoutVersion":"1.0.0"}'
    objects['manifest.json'] = json.dumps([dict(RepoTags=['ghostmanual:' + SHA],
            Config='blobs/sha256/' + config['digest'][7:], Layers=['blobs/sha256/' + layer['digest'][7:]])]).encode()
    if bad_layer:
        objects['blobs/sha256/' + layer['digest'][7:]] = b'synthetic-fault'
    with tarfile.open(path, 'w:gz') as writer:
        for name, raw in objects.items():
            info = tarfile.TarInfo(name)
            info.size = len(raw)
            writer.addfile(info, io.BytesIO(raw))
    return manifest['digest']


class ArchiveTests(unittest.TestCase):
    def test_shadow_resolution_drift_rejected_before_container_lookup(self):
        model = {'name': 'ghostmanual', 'services': {
            'app': {'image': OLD, 'logging': {'driver': 'none'}, 'environment': {'MAIL_DRIVER': 'synthetic'}},
            'db': {}}, 'volumes': {'database': {'name': 'ghostmanual_database'}},
            'networks': {'default': {'name': 'ghostmanual_default'}}}
        normalized = json.loads(json.dumps(model))
        normalized['services']['app']['image'] = '<verified-image>'
        cfg = {'model_sha256': entry.fingerprint(normalized)}
        row = {'Image': OLD, 'Mounts': []}
        legacy = Mock()
        model['volumes']['database']['name'] = 'some_other_volume'
        with patch.object(entry, 'compose', return_value=json.dumps(model)):
            with self.assertRaisesRegex(entry.Refusal, 'rendered_compose_changed'):
                entry.config_matches(legacy, row, cfg)
        legacy.inspect.assert_not_called()

    def test_huge_pax_extension_rejected_before_reading_declared_size(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'image.tar.gz'
            header = tarfile.TarInfo('pax')
            header.size = 2 * 1024**3
            header.type = tarfile.XHDTYPE
            with gzip.open(path, 'wb') as output:
                output.write(header.tobuf())
            with self.assertRaisesRegex(entry.Refusal, 'tar_extension_rejected'):
                entry.image_info(path, SHA)

    def test_manifest_identity_and_rejections_on_real_archives(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'image.tar.gz'
            image = archive(path)
            self.assertEqual(entry.image_info(path, SHA), image)
            archive(path, tag='docker.io/library/unrelated:' + SHA)
            with self.assertRaisesRegex(entry.Refusal, 'oci_tag_mismatch'):
                entry.image_info(path, SHA)
            archive(path, bad_layer=True)
            with self.assertRaisesRegex(entry.Refusal, 'archive_blob_integrity'):
                entry.image_info(path, SHA)


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.resources = contextlib.ExitStack()
        self.addCleanup(self.resources.close)
        self.folder = Path(self.resources.enter_context(tempfile.TemporaryDirectory()))
        self.cfg = {'initial': dict(sha=OLD_SHA, app_id='old-container', image=OLD, source='manual_server_build'),
                    'protected_tree': {}}
        self.artifact = dict(id=19, digest='sha256:' + 'f' * 64)
        self.image = OLD
        self.switches = []
        self.services = 'stable'
        self.legacy = Mock()
        self.legacy.api.return_value = {'status': 'ahead', 'ahead_by': 1, 'behind_by': 0,
                                        'base_commit': {'sha': OLD_SHA}, 'merge_base_commit': {'sha': OLD_SHA}}
        self.legacy.APP = 'ghostmanual-app-1'
        self.legacy.inspect.side_effect = lambda name: self.row()
        self.legacy.atomic_write.side_effect = lambda path, content: path.write_text(content)
        def use(name, **options):
            return self.resources.enter_context(patch.object(entry, name, **options))
        self.resources.enter_context(patch.object(entry, 'EVENT', self.folder))
        self.resources.enter_context(patch.object(entry.signal, 'alarm', create=True))
        use('config_guard')
        use('legacy_guard')
        use('sync')
        use('canonical', return_value=self.artifact)
        use('trusted_file', side_effect=lambda path: path.read_bytes())
        use('normalized_others', side_effect=lambda legacy: self.services)
        use('config_matches', return_value='injected-config')
        use('load_image', return_value=NEW)
        use('compose', side_effect=self.compose)

    def row(self):
        return {'Id': 'old-container' if self.image == OLD else 'new-container', 'Image': self.image,
                'HostConfig': {'Memory': 384}, 'Mounts': [], 'NetworkSettings': {'Networks': {}},
                'Config': {'Labels': {'org.opencontainers.image.revision': OLD_SHA if self.image == OLD else SHA}},
                'State': {'Running': True, 'OOMKilled': False}}

    def compose(self, legacy, image, *args):
        self.assertEqual(args, ('up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app'))
        self.switches.append(image)
        self.image = image

    def test_new_event_commits_only_after_app_replacement_and_health(self):
        receipt = entry.perform(self.legacy, self.cfg, SHA, 17)
        entry.verify_receipt(receipt, SHA, 17, self.artifact)
        self.assertEqual(self.switches, [NEW])
        self.assertEqual(json.loads((self.folder / 'deployed.json').read_text()), receipt)
        self.assertFalse((self.folder / 'in-progress').exists())
        self.assertEqual(entry.perform(self.legacy, self.cfg, SHA, 17)['status'], 'already_deployed')
        self.assertEqual(self.switches, [NEW])

    def test_new_app_health_failure_restores_manual_image_and_keeps_fence(self):
        self.legacy.health.side_effect = lambda image: self.fail_new(image)
        with self.assertRaisesRegex(entry.Refusal, 'synthetic_health'):
            entry.perform(self.legacy, self.cfg, SHA, 17)
        self.assertEqual(self.switches, [NEW, OLD])
        self.assertEqual(self.image, OLD)
        self.assertFalse((self.folder / 'deployed.json').exists())
        self.assertTrue((self.folder / 'in-progress').is_file())
        with self.assertRaisesRegex(entry.Refusal, 'reconcile_fence'):
            entry.perform(self.legacy, self.cfg, SHA, 17)
        self.assertEqual(self.switches, [NEW, OLD])

    def fail_new(self, image):
        if image == NEW:
            raise entry.Refusal('synthetic_health')

    def test_rewritten_branch_cannot_load_an_image(self):
        self.legacy.api.return_value['status'] = 'diverged'
        with self.assertRaisesRegex(entry.Refusal, 'nonforward_release'):
            entry.perform(self.legacy, self.cfg, SHA, 17)
        entry.load_image.assert_not_called()
        self.assertFalse(self.switches)


if __name__ == '__main__':
    unittest.main()
