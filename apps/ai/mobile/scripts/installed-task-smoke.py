#!/usr/bin/env python3
"""Exercise the installed, unauthenticated task entry on a fresh CI emulator."""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

apk = sys.argv[1]

def adb(*args):
    return subprocess.run(["adb", *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30).stdout

def find_node(labels):
    output = adb("exec-out", "uiautomator", "dump", "/dev/tty")
    start = output.find(b"<?xml")
    if start < 0:
        return None
    end = output.find(b"</hierarchy>", start)
    if end < 0:
        return None
    root = ET.fromstring(output[start:end + len(b"</hierarchy>")])
    return next((n for n in root.iter("node") if n.get("content-desc") in labels or n.get("text") in labels), None)

def wait_node(labels):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            node = find_node(labels)
            if node is not None:
                return node
        except (ET.ParseError, subprocess.CalledProcessError):
            pass
        time.sleep(2)
    raise RuntimeError("installed UI did not show expected task entry")

def tap(node):
    bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    if not bounds:
        raise RuntimeError("task UI element has invalid bounds")
    x1, y1, x2, y2 = map(int, bounds.groups())
    adb("shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2))

adb("install", "-r", apk)
adb("shell", "monkey", "-p", "com.ynxweb4.ai", "1")
tap(wait_node({"Task workspace", "任务工作区"}))
wait_node({"Task authorization unavailable", "正式任务登录不可用"})
tap(wait_node({"Back to chat", "返回对话"}))
wait_node({"Task workspace", "任务工作区"})
print("INSTALLED_UNAUTHENTICATED_TASK_ENTRY_AND_RETURN_PASS")
