import Foundation
#if !YNX_DOWNLOAD_DECISION_PROBE
import Testing
@testable import YNXBrowserCore
#endif

@MainActor private enum DownloadDecisionChecks {
    private final class Download {}
    private final class Captured {}
    static func run() async throws -> Int {
        var checks = 0
        func check(_ result: Bool, _ label: String) throws {
            guard result else { throw NSError(domain: "DownloadDecisionDelta." + label, code: 1) }
            checks += 1
        }
        let download = Download(), destination = URL(fileURLWithPath: "/PUBLIC-synthetic-download.pdf")
        let key = ObjectIdentifier(download)
        // Explicit reproduction of the old unguarded sheet callback after window close.
        var legacyClosed = false, legacyLateDestinations = 0
        let oldSheetCallback: (URL?) -> Void = { url in if legacyClosed && url != nil { legacyLateDestinations += 1 } }
        legacyClosed = true; oldSheetCallback(destination)
        try check(legacyLateDestinations == 1, "legacy-late-close-counterexample")

        let ledger = BrowserDownloadDecisionLedger()
        var completions: [URL?] = []
        let ticket = ledger.begin(downloadID: key) { completions.append($0) }
        try check(ticket.isPending && ledger.pendingCount == 1, "pending")
        try check(ticket.resolve(destination), "initial-resolve")
        try check(!ticket.resolve(nil) && !ticket.cancel(), "duplicate-ignored")
        try check(completions == [destination] && !ticket.isPending && ledger.pendingCount == 0, "exactly-once-success")

        let old = ledger.begin(downloadID: key) { completions.append($0) }
        let replacement = ledger.begin(downloadID: key) { completions.append($0) }
        try check(!old.isPending && completions.last! == nil, "same-key-cancels-original")
        try check(!old.resolve(destination) && replacement.isPending && ledger.pendingCount == 1, "old-key-cannot-complete-new")
        try check(replacement.cancel() && !replacement.cancel(), "cancel-exactly-once")

        let previousGeneration = ledger.begin(downloadID: key) { completions.append($0) }
        ledger.revokeAll()
        let nextGeneration = ledger.begin(downloadID: key) { completions.append($0) }
        try check(!previousGeneration.resolve(destination) && nextGeneration.isPending, "old-generation-cannot-complete-new")
        try check(nextGeneration.resolve(destination), "new-generation-live")

        var closedReplies: [URL?] = []
        let closing = BrowserDownloadDecisionLedger()
        let delayed = closing.begin(downloadID: key) { closedReplies.append($0) }
        let queued = Task { @MainActor in await Task.yield(); return delayed.resolve(destination) }
        closing.close(); closing.close()
        let accepted = await queued.value
        try check(!accepted && closedReplies == [nil] && !delayed.isPending, "queued-sheet-after-close-cancelled")
        let refused = closing.begin(downloadID: key) { closedReplies.append($0) }
        try check(!refused.isPending && !refused.resolve(destination) && closing.isClosed && closing.pendingCount == 0, "terminal-close-refuses-begin")
        try check(closedReplies == [nil, nil], "closed-begin-callback-once")

        let reentrant = BrowserDownloadDecisionLedger()
        var nested: BrowserDownloadDecision?
        let outer = reentrant.begin(downloadID: key) { _ in
            nested = reentrant.begin(downloadID: key) { _ in }
        }
        try check(outer.cancel() && nested?.isPending == true && reentrant.pendingCount == 1, "completion-cannot-delete-reentrant-new-owner")
        reentrant.close()
        try check(nested?.isPending == false && reentrant.pendingCount == 0, "reentrant-owner-closed")

        let replacementClose = BrowserDownloadDecisionLedger()
        _ = replacementClose.begin(downloadID: key) { _ in replacementClose.close() }
        var replacementReplies = 0
        let closedByPriorCallback = replacementClose.begin(downloadID: key) { url in if url == nil { replacementReplies += 1 } }
        try check(replacementClose.isClosed && !closedByPriorCallback.isPending && replacementReplies == 1,
                  "prior-callback-close-cannot-resurrect-replacement")

        let release = BrowserDownloadDecisionLedger()
        var captured: Captured? = Captured()
        weak var weakCapture = captured
        let retained = release.begin(downloadID: key) { [keep = captured!] _ in _ = keep }
        captured = nil
        try check(weakCapture != nil, "pending-owns-completion")
        retained.cancel()
        try check(weakCapture == nil, "terminal-clears-completion-capture")
        return checks
    }
}

#if YNX_DOWNLOAD_DECISION_PROBE
@main struct BrowserDownloadDecisionProbe {
    @MainActor static func main() async throws {
        let checks = try await DownloadDecisionChecks.run()
        print("DOWNLOAD_DECISION_DELTA \(checks) checks PASS; legacy counterexample reproduced; no WK/GUI/network/files written")
    }
}
#else
@Suite("Download destination completion ownership")
@MainActor struct BrowserDownloadDecisionTests {
    @Test("late close, generation/key reuse and reentrant callbacks resolve exactly once")
    func destinationLifetime() async throws { _ = try await DownloadDecisionChecks.run() }
}
#endif
