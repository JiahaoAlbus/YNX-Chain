import Foundation

private final class ImageHTTP:URLProtocol,@unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var counts:[String:Int] = [:]
    static func calls(_ path:String)->Int {lock.withLock {counts[path,default:0]}}

    override class func canInit(with request:URLRequest)->Bool {true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest {request}
    override func startLoading() {
        let path = request.url!.path
        let count = Self.lock.withLock {
            Self.counts[path,default:0] += 1
            return Self.counts[path]!
        }
        let fails = path == "/retry" && count == 1
        let data = Data(base64Encoded:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAe+m0WQAAAABJRU5ErkJggg==")!
        let response = HTTPURLResponse(url:request.url!,statusCode:fails ? 503:200,httpVersion:nil,headerFields:["Content-Type":"image/png"])!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main struct ShopProductImageLoaderChecks {
    @MainActor static func main() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ImageHTTP.self]
        let loader = ShopProductImageLoader(configuration:config)
        let url = URL(string:"https://catalog.invalid/shared")!
        let card = Task {try await loader.image(at:url)}
        let detail = Task {try await loader.image(at:url)}
        while ImageHTTP.calls("/shared") == 0 {await Task.yield()}
        card.cancel()
        do {
            _ = try await card.value
            // A completed card has no cancellation left to observe.
        } catch is CancellationError {}
        let image = try await detail.value
        let cached = try await loader.image(at:url)
        guard image.width == 1, cached.height == 1, ImageHTTP.calls("/shared") == 1 else {
            throw URLError(.cannotDecodeContentData)
        }
        let retry = URL(string:"https://catalog.invalid/retry")!
        do {
            _ = try await loader.image(at:retry)
            throw URLError(.badServerResponse)
        } catch let e as URLError where e.code == .cannotDecodeContentData {}
        _ = try await loader.image(at:retry)
        guard ImageHTTP.calls("/retry") == 2 else {throw URLError(.badServerResponse)}
        print("PASS shared catalog/detail GET, decoded cache, and retry after failure")
    }
}
