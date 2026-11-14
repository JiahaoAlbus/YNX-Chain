import Foundation

// Uses the exact Page method extracted by the runner. The shell supplies only
// its observation tables and callback; no actual page or WKDownload is created.
@main @MainActor struct ProtectedDownloadEvidenceProbe {
    static func main() throws {
        let owner = AcceptanceDownloadEvidenceFixture()
        let first = NSObject(), unrelated = NSObject()
        let firstKey = ObjectIdentifier(first), otherKey = ObjectIdentifier(unrelated)
        let evidenceID = UUID(), otherEvidenceID = UUID()
        owner.acceptanceDownloads = [firstKey: evidenceID, otherKey: otherEvidenceID]
        owner.acceptanceProgress = [firstKey: NSObject(), otherKey: NSObject()]
        var events: [[String: String]] = []
        owner.acceptanceRecord = { kind, fields in
            events.append(fields.merging(["kind": kind]) { _, next in next })
            // Reenter with the original ID while handling its terminal record.
            if events.count == 1 { owner.retire(firstKey) }
        }
        owner.retire(firstKey)
        owner.retire(firstKey)
        precondition(events == [["kind": "download-failed", "downloadID": evidenceID.uuidString.lowercased(), "committed": "false"]])
        precondition(owner.acceptanceDownloads == [otherKey: otherEvidenceID] && Set(owner.acceptanceProgress.keys) == [otherKey])
        owner.acceptanceRecord = nil
        owner.retire(otherKey)
        precondition(owner.acceptanceDownloads.isEmpty && owner.acceptanceProgress.isEmpty && events.count == 1)
        let output = ["schema": "P05_SWIFT_DOWNLOAD_EVIDENCE_RETIRE_V1",
                      "cases": "same ID only once, even on reentry; unrelated ID preserved; detached handler still retires state",
                      "actualWKDownload": "NOT_RUN"]
        print(String(decoding: try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]), as: UTF8.self))
    }
}
