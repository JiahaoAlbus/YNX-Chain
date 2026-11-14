import Foundation
import Testing
import WebKit
@testable import YNXBrowserCore

@Suite("P05-05/06 local selected-page snapshots")
@MainActor struct PageSelectionTests {
    private func document(_ host: String = "a.example", generation: UInt64 = 1, isPrivate: Bool = false, tabID: UUID = UUID()) -> BrowserPageDocument {
        BrowserPageDocument(tabID: tabID, profileID: "ordinary", generation: generation, origin: "https://\(host)", isPrivate: isPrivate)
    }

    private func confirmation(_ doc: BrowserPageDocument, fields: [String] = ["url", "title", "text"], text: String = "Approved visible article", confirmed: Bool = true) -> BrowserPageConfirmation {
        BrowserPageConfirmation(document: doc, taskID: "task-1", allowedFields: fields, content: BrowserPageContent(url: "\(doc.origin)/article", title: "Article", text: text), confirmed: confirmed)
    }

    @Test("T-P05-05 three selected ordinary pages return only their frozen fields")
    func threeSelectedPages() throws {
        let store = BrowserPageSelectionStore()
        let confirmations = ["a.example", "b.example", "c.example"].map { confirmation(document($0)) }
        let sources = try store.selectPages(confirmations)
        #expect(sources.count == 3)
        for (source, confirmation) in zip(sources, confirmations) {
            let bytes = try store.readSelectedPage(source, currentDocument: confirmation.document, currentContent: confirmation.content)
            #expect(source.binding == BrowserPageBinding.digest(bytes))
            let object = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            #expect(object["taskID"] as? String == "task-1")
            #expect(object["generation"] as? String == "1")
            #expect((object["content"] as? [String: String])?["text"] == "Approved visible article")
        }
    }

    @Test("T-P05-05 private, unconfirmed, duplicate tabs and non-allowlisted fields cannot select")
    func deniedSelectionsAreAtomic() throws {
        let store = BrowserPageSelectionStore()
        #expect(throws: BrowserPageSelectionError.denied) { try store.selectPages([confirmation(document(isPrivate: true))]) }
        #expect(throws: BrowserPageSelectionError.denied) { try store.selectPages([confirmation(document(), confirmed: false)]) }
        #expect(throws: BrowserPageSelectionError.invalid) { try store.selectPages([confirmation(document(), fields: ["password"])]) }
        let doc = document()
        #expect(throws: BrowserPageSelectionError.invalid) { try store.selectPages([confirmation(doc), confirmation(doc)]) }
        #expect(throws: BrowserPageSelectionError.denied) { try store.selectPages([confirmation(doc), confirmation(document(), confirmed: false)]) }
        // A failed batch did not consume any slots.
        let ordinary = try store.selectPages((0..<16).map { confirmation(document("page\($0).example")) })
        #expect(ordinary.count == 16)
    }

    @Test("human review uses the original confirmed fields; changed bytes and forged scope reject")
    func previewUsesFrozenConfirmedFields() throws {
        let store = BrowserPageSelectionStore(), selected = confirmation(document(), fields: ["text"])
        let source = try #require(store.selectPages([selected]).first)
        let bytes = try store.readSelectedPage(source, currentDocument: selected.document, currentContent: selected.content)
        #expect(try BrowserPageSelectionStore.previewFields(bytes, source: source) == ["text": selected.content.text])
        #expect(throws: BrowserPageSelectionError.denied) { try BrowserPageSelectionStore.previewFields(bytes + Data(" ".utf8), source: source) }
        let forged = BrowserPageSource(selectionID: source.selectionID, document: source.document, taskID: source.taskID, fields: ["text", "url"], binding: source.binding)
        #expect(throws: BrowserPageSelectionError.denied) { try BrowserPageSelectionStore.previewFields(bytes, source: forged) }
        store.removeAll()
        #expect(throws: BrowserPageSelectionError.stale) { try store.readSelectedPage(source, currentDocument: selected.document, currentContent: selected.content) }
    }

    @Test("T-P05-06 changed text, generation or origin is STALE; missing page is unavailable")
    func changedPageIsStale() throws {
        let store = BrowserPageSelectionStore()
        let selected = confirmation(document())
        let source = try #require(store.selectPages([selected]).first)
        #expect(throws: BrowserPageSelectionError.stale) {
            try store.readSelectedPage(source, currentDocument: selected.document, currentContent: BrowserPageContent(url: selected.content.url, title: "Article", text: "Changed after consent"))
        }
        let next = document(generation: 2, tabID: selected.document.tabID)
        #expect(throws: BrowserPageSelectionError.stale) { try store.readSelectedPage(source, currentDocument: next, currentContent: selected.content) }
        let redirect = document("other.example", tabID: selected.document.tabID)
        #expect(throws: BrowserPageSelectionError.stale) { try store.readSelectedPage(source, currentDocument: redirect, currentContent: selected.content) }
        #expect(throws: BrowserPageSelectionError.unavailable) { try store.readSelectedPage(source, currentDocument: nil, currentContent: nil) }
        store.invalidate(tabID: selected.document.tabID)
        #expect(throws: BrowserPageSelectionError.stale) { try store.readSelectedPage(source, currentDocument: selected.document, currentContent: selected.content) }
    }

    @Test("T-P05-06 store/source identity and selected fields cannot expand scope")
    func scopeIsExact() throws {
        let store = BrowserPageSelectionStore()
        let selected = confirmation(document(), fields: ["text"])
        let source = try #require(store.selectPages([selected]).first)
        let bytes = try store.readSelectedPage(source, currentDocument: selected.document, currentContent: BrowserPageContent(url: "unselected", title: "unselected", text: selected.content.text))
        let payload = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        #expect(payload["content"] as? [String: String] == ["text": selected.content.text])
        let anotherStore = BrowserPageSelectionStore()
        #expect(throws: BrowserPageSelectionError.denied) { try anotherStore.readSelectedPage(source, currentDocument: selected.document, currentContent: selected.content) }
        let forged = BrowserPageSource(selectionID: source.selectionID, document: source.document, taskID: "other-task", fields: source.fields, binding: source.binding)
        #expect(throws: BrowserPageSelectionError.denied) { try store.readSelectedPage(forged, currentDocument: selected.document, currentContent: selected.content) }
        store.removeAll()
        #expect(throws: BrowserPageSelectionError.stale) { try store.readSelectedPage(source, currentDocument: selected.document, currentContent: selected.content) }
    }

    @Test("T-P05-05 URL credential/origin mismatch and oversize snapshots fail closed")
    func validatesBoundsAndOrigin() throws {
        let store = BrowserPageSelectionStore()
        let doc = document()
        let mismatch = BrowserPageConfirmation(document: doc, taskID: "task-1", allowedFields: ["url"], content: BrowserPageContent(url: "https://wrong.example/", title: "", text: ""), confirmed: true)
        #expect(throws: BrowserPageSelectionError.invalid) { try store.selectPages([mismatch]) }
        #expect(throws: BrowserPageSelectionError.limit) { try store.selectPages([confirmation(doc, text: String(repeating: "a", count: 50_001))]) }
        #expect(BrowserPageSelectionStore.canonicalOrigin("https://name:secret@example.com") == nil)
        #expect(BrowserPageSelectionStore.canonicalOrigin("https://EXAMPLE.com:443/path") == "https://example.com")
        #expect(BrowserPageSelectionStore.canonicalOrigin("https://[::1]:8443/path") == "https://[::1]:8443")
    }

    @Test("SHA3-512 FIPS 202 known answers and rate-boundary messages")
    func sha3KnownAnswers() {
        #expect(BrowserSHA3_512.hash(Data()) == "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26")
        #expect(BrowserSHA3_512.hash(Data("abc".utf8)) == "b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0")
        // Independent SHA3-512 answers from the system Python hashlib implementation;
        // these cover either side of the 72-byte rate and exact multi-block padding.
        let rateVectors: [(Int, String)] = [
            (71, "070faf98d2a8fddf8ed886408744dc06456096c2e045f26f3c7b010530e6bbb3db535a54d636856f4e0e1e982461cb9a7e8e57ff8895cff1619af9f0e486e28c"),
            (72, "a8ae722a78e10cbbc413886c02eb5b369a03f6560084aff566bd597bb7ad8c1ccd86e81296852359bf2faddb5153c0a7445722987875e74287adac21adebe952"),
            (73, "23e6a8815f8201dbbf6a5463be8dcadb1acea9df5f8998954e59ac9565cf6d29b17aa27a5e8b0fc06343db6122d6e544d27583ddc78504d08203217e7e65b6bd"),
            (143, "1dfc536c0ef79e004ec6f18e3b24fd6c4c3076556424ef369e8734312d6594ff9b92a8f02d2980ab51c191a9cc3cf47d06265e81d306d4098cdf2b6bada1db27"),
            (144, "446cd4d7ba19510dcc776b21045bc68d424b5b840e14685e149bb238b5f473c0356b69e04f0f5785eefce20ff09e678b080d8aac64568c5edf001cd32b2ed7a8"),
            (145, "84a7b171615f4f0024b772defd5ea21a536bb1e52306fa7ad412c532ac919f6b645e412aa7f5d979808c8ae03ca7d159363dcdb179c9b03f908e3b3526cbf4de"),
            (200, "eae6c85c6904f11075de9f9d5e1064371d000510fa3d2d79d40cf9be34892fb01859d0a0234e138bcb0ad5c84f6c0dca226a414b0c9a2897cb695f5185fe36ec")
        ]
        for (count, expected) in rateVectors {
            #expect(BrowserSHA3_512.hash(Data(String(repeating: "a", count: count).utf8)) == expected)
        }
        let binding = BrowserPageBinding.digest(Data("abc".utf8))
        #expect(binding.bytes == 3)
        #expect(binding.sha512 == "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f")
    }

    @Test("T-P05-05 real WebKit extraction omits forms, hidden content and frames")
    func webKitExtractionBoundary() async throws {
        // An isolated local fixture tests the real extractor; it is not external-browser acceptance.
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
        let loader = PageExtractionLoader()
        view.navigationDelegate = loader
        let html = """
        <html><head><title>Selected title</title></head><body>
        <article>Visible approved article</article>
        <form>FORM_SECRET<input type="password" value="PASSWORD_SECRET"></form>
        <div hidden>HIDDEN_SECRET</div><div style="display:none">DISPLAY_SECRET</div>
        <div aria-hidden="true">ARIA_SECRET</div><div style="opacity:0">OPACITY_SECRET</div>
        <div contenteditable="true">EDITABLE_SECRET</div>
        <iframe srcdoc="<p>FRAME_SECRET</p>"></iframe>
        </body></html>
        """
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            loader.continuation = continuation
            view.loadHTMLString(html, baseURL: URL(string: "https://a.example/article"))
        }
        let result: [String: String] = try await withCheckedThrowingContinuation { continuation in
            view.evaluateJavaScript("(\(BrowserPageSelectionStore.extractionScript))(['text'])", in: nil, in: .defaultClient) { result in
                switch result {
                case .success(let value):
                    if let value = value as? [String: String] { continuation.resume(returning: value) }
                    else { continuation.resume(throwing: BrowserPageSelectionError.invalid) }
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
        }
        #expect(result["text"] == "Visible approved article")
        #expect(result["title"] == "")
        #expect(result["url"] == "")
    }
}

@MainActor private final class PageExtractionLoader: NSObject, WKNavigationDelegate {
    var continuation: CheckedContinuation<Void, Error>?
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        continuation?.resume()
        continuation = nil
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}
