#!/usr/bin/env python3
"""Compile actual enum/classifier source slices under both preprocessor paths; no route."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time


def declaration(text, name):
    # These selected declarations have no quoted/comment brace tokens. Fail rather
    # than silently choosing a duplicate or an unclosed declaration on source drift.
    needle = "enum " + name + ":"
    if text.count(needle) != 1:
        raise ValueError("ambiguous actual enum declaration: " + name)
    start = text.index(needle)
    brace = text.index("{", start)
    depth = 1
    end = brace + 1
    while depth:
        if end >= len(text):
            raise ValueError("unclosed actual enum: " + name)
        depth += (text[end] == "{") - (text[end] == "}")
        end += 1
    return text[start:end]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="new managed scratch directory")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    names = {
        "TorCoordinatorFailure": "native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift",
        "TorTransportFailure": "native/Sources/YNXBrowserNative/TorExternalTransport.swift",
        "ProtectionLeaseFailure": "native/Sources/YNXBrowserCore/ProtectionLease.swift",
        "PrivacyRouteError": "native/Sources/YNXBrowserCore/PrivacyRouteProvider.swift",
        "RoutedQualificationFailure": "native/Sources/YNXBrowserCore/RoutedProductionQualification.swift",
        "SyntheticTrialFailure": "native/Sources/YNXBrowserCore/SyntheticCanaryProtocol.swift",
    }
    inputs, declarations = {}, []
    for name, relative in names.items():
        data = (browser / relative).read_bytes()
        inputs[relative] = hashlib.sha256(data).hexdigest()
        (output / Path(relative).name).write_bytes(data)
        source = declaration(data.decode(), name)
        if name == "SyntheticTrialFailure":
            source = "#if YNX_PRIVACY_ACCEPTANCE\n" + source + "\n#endif"
        declarations.append(source)
    fixture = Path(__file__).with_name("TrialDiagnosticDeltaProbe.swift")
    data = fixture.read_bytes()
    inputs[str(fixture.relative_to(browser))] = hashlib.sha256(data).hexdigest()
    probe = output / fixture.name
    probe.write_bytes(data)
    selected = output / "ActualClassifierSlices.swift"
    selected.write_text("import Foundation\n\n" + "\n\n".join(declarations) + "\n")
    (output / "inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")
    events = []

    def run(command, name):
        started = time.monotonic()
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        timeout = False
        try:
            stdout, stderr = process.communicate(timeout=90)
        except subprocess.TimeoutExpired:
            timeout = True
            process.terminate()
            try:
                stdout, stderr = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate(timeout=2)
        (output / (name + ".stdout")).write_bytes(stdout)
        (output / (name + ".stderr")).write_bytes(stderr)
        events.append(dict(name=name, command=command, pid=process.pid, returncode=process.returncode,
                           timeout=timeout, reaped=process.poll() is not None, seconds=time.monotonic() - started))
        (output / "processes.json").write_text(json.dumps(events, indent=2) + "\n")
        if timeout or process.returncode:
            raise RuntimeError("delta failed; preserved first cause: " + name)
        return stdout

    failure = None
    results = {}
    try:
        for mode in ["normal", "acceptance"]:
            binary = output / ("diagnostic-" + mode)
            compiler = ["/usr/bin/xcrun", "swiftc", "-swift-version", "6", "-target", "arm64-apple-macosx14.0",
                        "-j", "1", "-module-cache-path", str(output / "module-cache"), "-parse-as-library"]
            if mode == "acceptance":
                compiler += ["-DYNX_PRIVACY_ACCEPTANCE"]
            run(compiler + [str(selected), str(probe), "-o", str(binary)], mode + "-compile")
            symbols = run(["/usr/bin/nm", "-j", str(binary)], mode + "-symbols")
            if mode == "normal" and any(x in symbols for x in [b"SyntheticTrialFailure", b"trialAuthorityUnavailable", b"trialCanaryLeak"]):
                raise RuntimeError("acceptance symbols leaked into production classifier")
            if mode == "acceptance" and b"SyntheticTrialFailure" not in symbols:
                raise RuntimeError("acceptance classifier was not compiled")
            results[mode] = run([str(binary)], mode + "-delta").decode().strip()
        for relative, digest in inputs.items():
            if hashlib.sha256((browser / relative).read_bytes()).hexdigest() != digest:
                raise RuntimeError("source drift during delta: " + relative)
    except Exception as error:
        failure = str(error)
    result = dict(status="FAIL" if failure else "PASS", firstCause=failure, results=results, processes=events,
                  scope="actual classifier/enum source slices only; no full Native build or route qualification",
                  BrowserRouteReady="NOT_RUN", LeakSafe="NOT_RUN", productionAdmission="UNCHANGED_FALSE",
                  oldGroupsRepeated=False)
    (output / "RESULT.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if failure else 0)


if __name__ == "__main__":
    main()
