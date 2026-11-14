#!/usr/bin/env python3
"""No-GUI observer and unwired candidate queue contracts; not Save-panel acceptance."""
import json
from pathlib import Path
import platform
import subprocess
import tempfile

here = Path(__file__).resolve().parent
sources = here.parent.parent / "Sources/YNXBrowserNative"
with tempfile.TemporaryDirectory(prefix="ynx-save-panel-state-") as temporary:
    executable = Path(temporary) / "probe"
    subprocess.run([
        "xcrun", "swiftc", "-swift-version", "6", "-target", platform.machine() + "-apple-macos14.0",
        str(sources / "BrowserSavePanelStateObservation.swift"),
        str(sources / "BrowserDownloadSavePresentation.swift"), str(here / "Probe.swift"), "-o", str(executable),
    ], check=True, timeout=60)
    result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=20, check=True)
    receipt = json.loads(result.stdout)
    if receipt.get("observerSyntheticNotificationContract") != "PASS" or receipt.get("saveButtonAcceptance") != "NOT_RUN":
        raise RuntimeError("Unexpected observation contract result")
    print(json.dumps(receipt, indent=2, sort_keys=True))
