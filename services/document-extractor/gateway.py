"""Private mutual-TLS byte gateway; no database, URL fetching, user paths or parser options."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import ssl
from sandbox import extract, failure


def validate_request(path, headers):
    formats = {"/v1/extract/" + f: f for f in ("hwp", "doc", "ppt", "pdf")}
    if path not in formats or headers.get("Content-Type") != "application/octet-stream" or headers.get("Transfer-Encoding"):
        raise ValueError("invalid_document")
    value = headers.get("Content-Length", "")
    if not value.isascii() or not value.isdigit() or not 0 < int(value) <= 5 * 1024 * 1024:
        raise ValueError("invalid_document")
    return formats[path], int(value)


class Gateway(HTTPServer):
    def get_request(self):
        socket, address = super().get_request()
        socket.settimeout(10)
        try:
            return self.context.wrap_socket(socket, server_side=True), address
        except BaseException:
            socket.close()
            raise


class Handler(BaseHTTPRequestHandler):
    server_version = "Extractor"
    sys_version = ""

    def log_message(self, *_):
        pass

    def do_POST(self):
        self.connection.settimeout(10)
        try:
            if not self.connection.getpeercert():
                raise ValueError("unauthenticated")
            if len(self.headers.get_all("Content-Length", [])) != 1:
                raise ValueError("invalid_document")
            format, size = validate_request(self.path, self.headers)
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError("invalid_document")
            result = extract(format, data)
            status = 200
        except (ValueError, OSError):
            result, status = failure("invalid_document", "rejected"), 400
        body = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()
        if len(body) > 2 * 1024 * 1024:
            body = json.dumps(failure("parser_failed")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True


def tls_context():
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_verify_locations("/run/secrets/client-ca.pem")
    context.load_cert_chain("/run/secrets/server-cert.pem", "/run/secrets/server-key.pem")
    return context


if __name__ == "__main__":
    # Single-process HTTPServer deliberately serializes extraction jobs.
    server = Gateway(("0.0.0.0", 8443), Handler)
    server.context = tls_context()
    server.serve_forever()
