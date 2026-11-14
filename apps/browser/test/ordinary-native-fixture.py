#!/usr/bin/python3
"""Loopback-only synthetic pages for real Native UI acceptance; never serves files or credentials."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import socket
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit, parse_qs

DOWNLOAD = b'YNX ordinary Native download acceptance\nOnly generated test bytes.\n'
INSTALLER = None
PULSE_PATH = None
PULSE_LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        target = urlsplit(self.path)
        if target.path == '/pulse':
            # Never log query strings, browser data, headers, or arbitrary files.
            if PULSE_PATH is not None:
                with PULSE_LOCK:
                    with PULSE_PATH.open('a') as log:
                        log.write(json.dumps({'syntheticPulse': True, 'monotonic': time.monotonic()}) + '\n')
            self.send_response(204)
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return
        if target.path == '/liveness':
            body = b'<!doctype html><title>YNX Owned Window Liveness</title><h1>Controlled page heartbeat</h1><p>Only synthetic loopback requests.</p><script>setInterval(()=>fetch("/pulse",{cache:"no-store"}).catch(()=>{}),1000)</script>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
        elif target.path == '/drop':
            # Exact controlled network failure: no proxy/DNS/external host is involved.
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connection.close()
            return
        elif target.path == '/refused':
            body = b'<!doctype html><title>YNX Controlled Refusal</title><h1>HTTP 403 controlled fixture</h1><p>Not a search result.</p>'
            self.send_response(403)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
        elif target.path in ['/download-slow', '/download-broken']:
            # Generated, bounded bytes let the installed Downloads UI expose real
            # progress/cancel or transport failure; no host file is opened here.
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition', 'attachment; filename="ynx-native-slow-fixture.bin"')
            self.send_header('Content-Length', str(32 * 1024 * 1024))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                for index in range(1024):
                    self.wfile.write(b'X' * 32768)
                    self.wfile.flush()
                    if target.path == '/download-broken' and index == 3:
                        self.close_connection = True
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
                    time.sleep(0.1)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass  # A user cancel is an expected terminal outcome for this fixture.
            return
        elif target.path == '/download' or (target.path == '/installer.zip' and INSTALLER is not None):
            body = DOWNLOAD if target.path == '/download' else INSTALLER
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream' if target.path == '/download' else 'application/zip')
            filename = 'ynx-native-acceptance.txt' if target.path == '/download' else 'YNX-Browser-QA.zip'
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        elif target.path in ['/page-a', '/page-b', '/page-c', '/changed', '/search']:
            title = {'/page-a': 'YNX Fixture A', '/page-b': 'YNX Fixture B', '/page-c': 'YNX Fixture C', '/changed': 'YNX Changed Document', '/search': 'YNX Explicit Custom Search'}[target.path]
            query = parse_qs(target.query)
            # The fixture only accepts a fixed public synthetic query; it does not echo arbitrary input.
            query_status = 'Synthetic query received' if query.get('q') == ['YNX ordinary acceptance'] else 'No matching synthetic query'
            body = f'''<!doctype html><html><head><title>{title}</title></head><body>
<h1>{title}</h1><p>Approved visible article for {target.path}.</p>
<a href="/page-a">Page A</a> <a href="/page-b">Page B</a> <a href="/page-c">Page C</a>
<a href="/changed">Changed document</a>
<a href="/refused">Controlled HTTP 403</a> <a href="/drop">Controlled network failure</a> <a href="/download">Download test bytes</a>
<a href="/installer.zip">Download reviewed QA installer</a>
<a href="/download-slow">Slow generated download</a> <a href="/download-broken">Interrupted generated download</a>
<a href="/page-b" target="_blank">Open B in new tab</a>
<button onclick="history.pushState(null,'','/page-c?revision=2')">Change address only</button>
<button onclick="document.getElementById('article').textContent='Changed visible text'">Change visible text</button>
<button onclick="document.title='YNX Deferred Title'">Change page title</button>
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
    parser.add_argument('--installer', type=Path)
    parser.add_argument('--installer-sha256')
    args = parser.parse_args()
    if args.receipt.exists() or not 60 <= args.lifetime <= 1800:
        raise SystemExit('Fresh receipt and bounded lifetime required')
    if args.installer is not None or args.installer_sha256 is not None:
        if args.installer is None or args.installer_sha256 is None or args.installer.is_symlink() or args.installer.suffix != '.zip':
            raise SystemExit('Exact reviewed ZIP and checksum required')
        if not 0 < args.installer.stat().st_size <= 128_000_000:
            raise SystemExit('Installer byte bound exceeded')
        INSTALLER = args.installer.read_bytes()
        if hashlib.sha256(INSTALLER).hexdigest() != args.installer_sha256:
            raise SystemExit('Installer checksum mismatch')
    PULSE_PATH = args.receipt.with_suffix('.pulse.jsonl')
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    receipt = {'baseURL': f'http://127.0.0.1:{server.server_port}', 'expiresAt': time.time() + args.lifetime,
               'downloadSHA256': hashlib.sha256(DOWNLOAD).hexdigest(), 'downloadBytes': len(DOWNLOAD), 'pulseLog': str(PULSE_PATH),
               'arbitraryFilesystemServed': False, 'reviewedInstallerSHA256': args.installer_sha256,
               'publiclyExposed': False, 'kind': 'synthetic localhost UI acceptance and optional exact reviewed installer only; not external DDG or TLS evidence'}
    args.receipt.write_text(json.dumps(receipt, indent=2) + '\n')
    timer = threading.Timer(args.lifetime, server.shutdown)
    timer.daemon = True
    timer.start()
    try:
        server.serve_forever()
    finally:
        timer.cancel()
        server.server_close()
