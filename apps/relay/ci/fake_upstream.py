#!/usr/bin/env python3
"""A stand-in API for the relay's app test: answers 200 with what it was sent (method, path, the
headers that matter), and remembers the last request in a file."""
import http.server
import json
import sys

PORT, SEEN = int(sys.argv[1]), sys.argv[2]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        seen = {"method": "POST", "path": self.path, "x-api-key": self.headers.get("x-api-key"),
                "authorization": self.headers.get("Authorization"), "body": body}
        with open(SEEN, "w") as f:
            json.dump(seen, f)
        out = json.dumps({"ok": True, "path": self.path}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
