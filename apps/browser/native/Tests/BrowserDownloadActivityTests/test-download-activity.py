#!/usr/bin/env python3
"""Actual nonpersistent WKDownload cancellation/failure delta; no visible window/panel."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
from pathlib import Path
import platform
import socket
import subprocess
import tempfile
import threading
import time


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        self.server.requests.append(self.path)
        if self.path not in ("/slow", "/broken", "/success"):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", 'attachment; filename="fixture.bin"')
        self.send_header("Content-Length", "65536" if self.path == "/success" else "4194304")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            if self.path == "/success":
                self.wfile.write(b"Z" * 65536)
                return
            for index in range(256):
                self.wfile.write(b"X" * 16384)
                self.wfile.flush()
                if self.path == "/broken" and index == 3:
                    self.close_connection = True
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                time.sleep(0.02)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def log_message(self, *_):
        pass


here = Path(__file__).resolve().parent
native = here.parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--save-recovery-only", action="store_true")
options = parser.parse_args()
with tempfile.TemporaryDirectory(prefix="ynx-download-activity-") as temporary:
    scratch = Path(temporary)
    target = platform.machine() + "-apple-macos14.0"
    core = native / "Sources/YNXBrowserCore"
    subprocess.run([
        "xcrun", "swiftc", "-swift-version", "6", "-target", target, "-emit-library", "-emit-module",
        "-module-name", "YNXBrowserCore", str(core / "BrowserDownloadDecision.swift"), str(core / "DownloadPersistence.swift"),
        "-emit-module-path", str(scratch / "YNXBrowserCore.swiftmodule"), "-o", str(scratch / "libYNXBrowserCore.dylib"),
    ], check=True, timeout=60)
    executable = scratch / "probe"
    subprocess.run([
        "xcrun", "swiftc", "-swift-version", "6", "-target", target, "-I", temporary, "-L", temporary,
        "-lYNXBrowserCore", "-Xlinker", "-rpath", "-Xlinker", temporary,
        str(native / "Sources/YNXBrowserNative/BrowserDownloadActivity.swift"), str(here / "Probe.swift"), "-o", str(executable),
    ], check=True, timeout=60)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    server.requests = []
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        argv = [str(executable), "http://127.0.0.1:" + str(server.server_port), temporary]
        if options.save_recovery_only:
            argv.append("--save-recovery-only")
        result = subprocess.run(argv,
                                check=True, capture_output=True, text=True, timeout=90)
        receipt = json.loads(result.stdout)
        if receipt.get("status") != "PASS" or receipt.get("installedDownloadsUI") != "NOT_RUN":
            raise RuntimeError("Unexpected actual WebKit delta receipt")
        if options.save_recovery_only:
            if server.requests != ["/success"] * 3:
                raise RuntimeError(f"Saving completed bytes repeated the network request: {server.requests}")
            receipt["actualHTTPRequests"] = len(server.requests)
        print(json.dumps(receipt, indent=2, sort_keys=True))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
