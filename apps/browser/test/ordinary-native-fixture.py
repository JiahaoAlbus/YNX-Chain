#!/usr/bin/python3
"""Loopback-only synthetic pages for real Native UI acceptance; never serves files or credentials."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit, parse_qs

DOWNLOAD = b'YNX ordinary Native download acceptance\nOnly generated test bytes.\n'


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        target = urlsplit(self.path)
        if target.path == '/download':
            body = DOWNLOAD
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition', 'attachment; filename="ynx-native-acceptance.txt"')
        elif target.path in ['/page-a', '/page-b', '/page-c', '/changed', '/search']:
            title = {'/page-a': 'YNX Fixture A', '/page-b': 'YNX Fixture B', '/page-c': 'YNX Fixture C', '/changed': 'YNX Changed Document', '/search': 'YNX Explicit Custom Search'}[target.path]
            query = parse_qs(target.query)
            # The fixture only accepts a fixed public synthetic query; it does not echo arbitrary input.
            query_status = 'Synthetic query received' if query.get('q') == ['YNX ordinary acceptance'] else 'No matching synthetic query'
            body = f'''<!doctype html><html><head><title>{title}</title></head><body>
<h1>{title}</h1><p>Approved visible article for {target.path}.</p>
<a href="/page-a">Page A</a> <a href="/page-b">Page B</a> <a href="/page-c">Page C</a>
<a href="/changed">Changed document</a> <a href="/download">Download test bytes</a>
<a href="/page-b" target="_blank">Open B in new tab</a>
<button onclick="history.pushState(null,'','/page-c?revision=2')">Change address only</button>
<button onclick="document.getElementById('article').textContent='Changed visible text'">Change visible text</button>
<p id="article">Immutable snapshot test article.</p><p>{query_status}</p>
<form>FORM_SECRET<input type="password" value="PASSWORD_SECRET"></form>
<p hidden>HIDDEN_SECRET</p><iframe srcdoc="FRAME_SECRET"></iframe>
</body></html>'''.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
        else:
            self.send_error(404)
            return
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--lifetime', type=int, default=1800)
    args = parser.parse_args()
    if args.receipt.exists() or not 60 <= args.lifetime <= 1800:
        raise SystemExit('Fresh receipt and bounded lifetime required')
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    receipt = {'baseURL': f'http://127.0.0.1:{server.server_port}', 'expiresAt': time.time() + args.lifetime,
               'downloadSHA256': hashlib.sha256(DOWNLOAD).hexdigest(), 'downloadBytes': len(DOWNLOAD),
               'filesystemServed': False, 'publiclyExposed': False, 'kind': 'synthetic localhost UI acceptance only; not external DDG or TLS evidence'}
    args.receipt.write_text(json.dumps(receipt, indent=2) + '\n')
    timer = threading.Timer(args.lifetime, server.shutdown)
    timer.daemon = True
    timer.start()
    try:
        server.serve_forever()
    finally:
        timer.cancel()
        server.server_close()
