import runpy
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("zram.py")


class BootSwap(unittest.TestCase):
    def simulate(self, active=False, size=0, failure=None):
        calls = []
        files = {
            "/proc/swaps": "Filename Type Size Used Priority\n"
            + ("/dev/zram0 partition 524284 99 100\n" if active else ""),
            "/sys/block/zram0/disksize": str(size),
        }

        def command(args, *, check):
            self.assertTrue(check)
            calls.append(args)
            if args[0] == failure:
                raise subprocess.CalledProcessError(1, args)

        self.calls = calls
        self.assertTrue(SCRIPT.is_file(), "boot entry point missing")
        with patch.object(Path, "read_text", lambda path: files[str(path)]), patch(
            "subprocess.run", side_effect=command
        ):
            runpy.run_path(str(SCRIPT), run_name="__main__")

    def test_active_swap_is_untouched(self):
        self.simulate(active=True, size=536870912)
        self.assertEqual(self.calls, [])

    def test_inactive_initialized_device_is_preserved(self):
        with self.assertRaisesRegex(RuntimeError, "initialized"):
            self.simulate(size=536870912)
        self.assertEqual(len(self.calls), 2)

    def test_new_device_gets_expected_configuration(self):
        self.simulate()
        self.assertEqual(self.calls, [
            ["/usr/sbin/modprobe", "zram", "num_devices=1"],
            ["/usr/bin/udevadm", "wait", "--timeout=10", "/dev/zram0"],
            ["/usr/sbin/zramctl", "--algorithm", "lzo-rle", "--size", "512M", "/dev/zram0"],
            ["/usr/sbin/mkswap", "/dev/zram0"],
            ["/usr/sbin/swapon", "--priority", "100", "/dev/zram0"],
        ])

    def test_setup_failure_stops_before_format(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.simulate(failure="/usr/sbin/zramctl")
        self.assertEqual(self.calls[-1][0], "/usr/sbin/zramctl")
