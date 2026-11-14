#!/usr/bin/env python3
"""Blocked-writer/UI-actor isolation and actual private-temp atomic readback delta."""
import json
from pathlib import Path
import platform
import subprocess
import tempfile

here = Path(__file__).resolve().parent
helper = here.parent.parent / "Sources/YNXBrowserNative/BrowserEvidenceFileWriter.swift"
with tempfile.TemporaryDirectory(prefix="ynx-evidence-writer-") as temporary:
    executable = Path(temporary) / "probe"
    subprocess.run([
        "xcrun", "swiftc", "-swift-version", "6", "-target", platform.machine() + "-apple-macos14.0",
        str(helper), str(here / "Probe.swift"), "-o", str(executable),
    ], check=True, timeout=60)
    result = subprocess.run([str(executable), temporary], check=True, capture_output=True, text=True, timeout=20)
    receipt = json.loads(result.stdout)
    if receipt.get("status") != "PASS" or receipt.get("saveButtonAcceptance") != "NOT_RUN":
        raise RuntimeError("Unexpected evidence-writer delta receipt")
    print(json.dumps(receipt, indent=2, sort_keys=True))
