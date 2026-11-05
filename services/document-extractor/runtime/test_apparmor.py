"""Offline checks of AppArmor compiler path and mount-flag expressions."""
from pathlib import Path
import re
import shutil
import subprocess
import unittest


@unittest.skipUnless(shutil.which("apparmor_parser"), "requires offline AppArmor compiler")
class AppArmorPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile = Path(__file__).with_name("ghostmanual-extractor-runtime.apparmor").read_text()
        compiled = subprocess.run(
            ["apparmor_parser", "-Q", "-K", "-D", "rule-exprs",
             str(Path(__file__).with_name("ghostmanual-extractor-runtime.apparmor"))],
            text=True, capture_output=True, check=True,
        )
        cls.expressions = {}
        cls.mount_expressions = []
        cls.exec_expressions = []
        for line in (compiled.stdout + compiled.stderr).splitlines():
            if line.startswith("aare: "):
                path, expression = line[6:].split("   ->   ", 1)
                if "uid_map" in path or "mountinfo" in path:
                    cls.expressions[path] = re.compile(expression)
            if line.startswith(r"rule: \x07") and line.endswith("(0x2/0)< 0x2>"):
                cls.mount_expressions.append(re.compile(line[6:].split("  ->  ", 1)[0]))
            rule = re.fullmatch(r"rule: (/.+?)  ->  .+ \(0x([0-9a-f]+)/[0-9a-f]+\)< 0x[0-9a-f]+>", line)
            if rule and " deny " not in line and int(rule[2], 16) & 1:
                cls.exec_expressions.append((re.compile(rule[1]), int(rule[2], 16)))

    def map_alias(self):
        matching = [path for path, expression in self.expressions.items()
                    if expression.fullmatch("/1504617/uid_map")]
        self.assertEqual(len(matching), 1, "missing exact disconnected proc-map rule")
        path = matching[0]
        self.assertIn("  owner " + path + " rw,", self.profile)
        return self.expressions[path]

    def test_disconnected_pid_maps_allow_only_owner_and_three_files(self):
        expression = self.map_alias()
        for pid in ("1", "42", "123", "1234", "12345", "123456", "1504617", "4194304"):
            for name in ("uid_map", "gid_map", "setgroups"):
                with self.subTest(pid=pid, name=name):
                    self.assertIsNotNone(expression.fullmatch(f"/{pid}/{name}"))

    def test_disconnected_map_rule_does_not_cover_other_objects(self):
        expression = self.map_alias()
        for path in ("/self/uid_map", "/0/uid_map", "/01/uid_map", "/12345678/uid_map",
                     "/1504617x/uid_map", "/1504617/uid_map/child", "/1504617/mem",
                     "/1504617/environ", "/1504617/root/etc/shadow", "/1504617/fd/3",
                     "/sys/user/max_user_namespaces", "/sys/fs/cgroup/memory.max",
                     "/proc/1504617/uid_map", "/oldroot/1504617/uid_map"):
            with self.subTest(path=path):
                self.assertIsNone(expression.fullmatch(path))

    def proc_read_alias(self):
        matching = [path for path, expression in self.expressions.items()
                    if expression.fullmatch("/1517743/mountinfo")]
        self.assertEqual(len(matching), 1, "missing exact disconnected proc-read rule")
        path = matching[0]
        self.assertIn("  owner " + path + " r,", self.profile)
        return self.expressions[path]

    def test_disconnected_proc_reads_are_owner_read_only(self):
        expression = self.proc_read_alias()
        maps = self.map_alias()
        for pid in ("1", "42", "123", "1234", "12345", "123456", "1517743", "4194304"):
            for name in ("mountinfo", "fd/"):
                with self.subTest(pid=pid, name=name):
                    path = f"/{pid}/{name}"
                    self.assertIsNotNone(expression.fullmatch(path))
                    self.assertIsNone(maps.fullmatch(path), "read alias must not gain map writes")

    def test_disconnected_proc_reads_exclude_fd_entries_and_other_objects(self):
        expression = self.proc_read_alias()
        for path in ("/self/mountinfo", "/0/mountinfo", "/01/mountinfo",
                     "/12345678/mountinfo", "/1517743x/mountinfo", "/1517743/mountinfo/",
                     "/1517743/mountinfo/child", "/1517743/fd", "/1517743/fd/0",
                     "/1517743/fd/3", "/1517743/fd/999", "/1517743/fd/3/child",
                     "/1517743/fdinfo/3", "/1517743/root/", "/1517743/root/etc/shadow",
                     "/1517743/mem", "/1517743/environ", "/1517743/cmdline", "/1517743/status",
                     "/1517743/ns/mnt", "/1517743/uid_map", "/1517743/gid_map",
                     "/1517743/setgroups", "/proc/1517743/mountinfo", "/oldroot/1517743/fd/",
                     "/sys/user/max_user_namespaces", "/sys/fs/cgroup/memory.max"):
            with self.subTest(path=path):
                self.assertIsNone(expression.fullmatch(path))

        # The fixed launcher caps RLIMIT_NOFILE at 128; directory read grants no entry read.
        for fd in range(128):
            self.assertIsNone(expression.fullmatch(f"/1517743/fd/{fd}"))

    def mount_allowed(self, target, flags, fstype="", source=""):
        # Linux match_mnt_flags serializes set bits in order as bit index + 1.
        encoded_flags = "".join(chr(bit + 1) for bit in range(32) if flags & (1 << bit))
        request = "\x07" + "\x00".join((target, source, fstype, encoded_flags))
        return any(expression.fullmatch(request) for expression in self.mount_expressions)

    def test_silent_propagation_mounts_match_bubblewrap_flags(self):
        # bubblewrap 0.8: MS_REC | MS_SILENT | MS_SLAVE/MS_PRIVATE.
        for target, flags in (("/", 0x8C000), ("/oldroot/", 0x4C000)):
            with self.subTest(target=target, flags=hex(flags)):
                self.assertTrue(self.mount_allowed(target, flags))

    def test_propagation_rules_exclude_other_targets_and_shared_mounts(self):
        for target in ("/oldroot/child/", "/oldroot-other/", "/other/",
                       "/proc/", "/sys/fs/cgroup/", "/newroot/other/"):
            for flags in (0x8C000, 0x4C000):
                with self.subTest(target=target, flags=hex(flags)):
                    self.assertFalse(self.mount_allowed(target, flags))
        for target in ("/", "/oldroot/"):
            for flags in (0x10C000, 0x2C000):  # Recursive silent shared/unbindable.
                with self.subTest(target=target, flags=hex(flags)):
                    self.assertFalse(self.mount_allowed(target, flags))
        self.assertFalse(self.mount_allowed("/oldroot/", 0x8C000))

    def test_fixed_mount_targets_accept_launcher_operations(self):
        directories = ("usr", "lib", "lib64", "opt/tika", "opt/parser",
                       "etc/java-17-openjdk", "etc/fonts", "proc/sys", "proc/irq", "proc/bus")
        files = ("etc/ld.so.cache", "proc/sysrq-trigger")
        for suffix in (*[path + "/" for path in directories], *files):
            target = "/newroot/" + suffix
            with self.subTest(target=target):
                self.assertTrue(self.mount_allowed(target, 0x5000))  # Mediated recursive bind.
                self.assertTrue(self.mount_allowed(target, 0x9027))  # RO/nosuid/nodev remount.
                if target.endswith("/"):
                    self.assertTrue(self.mount_allowed(target + "submount/", 0x9027))
        for name in ("null", "zero", "full", "random", "urandom", "tty"):
            with self.subTest(device=name):
                self.assertTrue(self.mount_allowed("/newroot/dev/" + name, 0x5000))
                self.assertTrue(self.mount_allowed("/newroot/dev/" + name, 0x9022))
        self.assertTrue(self.mount_allowed("/tmp/newroot/", 0x5000))
        for target, flags, fstype in (("/tmp/", 6, "tmpfs"), ("/newroot/dev/", 6, "tmpfs"),
                                     ("/newroot/tmp/", 6, "tmpfs"), ("/newroot/proc/", 14, "proc"),
                                     ("/newroot/dev/pts/", 10, "devpts")):
            with self.subTest(target=target, fstype=fstype):
                self.assertTrue(self.mount_allowed(target, flags, fstype, fstype))

    def test_remounts_preserve_recognized_mountinfo_flags(self):
        # decode_mountoptions recognizes noexec and only these three atime flags.
        optional = (8, 0x400, 0x800, 0x200000)
        for selected in range(16):
            inherited = sum(flag for bit, flag in enumerate(optional) if selected & (1 << bit))
            with self.subTest(inherited=hex(inherited)):
                self.assertTrue(self.mount_allowed("/newroot/usr/", 0x9027 | inherited))
        # BIND_DEVICES also retains existing ro/nodev rather than adding them.
        for inherited in (0, 1, 4, *optional, 0x200C0D):
            with self.subTest(device_inherited=hex(inherited)):
                self.assertTrue(self.mount_allowed("/newroot/dev/null", 0x9022 | inherited))

    def test_mount_contract_rejects_missing_guards_and_unrequested_mounts(self):
        for missing in (1, 2, 4):
            with self.subTest(missing_security_flag=missing):
                self.assertFalse(self.mount_allowed("/newroot/usr/", 0x9027 & ~missing))
        self.assertFalse(self.mount_allowed("/newroot/dev/null", 0x9020))
        for extra in (0x10, 0x80, 0x1000000, 0x2000000):
            with self.subTest(unrecognized_flag=hex(extra)):
                self.assertFalse(self.mount_allowed("/newroot/usr/", 0x209027 | extra))
        for target in ("/newroot/other/", "/newroot/usr2/", "/newroot/etc/shadow",
                       "/newroot/dev/console", "/newroot/dev/shm/", "/newroot/proc/mem",
                       "/proc/", "/sys/fs/cgroup/"):
            for flags in (0x5000, 0x9027):
                with self.subTest(target=target, flags=hex(flags)):
                    self.assertFalse(self.mount_allowed(target, flags))
        self.assertFalse(self.mount_allowed("/newroot/usr/submount/", 0x5000))
        for target, flags, fstype in (("/tmp/", 6, "tmpfs"), ("/newroot/dev/", 6, "tmpfs"),
                                     ("/newroot/tmp/", 6, "tmpfs"), ("/newroot/proc/", 14, "proc"),
                                     ("/newroot/dev/pts/", 10, "devpts")):
            with self.subTest(target=target, fstype=fstype):
                self.assertFalse(self.mount_allowed(target, flags, "overlay", "overlay"))
                self.assertFalse(self.mount_allowed(target, flags & ~2, fstype, fstype))
        self.assertFalse(self.mount_allowed("/newroot/usr/", 6, "tmpfs", "tmpfs"))

    def test_ocr_spawn_helper_inherits_existing_java_exec_policy(self):
        java = "/usr/lib/jvm/java-17-openjdk-amd64/bin/java"
        helper = "/usr/lib/jvm/java-17-openjdk-amd64/lib/jspawnhelper"
        java_modes = [mode for expression, mode in self.exec_expressions if expression.fullmatch(java)]
        helper_modes = [mode for expression, mode in self.exec_expressions if expression.fullmatch(helper)]
        self.assertTrue(java_modes, "missing existing Java inherit-exec compiler rule")
        self.assertEqual(helper_modes, java_modes)

    def test_spawn_helper_rule_does_not_enable_other_jvm_or_shell_executables(self):
        for path in ("/usr/lib/jvm/java-17-openjdk-amd64/lib/jspawnhelper.bak",
                     "/usr/lib/jvm/java-17-openjdk-amd64/lib/jspawnhelper/child",
                     "/usr/lib/jvm/java-17-openjdk-amd64/lib/libjava.so",
                     "/usr/lib/jvm/java-17-openjdk-amd64/bin/jcmd",
                     "/usr/lib/jvm/java-21-openjdk-amd64/lib/jspawnhelper",
                     "/oldroot/usr/lib/jvm/java-17-openjdk-amd64/lib/jspawnhelper",
                     "/usr/lib/other-helper", "/tmp/jspawnhelper", "/usr/bin/sh", "/bin/sh"):
            with self.subTest(path=path):
                self.assertFalse(any(expression.fullmatch(path) for expression, _ in self.exec_expressions))


if __name__ == "__main__":
    unittest.main()
