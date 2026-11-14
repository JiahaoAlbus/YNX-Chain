#!/usr/bin/env python3
"""Loopback-only synthetic WebView fixture. Never serves local files or account data."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = self.path.split('?', 1)[0]
        if route in ('/page-a', '/page-b'):
            page = route[-1].upper()
            other = 'b' if page == 'A' else 'a'
            label = 'Next page B' if page == 'A' else 'Previous page A'
            body = (f'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
                    f'<title>YNX Fixture {page}</title><link rel="stylesheet" href="/resource.css"></head>'
                    f'<body><h1>YNX_ANDROID_PAGE_{page}</h1><p id="resource">resource pending</p>'
                    f'<a id="to-{other}" href="/page-{other}">{label}</a>'
                    '<p><a id="download" href="https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf">Download synthetic PDF</a></p>'
                    '<img id="fixture-image" width="32" height="32" src="/pixel.svg" alt="synthetic image">'
                    '<script src="/resource.js"></script></body></html>').encode()
            mime = 'text/html; charset=utf-8'
        elif route == '/resource.css':
            body, mime = b'body{margin:24px;font:20px sans-serif;color:#002FA7}a{display:block;padding:20px 8px;min-height:48px}', 'text/css'
        elif route == '/resource.js':
            body, mime = b'document.getElementById("resource").textContent="YNX_ANDROID_RESOURCE_LOADED";', 'text/javascript'
        elif route == '/pixel.svg':
            body, mime = b'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#002FA7"/></svg>', 'image/svg+xml'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt', required=True, type=Path)
    parser.add_argument('--max-seconds', type=int, default=1800)
    args = parser.parse_args()
    if args.receipt.exists():
        raise ValueError('Preserve existing fixture receipt')
    if not 1 <= args.max_seconds <= 3600:
        raise ValueError('Fixture must have a bounded lifetime')
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    data = {'host': '127.0.0.1', 'port': server.server_port,
            'emulatorBase': f'http://10.0.2.2:{server.server_port}', 'syntheticOnly': True,
            'startedAt': time.time(), 'maxSeconds': args.max_seconds, 'localFilesServed': False}
    args.receipt.write_text(json.dumps(data, indent=2) + '\n')
    timer = threading.Timer(args.max_seconds, server.shutdown)
    timer.daemon = True
    timer.start()
    print(json.dumps(data), flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        timer.cancel()
        server.server_close()


if __name__ == '__main__':
    main()
