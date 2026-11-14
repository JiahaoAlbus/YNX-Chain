import Foundation
import CryptoKit

/// Backend transfer evidence only. This never admits WebKit content or infers anonymity.
enum TorBackendResponse {
    static let onion = "duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion"
    // Official same-provider HTML endpoint. This permits reviewed classification/
    // redirects only; it never selects a different endpoint or retries a refusal.
    static let allowedHosts: Set<String> = ["duckduckgo.com", "html.duckduckgo.com", onion, "www.torproject.org", "torproject.org", "dist.torproject.org", "check.torproject.org"]

    static func allowed(_ url: URL) -> Bool {
        url.scheme == "https" && url.user == nil && url.password == nil &&
        (url.port == nil || url.port == 443) && allowedHosts.contains(url.host?.lowercased() ?? "")
    }

    static func redirect(_ location: String, from url: URL) -> URL? {
        guard let next = URL(string: location, relativeTo: url)?.absoluteURL, allowed(next) else { return nil }
        return next
    }

    static func serviceRefusal(url: URL, body: Data) -> Bool {
        let html = String(decoding: body.prefix(1_048_576), as: UTF8.self).lowercased()
        let ddgHost = ["duckduckgo.com", "html.duckduckgo.com", onion].contains(url.host?.lowercased() ?? "")
        // Exact pair observed in the preserved 508-byte DDG403 response. This is
        // website refusal, not proof of CAPTCHA, censorship or broken Tor bridges.
        if ddgHost, html.contains("we have detected that you have connected over tor"),
           html.contains("there appears to be an issue with the tor exit node") { return true }
        return url.path.contains("/static-pages/home-error/") || url.path.contains("/anomaly") ||
            html.contains("data-errorpage=\"true\"") || html.contains("anomaly-modal") ||
            html.contains("unfortunately, bots use duckduckgo") || html.contains("verify you are human")
    }

    static func classify(exit: Int32, metrics: [String: Any], url: URL, body: Data, routeReady: Bool) -> String {
        // A completed transfer cannot override a simultaneous route fence.
        guard routeReady else { return "route-lost" }
        guard exit == 0 else {
            switch exit {
            case 5: return "proxy-resolution-failed"
            case 7: return "proxy-connect-failed"
            case 28: return "timeout"
            case 35, 51, 58, 60, 77: return "tls-failed"
            case 97: return "socks-connect-failed"
            default: return "transfer-failed"
            }
        }
        guard (metrics["proxy_used"] as? NSNumber)?.boolValue == true,
              metrics["remote_ip"] as? String == "127.0.0.1",
              (metrics["ssl_verify_result"] as? NSNumber)?.intValue == 0 else { return "proxy-or-tls-evidence-missing" }
        guard allowed(url) else { return "destination-rejected" }
        if serviceRefusal(url: url, body: body) { return "service-refused" }
        let status = (metrics["http_code"] as? NSNumber)?.intValue ?? 0
        if (300...399).contains(status) { return "redirect" }
        guard (200...299).contains(status) else { return "http-error" }
        guard !body.isEmpty else { return "empty-body" }
        return "https-body-received"
    }

    static func sha256(_ body: Data) -> String { SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined() }

    /// Only accept an actual result anchor, never unrelated external links on an error/home page.
    static func hasSearchResult(_ body: Data) -> Bool {
        let html = String(decoding: body.prefix(1_048_576), as: UTF8.self)
        let pattern = #"(?is)<a\b(?=[^>]*(?:class\s*=\s*["'][^"']*\bresult__a\b|data-testid\s*=\s*["']result-title-a["']))(?=[^>]*href\s*=\s*["'](?:https?://|//|/l/\?))[^>]*>[^<\s]"#
        return html.range(of: pattern, options: .regularExpression) != nil
    }

    /// One non-executable same-origin stylesheet. Cross-origin resources require separate review.
    static func stylesheet(in body: Data, base: URL) -> URL? {
        let html = String(decoding: body.prefix(1_048_576), as: UTF8.self)
        guard let regex = try? NSRegularExpression(pattern: #"(?is)<link\b(?=[^>]*\brel\s*=\s*["']stylesheet["'])[^>]*\bhref\s*=\s*["']([^"']+)["']"#) else { return nil }
        for match in regex.matches(in: html, range: NSRange(html.startIndex..., in: html)) {
            guard let range = Range(match.range(at: 1), in: html),
                  let target = redirect(String(html[range]).replacingOccurrences(of: "&amp;", with: "&"), from: base),
                  target.host == base.host else { continue }
            return target
        }
        return nil
    }
}
