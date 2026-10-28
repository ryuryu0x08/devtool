#!/usr/bin/env python3
"""Local forwarder for the toolbox's local plugins.

A browser page can't call an API that doesn't allow cross-origin requests (no CORS headers, or
OPTIONS not handled). This runs on your own computer, listens on 127.0.0.1 only, forwards each
request to the target API unchanged (path, query, Authorization, body) and adds the CORS headers
the browser needs. Only requests from the toolbox's address are served. Nothing is stored; keys
are never logged.

    python3 scripts/local-proxy.py http://xxxx
    python3 scripts/local-proxy.py http://xxxx --port 8787 --origin http://public-pages.ryuryu.fun:8081

A plugin then calls http://127.0.0.1:8787/<path> instead of http://xxxx/<path>.
Python 3.8+, standard library only.
"""
import argparse
import http.server
import json
import sys
import urllib.error
import urllib.request

DEFAULT_ORIGINS = ['http://public-pages.ryuryu.fun:8081']
FORWARD_HEADERS = ['authorization', 'content-type', 'accept']


def make_handler(target, origins):
    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = 'toolbox-local-proxy'

        def _origin(self):
            o = self.headers.get('Origin')
            return o if o in origins else None

        def _cors(self, origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')

        def _refuse(self):
            body = json.dumps({'proxy_error': 'origin not allowed: %s (start with --origin)' % self.headers.get('Origin')}).encode()
            self.send_response(403)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            origin = self._origin()
            if not origin:
                return self._refuse()
            self.send_response(204)
            self._cors(origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept')
            # Chrome asks before a public page may reach a local address.
            if self.headers.get('Access-Control-Request-Private-Network'):
                self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Access-Control-Max-Age', '600')
            self.send_header('Content-Length', '0')
            self.end_headers()

        def _forward(self, method):
            origin = self._origin()
            if not origin:
                return self._refuse()
            length = int(self.headers.get('Content-Length') or 0)
            data = self.rfile.read(length) if length else None
            req = urllib.request.Request(target + self.path, data=data, method=method)
            for h in FORWARD_HEADERS:
                if self.headers.get(h):
                    req.add_header(h, self.headers[h])
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    status, ctype, body = r.status, r.headers.get('Content-Type', 'application/octet-stream'), r.read()
            except urllib.error.HTTPError as e:
                status, ctype, body = e.code, e.headers.get('Content-Type', 'application/octet-stream'), e.read()
            except Exception as e:  # unreachable, timeout, DNS…
                status, ctype, body = 502, 'application/json', json.dumps({'proxy_error': 'cannot reach %s: %s' % (target, e)}).encode()
            self.send_response(status)
            self._cors(origin)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self._forward('GET')

        def do_POST(self):
            self._forward('POST')

        def log_message(self, fmt, *args):
            # Method, path and status only: no headers, so no keys.
            sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))

    return Handler


def main():
    p = argparse.ArgumentParser(description='Forward the toolbox\'s requests to an API that has no CORS.')
    p.add_argument('target', help='the API\'s base address, e.g. http://xxxx')
    p.add_argument('--port', type=int, default=8787)
    p.add_argument('--origin', action='append', help='the toolbox\'s address (repeatable); default %s' % DEFAULT_ORIGINS[0])
    a = p.parse_args()
    target = a.target.rstrip('/')
    origins = a.origin or DEFAULT_ORIGINS
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), make_handler(target, origins))
    print('Forwarding http://127.0.0.1:%d -> %s (for %s). Ctrl+C to stop.' % (a.port, target, ', '.join(origins)), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
