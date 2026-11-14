import Foundation

/// Existing selected-page reference fields only. This is lookup DATA, not a Grant or a Source.
public struct BrowserPageSelectionReference: Codable, Equatable, Hashable, Sendable {
    public let selectionID: String
    public let version: String
    enum CodingKeys: String, CodingKey { case selectionID = "selectionId", version }
    public init(selectionID: String, version: String) { self.selectionID = selectionID; self.version = version }
    public init(source: BrowserPageSource) { selectionID = source.selectionID.uuidString; version = source.binding.sha512 }
    var parsedID: UUID? {
        guard let id = UUID(uuidString: selectionID), id.uuidString == selectionID,
              version.range(of: "^[a-f0-9]{128}$", options: .regularExpression) != nil else { return nil }
        return id
    }
}

/// A local producer lifetime only. Auth's original authority/store borrow is a DIFFERENT object.
/// Private construction binds the actual store and its exact selected sources. No wire ready bit,
/// caller metadata, URL, cached readout or task ID can manufacture a current borrow.
@MainActor public final class BrowserPageSelectionBorrow {
    public let references: [BrowserPageSelectionReference]
    public let taskID: String
    public let profileID: String
    public let sources: [BrowserPageSource]
    private weak var store: BrowserPageSelectionStore?
    private var document: (@MainActor (UUID) -> BrowserPageDocument?)?
    private let id = UUID()
    private var ended: BrowserPageSelectionError?
    private var reading = false
    private var handlers: [@MainActor (BrowserPageSelectionError) -> Void] = []
    fileprivate init(store: BrowserPageSelectionStore, references: [BrowserPageSelectionReference], taskID: String,
                     profileID: String, sources: [BrowserPageSource], document: @escaping @MainActor (UUID) -> BrowserPageDocument?) {
        self.store = store; self.references = references; self.taskID = taskID; self.profileID = profileID
        self.sources = sources; self.document = document
    }
    public func requireCurrent() throws {
        if let ended { throw ended }
        guard let store, let document else { end(.unavailable); throw BrowserPageSelectionError.unavailable }
        do {
            for source in sources {
                try store.requireSelectedPageSource(source)
                guard let current = document(source.document.tabID) else { throw BrowserPageSelectionError.unavailable }
                guard !current.isPrivate, current == source.document else {
                    store.invalidate(tabID: source.document.tabID)
                    throw BrowserPageSelectionError.stale
                }
            }
            // Current-document lookup is an owner-supplied read-only synchronous callback. No await.
            for source in sources { try store.requireSelectedPageSource(source) }
        } catch let error as BrowserPageSelectionError { end(error); throw error }
        catch { end(.unavailable); throw BrowserPageSelectionError.unavailable }
    }
    public func installRevocationHandler(_ handler: @escaping @MainActor (BrowserPageSelectionError) -> Void) {
        if let ended { handler(ended) } else { handlers.append(handler) }
    }
    /// Fresh extraction through the existing fixed batch codec. Closing/revoking while awaiting
    /// any page aborts the whole borrow; staged bytes cannot escape its lifetime.
    public func read(extract: @MainActor (BrowserPageSource) async throws -> BrowserPageContent) async throws -> BrowserPageReadBatch {
        try requireCurrent()
        guard !reading, let store, let document else { throw BrowserPageSelectionError.unavailable }
        reading = true; defer { reading = false }
        do {
            let batch = try await store.readSelectedPageBatch(sources, taskID: taskID, profileID: profileID, currentDocument: document, extract: { source in
                try self.requireCurrent()
                let content = try await extract(source)
                try self.requireCurrent()
                return content
            })
            try requireCurrent()
            if batch.pages.contains(where: { $0.state == .stale }) { throw BrowserPageSelectionError.stale }
            guard batch.pages.allSatisfy({ $0.state == .available }) else { throw BrowserPageSelectionError.unavailable }
            return batch
        } catch is CancellationError { end(.denied); throw CancellationError() }
        catch let error as BrowserPageSelectionError { end(error); throw error }
        catch { end(.unavailable); throw error }
    }
    /// Closes this local borrow only; it neither revokes a remote Grant nor removes UI selections.
    public func close() { end(.denied) }
    func end(_ reason: BrowserPageSelectionError) {
        guard ended == nil else { return }; ended = reason
        store?.forgetPageBorrow(self); store = nil; document = nil
        let callbacks = handlers; handlers.removeAll()
        for callback in callbacks { callback(reason) }
    }
    var registryID: UUID { id }
    func affected(tabID: UUID) -> Bool { sources.contains { $0.document.tabID == tabID } }
}

final class WeakBrowserPageSelectionBorrow {
    weak var value: BrowserPageSelectionBorrow?
    init(_ value: BrowserPageSelectionBorrow) { self.value = value }
}

extension BrowserPageSelectionStore {
    public static let maximumPageBorrows = 64
    /// Owner supplies the actual expected task/profile from its protected binding, not untrusted
    /// request defaults. All refs are checked before a source is returned; no URL/DOM is read.
    public func resolveSelectedPageReferences(_ references: [BrowserPageSelectionReference], taskID: String, profileID: String) throws -> [BrowserPageSource] {
        try validatePageReferenceSet(references, taskID: taskID, profileID: profileID)
        return try references.map { try resolvePageReference($0, taskID: taskID, profileID: profileID, includeInvalidated: false) }
    }
    /// State read path: known revoked references retain bounded metadata only, so the existing
    /// readout can report STALE without old bytes. Unknown/wrong-scope refs still deny before DOM.
    public func readSelectedPageReferences(_ references: [BrowserPageSelectionReference], taskID: String, profileID: String,
        currentDocument: @MainActor (UUID) -> BrowserPageDocument?,
        extract: @MainActor (BrowserPageSource) async throws -> BrowserPageContent) async throws -> BrowserPageReadBatch {
        try validatePageReferenceSet(references, taskID: taskID, profileID: profileID)
        let sources = try references.map { try resolvePageReference($0, taskID: taskID, profileID: profileID, includeInvalidated: true) }
        return try await readSelectedPageBatch(sources, taskID: taskID, profileID: profileID, currentDocument: currentDocument, extract: extract)
    }
    public func borrowSelectedPages(_ references: [BrowserPageSelectionReference], taskID: String, profileID: String,
        currentDocument: @escaping @MainActor (UUID) -> BrowserPageDocument?) throws -> BrowserPageSelectionBorrow {
        let sources = try resolveSelectedPageReferences(references, taskID: taskID, profileID: profileID)
        let borrow = BrowserPageSelectionBorrow(store: self, references: references, taskID: taskID, profileID: profileID, sources: sources, document: currentDocument)
        try borrow.requireCurrent()
        try trackPageBorrow(borrow)
        return borrow
    }
    private func validatePageReferenceSet(_ references: [BrowserPageSelectionReference], taskID: String, profileID: String) throws {
        guard !references.isEmpty, references.count <= Self.maximumSelectedPages,
              !taskID.isEmpty, taskID.utf8.count <= 1024, !profileID.isEmpty, profileID.utf8.count <= 1024,
              references.allSatisfy({ $0.parsedID != nil }), Set(references.map(\.selectionID)).count == references.count else { throw BrowserPageSelectionError.invalid }
    }
}
