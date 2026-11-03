"""A stand-in for the usage API, for screenshots in CI: fixed numbers per key."""
import http.server
import json

POOL = {"pool_usage": 912.4, "pool_limit": 1000}
KEYS = {
    "sk-demo-ye": {"nick_name": "ye", "daily_usage": 82.31, "daily_limit": 200, "overflow_usage": 0, "overflow_limit": 100},
    "sk-demo-yy": {"nick_name": "yy", "daily_usage": 236.5, "daily_limit": 200, "overflow_usage": 36.5, "overflow_limit": 100},
    "sk-demo-66": {"nick_name": "66", "daily_usage": 300, "daily_limit": 200, "overflow_usage": 100, "overflow_limit": 100},
}


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        key = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if key in KEYS:
            body = {"code": 0, "data": {"valid": True, **KEYS[key], **POOL}}
            status = 200
        else:
            body = {"code": 401, "message": "无效的 key"}
            status = 401
        b = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass


import sys
http.server.ThreadingHTTPServer((sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1", 9931), H).serve_forever()
