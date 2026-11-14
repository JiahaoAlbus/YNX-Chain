import Foundation
import YNXBrowserCore

/// The actual ordinary-window DATA producer. It is not an Auth Source factory.
/// The original Auth borrow supplies `expected`; copying those operands from the
/// received request would remove the independent task/session/revision fence.
@MainActor final class BrowserNativePageReadoutProducer {
    let profileID: String
    private let store: BrowserPageSelectionStore
    private let taskID: @MainActor () -> String?
    private let windowCurrent: @MainActor () throws -> Void
    private let currentDocument: @MainActor (UUID) -> BrowserPageDocument?
    private let extract: @MainActor (BrowserPageSource) async throws -> BrowserPageContent
    private var closed = false
    private var borrows: [UUID: BrowserPageSelectionBorrow] = [:]

    init(profileID: String, store: BrowserPageSelectionStore,
         taskID: @escaping @MainActor () -> String?,
         windowCurrent: @escaping @MainActor () throws -> Void,
         currentDocument: @escaping @MainActor (UUID) -> BrowserPageDocument?,
         extract: @escaping @MainActor (BrowserPageSource) async throws -> BrowserPageContent) {
        self.profileID = profileID; self.store = store; self.taskID = taskID
        self.windowCurrent = windowCurrent; self.currentDocument = currentDocument; self.extract = extract
    }

    func requireCurrent() throws {
        guard !closed else { throw BrowserPageSelectionError.unavailable }
        try windowCurrent()
    }

    func readOriginalBrowserPageReadout(_ raw: Data, expected: BrowserOriginalPageReadExpectedData) async throws -> Data {
        try requireCurrent(); try Task.checkCancellation()
        let request = try BrowserOriginalPageReadRequest.decode(raw)
        try request.requireMatches(expected)
        try requireTask(request.task.id)
        let batch: BrowserPageReadBatch
        let borrow: BrowserPageSelectionBorrow
        do {
            borrow = try request.borrow(in: store, ownedProfileID: profileID, expected: expected, currentDocument: currentDocument)
        } catch BrowserPageSelectionError.stale {
            // Only an already-known retired reference may enter this state path.
            // The existing resolver validates the WHOLE set before any live DOM read.
            batch = try await request.read(in: store, ownedProfileID: profileID, expected: expected,
                currentDocument: currentDocument, extract: extract)
            try requireCurrent(); try Task.checkCancellation()
            try requireTask(request.task.id)
            return try batch.encoded()
        }
        let id = UUID(); borrows[id] = borrow
        defer { borrow.close(); borrows.removeValue(forKey: id) }
        batch = try await borrow.read(extract: extract)
        try requireCurrent(); try borrow.requireCurrent(); try Task.checkCancellation()
        try requireTask(request.task.id)
        return try batch.encoded()
    }

    private func requireTask(_ expected: String) throws {
        guard let actual = taskID(), actual.utf8.elementsEqual(expected.utf8) else { throw BrowserPageSelectionError.denied }
    }

    /// Window/application close cannot leave a suspended DOM read alive.
    /// This closes only local producer borrows, not an original remote Grant.
    func close() {
        guard !closed else { return }; closed = true
        let owned = Array(borrows.values); borrows.removeAll()
        for borrow in owned { borrow.close() }
    }
}
