import AppKit
import Foundation

func fail(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

guard CommandLine.arguments.count == 4 else {
    fail("usage: set-macos-default-handler.swift probe|set <app-path> <scheme>", 64)
}

let action = CommandLine.arguments[1]
let application = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
let scheme = CommandLine.arguments[3]

guard action == "probe" || action == "set" else {
    fail("action must be probe or set", 64)
}
guard FileManager.default.fileExists(atPath: application.path) else {
    fail("application path missing", 65)
}
guard let bundle = Bundle(url: application),
      let identifier = bundle.bundleIdentifier,
      let types = bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]],
      types.contains(where: { ($0["CFBundleURLSchemes"] as? [String])?.contains(scheme) == true }) else {
    fail("application does not claim the exact scheme", 66)
}

let probeURL = URL(string: "\(scheme)://com.ynxweb4.browser.macos/default-handler-probe")!
let before = NSWorkspace.shared.urlForApplication(toOpen: probeURL)?.standardizedFileURL.path ?? "NONE"

if action == "probe" {
    print("api=NSWorkspace.setDefaultApplicationAtURL.toOpenURLsWithScheme")
    print("bundle_id=\(identifier)")
    print("scheme=\(scheme)")
    print("requested_path=\(application.path)")
    print("resolved_before=\(before)")
    exit(0)
}

let semaphore = DispatchSemaphore(value: 0)
var completionError: Error?
NSWorkspace.shared.setDefaultApplication(at: application, toOpenURLsWithScheme: scheme) { error in
    completionError = error
    semaphore.signal()
}
guard semaphore.wait(timeout: .now() + 15) == .success else {
    fail("default-handler setter timed out", 67)
}
if let completionError {
    fail("default-handler setter failed: \(completionError.localizedDescription)", 68)
}

let after = NSWorkspace.shared.urlForApplication(toOpen: probeURL)?.standardizedFileURL.path ?? "NONE"
guard after == application.path else {
    fail("default-handler setter did not resolve the requested path", 69)
}
print(after)
