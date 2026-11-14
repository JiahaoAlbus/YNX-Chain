import Foundation
import XCTest
@testable import YNXBrowserCore

final class BrowserSearchProviderValidationDeltaTests: XCTestCase {
    private func stored(_ template: String) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["name": "Explicit Custom", "template": template])
    }

    func testDecodedPreferencesCannotBypassProviderValidation() throws {
        for template in [
            "http://example.org/?q={query}",
            "javascript:alert(1)",
            "https://user:password@example.org/?q={query}",
            "https://example.org/?q={query}#fragment",
            "https://example.org/?q=fixed",
            "https://example.org/?q=fixed&%71={query}"
        ] {
            XCTAssertThrowsError(try JSONDecoder().decode(BrowserSearchProvider.self, from: stored(template)), template)
        }
    }

    func testDecodedQueryNamesCannotMakeTheSearchTermAmbiguous() throws {
        for template in [
            "https://example.org/?q=fixed&q={query}",
            "https://example.org/?%71={query}&q=fixed",
            "https://example.org/?q={query}&lang=en&%6cang=zh",
            "https://example.org/?={query}"
        ] {
            XCTAssertThrowsError(try BrowserSearchProvider(name: "Custom", template: template), template)
            XCTAssertThrowsError(try JSONDecoder().decode(BrowserSearchProvider.self, from: stored(template)), template)
        }
    }

    func testLegacyPreferenceFormatPreservesExplicitCustomSelection() throws {
        let template = "https://example.org/search?lang=zh&term={query}"
        let restored = try JSONDecoder().decode(BrowserSearchProvider.self, from: stored(template))
        let savedAgain = try JSONEncoder().encode(restored)
        XCTAssertEqual(try JSONDecoder().decode(BrowserSearchProvider.self, from: savedAgain), restored)
        XCTAssertEqual(restored.name, "Explicit Custom")
        XCTAssertEqual(restored.template, template)
        let terms = "中文 + &term=other#fragment%25"
        let url = try BrowserOmnibox.resolveOmnibox(terms, provider: restored)
        let parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(parts.host, "example.org")
        XCTAssertEqual(parts.queryItems, [URLQueryItem(name: "lang", value: "zh"), URLQueryItem(name: "term", value: terms)])
        XCTAssertNil(parts.fragment)
        // A single encoded name is valid; only a decoded collision is rejected.
        let encodedTemplate = "https://example.org/search?lang=zh&%74erm={query}"
        let encodedProvider = try JSONDecoder().decode(BrowserSearchProvider.self, from: stored(encodedTemplate))
        XCTAssertEqual(encodedProvider.template, encodedTemplate)
        XCTAssertEqual(URLComponents(url: try encodedProvider.searchURL(terms), resolvingAgainstBaseURL: false)?.queryItems,
                       parts.queryItems)
    }

    func testPersistedDefaultRetainsDuckDuckGoAndLiteralQueryValue() throws {
        let restored = try JSONDecoder().decode(BrowserSearchProvider.self, from: JSONEncoder().encode(BrowserSearchProvider.duckDuckGo))
        XCTAssertEqual(restored, .duckDuckGo)
        let terms = "example.org/?q=other&redirect=https://other.example/"
        let url = try BrowserOmnibox.resolveOmnibox(terms, provider: restored)
        let parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(parts.host, "duckduckgo.com")
        XCTAssertEqual(parts.queryItems, [URLQueryItem(name: "q", value: terms)])
    }

    func testEncodedStaticTokenCannotAuthorizeInterpolationElsewhere() throws {
        for template in [
            "https://example.org/{query}?q=%7Bquery%7D",
            "https://example.org/?name=prefix{query}&q=%7Bquery%7D",
            "https://example.org/?{query}=static&q=%7Bquery%7D",
        ] {
            XCTAssertThrowsError(try BrowserSearchProvider(name: "Custom", template: template), template)
            XCTAssertThrowsError(try JSONDecoder().decode(BrowserSearchProvider.self, from: stored(template)), template)
        }
    }
}
