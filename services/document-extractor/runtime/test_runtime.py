import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


def load(name):
    path = Path(__file__).with_name(name + ".py")
    assert path.is_file(), "missing runtime implementation: " + name
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RuntimeTests(unittest.TestCase):
    def test_readiness_proc_view_keeps_caps_namespaces_and_resource_guards(self):
        import configparser
        unit = configparser.ConfigParser(interpolation=None, strict=False)
        unit.read(Path(__file__).with_name("ghostmanual-extractor-readiness@.service"))
        service = unit["Service"]
        for name in ("ProtectKernelTunables", "ProtectKernelLogs", "ProtectHostname"):
            with self.subTest(proc_overmount=name):
                self.assertFalse(service.getboolean(name))
        for name in ("NoNewPrivileges", "ProtectHome", "PrivateDevices", "PrivateNetwork",
                     "PrivateTmp", "ProtectKernelModules", "ProtectClock", "RestrictRealtime",
                     "RestrictSUIDSGID", "LockPersonality", "MountAPIVFS"):
            with self.subTest(retained_guard=name):
                self.assertTrue(service.getboolean(name))
        for name in ("CapabilityBoundingSet", "AmbientCapabilities"):
            self.assertEqual(set(service[name].split()), {"CAP_SETUID", "CAP_SETGID"})
        expected = {
            "User": "1000", "Group": "1000", "Type": "oneshot",
            "RootDirectory": "/opt/ghostmanual-extractor/%i/rootfs",
            "ProtectSystem": "strict", "ProtectProc": "invisible",
            "AppArmorProfile": "ghostmanual-extractor-runtime",
            "DelegateSubgroup": "gateway",
            "MemoryMax": "512M", "MemorySwapMax": "0", "TasksMax": "128",
            "CPUQuota": "50%", "CPUQuotaPeriodSec": "100ms",
            "BindPaths": "/sys/fs/cgroup/system.slice/%n:/sys/fs/cgroup",
            "ReadWritePaths": "/sys/fs/cgroup", "KillMode": "control-group",
            "ExecStart": "/usr/bin/python3 -u -B /service/runtime/bootstrap.py gate",
        }
        for name, value in expected.items():
            with self.subTest(setting=name):
                self.assertEqual(service[name], value)
        self.assertEqual(set(service["Delegate"].split()), {"cpu", "memory", "pids"})
        self.assertEqual(set(service["ReadOnlyPaths"].split()), {
            "/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.swap.max",
            "/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/pids.max",
        })

    def test_delegated_child_is_enabled_without_changing_outer_limits(self):
        bootstrap = load("bootstrap")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, value in {"memory.max":"536870912", "memory.swap.max":"0", "pids.max":"128", "cpu.max":"50000 100000", "cgroup.controllers":"cpu memory pids", "cgroup.procs":"", "cgroup.subtree_control":"cpu memory pids"}.items():
                (root/name).write_text(value)
            child=root/"extractor";child.mkdir()
            (child/"cgroup.controllers").write_text("cpu memory pids")
            (child/"cgroup.subtree_control").write_text("")
            before={name:(root/name).read_text() for name in ("memory.max","memory.swap.max","pids.max","cpu.max")}
            with patch.object(bootstrap,"require_outer_permissions"):
                self.assertEqual(bootstrap.configure(root),child)
            self.assertEqual((child/"cgroup.subtree_control").read_text(),"+cpu +memory +pids")
            self.assertEqual(before,{name:(root/name).read_text() for name in before})
    def test_enables_empty_outer_subtree_before_creating_job_parent(self):
        bootstrap=load("bootstrap")
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,value in {**bootstrap.OUTER_LIMITS,"cgroup.controllers":"cpu memory pids","cgroup.procs":"","cgroup.subtree_control":""}.items():(root/name).write_text(value)
            child=root/"extractor";child.mkdir()
            (child/"cgroup.controllers").write_text("cpu memory pids")
            (child/"cgroup.subtree_control").write_text("")
            original=Path.write_text
            def kernel_write(path,data,*args,**kwargs):
                return original(path,data.replace("+","") if path==root/"cgroup.subtree_control" else data,*args,**kwargs)
            with patch.object(bootstrap,"require_outer_permissions"),patch.object(Path,"write_text",kernel_write):
                bootstrap.configure(root)
            self.assertEqual(set((root/"cgroup.subtree_control").read_text().split()),bootstrap.CONTROLLERS)
            self.assertEqual((child/"cgroup.subtree_control").read_text(),"+cpu +memory +pids")

    def test_failed_outer_controller_write_is_not_treated_as_enabled(self):
        bootstrap=load("bootstrap")
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,value in {**bootstrap.OUTER_LIMITS,"cgroup.controllers":"cpu memory pids","cgroup.procs":"","cgroup.subtree_control":""}.items():(root/name).write_text(value)
            with patch.object(bootstrap,"require_outer_permissions"),patch.object(Path,"write_text",return_value=0),self.assertRaisesRegex(RuntimeError,"could not be enabled"):
                bootstrap.configure(root)
            self.assertFalse((root/"extractor").exists())

    def test_missing_controller_or_wrong_outer_limit_fails_closed(self):
        bootstrap=load("bootstrap")
        for values in [{"memory.max":"max"},{"memory.max":"536870912","memory.swap.max":"0","pids.max":"128","cpu.max":"50000 100000","cgroup.controllers":"cpu pids","cgroup.procs":""}]:
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)
                for name,value in values.items():(root/name).write_text(value)
                with patch.object(bootstrap,"require_outer_permissions"), self.assertRaises((OSError,RuntimeError)):
                    bootstrap.configure(root)
                self.assertFalse((root/"extractor").exists())
    def test_outer_control_writability_is_rejected(self):
        bootstrap=load("bootstrap")
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in ("memory.max","memory.swap.max","pids.max","cpu.max"):(root/name).write_text("1")
            with self.assertRaises(RuntimeError):bootstrap.require_outer_permissions(root)
    def test_export_extraction_blocks_traversal_devices_and_links_outside_root(self):
        prepare=load("prepare")
        for name,kind,target in [("../escape",tarfile.REGTYPE,""),("dev/device",tarfile.CHRTYPE,""),("usr/escape",tarfile.SYMTYPE,"../../outside"),("usr/hard",tarfile.LNKTYPE,"../../outside")]:
            with tempfile.TemporaryDirectory() as tmp:
                data=io.BytesIO()
                with tarfile.open(fileobj=data,mode="w") as archive:
                    item=tarfile.TarInfo(name);item.type=kind;item.linkname=target
                    archive.addfile(item)
                data.seek(0)
                with self.assertRaises((ValueError,tarfile.FilterError)):
                    prepare.extract_export(data,Path(tmp)/"rootfs")
    def test_export_normalizes_absolute_internal_symlink_and_strips_setid(self):
        prepare=load("prepare")
        with tempfile.TemporaryDirectory() as tmp:
            data=io.BytesIO()
            with tarfile.open(fileobj=data,mode="w") as archive:
                item=tarfile.TarInfo("usr/bin/tool");item.size=2;item.mode=0o6755;archive.addfile(item,io.BytesIO(b"ok"))
                link=tarfile.TarInfo("bin");link.type=tarfile.SYMTYPE;link.linkname="/usr/bin";archive.addfile(link)
            data.seek(0);root=Path(tmp)/"rootfs";prepare.extract_export(data,root)
            self.assertEqual((root/"usr/bin/tool").stat().st_mode & 0o6000,0)
            self.assertEqual((root/"bin/tool").read_bytes(),b"ok")
            self.assertFalse(os.path.isabs(os.readlink(root/"bin")))
    def test_root_uid_probe_rejects_writable_outer_controls_without_raising_values(self):
        bootstrap=load("bootstrap")
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,value in bootstrap.OUTER_LIMITS.items():(root/name).write_text(value)
            with patch.object(bootstrap.os,"setuid"),patch.object(bootstrap.os,"geteuid",return_value=0),self.assertRaises(RuntimeError):
                bootstrap.probe_outer_readonly(root)
            self.assertEqual({name:(root/name).read_text() for name in bootstrap.OUTER_LIMITS},bootstrap.OUTER_LIMITS)
    def test_root_uid_probe_accepts_actual_write_denials(self):
        import errno
        bootstrap=load("bootstrap")
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,value in bootstrap.OUTER_LIMITS.items():(root/name).write_text(value)
            with patch.object(bootstrap.os,"setuid"),patch.object(bootstrap.os,"geteuid",return_value=0),patch.object(bootstrap.os,"open",side_effect=PermissionError(errno.EROFS,"read-only")):
                bootstrap.probe_outer_readonly(root)

    def test_compressed_image_size_cannot_reduce_preparation_headroom(self):
        from types import SimpleNamespace
        prepare=load("prepare")
        image="sha256:"+"a"*64
        compressed=341222504
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            original_stat=Path.stat
            def owner_stat(path,*args,**kwargs):
                result=original_stat(path,*args,**kwargs)
                return SimpleNamespace(st_uid=0,st_mode=result.st_mode) if path==base else result
            def docker(args,**kwargs):
                if args[:3]==["docker","image","inspect"]:
                    return json.dumps([{"Id":image,"Size":compressed}]).encode()
                raise AssertionError("docker create reached without safe export/rootfs reservation")
            with patch.object(prepare,"BASE",base),patch.object(prepare.os,"geteuid",return_value=0),patch.object(Path,"stat",owner_stat),patch.object(prepare.subprocess,"check_output",side_effect=docker),patch.object(prepare.shutil,"disk_usage",return_value=SimpleNamespace(free=prepare.GUARD+2*compressed+1)),self.assertRaisesRegex(RuntimeError,"headroom"):
                prepare.prepare(image,{})
            self.assertEqual(list(base.iterdir()),[])
    def test_export_cap_is_checked_before_writing_the_crossing_chunk(self):
        from types import SimpleNamespace
        prepare=load("prepare")
        output=io.BytesIO()
        with patch.object(prepare,"CHUNK_SIZE",4),patch.object(prepare,"WRITE_SLACK",0),patch.object(prepare.shutil,"disk_usage",return_value=SimpleNamespace(free=10**12)),self.assertRaisesRegex(RuntimeError,"size"):
            prepare.bounded_copy(io.BytesIO(b"12345678"),output,Path("/tmp"),limit=5)
        self.assertEqual(output.getvalue(),b"1234")
    def test_export_space_is_checked_before_each_write(self):
        from types import SimpleNamespace
        prepare=load("prepare")
        output=io.BytesIO()
        with patch.object(prepare,"GUARD",100),patch.object(prepare,"CHUNK_SIZE",4),patch.object(prepare,"WRITE_SLACK",0),patch.object(prepare.shutil,"disk_usage",side_effect=[SimpleNamespace(free=104),SimpleNamespace(free=103)]),self.assertRaisesRegex(RuntimeError,"headroom"):
            prepare.bounded_copy(io.BytesIO(b"12345678"),output,Path("/tmp"),limit=8)
        self.assertEqual(output.getvalue(),b"1234")
    def test_failed_export_terminates_and_reaps_only_its_own_cli(self):
        from unittest.mock import MagicMock
        prepare=load("prepare")
        process=MagicMock()
        process.stdout=io.BytesIO(b"12345678")
        process.poll.return_value=None
        process.wait.return_value=-15
        with tempfile.TemporaryDirectory() as tmp,patch.object(prepare.subprocess,"Popen",return_value=process) as spawn,patch.object(prepare,"MAX_EXPORT",3),patch.object(prepare,"MAX_ROOTFS",10),patch.object(prepare,"CHUNK_SIZE",4),patch.object(prepare,"GUARD",100),patch.object(prepare,"WRITE_SLACK",0),patch.object(prepare.shutil,"disk_usage",return_value=type("Usage",(),{"free":1000})()),self.assertRaisesRegex(RuntimeError,"size"):
            prepare.export_image("a"*64,Path(tmp)/"export.tar")
        self.assertEqual(spawn.call_args.args[0],["docker","export","a"*64])
        process.terminate.assert_called_once_with()
        process.wait.assert_called_once_with(timeout=5)
        process.kill.assert_not_called()
        self.assertTrue(process.stdout.closed)

    def test_oversize_export_reaps_a_real_bounded_test_child(self):
        import subprocess
        import sys
        import time
        from types import SimpleNamespace
        prepare=load("prepare")
        process=subprocess.Popen([sys.executable,"-B","-c","import sys,time;sys.stdout.buffer.write(b'12345678');sys.stdout.flush();time.sleep(30)"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        started=time.monotonic()
        try:
            with tempfile.TemporaryDirectory() as tmp,patch.object(prepare.subprocess,"Popen",return_value=process),patch.object(prepare,"MAX_EXPORT",3),patch.object(prepare,"MAX_ROOTFS",10),patch.object(prepare,"CHUNK_SIZE",4),patch.object(prepare,"WRITE_SLACK",0),patch.object(prepare,"GUARD",100),patch.object(prepare.shutil,"disk_usage",return_value=SimpleNamespace(free=1000)),self.assertRaisesRegex(RuntimeError,"size"):
                prepare.export_image("a"*64,Path(tmp)/"export.tar")
            self.assertIsNotNone(process.returncode)
            self.assertLess(time.monotonic()-started,3)
        finally:
            if process.poll() is None:process.kill();process.wait(timeout=2)
            process.stdout.close()

    def test_image_reference_and_source_manifest_are_checked(self):
        prepare=load("prepare")
        with self.assertRaises(ValueError):prepare.image_digest("latest")
        with self.assertRaises(ValueError):prepare.image_digest("sha256:"+"../"*22)
        self.assertEqual(prepare.image_digest("sha256:"+"a"*64),"a"*64)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/"service").mkdir();(root/"service/sandbox.py").write_text("altered")
            with self.assertRaises(ValueError):prepare.verify_sources(root,{"service/sandbox.py":"0"*64})

if __name__ == "__main__": unittest.main()
