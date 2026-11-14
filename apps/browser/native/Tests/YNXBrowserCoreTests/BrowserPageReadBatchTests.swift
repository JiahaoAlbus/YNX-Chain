import Foundation
import Testing
@testable import YNXBrowserCore

@Suite("Selected-page batch terminal fence and full-byte codec delta")
@MainActor struct BrowserPageReadBatchTests {
    private let preparation = "browser-local:PUBLIC-COMPARE-20261101"
    private let profile = "PUBLIC-synthetic-ordinary"
    private func prepared(text: String? = nil) throws -> (BrowserPageSelectionStore, [BrowserPageSource], [UUID: BrowserPageDocument], [UUID: BrowserPageContent]) {
        let store = BrowserPageSelectionStore()
        let docs = (0..<3).map { BrowserPageDocument(tabID: UUID(), profileID: profile, generation: 1, origin: "https://p05-\($0).example", isPrivate: false) }
        let contents = docs.enumerated().map { index, doc in BrowserPageContent(url: doc.origin + "/public-synthetic", title: "PUBLIC synthetic page \(index)", text: text ?? "PUBLIC synthetic article \(index) — not user DOM, no authorization") }
        let sources = try store.selectPages(zip(docs, contents).map { doc, content in BrowserPageConfirmation(document: doc, taskID: preparation, allowedFields: ["url", "title", "text"], content: content, confirmed: true) })
        return (store, sources, Dictionary(uniqueKeysWithValues: docs.map { ($0.tabID, $0) }), Dictionary(uniqueKeysWithValues: zip(docs, contents).map { ($0.0.tabID, $0.1) }))
    }
    @Test("full original envelope is versioned and interoperable; content-map is not that version")
    func fullEnvelopeCodec() async throws {
        let (store, sources, docs, content) = try prepared()
        var read: [UUID] = []
        let batch = try await store.readSelectedPageBatch(sources, taskID: preparation, profileID: profile,
            currentDocument: { docs[$0] }, extract: { source in read.append(source.selectionID); return content[source.document.tabID]! })
        #expect(read == sources.map(\.selectionID)); #expect(batch.pages.allSatisfy { $0.state == .available })
        let encoded = try batch.encoded()
        let root = try #require(JSONSerialization.jsonObject(with: encoded) as? [String:Any])
        #expect(root["schema"] as? String == BrowserPageReadBatch.schema)
        #expect(root["preparationID"] as? String == preparation); #expect(root["taskId"] == nil)
        let pages = try #require(root["pages"] as? [[String:Any]])
        for (source, page) in zip(sources, pages) {
            let string = try #require(page["snapshotUTF8"] as? String), bytes = Data(string.utf8)
            #expect(BrowserPageBinding.digest(bytes) == source.binding)
            #expect((page["reference"] as? [String:String])?["version"] == source.binding.sha512)
            #expect((page["bytes"] as? Int) == bytes.count)
            let envelope = try #require(JSONSerialization.jsonObject(with: bytes) as? [String:Any])
            #expect(envelope["taskID"] as? String == preparation)
            let values = try BrowserPageSelectionStore.previewFields(bytes, source: source)
            let contentMap = try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys, .withoutEscapingSlashes])
            #expect(BrowserPageBinding.digest(contentMap).sha512 != source.binding.sha512)
        }
        // Explicit public conformance artifacts only. No ordinary pages, HTTP listener or Auth fixture.
        if let path = ProcessInfo.processInfo.environment["YNX_P05_READOUT_EVIDENCE_DIRECTORY"] {
            let directory = URL(fileURLWithPath: path)
            #expect(directory.path.hasPrefix("/Volumes/"))
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try encoded.write(to: directory.appendingPathComponent("public-three-pages-readout.json"), options: [.withoutOverwriting])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: directory.appendingPathComponent("public-three-pages-readout.json").path)
        }
    }
    @Test("navigation during a later extraction strips an earlier page body at whole-batch final fence")
    func navigationAfterEarlierRead() async throws {
        let (store, sources, initial, content) = try prepared(text: "PUBLIC_OLD_BODY_MUST_NOT_LEAK")
        var docs = initial
        let batch = try await store.readSelectedPageBatch(sources, taskID: preparation, profileID: profile, currentDocument: { docs[$0] }, extract: { source in
            if source.selectionID == sources[1].selectionID {
                let old = sources[0].document
                docs[old.tabID] = BrowserPageDocument(tabID: old.tabID, profileID: old.profileID, generation: 2, origin: "https://navigated.example", isPrivate: false)
                store.invalidate(tabID: old.tabID)
                await Task.yield()
            }
            return content[source.document.tabID]!
        })
        #expect(batch.pages.map(\.state) == [.stale, .available, .available]); #expect(batch.pages[0].snapshotBytes == nil)
        let encoded = try batch.encoded(), root = try #require(JSONSerialization.jsonObject(with: encoded) as? [String:Any]), pages = try #require(root["pages"] as? [[String:Any]])
        #expect(pages[0]["snapshotUTF8"] == nil); #expect(pages[0]["content"] == nil)
        if let path = ProcessInfo.processInfo.environment["YNX_P05_READOUT_EVIDENCE_DIRECTORY"] {
            let url = URL(fileURLWithPath: path).appendingPathComponent("public-navigation-stale-readout.json")
            try encoded.write(to: url, options: [.withoutOverwriting]); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        }
    }
    @Test("clear while awaiting the final page strips every previously staged snapshot")
    func clearDuringBatch() async throws {
        let (store, sources, docs, content) = try prepared()
        let batch = try await store.readSelectedPageBatch(sources, taskID: preparation, profileID: profile, currentDocument: { docs[$0] }, extract: { source in
            if source.selectionID == sources.last?.selectionID { store.removeAll(); await Task.yield() }
            return content[source.document.tabID]!
        })
        #expect(batch.pages.allSatisfy { $0.state == .stale && $0.snapshotBytes == nil })
    }
    @Test("unselected/private/other-profile/other-preparation sources deny the whole batch before any extraction")
    func scopeBeforeDOM() async throws {
        let (store, sources, docs, content) = try prepared()
        let (other, unselected, _, _) = try prepared(); _ = other
        let source = sources[0], old = source.document
        let privateDoc = BrowserPageDocument(tabID: old.tabID, profileID: old.profileID, generation: old.generation, origin: old.origin, isPrivate: true)
        let privateSource = BrowserPageSource(selectionID: source.selectionID, document: privateDoc, taskID: source.taskID, fields: source.fields, binding: source.binding)
        var calls = 0
        for (requested, task, profileID) in [([sources[0], unselected[0]], preparation, profile), ([privateSource], preparation, profile), (sources, "actual-ai-task-must-not-relabel-local-envelope", profile), (sources, preparation, "other-profile")] {
            do {
                _ = try await store.readSelectedPageBatch(requested, taskID: task, profileID: profileID, currentDocument: { docs[$0] }, extract: { source in calls += 1; return content[source.document.tabID]! })
                Issue.record("Nonselected scope reached batch read")
            } catch BrowserPageSelectionError.denied { }
        }
        #expect(calls == 0)
    }
    @Test("private current document and missing document are never extracted")
    func unavailableOrPrivateCurrent() async throws {
        let (store, sources, initial, content) = try prepared(); var docs = initial
        let old = sources[0].document
        docs[old.tabID] = BrowserPageDocument(tabID: old.tabID, profileID: old.profileID, generation: old.generation, origin: old.origin, isPrivate: true)
        docs.removeValue(forKey: sources[1].document.tabID); var calls: [UUID] = []
        let batch = try await store.readSelectedPageBatch(sources, taskID: preparation, profileID: profile, currentDocument: { docs[$0] }, extract: { source in calls.append(source.selectionID); return content[source.document.tabID]! })
        #expect(calls == [sources[2].selectionID]); #expect(batch.pages.map(\.state) == [.stale, .unavailable, .available])
        #expect(batch.pages[0].snapshotBytes == nil && batch.pages[1].snapshotBytes == nil)
    }
    @Test("selected visible fields changing at extraction return STALE instead of replacing the snapshot")
    func changedProjection() async throws {
        let (store, sources, docs, content) = try prepared()
        let batch = try await store.readSelectedPageBatch(sources, taskID: preparation, profileID: profile, currentDocument: { docs[$0] }, extract: { source in
            let original = content[source.document.tabID]!
            return source.selectionID == sources[0].selectionID ? BrowserPageContent(url: original.url, title: original.title, text: "PUBLIC replacement must not escape") : original
        })
        #expect(batch.pages[0].state == .stale && batch.pages[0].snapshotBytes == nil)
        #expect(!String(decoding: try batch.encoded(), as: UTF8.self).contains("replacement must not escape"))
    }
    @Test("actual UTF8 wire limit is whole-batch LIMIT without truncation, source mutation or digest replacement")
    func unicodeWholeBatchLimit() async throws {
        let (store, sources, docs, content) = try prepared(text: String(repeating: "中", count: 50_000))
        do {
            _ = try await store.readSelectedPageBatch(sources, taskID: preparation, profileID: profile, currentDocument: { docs[$0] }, extract: { content[$0.document.tabID]! })
            Issue.record("Oversize batch unexpectedly exported")
        } catch BrowserPageSelectionError.limit { }
        let bytes = try store.readSelectedPage(sources[0], currentDocument: docs[sources[0].document.tabID], currentContent: content[sources[0].document.tabID])
        #expect(BrowserPageBinding.digest(bytes) == sources[0].binding)
        #expect(try BrowserPageSelectionStore.previewFields(bytes, source: sources[0])["text"]?.count == 50_000)
    }
}
