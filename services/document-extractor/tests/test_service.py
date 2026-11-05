import base64
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gateway import validate_request, tls_context
from sandbox import bounded_process, normalize, sandbox_command, extract

class BoundaryTests(unittest.TestCase):
 def test_fixed_bytes_contract(self):
  self.assertEqual(validate_request("/v1/extract/pdf",{"Content-Type":"application/octet-stream","Content-Length":"8"}), ("pdf",8))
 def test_rejects_paths_options_urls_and_size(self):
  for path,headers in [("/v1/extract/pdf?url=http://169.254.169.254",{"Content-Type":"application/octet-stream","Content-Length":"8"}),("/v1/extract/../../etc/passwd",{}),("/v1/extract/pdf",{"Content-Type":"application/octet-stream","Content-Length":"5242881"}),("/v1/extract/pdf",{"Content-Type":"application/octet-stream","Content-Length":"8","Transfer-Encoding":"chunked"})]:
   with self.assertRaises(ValueError): validate_request(path,headers)
 def test_namespaces_and_filesystem_are_not_optional(self):
  command=sandbox_command("pdf")
  for flag in ["--unshare-all","--die-with-parent","--new-session","--clearenv","--proc","--cap-drop"]: self.assertIn(flag,command)
  self.assertNotIn("/run/secrets",command)
  self.assertNotIn("--share-net",command)
  with self.assertRaises(ValueError): sandbox_command("pdf; curl example.com")
 def test_java_executable_does_not_require_unmounted_alternatives(self):
  command=sandbox_command("pdf")
  self.assertEqual(command[command.index("--")+1],"/usr/lib/jvm/java-17-openjdk-amd64/bin/java")
  self.assertNotIn("/etc/alternatives",command)
 def test_missing_cgroup_fails_closed(self):
  with patch("sandbox.CGROUP",Path("/nonexistent-cgroup")):
   self.assertEqual(extract("pdf",b"%PDF-1.7")["reason"],"sandbox_unavailable")
 def test_ocr_is_limited_not_no_changes(self):
  payload=b"mode\tocr\npage\tpage/1\t"+base64.b64encode("한글".encode())+b"\n"
  result=normalize("pdf",0,payload)
  self.assertEqual((result["status"],result["reason"],result["snapshot"]["extractionMode"]),("limited","ocr_uncertain","ocr"))
 def test_output_and_page_caps(self):
  payload=b"page\tpage/1\t"+base64.b64encode(b"x"*200001)+b"\n"
  self.assertEqual(normalize("pdf",0,payload)["status"],"failed")
  self.assertEqual(normalize("pdf",0,b"page\tpage/1\teA==\n"*21)["status"],"failed")
 def test_errors_are_fixed_codes_never_stderr(self):
  for code,reason in [(42,"limit_exceeded"),(43,"unsafe_document"),(44,"invalid_document"),(124,"timeout"),(99,"parser_failed")]:
   result=normalize("pdf",code,b"secret document and stack")
   self.assertEqual(result["reason"],reason);self.assertIsNone(result["snapshot"])
 def test_tls_requires_client_certificate(self):
  with patch.object(ssl.SSLContext,"load_verify_locations"),patch.object(ssl.SSLContext,"load_cert_chain"):
   context=tls_context()
  self.assertEqual(context.verify_mode,ssl.CERT_REQUIRED)
  self.assertEqual(context.minimum_version,ssl.TLSVersion.TLSv1_3)
 def test_real_timeout_kills_process_group_and_caps_stdout(self):
  # Regular files exercise controller plumbing only; the real cgroup gate is separate.
  with tempfile.TemporaryDirectory() as tmp, patch("sandbox.os.setgroups"), patch("sandbox.os.setgid"), patch("sandbox.os.setuid"):
   group=Path(tmp)
   started=time.monotonic()
   code,_=bounded_process([sys.executable,"-c","import subprocess,time; subprocess.Popen(['sleep','30']); time.sleep(30)"],b"x",group,0.2)
   self.assertEqual(code,124);self.assertLess(time.monotonic()-started,3)
   code,data=bounded_process([sys.executable,"-c","import sys; sys.stdout.buffer.write(b'x'*3000000)"],b"x",group,3)
   self.assertEqual(code,42);self.assertEqual(data,b"")
class PrivilegeTests(unittest.TestCase):
 def test_explicit_parser_drop_clears_all_capability_sets_before_exec(self):
  import json
  command = """import json,os
from pathlib import Path
from unittest.mock import patch
import sandbox
with patch('sandbox.os.setgroups'),patch('sandbox.os.setgid'),patch('sandbox.os.setuid'):
 sandbox.drop_parser_privileges()
status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert all(int(status[name],16)==0 for name in ['CapEff','CapPrm','CapInh','CapAmb'])
assert status['NoNewPrivs'].strip()=='1'
print('cleared')
"""
  result=subprocess.run([sys.executable,"-B","-c",command],cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr)
  self.assertEqual(result.stdout.strip(),"cleared")

class CleanupTests(unittest.TestCase):
 def test_successful_cgroup_kill_does_not_require_host_kill_capability(self):
  with tempfile.TemporaryDirectory() as tmp, patch("sandbox.os.setgroups"), patch("sandbox.os.setgid"), patch("sandbox.os.setuid"), patch("sandbox.os.killpg", side_effect=PermissionError("different UID")):
   self.assertEqual(bounded_process([sys.executable,"-c","print('ok')"],b"x",Path(tmp),2),(0,b"ok\n"))
 def test_failed_cgroup_kill_stays_failed_closed_and_reaps_child(self):
  with tempfile.TemporaryDirectory() as tmp, patch("sandbox.os.setgroups"), patch("sandbox.os.setgid"), patch("sandbox.os.setuid"):
   group=Path(tmp);(group/"cgroup.kill").mkdir()
   with self.assertRaises(OSError):
    bounded_process([sys.executable,"-c","print('ok')"],b"x",group,2)

if __name__=="__main__":unittest.main()
