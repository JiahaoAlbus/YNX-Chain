import Foundation

/// Local WKDownload destination completion ownership only; never an Auth capability.
@MainActor public final class BrowserDownloadDecision {
    public let id = UUID()
    public private(set) var isPending = true
    fileprivate weak var ledger: BrowserDownloadDecisionLedger?
    fileprivate let downloadID: ObjectIdentifier
    fileprivate let generation: UUID
    private var completion: (@MainActor (URL?) -> Void)?

    fileprivate init(downloadID: ObjectIdentifier, generation: UUID,
                     ledger: BrowserDownloadDecisionLedger, completion: @escaping @MainActor (URL?) -> Void) {
        self.downloadID = downloadID; self.generation = generation
        self.ledger = ledger; self.completion = completion
    }

    /// False means a late/duplicate decision was ignored; it never invokes a second callback.
    @discardableResult public func resolve(_ destination: URL?) -> Bool {
        guard isPending, let ledger else { return false }
        return ledger.resolve(self, destination: destination)
    }
    @discardableResult public func cancel() -> Bool { resolve(nil) }

    fileprivate func finish(_ destination: URL?) {
        guard isPending else { return }
        isPending = false
        let callback = completion; completion = nil; ledger = nil
        callback?(destination)
    }
}

/// One owner per window. Close before ending panels or cancelling downloads, so any
/// synchronous/reentrant/queued destination callback observes revoked decisions.
@MainActor public final class BrowserDownloadDecisionLedger {
    public private(set) var isClosed = false
    public var pendingCount: Int { entries.count }
    private var generation = UUID()
    private var entries: [ObjectIdentifier: BrowserDownloadDecision] = [:]

    public init() {}

    /// Replacing a decision cancels the original exactly once. ObjectIdentifier is only
    /// a lookup key: exact ticket identity plus UUID generation supplies freshness.
    public func begin(downloadID: ObjectIdentifier,
                      completion: @escaping @MainActor (URL?) -> Void) -> BrowserDownloadDecision {
        let ticket = BrowserDownloadDecision(downloadID: downloadID, generation: generation, ledger: self, completion: completion)
        if isClosed { ticket.finish(nil); return ticket }
        let previous = entries.updateValue(ticket, forKey: downloadID)
        // Publish the new owner before invoking arbitrary prior completion code. Reentrant
        // close/replacement can then revoke it and must not be overwritten on return.
        previous?.finish(nil)
        return ticket
    }

    fileprivate func resolve(_ ticket: BrowserDownloadDecision, destination: URL?) -> Bool {
        guard !isClosed, ticket.isPending, ticket.generation == generation,
              entries[ticket.downloadID] === ticket else { return false }
        entries.removeValue(forKey: ticket.downloadID)
        ticket.finish(destination)
        return true
    }

    /// Revoke current decisions, permitting a later explicit download in the same live window.
    public func revokeAll() {
        generation = UUID()
        let revoked = Array(entries.values); entries.removeAll()
        for ticket in revoked { ticket.finish(nil) }
    }

    /// Terminal window close. A later begin is synchronously completed with nil.
    public func close() {
        guard !isClosed else { return }
        isClosed = true
        revokeAll()
    }
}
