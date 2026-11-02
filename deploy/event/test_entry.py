import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock

import entry

SHA = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64


class Boundaries(unittest.TestCase):
    def test_explicit_successful_first_push_only(self):
        run = dict(id=17, head_sha=SHA, head_branch=entry.BRANCH, path='.github/workflows/ci.yml',
                   event='push', status='completed', conclusion='success', run_attempt=1,
                   repository={'full_name': entry.REPO}, head_repository={'full_name': entry.REPO})
        entry.verify_run(run, SHA, 17)
        for change in [dict(run_attempt=2), dict(id=18), dict(event='pull_request'),
                       dict(head_repository={'full_name': 'fork/GhostManual'}), dict(head_sha='c' * 40)]:
            with self.subTest(change=change), self.assertRaises(entry.Refusal):
                entry.verify_run(run | change, SHA, 17)

    def test_artifact_must_match_pair_and_cannot_feed_poller(self):
        binding = dict(id=17, head_sha=SHA, head_branch=entry.BRANCH)
        artifact = dict(name='ghostmanual-event-image-' + SHA, id=19, digest=DIGEST,
                        size_in_bytes=100, expired=False, workflow_run=binding)
        def select(*items):
            return entry.select_artifact(dict(total_count=len(items), artifacts=items), SHA, 17)
        self.assertEqual(select(artifact)['id'], 19)
        for change in [dict(name='ghostmanual-image-' + SHA), dict(expired=True),
                       dict(workflow_run=binding | dict(id=18)), dict(digest='wrong')]:
            with self.assertRaises(entry.Refusal):
                select(artifact | change)
        with self.assertRaises(entry.Refusal):
            select(artifact, artifact)

    def test_manual_receipt_with_matching_sha_cannot_ack_event(self):
        receipt = dict(sha=SHA, image=DIGEST, source='user_authorized_server_build')
        artifact = dict(id=19, digest=DIGEST)
        with self.assertRaises(entry.Refusal):
            entry.verify_receipt(receipt, SHA, 17, artifact)
        receipt.update(source='canonical_ci_artifact', requested_run_id=17, deployed_run_id=17,
                       artifact_run_id=17, artifact_id=19, artifact_digest=DIGEST)
        entry.verify_receipt(receipt, SHA, 17, artifact)

    def test_rejected_head_never_reaches_other_github_requests(self):
        api = Mock(return_value={'sha': 'e' * 40})
        with self.assertRaisesRegex(entry.Refusal, 'superseded'):
            entry.canonical(api, SHA, 17, {})
        self.assertEqual(api.call_count, 1)

    def test_fence_created_exclusively(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / 'in-progress'
            entry.fence(path, {'sha': SHA})
            with self.assertRaises(FileExistsError):
                entry.fence(path, {'sha': 'd' * 40})
            self.assertEqual(json.loads(path.read_bytes()), {'sha': SHA})


if __name__ == '__main__':
    unittest.main()
