import Foundation

@main struct BoundsCheck {
  static func main() throws {
    var passed = 0
    func reject(_ action: () throws -> Void) {
      do { try action(); fatalError("Expected metadata rejection") } catch { passed += 1 }
    }
    try ImagePreviewBounds.check(width: 8064, height: 6048, frames: 1); passed += 1
    try ImagePreviewBounds.check(width: 256, height: 256, frames: 256); passed += 1
    for (w, h, frames) in [(0.0, 1.0, 1), (-1, 1, 1), (16385, 1, 1), (16384, 16384, 1),
      (.infinity, 1, 1), (.nan, 1, 1), (1.5, 1, 1), (1, 1, 257), (4096, 4096, 2)] {
      reject { try ImagePreviewBounds.check(width: w, height: h, frames: frames) }
    }
    try ImagePreviewBounds.validate(file: URL(fileURLWithPath: CommandLine.arguments[1]), declaredMime: "image/png")
    passed += 1
    print("Actual Foundation/ImageIO public-logo metadata and budget checks PASS \(passed)")
  }
}
