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
    @MainActor func accountData(_ path: String, method: String = "GET", body: Data? = nil,
                               engine: VideoNativeEngine? = nil,requestKey: String = UUID().uuidString) async throws -> Data {
        let url=try Self.url(path),bytes=body ?? Data(),method=method.uppercased()
        guard let engine,let original=engine.identity,bytes.count<=1_048_576,
              method != "GET" || bytes.isEmpty,
              VideoNativeState.matches(requestKey,"^[A-Za-z0-9_-]{16,128}$") else { throw Failure.nativeSessionUnavailable }
        let epoch=engine.epoch;try engine.require(original,epoch)
        let proof=try await engine.dispatch("prepareRequest",["method":method,"path":path,"bodyDigest":VideoNativeState.hash(bytes),"bodyBytes":bytes.count])
        try engine.require(original,epoch)
        guard proof["account"] as? String==original.account,proof["sessionBinding"] as? String==original.binding,
              proof["bodyDigest"] as? String==VideoNativeState.hash(bytes),proof["bodyBytes"] as? Int==bytes.count,
              let identity=proof["identityHeader"] as? String,let action=proof["actionHeader"] as? String else { throw Failure.nativeSessionUnavailable }
        var request=URLRequest(url:url);request.httpMethod=method
        request.setValue("application/json",forHTTPHeaderField:"Accept")
        request.setValue(identity,forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2")
        request.setValue(action,forHTTPHeaderField:"X-YNX-Product-Session-Action-Proof-V2")
        if method != "GET" && method != "HEAD" {
            request.httpBody=bytes;request.setValue("application/json",forHTTPHeaderField:"Content-Type")
            request.setValue(requestKey,forHTTPHeaderField:"Idempotency-Key")
        }
        try engine.require(original,epoch)
        let (data,response)=try await engine.sendBusiness(request,2_097_152,original,epoch)
        try engine.require(original,epoch)
        if response.statusCode==401 { try engine.rejected(original) }
        guard (200..<300).contains(response.statusCode) else { throw Failure.unexpectedResponse }
        return data
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
