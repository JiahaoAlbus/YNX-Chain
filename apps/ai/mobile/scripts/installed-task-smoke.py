#!/usr/bin/env python3
"""Exercise the installed, unauthenticated task entry on a fresh CI emulator."""
import hashlib
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

apk = sys.argv[1]

def adb(*args, timeout=60):
    return subprocess.run(["adb", *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout).stdout

def find_node(labels):
    output = adb("exec-out", "uiautomator", "dump", "/dev/tty")
    start = output.find(b"<?xml")
    if start < 0:
        return None
    end = output.find(b"</hierarchy>", start)
    if end < 0:
        return None
    body = output[start:end + len(b"</hierarchy>")]
    if os.environ.get("RUNNER_TEMP"):
        with open(os.path.join(os.environ["RUNNER_TEMP"], "ynx-ai-task-ui-last.xml"), "wb") as dump:
            dump.write(body)
    root = ET.fromstring(body)
    return next((n for n in root.iter("node") if n.get("content-desc") in labels or n.get("text") in labels), None)

def wait_node(labels):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            node = find_node(labels)
            if node is not None:
                return node
        except (ET.ParseError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            pass
        time.sleep(2)
    raise RuntimeError("installed UI did not show expected task entry")

def tap(node):
    bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    if not bounds:
        raise RuntimeError("task UI element has invalid bounds")
    x1, y1, x2, y2 = map(int, bounds.groups())
    adb("shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2))

def digest(stream):
    result = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        result.update(block)
    return result.hexdigest()

adb("install", "-r", apk, timeout=180)
paths = adb("shell", "pm", "path", "com.ynxweb4.ai").decode().splitlines()
if len(paths) != 1 or not paths[0].startswith("package:"):
    raise RuntimeError("installed package did not expose exactly one original APK")
with open(apk, "rb") as original:
    expected = digest(original)
with subprocess.Popen(["adb", "exec-out", "cat", paths[0][len("package:"):]], stdout=subprocess.PIPE) as installed:
    assert installed.stdout is not None
    observed = digest(installed.stdout)
    if installed.wait(timeout=60) != 0 or observed != expected:
        raise RuntimeError("installed APK does not match original artifact")
print("INSTALLED_APK_SHA256=" + observed, flush=True)
adb("shell", "monkey", "-p", "com.ynxweb4.ai", "1")
tap(wait_node({"Task workspace", "任务工作区"}))
wait_node({"Task authorization unavailable", "正式任务登录不可用"})
tap(wait_node({"Back to chat", "返回对话"}))
wait_node({"Task workspace", "任务工作区"})
print("INSTALLED_UNAUTHENTICATED_TASK_ENTRY_AND_RETURN_PASS")
