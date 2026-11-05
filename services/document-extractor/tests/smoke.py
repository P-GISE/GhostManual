"""Real parser smoke. Mount only synthetic /fixtures; pipe current Parser.java on stdin."""
import glob
import json
from pathlib import Path
import subprocess
import sys
sys.path.insert(0,"/service")
from sandbox import normalize
source = sys.stdin.buffer.read(100001)
assert 0 < len(source) <= 100000
Path("/tmp/Parser.java").write_bytes(source)
cp = ":".join(glob.glob("/opt/tika/lib/*.jar") + glob.glob("/opt/tika/*.jar"))
compile = subprocess.run(["java","-Xmx256m","-XX:ActiveProcessorCount=1","-jar","/opt/compiler/ecj.jar","-17","-proc:none","-cp",cp,"-d","/tmp/classes","/fixtures/GenerateFixtures.java","/tmp/Parser.java"],capture_output=True,text=True)
assert compile.returncode == 0, compile.stderr
java = ["java","-Xmx256m","-XX:ActiveProcessorCount=1","-XX:+UseSerialGC","-Djava.awt.headless=true","-Duser.home=/tmp","-cp","/tmp/classes:"+cp]
subprocess.run(java+["GenerateFixtures","/fixtures"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60,check=True)
for format,prefix in [("hwp","sample"),("doc","office"),("ppt","slides"),("pdf","text"),("pdf","scan-ko")]:
    snapshots = []
    for version in (1,2):
        data = Path(f"/fixtures/{prefix}-v{version}.{format}").read_bytes()
        process = subprocess.run(java+["Parser",format],input=data,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=125)
        result = normalize(format,process.returncode,process.stdout)
        text = "\n".join(b["text"] for b in (result["snapshot"] or {}).get("blocks",[]))
        print(prefix,version,"exit",process.returncode,"status",result["status"],"text",repr(text),flush=True)
        assert result["status"] == ("limited" if prefix=="scan-ko" else "ready")
        assert "SECRET_HIDDEN" not in text
        if prefix == "slides": assert f"TABLE CELL {version}" in text
        if prefix == "sample":
            assert f"한글 합성 문서 {version}" in text
        elif prefix == "scan-ko":
            assert "한글" in text and "GhostManual" in text and str(version) in text
            assert result["snapshot"]["extractionMode"] == "ocr"
        else:
            assert f"GhostManual synthetic version {version}" in text
        snapshots.append(text)
        Path(f"/fixtures/{prefix}-v{version}.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    assert snapshots[0] != snapshots[1]
print("PASS: 10 real format extractions and five version differences",flush=True)
