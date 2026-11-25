"""Real TLS handshake tests; certificate files are synthetic and live only in tmpfs."""
from pathlib import Path
import http.client
import json
import os
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from gateway import Gateway, Handler, tls_context

class MutualTLS(unittest.TestCase):
 def test_missing_and_untrusted_client_certificates_are_denied(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder=Path(tmp)
   def run(*args):
    subprocess.run(["openssl",*args],cwd=folder,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
   run("req","-x509","-newkey","rsa:2048","-nodes","-keyout","ca-key.pem","-out","client-ca.pem","-days","1","-subj","/CN=Fixture CA")
   for name,usage in [("server","serverAuth"),("client","clientAuth")]:
    run("req","-new","-newkey","rsa:2048","-nodes","-keyout",name+"-key.pem","-out",name+".csr","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost","-addext","extendedKeyUsage="+usage)
    run("x509","-req","-in",name+".csr","-CA","client-ca.pem","-CAkey","ca-key.pem","-CAcreateserial","-out",name+"-cert.pem","-days","1","-copy_extensions","copy")
   run("req","-x509","-newkey","rsa:2048","-nodes","-keyout","rogue-key.pem","-out","rogue-cert.pem","-days","1","-subj","/CN=Untrusted Fixture")
   original_ca=ssl.SSLContext.load_verify_locations
   original_chain=ssl.SSLContext.load_cert_chain
   def ca(context,path):return original_ca(context,str(folder/Path(path).name))
   def chain(context,cert,key):return original_chain(context,str(folder/Path(cert).name),str(folder/Path(key).name))
   with patch.object(ssl.SSLContext,"load_verify_locations",ca),patch.object(ssl.SSLContext,"load_cert_chain",chain):context=tls_context()
   server=Gateway(("127.0.0.1",0),Handler);server.context=context
   thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   try:
    def request(client):
     connection=http.client.HTTPSConnection("localhost",server.server_port,context=client,timeout=3)
     try:
      connection.request("POST","/v1/extract/pdf",body=b"%PDF-1.7",headers={"Content-Type":"application/octet-stream"})
      response=connection.getresponse();body=response.read();return response.status,body
     finally:connection.close()
    client=ssl.create_default_context(cafile=str(folder/"client-ca.pem"))
    with self.assertRaises((ssl.SSLError,ConnectionError)):request(client)
    client.load_cert_chain(str(folder/"client-cert.pem"),str(folder/"client-key.pem"))
    status,body=request(client)
    self.assertEqual(status,200);self.assertIn(b"sandbox_unavailable",body)
    # Run the same transport under the CI runtime; /work remains the isolated-image default.
    root=Path(os.environ.get("GHOSTMANUAL_TEST_ROOT","/work")).resolve()
    transport=root/"src/lib/document-extractor.ts"
    self.assertTrue(transport.is_file(), "Provide the isolated checkout as GHOSTMANUAL_TEST_ROOT or mount it at /work")
    environment={"PATH":os.environ["PATH"],"DOCUMENT_EXTRACTOR_URL":f"https://localhost:{server.server_port}","DOCUMENT_EXTRACTOR_CA":(folder/"client-ca.pem").read_text(),"DOCUMENT_EXTRACTOR_CERT":(folder/"client-cert.pem").read_text(),"DOCUMENT_EXTRACTOR_KEY":(folder/"client-key.pem").read_text()}
    denied="문서 추출 서비스에 연결할 수 없습니다."
    cases=[
     ("valid",{},"안전한 문서 추출 환경을 사용할 수 없습니다."),
     ("missing-client",{"DOCUMENT_EXTRACTOR_CERT":"","DOCUMENT_EXTRACTOR_KEY":""},denied),
     ("untrusted-client",{"DOCUMENT_EXTRACTOR_CERT":(folder/"rogue-cert.pem").read_text(),"DOCUMENT_EXTRACTOR_KEY":(folder/"rogue-key.pem").read_text()},denied),
     ("wrong-server-ca",{"DOCUMENT_EXTRACTOR_CA":(folder/"rogue-cert.pem").read_text()},denied),
     ("wrong-server-name",{"DOCUMENT_EXTRACTOR_URL":f"https://127.0.0.1:{server.server_port}"},denied),
    ]
    for name,overrides,expected in cases:
     with self.subTest(node_transport=name):
      script="import {extractDocument} from "+json.dumps(transport.as_uri())+"; const r=await extractDocument('pdf',Buffer.from('%PDF-1.7')); if(r.status!=='failed'||r.snapshot!==null||r.reason!=="+json.dumps(expected)+")throw new Error('Transport contract failed');"
      result=subprocess.run(["node","--input-type=module","-e",script],env=environment|overrides,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
      self.assertEqual(result.returncode,0,result.stderr.decode()[:500])
    untrusted=ssl.create_default_context(cafile=str(folder/"client-ca.pem"))
    untrusted.load_cert_chain(str(folder/"rogue-cert.pem"),str(folder/"rogue-key.pem"))
    with self.assertRaises((ssl.SSLError,ConnectionError)):request(untrusted)
   finally:server.shutdown();server.server_close();thread.join(3)
if __name__=="__main__":unittest.main()
