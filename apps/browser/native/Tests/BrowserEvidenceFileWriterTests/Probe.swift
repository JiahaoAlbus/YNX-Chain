import Foundation

private final class WriteProbe: @unchecked Sendable {
    let started = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    let completed = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var saved: [Data] = []
    func record(_ data: Data) { lock.withLock { saved.append(data) } }
    var values: [Data] { lock.withLock { saved } }
}

@main private struct EvidenceFileWriterProbe {
    @MainActor static func nextMainTurn() async {
        await withCheckedContinuation { continuation in DispatchQueue.main.async { continuation.resume() } }
    }
    static func signalled(_ semaphore: DispatchSemaphore) async -> Bool {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                continuation.resume(returning: semaphore.wait(timeout: .now() + 5) == .success)
            }
        }
    }

    @MainActor static func main() async throws {
        guard CommandLine.arguments.count == 2 else { throw CocoaError(.fileNoSuchFile) }
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let destination = directory.appendingPathComponent("evidence.json")
        let probe = WriteProbe()
        let writer = BrowserEvidenceFileWriter { data, _ in
            precondition(!Thread.isMainThread, "filesystem work reached the main thread")
            if data == Data("first".utf8) {
                probe.started.signal()
                precondition(probe.release.wait(timeout: .now() + 10) == .success)
            }
            probe.record(data)
            if data == Data("latest-5000".utf8) { probe.completed.signal() }
        }
        writer.submit(Data("first".utf8), to: destination)
        let firstStarted = await signalled(probe.started)
        precondition(firstStarted)
        var mainActorTurns = 0
        await nextMainTurn(); mainActorTurns += 1
        for index in 1...5000 {
            writer.submit(Data("latest-\(index)".utf8), to: destination)
            precondition(writer.pendingSnapshotCount <= 1)
        }
        await nextMainTurn(); mainActorTurns += 1
        precondition(mainActorTurns == 2 && probe.values.isEmpty && writer.pendingSnapshotCount == 1,
                     "main actor must advance while the writer is blocked")
        probe.release.signal()
        let batchCompleted = await signalled(probe.completed)
        precondition(batchCompleted)
        precondition(probe.values == [Data("first".utf8), Data("latest-5000".utf8)],
                     "intermediate snapshots must be replaced, never queued for IO")

        // A failed write must not leave the mailbox permanently busy or retry old data.
        let failureProbe = WriteProbe()
        let recoverWriter = BrowserEvidenceFileWriter { data, _ in
            precondition(!Thread.isMainThread)
            failureProbe.record(data)
            if data == Data("fail".utf8) {
                failureProbe.started.signal()
                precondition(failureProbe.release.wait(timeout: .now() + 10) == .success)
                throw CocoaError(.fileWriteUnknown)
            }
            failureProbe.completed.signal()
        }
        recoverWriter.submit(Data("fail".utf8), to: destination)
        let failureStarted = await signalled(failureProbe.started)
        precondition(failureStarted)
        recoverWriter.submit(Data("after-failure".utf8), to: destination)
        failureProbe.release.signal()
        let afterFailureCompleted = await signalled(failureProbe.completed)
        precondition(afterFailureCompleted)
        precondition(failureProbe.values == [Data("fail".utf8), Data("after-failure".utf8)])

        // Actual atomic write/readback in the runner's private temporary directory.
        let actualWriter = BrowserEvidenceFileWriter()
        let expected = Data("{\"schema\":\"YNX_EVIDENCE_WRITER_DELTA\",\"latest\":true}".utf8)
        actualWriter.submit(expected, to: destination)
        var actual: Data?
        for _ in 0..<200 {
            actual = await Task.detached { try? Data(contentsOf: destination) }.value
            if actual == expected { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        precondition(actual == expected, "real atomic output did not match the submitted snapshot")
        let receipt: [String: Any] = ["schema": "YNX_EVIDENCE_FILE_WRITER_DELTA_V1",
            "status": "PASS", "mainActorTurnsWhileWriteBlocked": mainActorTurns,
            "submittedSnapshotsDuringBlockedWrite": 5000, "maxPendingSnapshots": 1,
            "actualWritesForCoalescedBatch": probe.values.count,
            "firstAndLatestOnly": true, "failureDoesNotWedgeOrReplay": true,
            "actualPrivateTempAtomicWriteReadback": true, "visibleGUI": "NOT_RUN",
            "installedMainThreadResponsiveness": "NOT_RUN", "saveButtonAcceptance": "NOT_RUN",
            "TCCCause": "NOT_DETERMINED", "network": "NOT_RUN"]
        let json = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
        FileHandle.standardOutput.write(json); FileHandle.standardOutput.write(Data([10]))
    }
}
