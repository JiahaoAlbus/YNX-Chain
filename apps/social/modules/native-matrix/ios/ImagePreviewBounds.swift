import Foundation
import ImageIO

struct ImagePreviewBounds {
  static func check(width: Double, height: Double, frames: Int) throws {
    guard width.isFinite, height.isFinite, width.rounded(.down) == width, height.rounded(.down) == height,
          width > 0, height > 0, width <= 16384, height <= 16384, frames > 0, frames <= 256 else {
      throw failure("MATRIX_MEDIA_IMAGE_PREVIEW_TOO_LARGE")
    }
    let maximum: Double = frames == 1 ? 64 * 1024 * 1024 : 16 * 1024 * 1024
    guard width * height <= maximum / Double(frames) else {
      throw failure("MATRIX_MEDIA_IMAGE_PREVIEW_TOO_LARGE")
    }
  }

  static func validate(file: URL, declaredMime: String) throws {
    guard ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(declaredMime) else { return }
    let options = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithURL(file as CFURL, options) else {
      throw failure("MATRIX_MEDIA_IMAGE_METADATA_INVALID")
    }
    let count = CGImageSourceGetCount(source)
    guard count > 0, count <= 256 else { throw failure("MATRIX_MEDIA_IMAGE_PREVIEW_TOO_LARGE") }
    var pixels: Double = 0
    for index in 0..<count {
      guard let properties = CGImageSourceCopyPropertiesAtIndex(source, index, options) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
            let height = properties[kCGImagePropertyPixelHeight] as? NSNumber else {
        throw failure("MATRIX_MEDIA_IMAGE_METADATA_INVALID")
      }
      try check(width: width.doubleValue, height: height.doubleValue, frames: 1)
      pixels += width.doubleValue * height.doubleValue
    }
    guard pixels <= Double(count == 1 ? 64 * 1024 * 1024 : 16 * 1024 * 1024) else {
      throw failure("MATRIX_MEDIA_IMAGE_PREVIEW_TOO_LARGE")
    }
    // No CGImage/UIImage, thumbnails, pixel buffers or plaintext copies created.
  }

  private static func failure(_ reason: String) -> NSError {
    NSError(domain: "YNXSocialMatrix", code: 413, userInfo: [NSLocalizedDescriptionKey: reason])
  }
}
