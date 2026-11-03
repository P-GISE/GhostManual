import json
import os
import smtplib
import ssl
import sys
from datetime import UTC, datetime
from email.headerregistry import Address
from email.message import EmailMessage
from pathlib import Path


def mailbox(value):
    if not value.isprintable():
        raise ValueError("Invalid address")
    address = Address(addr_spec=value)
    if not address.username or not address.domain or address.addr_spec != value:
        raise ValueError("Invalid address")
    return address


def notify(args):
    if args not in ([], ["--test"]):
        raise ValueError("Invalid argument")
    credential = Path(os.environ["CREDENTIALS_DIRECTORY"], "mail.json")
    config = json.loads(credential.read_text(encoding="utf-8"))
    if set(config) != {"user", "password", "recipient"} or not all(
        isinstance(value, str) and value.strip() for value in config.values()
    ):
        raise ValueError("Invalid credential")

    message = EmailMessage()
    message["From"] = mailbox(config["user"])
    message["To"] = mailbox(config["recipient"])
    timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    if args:
        message["Subject"] = "GhostManual backup notification test"
        message.set_content(f"Notification delivery test at {timestamp} (UTC).")
    else:
        message["Subject"] = "GhostManual database backup failed"
        message.set_content(
            f"Failure notification at {timestamp} (UTC).\n"
            "Check ghostmanual-backup.service on the server."
        )

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15, context=ssl.create_default_context()) as smtp:
        smtp.login(config["user"], config["password"])
        if smtp.send_message(message):
            raise RuntimeError("Delivery refused")


if __name__ == "__main__":
    try:
        notify(sys.argv[1:])
    except Exception:
        print("Backup notification failed.", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)
