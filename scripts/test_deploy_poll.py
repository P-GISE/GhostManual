import importlib.util
import pathlib
import json
import tempfile
import unittest
from unittest.mock import patch

SOURCE = pathlib.Path(__file__).with_name("deploy-poll.py")
spec = importlib.util.spec_from_file_location("deploy_poll", SOURCE)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
SHA = "a" * 40


class DeploymentTests(unittest.TestCase):
    def run_record(self, **changes):
        record = dict(head_sha=SHA, head_branch=deploy.BRANCH, event="push",
                      path=".github/workflows/ci.yml", status="completed", conclusion="success", id=42)
        return record | changes

    def test_only_successful_production_push_can_deploy(self):
        self.assertTrue(deploy.verified_run(self.run_record(), SHA))
        for change in [dict(event="pull_request"), dict(head_sha="b" * 40),
                       dict(head_branch="other"), dict(conclusion="failure"),
                       dict(status="in_progress"), dict(path="other.yml")]:
            self.assertFalse(deploy.verified_run(self.run_record(**change), SHA))

    def test_environment_update_changes_only_image(self):
        before = "# retained\nGHOSTMANUAL_IMAGE=old\nAPP_ORIGIN=https://example.test\n"
        self.assertEqual(deploy.image_environment(before, "sha256:" + "b" * 64),
                         before.replace("GHOSTMANUAL_IMAGE=old", "GHOSTMANUAL_IMAGE=sha256:" + "b" * 64))

    def test_environment_rejects_missing_or_duplicate_image(self):
        for text in ["OTHER=x\n", "GHOSTMANUAL_IMAGE=a\nGHOSTMANUAL_IMAGE=b\n"]:
            with self.assertRaises(deploy.DeployError):
                deploy.image_environment(text, "sha256:" + "b" * 64)

    def test_schema_gate_includes_runner_and_server_compose(self):
        entries = [{"path": p, "sha": p, "type": "blob"} for p in
                   ["db/migrations/001.sql", "scripts/migrate.ts", "compose.yaml", "src/components/Start.tsx"]]
        self.assertEqual(set(deploy.protected_tree({"tree": entries})),
                         {"db/migrations/001.sql", "scripts/migrate.ts", "compose.yaml"})
        with self.assertRaises(deploy.DeployError):
            deploy.protected_tree({"truncated": True, "tree": entries})

    def test_failed_switch_restores_previous_environment_and_image(self):
        events = []
        def switch(image):
            events.append(("switch", image))
            if image == "new":
                raise deploy.DeployError("synthetic_failure")
        with self.assertRaises(deploy.DeployError):
            deploy.replace_app("old", "new", lambda image: events.append(("env", image)),
                               switch, lambda image: events.append(("health", image)), lambda: None)
        self.assertEqual(events, [("env", "new"), ("switch", "new"),
                                  ("env", "old"), ("switch", "old"), ("health", "old")])

    def test_failed_health_also_rolls_back(self):
        switched = []
        def health(image):
            if image == "new":
                raise deploy.DeployError("synthetic_health")
        with self.assertRaises(deploy.DeployError):
            deploy.replace_app("old", "new", lambda image: None, switched.append, health, lambda: None)
        self.assertEqual(switched, ["new", "old"])

    def test_failed_preservation_rolls_back(self):
        switched = []
        with self.assertRaises(deploy.DeployError):
            deploy.replace_app("old", "new", lambda image: None, switched.append,
                               lambda image: None, lambda: (_ for _ in ()).throw(deploy.DeployError("preservation")))
        self.assertEqual(switched, ["new", "old"])

    def test_success_switches_once(self):
        switched = []
        deploy.replace_app("old", "new", lambda image: None, switched.append, lambda image: None, lambda: None)
        self.assertEqual(switched, ["new"])

    def test_termination_handler_enters_rollback(self):
        switched = []
        def health(image):
            if image == "new":
                deploy.interrupted(15, None)
        with self.assertRaisesRegex(deploy.DeployError, "interrupted"):
            deploy.replace_app("old", "new", lambda image: None, switched.append, health, lambda: None)
        self.assertEqual(switched, ["new", "old"])

    def test_app_compose_cannot_recreate_database(self):
        with patch.object(deploy, "command", return_value="") as command:
            deploy.switch_app("sha256:" + "b" * 64)
        args = command.call_args.args[0]
        self.assertEqual(args[-7:], ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "app"])
        self.assertNotIn("migrate", " ".join(args))

    def test_pending_ci_cannot_download_or_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "deployed.json").write_text(json.dumps({"sha": "b" * 40, "image": "old"}))
            responses = [{"sha": SHA}, {"workflow_runs": [self.run_record(status="in_progress")]}]
            with patch.object(deploy, "STATE", root), patch.object(deploy, "api", side_effect=responses), \
                 patch.object(deploy, "switch_app") as switch:
                self.assertEqual(deploy.poll(), "waiting_for_successful_ci")
                switch.assert_not_called()

    def test_schema_change_cannot_download_or_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "deployed.json").write_text(json.dumps({"sha": "b" * 40, "image": "old"}))
            def tree(value):
                return {"tree": [{"path": "db/migrations/001.sql", "sha": value, "type": "blob"}]}
            responses = [{"sha": SHA}, {"workflow_runs": [self.run_record()]}, tree("old"), tree("changed")]
            with patch.object(deploy, "STATE", root), patch.object(deploy, "api", side_effect=responses) as api, \
                 patch.object(deploy, "switch_app") as switch:
                with self.assertRaisesRegex(deploy.DeployError, "schema_or_compose"):
                    deploy.poll()
                self.assertEqual(api.call_count, 4)
                switch.assert_not_called()

    def test_failed_revision_is_not_redeployed_every_poll(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "deployed.json").write_text(json.dumps({"sha": "b" * 40, "image": "old"}))
            (root / "failed-sha").write_text(SHA)
            with patch.object(deploy, "STATE", root), patch.object(deploy, "api", return_value={"sha": SHA}) as api:
                self.assertEqual(deploy.poll(), "blocked_after_failure")
                self.assertEqual(api.call_count, 1)

    def test_same_revision_is_a_read_only_noop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "deployed.json").write_text(json.dumps({"sha": SHA, "image": "old"}))
            with patch.object(deploy, "STATE", root), patch.object(deploy, "api", return_value={"sha": SHA}) as api:
                self.assertEqual(deploy.poll(), "unchanged")
                self.assertEqual(api.call_count, 1)

    def test_atomic_state_write_is_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "state"
            path.write_text("old")
            deploy.atomic_write(path, "new")
            self.assertEqual(path.read_text(), "new")
            self.assertEqual(list(path.parent.iterdir()), [path])


if __name__ == "__main__":
    unittest.main()
