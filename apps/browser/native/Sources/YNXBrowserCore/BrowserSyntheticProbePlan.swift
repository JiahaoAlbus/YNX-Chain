import Foundation

/// Developer-only synthetic traffic plan. This never admits a production privacy route.
public struct BrowserSyntheticProbePlan: Codable, Sendable {
    public struct Bootstrap: Codable, Sendable {
        public let path: String
        public let sha256: String
        public let baseURL: URL
    }
    public struct PublicFixture: Codable, Sendable {
        public let origins: [URL]
        public let nonce: String
        public let responseSHA256: String
        public let downloadSHA256: String
    }
    public let runID: String
    public let initialURL: URL
    public let routePort: UInt16
    public let allowedHosts: [String]
    public let durationSeconds: Int
    public let bootstrap: Bootstrap?
    public let readinessFile: String?
    public let phaseControlFile: String?
    public let publicFixture: PublicFixture?
    public let transport: String?
    public func validate(expectedRunID: String) throws {
        guard transport == nil || ["socks5", "direct-negative-control"].contains(transport!) else { throw PrivacyRouteError.unsafeTarget }
        if transport == "direct-negative-control", bootstrap == nil || publicFixture != nil { throw PrivacyRouteError.unsafeTarget }
        if let fixture = publicFixture {
            guard fixture.nonce == runID, (1...2).contains(fixture.origins.count),
                  Set(fixture.origins).count == fixture.origins.count,
                  [fixture.responseSHA256, fixture.downloadSHA256].allSatisfy({ $0.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil }),
                  fixture.origins.allSatisfy({ url in
                      guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false), c.scheme == "https",
                            let host = c.host, host.contains("."), host.range(of: "^[a-z0-9.-]+$", options: .regularExpression) != nil,
                            host.contains(where: { $0.isLetter }), !host.hasSuffix(".local"), !host.hasSuffix(".test"),
                            c.user == nil, c.password == nil, c.query == nil, c.fragment == nil,
                            c.port == nil || c.port == 443, ["", "/"].contains(c.path) else { return false }
                      return allowedHosts.contains(host)
                  }) else { throw PrivacyRouteError.unsafeTarget }
        }
        guard runID == expectedRunID,
              runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil,
              routePort > 0, (10...120).contains(durationSeconds),
              !allowedHosts.isEmpty, allowedHosts.count <= 8,
              Set(allowedHosts).count == allowedHosts.count,
              allowedHosts.allSatisfy({ host in
                  let suffix = "\(runID).leak.test"
                  return ((host == suffix || host.hasSuffix("." + suffix)) && host.range(of: "^[a-z0-9.-]+$", options: .regularExpression) != nil) || publicFixture?.origins.contains(where: { $0.host == host }) == true
              }), allows(initialURL) else { throw PrivacyRouteError.unsafeTarget }
        if let bootstrap {
            guard bootstrap.path.hasPrefix("/"),
                  bootstrap.sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
                  bootstrap.baseURL.scheme == "https", allowedHosts.contains(bootstrap.baseURL.host ?? ""),
                  bootstrap.baseURL.user == nil, bootstrap.baseURL.password == nil, bootstrap.baseURL.fragment == nil,
                  bootstrap.baseURL.port.map({ (1...65535).contains($0) }) ?? true,
                  publicFixture?.origins.contains(where: { $0.host == bootstrap.baseURL.host }) != true || bootstrap.baseURL.port == nil || bootstrap.baseURL.port == 443,
                  bootstrap.baseURL.query == nil,
                  ["", "/"].contains(bootstrap.baseURL.path),
                  readinessFile?.hasPrefix("/") == true,
                  phaseControlFile?.hasPrefix("/") == true else { throw PrivacyRouteError.unsafeTarget }
        } else if readinessFile != nil || phaseControlFile != nil { throw PrivacyRouteError.unsafeTarget }
    }
    public func allows(_ url: URL) -> Bool {
        guard let value = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["https", "wss"].contains(value.scheme?.lowercased() ?? ""),
              let host = value.host?.lowercased(), allowedHosts.contains(host),
              value.user == nil, value.password == nil,
              value.fragment == nil, url.absoluteString.utf8.count < 4096 else { return false }
        if publicFixture?.origins.contains(where: { $0.host == host }) == true {
            guard value.port == nil || value.port == 443, value.path.hasPrefix("/ynx-route-probe/\(runID)/") else { return false }
        }
        return value.port.map { (1...65535).contains($0) } ?? true
    }
}
