"""A stand-in fallback gateway for forward_e2e.sh: its API under /fb, a key it wants (Bearer
sk-fallback), one model of its own. Each request it gets is written to the file given."""
import http.server
import json
import sys

SEEN = sys.argv[1]


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def answer(self, status, body):
        b = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def record(self, body):
        json.dump({"path": self.path, "auth": self.headers.get("Authorization"), "version": self.headers.get("anthropic-version"), "body": body}, open(SEEN, "w"))

    def do_GET(self):
        self.record("")
        if self.headers.get("Authorization") != "Bearer sk-fallback":
            return self.answer(401, {"type": "error", "error": {"type": "authentication_error", "message": "bad key"}})
        if self.path.startswith("/fb/v1/models"):
            return self.answer(200, {"data": [{"id": "glm-fallback", "type": "model", "display_name": "GLM"}], "has_more": False})
        self.answer(404, {"type": "error", "error": {"type": "not_found_error", "message": self.path}})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode()
        self.record(body)
        if self.headers.get("Authorization") != "Bearer sk-fallback" or not self.path.startswith("/fb/v1/messages"):
            return self.answer(401, {"type": "error", "error": {"type": "authentication_error", "message": "bad key or path"}})
        self.answer(200, {"type": "message", "content": [{"type": "text", "text": "from the fallback"}]})

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 9932), H).serve_forever()
