import subprocess
from pathlib import Path

DEVICE = "/dev/zram0"


def main():
    swaps = Path("/proc/swaps").read_text().splitlines()[1:]
    if any(row.split()[0] == DEVICE for row in swaps):
        return

    subprocess.run(["/usr/sbin/modprobe", "zram", "num_devices=1"], check=True)
    subprocess.run(["/usr/bin/udevadm", "wait", "--timeout=10", DEVICE], check=True)
    if int(Path("/sys/block/zram0/disksize").read_text()) != 0:
        raise RuntimeError("refusing to format an initialized zram device")

    subprocess.run(["/usr/sbin/zramctl", "--algorithm", "lzo-rle", "--size", "512M", DEVICE], check=True)
    subprocess.run(["/usr/sbin/mkswap", DEVICE], check=True)
    subprocess.run(["/usr/sbin/swapon", "--priority", "100", DEVICE], check=True)


if __name__ == "__main__":
    main()
