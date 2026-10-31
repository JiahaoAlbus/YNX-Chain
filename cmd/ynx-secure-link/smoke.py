#!/usr/bin/env python3
"""Exercise an already built command over isolated IPC and real PQ TLS.

No production service, CA, account, funds or network activation is touched.
The backend business result is explicitly a fixture, not a Pay settlement.
"""
import argparse
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import signal
import socket
import socketserver
import subprocess
import tempfile
import threading
import time


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("isolated-local-app", timeout=5)
        self.path = str(path)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect(self.path)


def exercise(binary):
    children = []
    with tempfile.TemporaryDirectory(prefix="yl-smoke-", dir="/tmp") as temp:
        root = Path(temp)
        os.chmod(root, 0o700)

        def openssl(*args):
            result = subprocess.run(["openssl", *map(str, args)], capture_output=True)
            if result.returncode:
                raise RuntimeError("isolated certificate fixture failed: " + args[0])
            return result.stdout

        openssl("genpkey", "-algorithm", "ML-DSA-87", "-out", root / "ca.key")
        openssl("req", "-new", "-x509", "-key", root / "ca.key", "-subj", "/CN=isolated-command-root", "-days", "1", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", root / "ca.pem")
        for serial, name, san, eku in [(1, "pay", "pay.ynx.test", "clientAuth"), (2, "adapter", "adapter.ynx.test", "serverAuth")]:
            openssl("genpkey", "-algorithm", "ML-DSA-87", "-out", root / (name + ".key"))
            openssl("req", "-new", "-key", root / (name + ".key"), "-subj", "/CN=unused", "-out", root / (name + ".csr"))
            ext = root / (name + ".ext")
            ext.write_text(f"basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage={eku}\nsubjectAltName=DNS:{san}\n")
            openssl("x509", "-req", "-in", root / (name + ".csr"), "-CA", root / "ca.pem", "-CAkey", root / "ca.key", "-set_serial", str(serial), "-days", "1", "-extfile", ext, "-out", root / (name + ".pem"))
            os.chmod(root / (name + ".key"), 0o600)
        fingerprint = hashlib.sha256(openssl("x509", "-in", root / "ca.pem", "-outform", "DER")).hexdigest()
        counts = {"reads": 0, "writes": 0}

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass

            def reply(self, status, value):
                wire = json.dumps(value).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(wire)))
                self.end_headers()
                self.wfile.write(wire)

            def do_GET(self):
                assert self.path == "/settlement"
                counts["reads"] += 1
                self.reply(200, {"class": "isolated-business-fixture", "result": "read"})

            def do_POST(self):
                assert self.path == "/settle"
                payload = self.rfile.read(int(self.headers["Content-Length"]))
                assert json.loads(payload)["opId"] == "isolated-original-operation"
                counts["writes"] += 1
                self.reply(200, {"class": "isolated-business-fixture", "result": "write-recorded", "funds": False})

        backend_path = root / "backend.sock"
        backend = socketserver.UnixStreamServer(str(backend_path), Handler)
        os.chmod(backend_path, 0o600)
        worker = threading.Thread(target=backend.serve_forever, daemon=True)
        worker.start()
        reservation = socket.socket()
        reservation.bind(("127.0.0.1", 0))
        address = "127.0.0.1:" + str(reservation.getsockname()[1])
        reservation.close()
        uid = os.geteuid()

        def config(server):
            local, peer = ("adapter", "pay") if server else ("pay", "adapter")
            tls = {"CertFile": str(root / (local + ".pem")), "KeyFile": str(root / (local + ".key")), "CAFile": str(root / "ca.pem"), "PeerSAN": peer + ".ynx.test", "Server": server}
            policy = {"Edges": [{"ID": "isolated-pay-adapter", "LocalSAN": local + ".ynx.test", "PeerSAN": peer + ".ynx.test", "Epoch": 1, "Roots": [{"Fingerprint": fingerprint, "Until": "2099-01-01T00:00:00Z"}], "Routes": [{"Method": "GET", "Path": "/settlement", "Risk": "read"}, {"Method": "POST", "Path": "/settle", "Risk": "asset"}]}]}
            common = {"tls": tls, "policy": policy, "edgeId": "isolated-pay-adapter"}
            if server:
                common.update(mode="ingress", listenTCP=address, backendUnix=str(backend_path), backendUID=uid)
            else:
                common.update(mode="egress", listenUnix=str(root / "app.sock"), peerUID=uid, address=address, origin="https://adapter.ynx.test")
            return common

        try:
            for server in (True, False):
                path = root / ("ingress.json" if server else "egress.json")
                path.write_text(json.dumps(config(server)))
                children.append(subprocess.Popen([binary, "-config", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE))
            deadline = time.monotonic() + 5
            while not (root / "app.sock").exists():
                if any(p.poll() is not None for p in children):
                    raise RuntimeError("isolated command failed to start")
                if time.monotonic() > deadline:
                    raise TimeoutError("isolated command did not create private socket")
                time.sleep(0.02)
            outcomes = []
            for method, path, body, headers, expected in [
                ("GET", "/settlement", None, {}, 200),
                ("POST", "/settle", json.dumps({"opId": "isolated-original-operation"}), {"Content-Type": "application/json"}, 200),
                ("DELETE", "/settlement", None, {}, 502),
                ("GET", "/settlement", None, {"X-YNX-Service-ID": "pay.ynx.test"}, 502),
            ]:
                client = UnixHTTP(root / "app.sock")
                client.request(method, path, body=body, headers=headers)
                response = client.getresponse()
                response.read()
                outcomes.append({"method": method, "path": path, "injectedIdentity": bool(headers.get("X-YNX-Service-ID")), "status": response.status})
                assert response.status == expected, outcomes
                client.close()
            assert counts == {"reads": 1, "writes": 1}, counts
            return {"class": "isolated", "normalEntry": "ynx-secure-link -config", "hops": ["OS-authenticated private IPC", "actual native PQ mutual TLS", "OS-authenticated private backend IPC"], "business": "fixture only; no funds or product deployment", "outcomes": outcomes, "backendCalls": counts, "binarySHA256": hashlib.sha256(Path(binary).read_bytes()).hexdigest()}
        finally:
            for child in children:
                if child.poll() is None:
                    child.send_signal(signal.SIGTERM)
            for child in children:
                try:
                    child.wait(timeout=7)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            backend.shutdown()
            backend.server_close()
            worker.join(timeout=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("binary")
    parser.add_argument("--output")
    args = parser.parse_args()
    result = exercise(str(Path(args.binary).resolve()))
    wire = json.dumps(result, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(wire)
    print(wire, end="")
