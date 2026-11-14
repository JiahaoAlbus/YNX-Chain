#!/usr/bin/env python3
"""New download-policy/streaming regression; no Gradle, emulator, GUI or Internet."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path, help="Dedicated external/CI output directory")
    parser.add_argument("--java-home", type=Path, help="CI JDK root; otherwise JAVA_HOME or PATH")
    parser.add_argument("--suite", choices=("baseline", "target-delta"), default="baseline",
                        help="Run the existing transport suite or only the new request-target deltas")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sources = [root / "app/src/main/java/com/ynxweb4/browser" / (name + ".java") for name in (
        "BrowserNavigationPolicy", "BrowserDownloadPolicy", "BrowserDownloadTransfer")]
    test_class = "BrowserDownloadTargetDeltaTest" if args.suite == "target-delta" else "BrowserDownloadsTest"
    sources.append(Path(__file__).with_name(test_class + ".java"))
    args.output.mkdir(parents=True, exist_ok=True)
    classes = args.output / "classes"
    classes.mkdir(exist_ok=True)
    before = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    java_home = args.java_home or (Path(os.environ["JAVA_HOME"]) if os.environ.get("JAVA_HOME") else None)
    javac = str(java_home / "bin/javac") if java_home else shutil.which("javac") or "javac"
    java = str(java_home / "bin/java") if java_home else shutil.which("java") or "java"
    commands = [[javac, "--release", "8", "-d", str(classes), *map(str, sources)],
                [java, "-cp", str(classes), "com.ynxweb4.browser." + test_class]]
    results = []
    for command in commands:
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=45)
            results.append({"command": command, "exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
            print(result.stdout, end="")
            if result.returncode != 0:
                break
        except subprocess.TimeoutExpired as error:
            results.append({"command": command, "exitCode": None, "status": "timeout-unknown", "childReaped": True,
                            "stdout": str(error.stdout or ""), "stderr": str(error.stderr or "")})
            break
        except OSError as error:
            results.append({"command": command, "exitCode": None, "status": "tool-unavailable", "error": str(error)})
            break
    after = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    success = len(results) == 2 and all(item.get("exitCode") == 0 for item in results) and before == after
    receipt = {"schema": "YNX_ANDROID_DOWNLOAD_OFFLINE_V1", "suite": args.suite,
               "sourceSHA256": before, "sourceAfterSHA256": after,
               "results": results, "passed": success, "actualAndroidSAF": "NOT_RUN", "normalTLS": "NOT_RUN",
               "privateIsolation": "NOT_RUN_DISABLED", "networkTraffic": "none"}
    (args.output / "download-test-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    raise SystemExit(0 if success else 1)


if __name__ == "__main__":
    main()
