#!/usr/bin/env python3
"""macOS PUBLIC embedded NSXPC test; all outputs go to a new managed scratch."""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import time


def main():
    args = argparse.ArgumentParser()
    args.add_argument("scratch", type=Path)
    args.add_argument("--consumer-delta", action="store_true", help="only four new Native producer consumer process cases")
    args.add_argument("--reuse-core", type=Path, help="reuse only if every snapshotted Core hash is identical")
    parsed = args.parse_args()
    architecture = platform.machine()
    if platform.system() != "Darwin" or architecture not in ("arm64", "x86_64"):
        args.error("A native macOS arm64 or x86_64 runner is required")
    scratch = parsed.scratch.resolve()
    scratch.mkdir(parents=True, exist_ok=False)
    alias = Path(tempfile.mkdtemp(prefix="ynx-public-ipc-", dir="/private/tmp"))
    os.rmdir(alias)
    alias.symlink_to(scratch, target_is_directory=True)
    browser = Path(__file__).resolve().parents[1]
    core = sorted((browser / "native/Sources/YNXBrowserCore").glob("*.swift"))
    transport = browser / "native/Sources/YNXBrowserNative/BrowserPageProtectedIPC.swift"
    probe = Path(__file__).with_name("ConsumerIPCProbe.swift" if parsed.consumer_delta else "PUBLICIPCProbe.swift").resolve()
    native = [transport]
    if parsed.consumer_delta:
        native.append(browser / "native/Sources/YNXBrowserNative/BrowserNativePageReadoutProducer.swift")
    readback_script = "verify-consumer-readback.py" if parsed.consumer_delta else "verify-readback.py"
    hashes = {}
    copies = []
    for source in core + native + [probe]:
        data = source.read_bytes()
        target = scratch / "source" / source.relative_to(browser)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        copies.append(target)
        hashes[str(source.relative_to(browser))] = hashlib.sha256(data).hexdigest()
    for source in [Path(__file__).resolve(), Path(__file__).with_name(readback_script).resolve()]:
        data = source.read_bytes()
        target = scratch / "source" / source.relative_to(browser)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        hashes[str(source.relative_to(browser))] = hashlib.sha256(data).hexdigest()
    (scratch / "inputs.json").write_text(json.dumps(hashes, indent=2) + "\n")
    commands = []

    def run(command, label):
        commands.append(command)
        (scratch / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
        with (scratch / (label + ".log")).open("wb") as output:
            result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            print((scratch / (label + ".log")).read_text())
            raise RuntimeError(label + " exit " + str(result.returncode))

    compiler = ["/usr/bin/xcrun", "swiftc", "-swift-version", "6", "-target", architecture + "-apple-macosx14.0",
                "-module-cache-path", str(alias / "module-cache")]
    if parsed.reuse_core:
        prior = parsed.reuse_core.resolve()
        previous = json.loads((prior / "inputs.json").read_text())
        for source in core:
            key = str(source.relative_to(browser))
            if previous.get(key) != hashes[key]:
                raise RuntimeError("Core reuse hash mismatch: " + key)
        for name in ["libYNXBrowserCore.dylib", "YNXBrowserCore.swiftmodule", "YNXBrowserCore.swiftdoc", "YNXBrowserCore.swiftsourceinfo"]:
            shutil.copy2(prior / name, scratch / name)
        (scratch / "core-reused.json").write_text(json.dumps({"prior": str(prior), "matchedCoreFiles": len(core)}))
    else:
        run(compiler + ["-parse-as-library", "-emit-library", "-emit-module", "-module-name", "YNXBrowserCore",
            "-emit-module-path", str(alias / "YNXBrowserCore.swiftmodule"), "-o", str(alias / "libYNXBrowserCore.dylib"),
            "-Xlinker", "-install_name", "-Xlinker", "@rpath/libYNXBrowserCore.dylib"] + [str(p) for p in copies[:len(core)]], "compile-core")
    common = compiler + ["-parse-as-library", "-I", str(alias), "-L", str(alias), "-lYNXBrowserCore",
        "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"]
    run(common + [str(p) for p in copies[len(core):]] + ["-o", str(alias / "host")], "compile-host")
    run(common + ["-DPUBLIC_IPC_SERVICE"] + [str(p) for p in copies[len(core):]] + ["-o", str(alias / "service")], "compile-service")
    app = alias / "Host.app"
    executable = app / "Contents/MacOS/PUBLICIPCProbe"
    executable.parent.mkdir(parents=True)
    shutil.copy2(alias / "host", executable)
    frameworks = app / "Contents/Frameworks"
    frameworks.mkdir()
    shutil.copy2(alias / "libYNXBrowserCore.dylib", frameworks / "libYNXBrowserCore.dylib")
    modes = ["normal", "wrong-peer", "wrong-code", "request-limit", "response-limit", "busy", "cancel", "navigate", "clear", "exit"]
    if parsed.consumer_delta:
        modes = ["consumer-valid", "consumer-bindings", "consumer-cancel", "consumer-stale"]
    for mode in modes:
        directory = alias / mode
        directory.mkdir()
        service = app / ("Contents/XPCServices/com.ynx.public.pageipc." + mode + ".xpc")
        binary = service / "Contents/MacOS/PUBLICIPCProbe"
        binary.parent.mkdir(parents=True)
        shutil.copy2(alias / "service", binary)
        libdir = service / "Contents/Frameworks"
        libdir.mkdir()
        shutil.copy2(alias / "libYNXBrowserCore.dylib", libdir / "libYNXBrowserCore.dylib")
        info = {"CFBundleExecutable": "PUBLICIPCProbe", "CFBundleIdentifier": "com.ynx.public.pageipc." + mode,
                "CFBundlePackageType": "XPC!", "CFBundleVersion": "1", "XPCService": {"ServiceType": "Application", "RunLoopType": "dispatch_main"},
                "PUBLICFixtureDirectory": str(directory), "PUBLICFixtureMode": mode, "PUBLICHostExecutable": str(executable),
                "PUBLICAuthRootQualified": False}
        (service / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
        run(["/usr/bin/codesign", "--force", "--sign", "-", str(libdir / "libYNXBrowserCore.dylib")], "sign-service-library-" + mode)
        run(["/usr/bin/codesign", "--force", "--sign", "-", str(service)], "sign-service-" + mode)
    (app / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "PUBLICIPCProbe", "CFBundleIdentifier": "com.ynx.public.pageipc.host",
        "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "LSBackgroundOnly": True, "PUBLICAuthRootQualified": False}))
    run(["/usr/bin/codesign", "--force", "--sign", "-", str(frameworks / "libYNXBrowserCore.dylib")], "sign-host-library")
    run(["/usr/bin/codesign", "--force", "--sign", "-", str(app)], "sign-host")
    run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)], "verify-bundle")
    run(["/usr/bin/codesign", "--display", "--verbose=4", str(app)], "actual-host-code-signature")
    process = None
    try:
        with (scratch / "runtime.log").open("wb") as output:
            process = subprocess.Popen([str(executable), str(alias)], stdout=output, stderr=subprocess.STDOUT)
            (scratch / "RUNNING.json").write_text(json.dumps({"pid": process.pid, "alias": str(alias), "RootAuthQualified": False}, indent=2))
            code = process.wait(timeout=150)
        if code:
            raise RuntimeError("PUBLIC host exit " + str(code))
        run(["/usr/bin/python3", str(scratch / "source/native-ipc-tests" / readback_script), str(scratch)], "readback")
        print((scratch / "RESULT.json").read_text())
    finally:
        # Fixture-only sealed directories, not a production control protocol. Never kill
        # an OS-discovered service PID: request its own bounded normal owner shutdown.
        for mode in modes:
            (scratch / mode / "shutdown").write_text("close")
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        known = []
        for mode in modes:
            fixture = scratch / mode / "fixture.json"
            if fixture.exists():
                known.append(json.loads(fixture.read_text())["pid"])
        def alive(pid):
            try:
                os.kill(pid, 0)  # Observation only. Never signal a discovered service PID.
                return True
            except ProcessLookupError:
                return False
        deadline = time.monotonic() + 6
        while any(alive(pid) for pid in known) and time.monotonic() < deadline:
            time.sleep(0.02)
        # Preserve alias and all first-cause artifacts for exact reinspection.
        (scratch / "FINISHED.json").write_text(json.dumps({"hostExited": process is None or process.poll() is not None,
            "knownServicePIDs": known, "knownServicesExited": all(not alive(pid) for pid in known),
            "unobservedServices": len(modes) - len(known), "alias": str(alias), "RootAuthQualification": "NOT_RUN"}))


if __name__ == "__main__":
    main()
