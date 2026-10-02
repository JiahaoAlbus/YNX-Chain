import Foundation

// This product boundary only isolates navigation. It does not grant authority.
@MainActor final class VideoRequestBoundary {
    private(set) var generation: UInt64 = 0
    @discardableResult func advance() -> UInt64 { generation &+= 1; return generation }
    func matches(_ expected: UInt64) -> Bool { expected == generation }
}

final class VideoHTTP: NSObject, URLSessionTaskDelegate {
    static let api = URL(string: "https://video.ynxweb4.com/video/api")!
    static let shared = VideoHTTP()
    enum Failure: Error { case invalidPath, unexpectedResponse, nativeSessionUnavailable }
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    static func url(_ path: String) throws -> URL {
        let route = path.split(separator:"?",maxSplits:1).first.map(String.init)?.lowercased() ?? ""
        guard (path.hasPrefix("/v1/") || path.hasPrefix("/media/")),
              !route.contains(".."), !path.contains("\\"), !path.contains("#"),
              !path.contains("\r"), !path.contains("\n"),
              !route.contains("%2e"), !route.contains("%2f"), !route.contains("%5c"),
              let url = URL(string: api.absoluteString + path),
              url.scheme == "https", url.host == api.host, url.port == nil else { throw Failure.invalidPath }
        return url
    }
    func data(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        var parts = URLComponents(url: try Self.url(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { parts.queryItems = query }
        guard let url = parts.url else { throw Failure.invalidPath }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw Failure.unexpectedResponse }
        return data
    }
    func accountData(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        // Preserve product routes/payloads at their callers. This boundary can
        // send them only after the shared native SDK supplies verified session
        // completion and an exact request proof; legacy callback strings cannot.
        _ = try Self.url(path)
        throw Failure.nativeSessionUnavailable
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
