"""Real malicious-format rejection smoke; no production documents or host mounts."""
import glob
from pathlib import Path
import subprocess
import sys
sys.path.insert(0,"/service")
from sandbox import normalize
Path("/tmp/Parser.java").write_bytes(sys.stdin.buffer.read(100000))
cp=":".join(glob.glob("/opt/tika/lib/*.jar")+glob.glob("/opt/tika/*.jar"))
r=subprocess.run(["java","-Xmx256m","-XX:ActiveProcessorCount=1","-jar","/opt/compiler/ecj.jar","-17","-proc:none","-cp",cp,"-d","/tmp/classes","/fixtures/AdversarialFixtures.java","/tmp/Parser.java"],capture_output=True,text=True)
assert r.returncode==0,r.stderr
java=["java","-Xmx256m","-XX:ActiveProcessorCount=1","-XX:+UseSerialGC","-Duser.home=/tmp","-cp","/tmp/classes:"+cp]
subprocess.run(java+["AdversarialFixtures","/fixtures"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60,check=True)
for name,code in [("protected.hwp",43),("expanded.hwp",42),("macro.doc",43),("embedded.doc",43),("pages21.pdf",42),("active.pdf",43),("encrypted.pdf",44),("slides21.ppt",42),("annotation-Launch.pdf",43),("annotation-SubmitForm.pdf",43),("annotation-ImportData.pdf",43),("embedded.ppt",43),("macro.ppt",43)]:
 format=name.rsplit(".",1)[1]
 r=subprocess.run(java+["Parser",format],input=Path("/fixtures",name).read_bytes(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=65)
 result=normalize(format,r.returncode,r.stdout)
 print(name,r.returncode,result["status"],result["reason"],flush=True)
 assert r.returncode==code and result["status"]=="rejected" and result["snapshot"] is None
for data,format in [(b"%PDF-not-a-document","pdf"),(Path("/fixtures/text-v1.pdf").read_bytes(),"doc"),(b"x"*(5*1024*1024+1),"pdf")]:
 r=subprocess.run(java+["Parser",format],input=data,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=65)
 assert normalize(format,r.returncode,r.stdout)["status"]=="rejected"
print("PASS: 16 real malformed/protected/macro/embedded/size/page/expansion rejection cases",flush=True)
