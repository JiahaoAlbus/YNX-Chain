import Foundation
import ImageIO

// Catalog cards, detail images, and thumbnails share the same public GET.
@MainActor final class ShopProductImageLoader {
    static let shared = ShopProductImageLoader()
    private let session:URLSession
    private let cache = NSCache<NSURL, CGImage>()
    private var pending:[URL:Task<CGImage,Error>] = [:]

    init(configuration:URLSessionConfiguration = .ephemeral) {
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForResource = 45
        session = URLSession(configuration:configuration,delegate:ShopRedirectPolicy(),delegateQueue:nil)
        cache.totalCostLimit = 32 * 1024 * 1024
        cache.countLimit = 32
    }

    func image(at url:URL) async throws -> CGImage {
        try Task.checkCancellation()
        guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else {
            throw URLError(.badURL)
        }
        if let cached = cache.object(forKey:url as NSURL) {return cached}
        if let task = pending[url] {
            let image = try await task.value
            try Task.checkCancellation()
            return image
        }
        // This task belongs to the loader. Leaving a card does not cancel a
        // matching detail request that is still waiting for the same image.
        let task = Task {
            defer {pending[url] = nil}
            var request = URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:30)
            request.httpShouldHandleCookies = false
            let (data,response) = try await session.data(for:request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  http.url == url, !data.isEmpty, data.count <= 16_777_216,
                  let source = CGImageSourceCreateWithData(data as CFData,nil) else {
                throw URLError(.cannotDecodeContentData)
            }
            let options:[CFString:Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways:true,
                kCGImageSourceCreateThumbnailWithTransform:true,
                kCGImageSourceThumbnailMaxPixelSize:2048
            ]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source,0,options as CFDictionary) else {
                throw URLError(.cannotDecodeContentData)
            }
            cache.setObject(image,forKey:url as NSURL,cost:image.bytesPerRow * image.height)
            return image
        }
        pending[url] = task
        let image = try await task.value
        try Task.checkCancellation()
        return image
    }
}
