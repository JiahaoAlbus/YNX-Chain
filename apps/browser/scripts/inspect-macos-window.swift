import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2, let pid = Int32(CommandLine.arguments[1]) else {
    fputs("usage: inspect-macos-window.swift <pid>\n", stderr)
    exit(2)
}

let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let matches = rows.compactMap { row -> [String: Any]? in
    guard (row[kCGWindowOwnerPID as String] as? Int32) == pid,
          (row[kCGWindowLayer as String] as? Int) == 0,
          let number = row[kCGWindowNumber as String] as? Int,
          let bounds = row[kCGWindowBounds as String] as? [String: Any],
          let width = bounds["Width"] as? Double,
          let height = bounds["Height"] as? Double else { return nil }
    return ["windowId": number, "width": Int(width.rounded()), "height": Int(height.rounded()), "area": width * height]
}.sorted { ($0["area"] as? Double ?? 0) > ($1["area"] as? Double ?? 0) }

guard var window = matches.first else {
    fputs("no on-screen layer-zero window for pid \(pid)\n", stderr)
    exit(1)
}
window.removeValue(forKey: "area")
window["pid"] = Int(pid)
window["source"] = "CGWindowListCopyWindowInfo on-screen WindowServer bounds"
let data = try JSONSerialization.data(withJSONObject: window, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
