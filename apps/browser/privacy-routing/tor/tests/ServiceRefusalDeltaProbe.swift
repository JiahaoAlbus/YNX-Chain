import Foundation
import Darwin

/// Classification only. Historical/synthetic routeReady never becomes current authority.
@main struct ServiceRefusalDeltaProbe {
    static func main() {
        do {
            let args = Array(CommandLine.arguments.dropFirst())
            let legacy = args.contains("--legacy-counterexample")
            var checks = 0
            func check(_ condition: Bool, _ label: String) throws {
                guard condition else { throw NSError(domain: "TorServiceRefusalDelta." + label, code: checks) }
                checks += 1
            }
            if let index = args.firstIndex(of: "--receipt"), index + 1 < args.count {
                let directory = URL(fileURLWithPath: args[index + 1])
                let body = try Data(contentsOf: directory.appendingPathComponent("ddg-hop1.body"))
                let metrics = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("ddg-hop1.curl.json"))) as! [String: Any]
                try check(TorBackendResponse.sha256(body) == "77aa0703d081062ae313cad05f0d3a92f21333cacdc71844599f9ddbbeca2522", "exact-old-public-body")
                let url = URL(string: metrics["url_effective"] as! String)!
                // Replays the original transfer-time readiness observation, not today's lease.
                let result = TorBackendResponse.classify(exit: 0, metrics: metrics, url: url, body: body, routeReady: true)
                if legacy {
                    try check(result == "destination-rejected" && !TorBackendResponse.serviceRefusal(url: url, body: body), "old-misclassification")
                    print("TOR_SERVICE_REFUSAL_BUG_REPRODUCED original508B HTML403 classified destination-rejected; no query/backend/lease created")
                    return
                }
                try check(result == "service-refused", "actual-old-html-refusal")
                try check(!TorBackendResponse.hasSearchResult(body), "no-search-result-proof")
                try check(TorBackendResponse.classify(exit: 0, metrics: metrics, url: url, body: body, routeReady: false) == "route-lost", "current-route-loss-still-first")
            } else if legacy { throw CocoaError(.fileReadInvalidFileName) }
            let html = URL(string: "https://html.duckduckgo.com/html?q=PUBLIC-synthetic")!
            let initial = URL(string: "https://duckduckgo.com/html?q=PUBLIC-synthetic")!
            let body = Data("we have detected that you have connected over tor. there appears to be an issue with the tor exit node.".utf8)
            let metrics: [String: Any] = ["http_code": 403, "proxy_used": true, "remote_ip": "127.0.0.1", "ssl_verify_result": 0]
            try check(TorBackendResponse.redirect(html.absoluteString, from: initial) == html, "official-same-provider-https-host")
            try check(TorBackendResponse.classify(exit: 0, metrics: metrics, url: html, body: body, routeReady: true) == "service-refused", "synthetic-specific-refusal")
            try check(TorBackendResponse.classify(exit: 0, metrics: metrics, url: html, body: Data("Forbidden".utf8), routeReady: true) == "http-error", "generic403-not-captcha-or-tor-failure")
            try check(!TorBackendResponse.serviceRefusal(url: URL(string: "https://www.torproject.org/")!, body: body), "specific-ddg-message-not-unrelated-site")
            try check(TorBackendResponse.classify(exit: 28, metrics: metrics, url: html, body: body, routeReady: true) == "timeout", "unfinished-transfer-not-service-proof")
            try check(TorBackendResponse.classify(exit: 0, metrics: metrics, url: html, body: body, routeReady: false) == "route-lost", "site-reply-cannot-override-fence")
            var unverified = metrics; unverified["proxy_used"] = false
            try check(TorBackendResponse.classify(exit: 0, metrics: unverified, url: html, body: body, routeReady: true) == "proxy-or-tls-evidence-missing", "refusal-needs-transfer-evidence")
            try check(TorBackendResponse.redirect("http://html.duckduckgo.com/html", from: initial) == nil, "no-http-fallback")
            try check(TorBackendResponse.redirect("https://html.duckduckgo.com.evil.test/html", from: initial) == nil, "no-suffix-host-fallback")
            print("TOR_SERVICE_REFUSAL_DELTA \(checks) checks PASS; synthetic + optional original receipt replay only; current route/search/BrowserRouteReady NOT_VERIFIED")
        } catch { FileHandle.standardError.write(Data("TOR_SERVICE_REFUSAL_DELTA FAIL \(error)\n".utf8)); exit(1) }
    }
}
