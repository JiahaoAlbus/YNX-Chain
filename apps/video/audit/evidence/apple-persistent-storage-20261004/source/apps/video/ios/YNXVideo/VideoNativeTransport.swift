import Foundation

// Native transport is never a cookie, redirect or credential-bearing Web view.
final class VideoNativeTransport: NSObject, URLSessionTaskDelegate {
    enum Failure: Error { case invalidResponse, responseTooLarge }
    private lazy var session: URLSession = {
        let config=URLSessionConfiguration.ephemeral
        config.httpCookieStorage=nil; config.urlCredentialStorage=nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest=15; config.timeoutIntervalForResource=30
        return URLSession(configuration:config,delegate:self,delegateQueue:nil)
    }()
    func send(_ request: URLRequest,_ limit: Int) async throws -> (Data,HTTPURLResponse) {
        let (stream,response)=try await session.bytes(for:request)
        guard let http=response as? HTTPURLResponse,http.url==request.url else { throw Failure.invalidResponse }
        var data=Data();data.reserveCapacity(min(limit,8192))
        for try await byte in stream {
            if data.count&8191==0 { try Task.checkCancellation() }
            guard data.count<limit else { throw Failure.responseTooLarge }; data.append(byte)
        }
        try Task.checkCancellation(); return (data,http)
    }
    func urlSession(_ session: URLSession,task: URLSessionTask,willPerformHTTPRedirection response: HTTPURLResponse,newRequest request: URLRequest,completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
