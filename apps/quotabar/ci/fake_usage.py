"""A stand-in for the usage API (fixed numbers per key) and the model API, for CI."""
import http.server
import json

POOL = {"pool_usage": 912.4, "pool_limit": 1000}
KEYS = {
    "sk-demo-ye": {"nick_name": "ye", "daily_usage": 82.31, "daily_limit": 200, "overflow_usage": 0, "overflow_limit": 100},
    "sk-demo-yy": {"nick_name": "yy", "daily_usage": 236.5, "daily_limit": 200, "overflow_usage": 36.5, "overflow_limit": 100},
    "sk-demo-66": {"nick_name": "66", "daily_usage": 300, "daily_limit": 200, "overflow_usage": 100, "overflow_limit": 100},
}


class H(http.server.BaseHTTPRequestHandler):
    # A gateway keeps connections open (HTTP/1.1) unless asked to close them.
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        """The model API, strict like a gateway: the path under /api and the API's own Host, or an
        empty 400."""
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        if not self.path.startswith("/api/v1/messages") or self.headers.get("Host") != EXPECTED_HOST:
            self.send_response(400)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for ev in ("event: message_start\ndata: {}\n\n", "event: content_block_delta\ndata: {\"text\":\"hi\"}\n\n", "event: message_stop\ndata: {}\n\n"):
                b = ev.encode()
                self.wfile.write(b"%x\r\n%s\r\n" % (len(b), b))
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            return
        out = json.dumps({"type": "message", "content": [{"type": "text", "text": "hi"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        key = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if self.path.startswith("/api/v1/models"):
            # The model API's model list (for the fallback gateway's merged list).
            b = json.dumps({"data": [{"id": "claude-company", "type": "model"}], "has_more": False}).encode()
            self.send_response(200 if key in KEYS else 401)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        if key in KEYS:
            body = {"code": 0, "data": {"valid": True, **KEYS[key], **POOL}}
            status = 200
        else:
            body = {"code": 401, "message": "无效的 key"}
            status = 401
        b = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass


import sys
EXPECTED_HOST = sys.argv[2] if len(sys.argv) > 2 else "model-api.quotabar.test:9931"
http.server.ThreadingHTTPServer((sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1", 9931), H).serve_forever()
