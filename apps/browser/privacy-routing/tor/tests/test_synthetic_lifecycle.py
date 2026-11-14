#!/usr/bin/env python3
"""New headless ownership delta only. No AppKit/Root/IPC/vendor/network."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path, help="new managed scratch directory")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    sources = [browser / "native/Sources/YNXBrowserNative" / name for name in
               ["ProtectedSyntheticWindow.swift", "ProtectedAcceptanceDispatcher.swift"]]
    sources.append(Path(__file__).with_name("SyntheticLifecycleDeltaProbe.swift").resolve())
    inputs, copied = {}, []
    for source in sources:
        data = source.read_bytes()
        copy = output / source.name
        copy.write_bytes(data)
        copied.append(str(copy))
        inputs[str(source.relative_to(browser))] = hashlib.sha256(data).hexdigest()
    (output / "inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")
    command = ["/usr/bin/xcrun", "swiftc", "-swift-version", "6", "-target", "arm64-apple-macosx14.0",
               "-module-cache-path", str(output / "module-cache"), "-parse-as-library",
               "-DYNX_PRIVACY_ACCEPTANCE", "-DYNX_SYNTHETIC_LIFECYCLE_PROBE"] + copied + ["-o", str(output / "lifecycle-probe")]
    (output / "command.json").write_text(json.dumps(command, indent=2) + "\n")
    with (output / "compile.log").open("wb") as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        print((output / "compile.log").read_text())
        raise SystemExit(result.returncode)
    # The only process is this pure ownership probe. It owns no child/resource effects.
    with (output / "result.log").open("wb") as log:
        result = subprocess.run([str(output / "lifecycle-probe")], stdout=log, stderr=subprocess.STDOUT, timeout=15)
    print((output / "result.log").read_text().strip())
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
