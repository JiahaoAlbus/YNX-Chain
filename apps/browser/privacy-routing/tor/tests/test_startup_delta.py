#!/usr/bin/env python3
"""Focused macOS offline startup delta; fresh scratch directory is required."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("scratch", type=Path, help="new output directory, preferably on managed external storage")
    args = parser.parse_args()
    scratch = args.scratch.resolve()
    scratch.mkdir(parents=True, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    core = sorted((browser / "native/Sources/YNXBrowserCore").glob("*.swift"))
    native = [browser / "native/Sources/YNXBrowserNative" / name for name in [
        "PrivacyTorPlatform.swift", "BundledTorBackend.swift", "TorExternalTransport.swift",
        "BrowserRouteProtection.swift", "TorProtectedRouteProvider.swift"]]
    probe = Path(__file__).resolve().with_name("StartupCancellationDeltaProbe.swift")
    inputs = {}
    copied = []
    for source in core + native + [probe]:
        data = source.read_bytes()
        target = scratch / "source" / source.relative_to(browser)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        copied.append(target)
        inputs[str(source.relative_to(browser))] = hashlib.sha256(data).hexdigest()
    (scratch / "inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")
    compiler = ["/usr/bin/xcrun", "swiftc", "-swift-version", "6", "-target", "arm64-apple-macosx14.0",
                "-module-cache-path", str(scratch / "module-cache")]

    def run(command, name, env=None):
        with (scratch / (name + ".log")).open("wb") as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, env=env)
        if result.returncode:
            print((scratch / (name + ".log")).read_text())
            raise SystemExit(result.returncode)

    run(compiler + ["-parse-as-library", "-emit-library", "-emit-module", "-module-name", "YNXBrowserCore",
        "-emit-module-path", str(scratch / "YNXBrowserCore.swiftmodule"), "-o", str(scratch / "libYNXBrowserCore.dylib")]
        + [str(path) for path in copied[:len(core)]], "compile-core")
    run(compiler + ["-parse-as-library", "-I", str(scratch), "-L", str(scratch), "-lYNXBrowserCore",
        "-o", str(scratch / "startup-delta")] + [str(path) for path in copied[len(core):]], "compile-delta")
    environment = dict(os.environ)
    environment["DYLD_LIBRARY_PATH"] = str(scratch)
    run([str(scratch / "startup-delta")], "result", environment)
    print((scratch / "result.log").read_text().strip())
    print("INPUTS " + str(scratch / "inputs.json"))


if __name__ == "__main__":
    main()
