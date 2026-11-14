#!/usr/bin/env python3
"""Public AppKit own-app key routing delta; deliberately no visible GUI/save panel."""
import json
from pathlib import Path
import platform
import subprocess
import tempfile

here = Path(__file__).resolve().parent
native = here.parent.parent
helper = native / "Sources/YNXBrowserNative/BrowserPendingSaveQuitShortcut.swift"
with tempfile.TemporaryDirectory(prefix="ynx-pending-save-quit-") as temporary:
    executable = Path(temporary) / "probe"
    subprocess.run([
        "xcrun", "swiftc", "-swift-version", "6", "-target",
        platform.machine() + "-apple-macos14.0", str(helper), str(here / "Probe.swift"),
        "-o", str(executable),
    ], check=True, timeout=60)
    result = subprocess.run([str(executable)], check=True, capture_output=True, text=True, timeout=20)
    receipt = json.loads(result.stdout)
    if receipt.get("mechanismStatus") != "PASS" or receipt.get("installedModalKeyDelivery") != "NOT_RUN":
        raise RuntimeError("Unexpected AppKit delta result")
    print(json.dumps(receipt, indent=2, sort_keys=True))
