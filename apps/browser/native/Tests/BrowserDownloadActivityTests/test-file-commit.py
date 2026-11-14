#!/usr/bin/env python3
"""Exercise the ordinary download commit boundary with owned files and Swift code."""

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="Fresh absolute evidence directory")
    parser.add_argument("--directory-rebind-only", action="store_true")
    args = parser.parse_args()
    output = args.output
    if not output.is_absolute():
        parser.error("--output must be absolute")
    output.mkdir(mode=0o700)
    here = Path(__file__).resolve().parent
    source = here.parent.parent / "Sources"
    paths = [
        source / "YNXBrowserCore/BrowserDownloadDecision.swift",
        source / "YNXBrowserCore/DownloadPersistence.swift",
        source / "YNXBrowserNative/BrowserDownloadActivity.swift",
        here / "FileCommitProbe.swift",
        Path(__file__).resolve(),
    ]
    inputs = {}
    for path in paths:
        contents = path.read_bytes()
        inputs[str(path)] = sha256(contents).hexdigest()
        (output / path.name).write_bytes(contents)
    (output / "tmp").mkdir(mode=0o700)
    (output / "files").mkdir(mode=0o700)
    receipt = {"schema": "P05_ORDINARY_DOWNLOAD_FILE_COMMIT_V1", "inputs": inputs, "commands": [],
               "nativeApplication": "NOT_RUN", "webKitAndSavePanel": "NOT_RUN", "network": "NOT_RUN"}
    try:
        # Keep module/cache output on the evidence volume even when Swift needs an ASCII path.
        with tempfile.TemporaryDirectory(prefix="p05-file-commit-", dir="/tmp") as alias_dir:
            build = Path(alias_dir) / "evidence"
            build.symlink_to(output)
            env = dict(os.environ, TMPDIR=str(build / "tmp"))
            def run(label, command, timeout):
                try:
                    result = subprocess.run(command, env=env, capture_output=True, timeout=timeout, check=False)
                except subprocess.TimeoutExpired as error:
                    (output / f"{label}.stdout").write_bytes(error.stdout or b"")
                    (output / f"{label}.stderr").write_bytes(error.stderr or b"")
                    receipt["commands"].append({"label": label, "argv": command, "timeout": True})
                    raise
                (output / f"{label}.stdout").write_bytes(result.stdout)
                (output / f"{label}.stderr").write_bytes(result.stderr)
                receipt["commands"].append({"label": label, "argv": command, "exit": result.returncode})
                if result.returncode != 0:
                    raise SystemExit(result.returncode)
                return result.stdout.decode().strip()

            sdk = run("sdk", ["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"], 15)
            swift = run("swift", ["/usr/bin/xcrun", "--find", "swiftc"], 15)
            common = [swift, "-j", "1", "-swift-version", "6", "-sdk", sdk,
                      "-target", platform.machine() + "-apple-macosx14.0", "-module-cache-path", str(build / "cache")]
            run("compile-core", common + ["-emit-library", "-emit-module", "-module-name", "YNXBrowserCore",
                str(build / paths[0].name), str(build / paths[1].name),
                "-emit-module-path", str(build / "YNXBrowserCore.swiftmodule"), "-o", str(build / "libYNXBrowserCore.dylib")], 45)
            executable = str(build / "FileCommitProbe")
            run("compile-probe", common + ["-parse-as-library", "-I", str(build), "-L", str(build), "-lYNXBrowserCore",
                "-Xlinker", "-rpath", "-Xlinker", str(build),
                str(build / paths[2].name), str(build / paths[3].name), "-o", executable], 45)
            selector = ["--directory-rebind-only"] if args.directory_rebind_only else []
            receipt["checks"] = run("probe", [executable, str((output / "files").resolve()), *selector], 10).splitlines()
            expected = 2 if args.directory_rebind_only else 9
            if len(receipt["checks"]) != expected or not all(line.startswith("PASS ") for line in receipt["checks"]):
                raise ValueError("Missing ordinary download filesystem observations")
    finally:
        receipt["sourceDrift"] = [str(path) for path in paths if sha256(path.read_bytes()).hexdigest() != inputs[str(path)]]
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
    if receipt["sourceDrift"]:
        raise ValueError("Input changed after source freeze")
    print(output / "receipt.json")


if __name__ == "__main__":
    main()
