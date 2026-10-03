import Foundation

// This product boundary only isolates navigation. It does not grant authority.
@MainActor final class CreatorRequestBoundary {
    private(set) var generation: UInt64 = 0
    @discardableResult func advance() -> UInt64 { generation &+= 1; return generation }
    func matches(_ expected: UInt64) -> Bool { expected == generation }
}

final class CreatorHTTP: NSObject, URLSessionTaskDelegate {
    static let api = URL(string: "https://creator.ynxweb4.com/video/api")!
    static let shared = CreatorHTTP()
    enum Failure: Error { case invalidPath, unexpectedResponse, nativeSessionUnavailable, businessRejected(Int,String) }
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
    @MainActor func accountData(_ path: String, method: String = "GET", body: Data? = nil, file: URL? = nil, contentType: String = "application/json",
                               engine: CreatorNativeEngine? = nil,requestKey: String = UUID().uuidString,guardRequest: @MainActor () throws -> Void = {}) async throws -> Data {
        let url=try Self.url(path),bytes=body ?? Data(),method=method.uppercased()
        let finalBytes: Int, digest: String
        if let file {
            guard path=="/v1/uploads",method=="POST",body==nil,file.isFileURL else { throw Failure.invalidPath }
            (digest,finalBytes)=try CreatorDraftState.digest(file,limit:512*1024*1024)
        } else { finalBytes=bytes.count;digest=CreatorNativeState.hash(bytes) }
        guard let engine,let original=engine.identity,finalBytes<=(file==nil ? 1_048_576 : 512*1024*1024),
              method != "GET" || bytes.isEmpty,
              CreatorNativeState.matches(requestKey,"^[A-Za-z0-9_-]{16,128}$") else { throw Failure.nativeSessionUnavailable }
        let epoch=engine.epoch;try guardRequest();try engine.require(original,epoch)
        let proof=try await engine.dispatch("prepareRequest",["method":method,"path":path,"bodyDigest":digest,"bodyBytes":finalBytes])
        try guardRequest();try engine.require(original,epoch)
        guard proof["account"] as? String==original.account,proof["sessionBinding"] as? String==original.binding,
              proof["bodyDigest"] as? String==digest,proof["bodyBytes"] as? Int==finalBytes,
              let identity=proof["identityHeader"] as? String,let action=proof["actionHeader"] as? String else { throw Failure.nativeSessionUnavailable }
        var request=URLRequest(url:url);request.httpMethod=method
        request.setValue("application/json",forHTTPHeaderField:"Accept")
        request.setValue(identity,forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2")
        request.setValue(action,forHTTPHeaderField:"X-YNX-Product-Session-Action-Proof-V2")
        if method != "GET" && method != "HEAD" {
            if let file { guard let stream=InputStream(url:file) else { throw Failure.invalidPath };request.httpBodyStream=stream;request.setValue(String(finalBytes),forHTTPHeaderField:"Content-Length") } else { request.httpBody=bytes }
            request.setValue(contentType,forHTTPHeaderField:"Content-Type")
            request.setValue(requestKey,forHTTPHeaderField:"Idempotency-Key")
        }
        try guardRequest();try engine.require(original,epoch)
        let (data,response)=try await engine.sendBusiness(request,2_097_152,original,epoch)
        try guardRequest();try engine.require(original,epoch)
        if response.statusCode==401 { try engine.rejected(original) }
        guard (200..<300).contains(response.statusCode) else {
            let reply=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any]
            throw Failure.businessRejected(response.statusCode,String((reply?["error"] as? String ?? "Unavailable").prefix(500)))
        }
        return data
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
