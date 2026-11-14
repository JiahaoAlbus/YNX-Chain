#!/usr/bin/env python3
"""Exercise the real debug Activity against a deliberately reordered public catalog."""
import json
import re
import subprocess
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

started = {key: threading.Event() for key in ("oldone", "oldtwo")}
release = {key: threading.Event() for key in started}
finished = {key: threading.Event() for key in started}
sent = {}
fresh_sent = threading.Event()
initial_sent = threading.Event()

def product(title):
    return {"ID": title, "Title": title, "Description": "Controlled public catalog",
            "Variants": [{"ID": "v1", "Name": "One", "Inventory": 3,
                          "Reserved": 0, "PriceYNXT": 100}]}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(url.query).get("q", [""])[0]
        print(f"fixture request: {self.path}", flush=True)
        if url.path != "/api/products":
            self.send_error(404)
            return
        if query in started:
            started[query].set()
            if not release[query].wait(10):
                sent[query] = 504
                self.send_error(504)
                finished[query].set()
                return
        title = "FRESH PRODUCT" if query == "fresh" else "STALE PRODUCT"
        data = json.dumps({"products": [product(title)] if query else []}).encode()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            if query in finished:
                sent[query] = 200
            if query == "fresh":
                fresh_sent.set()
            if not query:
                initial_sent.set()
        finally:
            if query in finished:
                finished[query].set()

    def log_message(self, fmt, *args):
        print("fixture:", fmt % args, flush=True)

def adb(*args):
    return subprocess.check_output(["adb", *args], text=True)

def snapshot():
    raw = adb("exec-out", "uiautomator", "dump", "/dev/tty").split("UI hierchary dumped")[0].strip()
    return list(ET.fromstring(raw).iter("node"))

def find(nodes, label):
    return next(n for n in nodes if n.get("text") == label or n.get("content-desc") == label)

def position(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
    return str((x1 + x2) // 2), str((y1 + y2) // 2)

def tap(pos):
    adb("shell", "input", "tap", *pos)

def search(value):
    tap(position(find(snapshot(), "Search products and categories")))
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    adb("shell", "input", "keyevent", *(["KEYCODE_DEL"] * 20))
    adb("shell", "input", "text", value)
    adb("shell", "input", "keyevent", "KEYCODE_BACK")
    time.sleep(0.3)
    tap(position(find(snapshot(), "Search")))

def require(nodes, label):
    try:
        find(nodes, label)
    except StopIteration as exc:
        raise AssertionError(f"Missing {label!r}: {[n.get('text') for n in nodes]}") from exc

server = ThreadingHTTPServer(("127.0.0.1", 8095), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    adb("shell", "am", "start", "-W", "-n", "com.ynxweb4.shop.debug/com.ynxweb4.shop.MainActivity")
    if not initial_sent.wait(8):
        print("Initial catalog request absent; UI:", [(n.get("text"), n.get("content-desc")) for n in snapshot()], flush=True)
        raise AssertionError("initial catalog request did not reach fixture")
    nodes = snapshot()
    cart = position(find(nodes, "Cart"))

    search("oldone")
    if not started["oldone"].wait(5):
        print("Search request absent; UI:", [(n.get("text"), n.get("content-desc"), n.get("bounds")) for n in snapshot()], flush=True)
        raise AssertionError("old search did not reach fixture")
    search("fresh")
    assert fresh_sent.wait(5), "fresh response was not sent"
    require(snapshot(), "FRESH PRODUCT")
    release["oldone"].set()
    assert finished["oldone"].wait(3), "old response was not sent"
    assert sent.get("oldone") == 200, "old response timed out or was not delivered"
    time.sleep(1)
    nodes = snapshot()
    require(nodes, "FRESH PRODUCT")
    assert not any(n.get("text") == "STALE PRODUCT" for n in nodes)

    search("oldtwo")
    assert started["oldtwo"].wait(5), "second old search did not reach fixture"
    tap(cart)
    before = snapshot()
    require(before, "Order review")
    old_status = find(before, "Marketplace status").get("text")
    release["oldtwo"].set()
    assert finished["oldtwo"].wait(3), "second old response was not sent"
    assert sent.get("oldtwo") == 200, "second old response timed out or was not delivered"
    time.sleep(1)
    after = snapshot()
    require(after, "Order review")
    assert find(after, "Marketplace status").get("text") == old_status, "late response changed Cart status"
    assert not any(n.get("text") == "STALE PRODUCT" for n in after)
    print("PASS: latest search and Cart survive delayed catalog responses")
finally:
    for event in release.values():
        event.set()
    server.shutdown()
