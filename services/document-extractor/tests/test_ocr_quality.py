"""Check real Korean OCR against the synthetic scanned PDF originals."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from sandbox import normalize


PARSER = [
    "java", "-Xmx256m", "-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC",
    "-cp", "/tmp/ocr-parser:/opt/parser:/opt/tika/lib/*:/opt/tika/*",
]


def extract(path):
    parsed = subprocess.run(
        PARSER + ["Parser", "pdf"], input=path.read_bytes(), stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, cwd="/tmp", timeout=120, check=True,
    )
    return normalize("pdf", parsed.returncode, parsed.stdout)


class OcrQualityTests(unittest.TestCase):
    def test_scanned_and_native_pdfs(self):
        for name in ("scan-ko-v1", "scan-ko-v2", "text-v1"):
            with self.subTest(name=name):
                fixture = Path("/fixtures") / name
                result = extract(fixture.with_suffix(".pdf"))
                expected = json.loads(fixture.with_suffix(".json").read_text(encoding="utf-8"))
                self.assertEqual(result, expected)


    def test_ruled_table_and_two_column_originals(self):
        expected = {
            "table": "구분\t내용\n신청\t서류 제출\n검토\t결과 안내 문서 보관",
            "columns": (
                "왼쪽 첫 번째 문장\n왼쪽 두 번째 문장\n\n"
                "오른쪽 첫 번째 문장\n오른쪽 두 번째 문장"
            ),
        }
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(
                PARSER + [str(Path(__file__).with_name("Layout.java")), tmp],
                timeout=120, check=True,
            )
            for name, original in expected.items():
                with self.subTest(name=name):
                    result = extract(Path(tmp) / f"{name}.pdf")
                    self.assertEqual((result["status"], result["reason"]), ("limited", "ocr_uncertain"))
                    self.assertEqual(result["snapshot"]["extractionMode"], "ocr")
                    self.assertEqual(result["snapshot"]["blocks"][0]["text"].strip(), original)
