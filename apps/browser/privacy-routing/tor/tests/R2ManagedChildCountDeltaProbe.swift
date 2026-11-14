import Foundation
import Darwin

/// Real harmless local children, never Arti/PT, sockets, WebKit or a route qualification.
@main struct R2ManagedChildCountDeltaProbe {
    @MainActor static func main() async throws {
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let legacy = CommandLine.arguments.contains("--expect-legacy-miss")
        let trace = try TorPublicRuntimeTrace(directory: output, execution: .adjacentCLI)
        trace.record("syntheticHarmlessChildControl", ["parentIsNotArti": true, "childrenAreNotPluggableTransports": true])
        var tasks: [Process] = [], pipes: [Pipe] = [], observations: [[String: Any]] = []
        var firstCause: String?
        func rawCount() -> Int32 {
            var buffer = [Int32](repeating: 0, count: 64)
            return proc_listchildpids(getpid(), &buffer, Int32(buffer.count * MemoryLayout<Int32>.size))
        }
        for step in 1...(legacy ? 1 : 3) {
            let task = Process(), input = Pipe()
            task.executableURL = URL(fileURLWithPath: "/bin/cat"); task.environment = ["PATH": "/usr/bin:/bin", "HOME": output.path]
            task.standardInput = input; task.standardOutput = FileHandle.nullDevice; task.standardError = FileHandle.nullDevice
            try task.run(); tasks.append(task); pipes.append(input)
            if step == 1 {
                var path = [CChar](repeating: 0, count: 4096)
                guard proc_pidpath(task.processIdentifier, &path, UInt32(path.count)) > 0 else { throw NSError(domain: "SyntheticChildPathUnavailable", code: 1) }
                trace.launched(pid: getpid(), transport: URL(fileURLWithPath: String(cString: path)))
            }
            trace.observeManagedTransport(); trace.checkpoint("syntheticCountCheckpoint")
            let rows = try String(contentsOf: trace.file, encoding: .utf8).split(separator: "\n").map { try JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any] }
            let recorded = rows.filter { $0["event"] as? String == "managedPTObserved" }
            let count = rawCount(), expectedIDs = tasks.map(\.processIdentifier), enumerated = TorPublicRuntimeTrace.observedChildPIDs(parent: getpid())
            observations.append(["step": step, "rawAPIChildCount": count, "exactOwnedChildPIDs": expectedIDs, "actualEnumerationPIDs": enumerated, "recordedUniqueChildEvents": recorded.count])
            if count != step || Set(enumerated) != Set(expectedIDs) { firstCause = "actual child-count API disagreement" }
            if legacy {
                if recorded.count != 0 || count != 1 { firstCause = "old divide-by-four counterexample not observed" }
            } else if recorded.count != step { firstCause = "new actual observer missed an owned child" }
        }
        if !legacy {
            trace.observeManagedTransport(); trace.checkpoint("syntheticDuplicateCheckpoint")
            let rows = try String(contentsOf: trace.file, encoding: .utf8).split(separator: "\n").map { try JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any] }
            if rows.filter({ $0["event"] as? String == "managedPTObserved" }).count != 3 { firstCause = firstCause ?? "repeated observations duplicated same incarnation" }
        }
        for input in pipes { try input.fileHandleForWriting.close() }
        let end = ContinuousClock.now.advanced(by: .seconds(3))
        while tasks.contains(where: \.isRunning), ContinuousClock.now < end { try? await Task.sleep(for: .milliseconds(20)) }
        if tasks.contains(where: \.isRunning) {
            firstCause = firstCause ?? "harmless child did not exit on original stdin EOF"
            for task in tasks where task.isRunning { task.terminate() }
            let deadline = ContinuousClock.now.advanced(by: .seconds(2))
            while tasks.contains(where: \.isRunning), ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(20)) }
            for task in tasks where task.isRunning { _ = kill(task.processIdentifier, SIGKILL) }
            let last = ContinuousClock.now.advanced(by: .seconds(2))
            while tasks.contains(where: \.isRunning), ContinuousClock.now < last { try? await Task.sleep(for: .milliseconds(20)) }
        }
        let after = TorPublicRuntimeTrace.observedChildPIDs(parent: getpid()), countAfter = rawCount()
        if !after.isEmpty || countAfter != 0 { firstCause = firstCause ?? "original children not absent after exit" }
        let cleanup = tasks.map { task -> [String: Any] in
            var value: [String: Any] = ["pid": task.processIdentifier, "exitObserved": !task.isRunning]
            if !task.isRunning { value["terminationStatus"] = task.terminationStatus; value["terminationReason"] = task.terminationReason == .exit ? "exit" : "uncaughtSignal" }
            return value
        }
        var result: [String: Any] = ["schema": "P05_R2_REAL_HARMLESS_CHILD_COUNT_CONTROL_V1", "status": firstCause == nil ? "PASS" : "FAIL", "legacyDivideByFourCounterexample": legacy, "ownerPID": getpid(), "observations": observations, "rawAPIAfterExit": countAfter, "actualEnumerationAfterExit": after, "cleanup": cleanup, "vendorProcessesStarted": 0, "networkOrGUI": "NOT_RUN"]
        if let firstCause { result["firstCause"] = firstCause }
        try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("OBSERVED.json"), options: [.withoutOverwriting])
        print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
        if firstCause != nil { exit(1) }
    }
}
