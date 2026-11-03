import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import smtplib
import ssl
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("notify.py")


class BackupNotifyTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.credential = Path(directory.name, "mail.json")
        self.config = {
            "user": "sender@example.invalid",
            "password": "synthetic-private-value",
            "recipient": "recipient@example.invalid",
        }
        self.credential.write_text(json.dumps(self.config))
        env = patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": directory.name})
        env.start()
        self.addCleanup(env.stop)
        transport = patch("smtplib.SMTP_SSL", autospec=True)
        self.smtp = transport.start()
        self.addCleanup(transport.stop)
        self.connection = self.smtp.return_value.__enter__.return_value
        self.connection.send_message.return_value = {}

    def run_script(self, *args):
        errors, output = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", [str(SCRIPT), *args]), \
                contextlib.redirect_stderr(errors), contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit) as result:
                runpy.run_path(str(SCRIPT), run_name="__main__")
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(errors.getvalue(), "" if result.exception.code == 0 else "Backup notification failed.\n")
        return result.exception.code

    def test_failure_notification(self):
        self.assertEqual(self.run_script(), 0)
        args, kwargs = self.smtp.call_args
        self.assertEqual(args, ("smtp.gmail.com", 465))
        self.assertEqual(kwargs["timeout"], 15)
        self.assertTrue(kwargs["context"].check_hostname)
        self.assertEqual(kwargs["context"].verify_mode, ssl.CERT_REQUIRED)
        self.connection.login.assert_called_once_with(self.config["user"], self.config["password"])
        self.connection.send_message.assert_called_once()
        message = self.connection.send_message.call_args.args[0]
        self.assertEqual(str(message["To"]), self.config["recipient"])
        self.assertEqual(str(message["From"]), self.config["user"])
        self.assertIn("failed", message["Subject"])
        self.assertRegex(message.get_content(), r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
        for private in self.config.values():
            self.assertNotIn(private, message.get_content())

    def test_test_notification_is_labelled(self):
        self.assertEqual(self.run_script("--test"), 0)
        message = self.connection.send_message.call_args.args[0]
        self.assertIn("test", message["Subject"].lower())
        self.assertNotIn("failed", message.get_content().lower())

    def test_auth_error_cannot_leak_server_reply(self):
        self.connection.login.side_effect = smtplib.SMTPAuthenticationError(535, str(self.config))
        self.assertNotEqual(self.run_script(), 0)
        self.connection.send_message.assert_not_called()

    def test_refused_recipient(self):
        self.connection.send_message.return_value = {self.config["recipient"]: (550, b"refused")}
        self.assertNotEqual(self.run_script(), 0)

    def test_missing_credential(self):
        self.credential.unlink()
        self.assertNotEqual(self.run_script(), 0)
        self.smtp.assert_not_called()

    def test_invalid_config_does_not_connect(self):
        for key, value in [
            ("recipient", "invalid"),
            ("recipient", "first@example.invalid,second@example.invalid"),
            ("recipient", "first@example.invalid\r\nBcc: other@example.invalid"),
            ("user", "bad\naddress@example.invalid"),
            ("password", ""),
        ]:
            with self.subTest(key=key, value=value):
                self.credential.write_text(json.dumps({**self.config, key: value}))
                self.assertNotEqual(self.run_script(), 0)
                self.smtp.assert_not_called()

    def test_unknown_argument_does_not_send(self):
        self.assertNotEqual(self.run_script("--bogus"), 0)
        self.smtp.assert_not_called()


if __name__ == "__main__":
    unittest.main()
