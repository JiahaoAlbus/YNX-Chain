#!/usr/bin/env python3
"""Check the actual Successor QA result-publication and owned-handle drain."""

import argparse
import hashlib
import json
from pathlib import Path
import platform

from test_r2_https_completion import execute
from test_worker_ownership import segment


FIXTURE = r'''
import Darwin
import Foundation

@MainActor final class ActualChildAdapter {
    private var process: Process?
    init(_ process: Process) { self.process = process }
    var processIdentifier: Int32? { process?.processIdentifier }
    func pollProcess() {
        if let process, !process.isRunning { self.process = nil }
    }
}

@main struct Probe {
    @MainActor static var retainedAdapter: ActualChildAdapter?
    @MainActor static var retainedCurl: Process?

    @MainActor static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let failure = root.appendingPathComponent("publication-conflict", isDirectory: true)
        let unknown = root.appendingPathComponent("late-cleanup", isDirectory: true)
        let normal = root.appendingPathComponent("without-retention", isDirectory: true)
        for output in [failure, unknown, normal] {
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: false)
        }
        let existing = failure.appendingPathComponent("CLI-RESULT.json")
        let first = Data("first unchanged".utf8)
        try first.write(to: existing)
        var controls: [String: Bool] = [:]
        let witness = failure.appendingPathComponent("PREEXIT.json")
        let childA = try startChild(), childB = try startChild()
        retainedAdapter = .init(childA)
        retainedCurl = childB
        try write(["childPIDs": [childA.processIdentifier, childB.processIdentifier]], witness)
        // Deliberately let publication fail while both actual children are live.
        // The harness owns their bounded exit if the product drops custody.
        let stopAfterPublication = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(200))
            if childA.isRunning { childA.terminate() }
            if childB.isRunning { childB.terminate() }
        }
        var sawExclusiveFailure = false
        do { _ = try await finishRun(["status": "CLEANUP_UNKNOWN"], output: failure) }
        catch {
            let cocoa = error as NSError
            sawExclusiveFailure = cocoa.domain == NSCocoaErrorDomain && cocoa.code == NSFileWriteFileExistsError
        }
        controls["publicationFailureWaitedBothOwnedChildren"] = sawExclusiveFailure && !childA.isRunning && !childB.isRunning
        controls["earlierReceiptUnchanged"] = try Data(contentsOf: existing) == first
        controls["noFabricatedLateReceipt"] = !FileManager.default.fileExists(atPath: failure.appendingPathComponent("CLI-LATE-CLEANUP.json").path)
        await stopAfterPublication.value
        childA.waitUntilExit(); childB.waitUntilExit()

        let childC = try startChild()
        retainedAdapter = nil; retainedCurl = childC
        let stopAfterUnknown = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(200))
            if childC.isRunning { childC.terminate() }
        }
        let code = try await finishRun(["status": "CLEANUP_UNKNOWN"], output: unknown)
        controls["unknownWaitedAndReturnedFailure"] = code == 2 && !childC.isRunning
        let outcome = json(unknown.appendingPathComponent("CLI-RESULT.json"))
        let late = json(unknown.appendingPathComponent("CLI-LATE-CLEANUP.json"))
        controls["unknownFirstOutcomePreserved"] = outcome["status"] as? String == "CLEANUP_UNKNOWN"
            && late["status"] as? String == "LATE_OWNED_HANDLE_EXIT_OBSERVED"
            && late["originalOutcomeRemainsUNKNOWN"] as? Bool == true
        await stopAfterUnknown.value; childC.waitUntilExit()
        retainedCurl = nil
        let normalCode = try await finishRun(["status": "PUBLIC_HTTPS_VALIDATED"], output: normal)
        controls["healthyPreservesExit"] = normalCode == 0
            && json(normal.appendingPathComponent("CLI-RESULT.json"))["status"] as? String == "PUBLIC_HTTPS_VALIDATED"
        let childWait: [[String: Int32]] = [childA, childB, childC].map {
            ["pid": $0.processIdentifier, "originalWait": $0.terminationStatus, "signal": $0.terminationReason == .uncaughtSignal ? $0.terminationStatus : 0]
        }
        print(String(decoding: try JSONSerialization.data(withJSONObject: ["controls": controls, "children": childWait], options: [.sortedKeys]), as: UTF8.self))
        exit(controls.values.allSatisfy { $0 } ? 0 : 1)
    }
    static func json(_ path: URL) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any]) ?? [:]
    }
    static func startChild() throws -> Process {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/sleep")
        child.arguments = ["2"]
        try child.run()
        return child
    }
__SOURCE__
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--baseline", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(__file__).with_name("SuccessorPublicQA.swift")
    raw = source.read_bytes()
    text = raw.decode()
    if args.baseline:
        start = '            try write(result, output.appendingPathComponent("CLI-RESULT.json"))'
        end = "        } catch {"
        subsection = text[text.index(start):].split(end, 1)[0]
        subsection = subsection.replace("exit(2)", "return 2").replace('exit(["PUBLIC_HTTPS_VALIDATED"', 'return (["PUBLIC_HTTPS_VALIDATED"')
        finish = "@MainActor static func finishRun(_ result: [String: Any], output: URL) async throws -> Int32 {\n" + subsection + "}\n"
    else:
        finish = segment(text, "@MainActor static func finishRun(")
    probe = output / "Probe.swift"
    probe.write_text(FIXTURE.replace("__SOURCE__", finish + "\n" + segment(text, "static func write(")))
    (output / source.name).write_bytes(raw)
    binary = output / "probe"
    steps = {"compile": execute(["/usr/bin/xcrun", "swiftc", "-j", "1", "-swift-version", "6",
        "-target", f"{platform.machine()}-apple-macosx14.0", "-parse-as-library",
        "-module-cache-path", str(output / "module-cache"), str(probe), "-o", str(binary)], 30, output, "compile")}
    if steps["compile"]["originalWait"] == 0:
        steps["probe"] = execute([str(binary), str(output)], 10, output, "probe")
    passed = "probe" in steps and steps["probe"]["originalWait"] == 0 and source.read_bytes() == raw
    (output / "RESULT.json").write_text(json.dumps({"status": "PASS" if passed else "FAIL",
        "sourceSHA256": hashlib.sha256(raw).hexdigest(), "processes": steps,
        "baselineAdaptation": args.baseline, "actualArti": "NOT_RUN", "network": "NOT_RUN"}, indent=2) + "\n")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
