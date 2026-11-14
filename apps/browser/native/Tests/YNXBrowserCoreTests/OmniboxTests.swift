import XCTest
@testable import YNXBrowserCore

final class OmniboxTests: XCTestCase {
    func testP0504BlobDownloadsStayBoundToInitiatingOrigin() {
        let document = URL(string: "https://example.org/page")!
        XCTAssertTrue(BrowserOmnibox.isSameOriginBlobDownload(URL(string: "blob:https://example.org/id")!, documentURL: document))
        for value in ["blob:https://other.example/id", "blob:http://example.org/id", "blob:null/id", "file:///tmp/file"] {
            XCTAssertFalse(BrowserOmnibox.isSameOriginBlobDownload(URL(string: value)!, documentURL: document))
        }
    }
    func testP0501ExplicitHTTPAndHTTPSWithoutWallet() throws {
        XCTAssertEqual(try BrowserOmnibox.resolveOmnibox(" https://example.com/a?x=1&y=2 ").absoluteString, "https://example.com/a?x=1&y=2")
        XCTAssertEqual(try BrowserOmnibox.resolveOmnibox("http://localhost:8787/").host, "localhost")
    }
    func testP0501ChineseQueryCannotInjectParameters() throws {
        let query = "中文 搜索&private=1#x+%"
        let url = try BrowserOmnibox.resolveOmnibox(query)
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(parts.host, "duckduckgo.com")
        XCTAssertEqual(parts.queryItems, [URLQueryItem(name: "q", value: query)])
        XCTAssertNil(parts.fragment)
        XCTAssertEqual(try BrowserOmnibox.resolveOmnibox("example.com").host, "duckduckgo.com")
    }
    func testP0501RejectsDangerousAndMalformedSchemes() {
        for value in ["javascript:alert(1)", "JaVaScRiPt://example.com", "file:///etc/passwd", "data:text/html,test", "ynxwallet://connect", "https://", "https://user:pass@example.com", "https://example.com/has space", ""] {
            XCTAssertThrowsError(try BrowserOmnibox.resolveOmnibox(value), value)
        }
    }
    func testP0509ValidatedReplaceableHTTPSProvider() throws {
        let provider = try BrowserSearchProvider(name: "Example Search", template: "https://example.org/search?lang=zh&q={query}")
        XCTAssertEqual(provider.destinationHost, "example.org")
        XCTAssertEqual(URLComponents(url: try BrowserOmnibox.resolveOmnibox("a&b", provider: provider), resolvingAgainstBaseURL: false)?.queryItems?.last?.value, "a&b")
        for template in ["http://example.org/?q={query}", "javascript:{query}", "https://u:p@example.org/?q={query}", "https://example.org/{query}", "https://example.org/?q={query}{query}", "https://example.org/?q=prefix{query}", "https://example.org/?q={query}#fragment", "https://example.org:65536/?q={query}", "https://example.org/?q=YNXQUERYPLACEHOLDER&{query}=fixed"] {
            XCTAssertThrowsError(try BrowserSearchProvider(name: "Invalid", template: template), template)
        }
    }
}
