import Foundation

public enum BrowserPageReadState: String, Encodable, Sendable {
    case available = "AVAILABLE", stale = "STALE", unavailable = "UNAVAILABLE"
}

/// Local data only. A source reference/version is neither an Auth Source nor a disclosure grant.
public struct BrowserPageReadResult: Sendable {
    public let source: BrowserPageSource
    public let state: BrowserPageReadState
    /// Exact original full envelope, never a re-encoded content map or a replacement document.
    /// Absent for every non-AVAILABLE state.
    public let snapshotBytes: Data?
    fileprivate init(source: BrowserPageSource, state: BrowserPageReadState, bytes: Data? = nil) {
        self.source = source; self.state = state; snapshotBytes = state == .available ? bytes : nil
    }
}

/// Ephemeral readout of a local preparation set. It intentionally has no AI task/grant/issuer fields.
public struct BrowserPageReadBatch: Sendable {
    public static let schema = "YNX_BROWSER_SELECTED_PAGE_READOUT_V1"
    /// Same encoded JSON byte cap as P08's current pages consumer. No truncation or rehashing.
    public static let maximumEncodedBytes = 256 * 1024
    public let preparationID: String
    public let profileID: String
    public let pages: [BrowserPageReadResult]
    fileprivate init(preparationID: String, profileID: String, pages: [BrowserPageReadResult]) {
        self.preparationID = preparationID; self.profileID = profileID; self.pages = pages
    }
    /// snapshotUTF8 is the EXACT original envelope whose SHA-512 is reference.version.
    /// Consumers must verify len+SHA3-512+SHA-512 and all envelope metadata before decoding content.
    public func encoded() throws -> Data {
        struct Reference: Encodable { let selectionId: String, version: String }
        struct Page: Encodable {
            let reference: Reference
            let tabId: String, profileId: String
            let generation: UInt64
            let origin: String
            let fields: [String]
            let bytes: Int
            let sha3_512: String
            let state: BrowserPageReadState
            let snapshotUTF8: String?
        }
        struct Readout: Encodable { let schema: String, preparationID: String, profileID: String; let pages: [Page] }
        let wire = try pages.map { page -> Page in
            let source = page.source
            var snapshot: String?
            if page.state == .available {
                guard let data = page.snapshotBytes, BrowserPageBinding.digest(data) == source.binding,
                      let text = String(data: data, encoding: .utf8) else { throw BrowserPageSelectionError.denied }
                snapshot = text
            } else { guard page.snapshotBytes == nil else { throw BrowserPageSelectionError.denied } }
            return Page(reference: Reference(selectionId: source.selectionID.uuidString, version: source.binding.sha512),
                tabId: source.document.tabID.uuidString, profileId: source.document.profileID, generation: source.document.generation,
                origin: source.document.origin, fields: source.fields, bytes: source.binding.bytes, sha3_512: source.binding.sha3_512,
                state: page.state, snapshotUTF8: snapshot)
        }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(Readout(schema: Self.schema, preparationID: preparationID, profileID: profileID, pages: wire))
        guard bytes.count <= Self.maximumEncodedBytes else { throw BrowserPageSelectionError.limit }
        return bytes
    }
}

extension BrowserPageSelectionStore {
    /// `taskID` is the existing LOCAL preparation ID embedded in every original envelope.
    /// It cannot be relabeled to an AI task ID; the original Auth/AI owner must bind that mapping.
    /// No socket, persistence, provider call or remote resource admission exists here.
    ///
    /// Both callbacks must access only this window's ordinary main document. `currentDocument`
    /// is a synchronous, read-only Native identity lookup. `extract` receives only sources that
    /// passed whole-batch membership and scope validation, and must extract source.fields only.
    public func readSelectedPageBatch(_ sources: [BrowserPageSource], taskID: String, profileID: String,
        currentDocument: @MainActor (UUID) -> BrowserPageDocument?,
        extract: @MainActor (BrowserPageSource) async throws -> BrowserPageContent) async throws -> BrowserPageReadBatch {
        guard !sources.isEmpty, sources.count <= Self.maximumSelectedPages,
              !taskID.isEmpty, taskID.utf8.count <= 1024, !profileID.isEmpty, profileID.utf8.count <= 1024,
              Set(sources.map(\.selectionID)).count == sources.count,
              Set(sources.map { $0.document.tabID }).count == sources.count else { throw BrowserPageSelectionError.invalid }
        // Validate every requested identity before extracting ANY page. An unselected/private/
        // other-profile/other-local-task reference never becomes a DOM read, even in a mixed batch.
        var knownStale = Set<UUID>()
        for source in sources {
            guard !source.document.isPrivate, source.document.profileID.utf8.elementsEqual(profileID.utf8),
                  source.taskID.utf8.elementsEqual(taskID.utf8) else { throw BrowserPageSelectionError.denied }
            guard source.document.generation > 0 else { throw BrowserPageSelectionError.invalid }
            do { try requireSelectedPageSource(source) }
            catch BrowserPageSelectionError.stale { knownStale.insert(source.selectionID) }
        }
        try Task.checkCancellation()
        var provisional: [BrowserPageReadResult] = []
        for source in sources {
            try Task.checkCancellation()
            if knownStale.contains(source.selectionID) { provisional.append(.init(source: source, state: .stale)); continue }
            do {
                try requireSelectedPageSource(source)
                guard let before = currentDocument(source.document.tabID) else { provisional.append(.init(source: source, state: .unavailable)); continue }
                guard before == source.document, !before.isPrivate else { provisional.append(.init(source: source, state: .stale)); continue }
                let content = try await extract(source)
                try Task.checkCancellation()
                let bytes = try readSelectedPage(source, currentDocument: currentDocument(source.document.tabID), currentContent: content)
                provisional.append(.init(source: source, state: .available, bytes: bytes))
            } catch is CancellationError { throw CancellationError() }
            catch BrowserPageSelectionError.stale { provisional.append(.init(source: source, state: .stale)) }
            catch BrowserPageSelectionError.unavailable { provisional.append(.init(source: source, state: .unavailable)) }
            catch let error as BrowserPageSelectionError { throw error }
            catch {
                // A failed extraction is not permission to read a replacement page.
                let doc = currentDocument(source.document.tabID)
                let stale = doc != nil && doc != source.document
                provisional.append(.init(source: source, state: stale ? .stale : .unavailable))
            }
        }
        try Task.checkCancellation()
        // No await after this point. Navigation/close/clear during ANY previous extraction can
        // invalidate an earlier successful read. Recheck the WHOLE batch and strip its old body.
        let documents = sources.map { currentDocument($0.document.tabID) }
        let final = try zip(provisional, documents).map { page, document -> BrowserPageReadResult in
            let source = page.source
            do { try requireSelectedPageSource(source) }
            catch BrowserPageSelectionError.stale { return .init(source: source, state: .stale) }
            guard let document else { return .init(source: source, state: page.state == .stale ? .stale : .unavailable) }
            guard document == source.document, !document.isPrivate else { return .init(source: source, state: .stale) }
            return page
        }
        let batch = BrowserPageReadBatch(preparationID: taskID, profileID: profileID, pages: final)
        _ = try batch.encoded() // Overall LIMIT preserves selections and all original version digests.
        return batch
    }
}
