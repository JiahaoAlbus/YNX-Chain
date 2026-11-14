#!/usr/bin/env python3
"""Verify real WebKit target=_blank POST and link navigation using numeric loopback."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
from threading import Thread

FORM = b'<form action="/submit" method="post" target="_blank"><input name="item" value="generated"></form>'
LINK = b'<a href="/follow" target="_blank">Open the next page</a>'


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond(b"")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 256:
            self.send_error(400)
            return
        self.respond(self.rfile.read(length))

    def respond(self, request_body):
        if self.path in ("/submit", "/follow"):
            self.server.observed.append((self.command, self.path, request_body.decode(), self.headers.get("Cookie")))
        payload = {"/form": FORM, "/link": LINK}.get(self.path, b"<!doctype html><title>Fixture destination</title>")
        self.send_response(200)
        if self.path == "/form":
            self.send_header("Set-Cookie", "ynx_fixture=owned; SameSite=Lax; Path=/")
        self.send_header("Content-Type", "text/html")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--controller", type=Path, help="Override main.swift for a pre-fix reproduction")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700)
    (output / "tmp").mkdir(mode=0o700)
    source = Path(__file__).with_name("BlankTabNavigationProbe.swift")
    native = source.resolve().parents[2] / "Sources"
    controller = args.controller or native / "YNXBrowserNative/main.swift"
    controller_bytes = controller.read_bytes()
    start = "    func webView(_ webView: WKWebView, createWebViewWith configuration:"
    next_method = "    private func reviewWalletURL"
    if controller_bytes.decode().count(start) != 1:
        raise ValueError("Expected one ordinary Browser popup delegate")
    delegate = start + controller_bytes.decode().split(start, 1)[1].split(next_method, 1)[0]
    (output / "OrdinaryPopupDelegate.swift").write_text("import WebKit\nextension BlankTabNavigationFixture {\n" + delegate + "}\n")
    (output / source.name).write_bytes(source.read_bytes())
    (output / "Omnibox.swift").write_bytes((native / "YNXBrowserCore/Omnibox.swift").read_bytes())
    with tempfile.TemporaryDirectory(prefix="p05-blank-tab-", dir="/tmp") as scratch:
        build = Path(scratch) / "evidence"
        build.symlink_to(output)
        env = dict(os.environ, TMPDIR=str(build / "tmp"))
        probe = build / "Probe"
        compile_args = ["xcrun", "swiftc", "-j", "1", "-swift-version", "6", "-parse-as-library",
                        "-target", platform.machine() + "-apple-macosx14.0",
                        "-module-cache-path", str(build / "cache"), str(build / source.name),
                        str(build / "OrdinaryPopupDelegate.swift"), str(build / "Omnibox.swift"), "-o", str(probe)]
        compiled = subprocess.run(compile_args, env=env, capture_output=True, timeout=45, check=False)
        (output / "compile.stderr").write_bytes(compiled.stderr)
        compiled.check_returncode()
        with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server:
            server.observed = []
            thread = Thread(target=server.serve_forever)
            thread.start()
            arguments = [str(probe), f"http://127.0.0.1:{server.server_port}"]
            try:
                completed = subprocess.run(arguments, env=env, capture_output=True, timeout=25, check=False)
            finally:
                server.shutdown()
                thread.join()
            (output / "probe.stdout").write_bytes(completed.stdout)
            (output / "probe.stderr").write_bytes(completed.stderr)
            expected = [("POST", "/submit", "item=generated", "ynx_fixture=owned"),
                        ("GET", "/follow", "", "ynx_fixture=owned")]
            passed = completed.returncode == 0 and server.observed == expected
            receipt = {"status": "PASS" if passed else "FAIL", "originalExit": completed.returncode,
                       "controllerSHA256": hashlib.sha256(controller_bytes).hexdigest(),
                       "delegateSHA256": hashlib.sha256(delegate.encode()).hexdigest(),
                       "loopbackRequests": server.observed, "visibleGUI": "NOT_RUN", "installedBrowser": "NOT_RUN"}
            (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
            print(json.dumps(receipt))
            if not passed:
                raise SystemExit(1)


if __name__ == "__main__":
    main()
