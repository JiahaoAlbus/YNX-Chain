import Foundation
import OSLog

/// Best-effort QA evidence output. AppKit/JSON snapshot creation stays with the caller;
/// filesystem work never runs on that actor or waits for UI acknowledgement.
final class BrowserEvidenceFileWriter: Sendable {
    private let mailbox: Mailbox

    init(write: @escaping @Sendable (Data, URL) throws -> Void = { data, destination in
        try data.write(to: destination, options: .atomic)
    }) {
        mailbox = Mailbox(write: write)
    }

    func submit(_ data: Data, to destination: URL) {
        mailbox.submit(Snapshot(data: data, destination: destination))
    }

    /// At most one latest snapshot can wait behind the single in-flight write.
    var pendingSnapshotCount: Int { mailbox.pendingSnapshotCount }

    private struct Snapshot: Sendable {
        let data: Data
        let destination: URL
    }

    /// All mutable mailbox state is protected by lock. The writer closure runs only on
    /// queue, with the lock released, so a stalled open/write cannot block submit().
    private final class Mailbox: @unchecked Sendable {
        private let lock = NSLock()
        private let queue = DispatchQueue(label: "com.ynxweb4.browser.evidence-file-writer", qos: .utility)
        private let write: @Sendable (Data, URL) throws -> Void
        private let logger = Logger(subsystem: "com.ynxweb4.browser.macos", category: "evidence-file-writer")
        private var latest: Snapshot?
        private var draining = false

        init(write: @escaping @Sendable (Data, URL) throws -> Void) { self.write = write }

        var pendingSnapshotCount: Int { lock.withLock { latest == nil ? 0 : 1 } }

        func submit(_ snapshot: Snapshot) {
            let start = lock.withLock {
                latest = snapshot
                guard !draining else { return false }
                draining = true
                return true
            }
            // Exactly one drain task is scheduled per idle→busy transition. A blocked
            // write can retain one newer snapshot, never an unbounded dispatch backlog.
            if start { queue.async { self.drain() } }
        }

        private func drain() {
            while true {
                let snapshot = lock.withLock {
                    let snapshot = latest
                    latest = nil
                    if snapshot == nil { draining = false }
                    return snapshot
                }
                guard let snapshot else { return }
                do { try write(snapshot.data, snapshot.destination) }
                catch {
                    // Do not print filenames, paths, URLs or the NSError's userInfo.
                    logger.error("evidenceWriteFailed")
                }
            }
        }
    }
}
