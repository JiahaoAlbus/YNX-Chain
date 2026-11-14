#!/usr/bin/env python3
"""Compile the actual QA policy and process checks with the Browser Core module.

The fixture creates no NSApplication or WebKit view. Its only socket is a local
Python listener that never sends or accepts a connection.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


BROWSER = Path(__file__).resolve().parents[4]
CONTROLLER = BROWSER / "native/Sources/YNXBrowserNative/BrowserInteractiveRouteExperiment.swift"
CHILD = r"""
import socket
import sys

def listen(port):
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('127.0.0.1', port))
    server.listen(1)
    return server

server = listen(0)
port = server.getsockname()[1]
print(port, flush=True)
for command in sys.stdin:
    server.close()
    if command == 'rebind\n':
        server = listen(port)
        print(port, flush=True)
    else:
        break
"""

PROBE = r"""
let marker = BrowserInteractiveRouteExperimentRole.marker
let role = BrowserInteractiveRouteExperimentRole.self
let policy = BrowserInteractiveRouteExperimentPolicy.self
func check(_ condition: @autoclosure () -> Bool, _ description: String) {
    guard condition() else { fatalError(description) }
    print("PASS \(description)")
}
func expected(_ value: BrowserInteractiveRouteExperimentFailure, _ operation: () throws -> Void) {
    do { try operation(); fatalError("Expected \(value)") }
    catch { check((error as? BrowserInteractiveRouteExperimentFailure) == value, value.rawValue) }
}

for value in role.allCases {
    check(role.claim(identifier: value.rawValue, metadata: [marker: true]) == value, "exact role \(value.name)")
    check(role.claim(identifier: value.rawValue, metadata: [marker: 1]) == nil, "integer marker rejected \(value.name)")
    check(role.claim(identifier: value.rawValue, metadata: [marker: "true"]) == nil, "string marker rejected \(value.name)")
    check(role.claim(identifier: value.rawValue, metadata: [marker: false]) == nil, "false marker rejected \(value.name)")
    check(role.claim(identifier: value.rawValue, metadata: [marker: true, "YNXPublicNymSearchDiagnostic": false]) == nil,
          "conflicting key presence rejected \(value.name)")
}
check(role.requested(identifier: "com.ynxweb4.browser", metadata: [marker: false]), "reserved metadata cannot fall through")
check(role.claim(identifier: "com.ynxweb4.browser", metadata: [marker: true]) == nil, "ordinary role rejected")
check(policy.address("https://www.rfc-editor.org/rfc/rfc9110.html", mode: .tor)?.host == "www.rfc-editor.org", "Tor HTTPS")
check(policy.address("example.org:8443/another/path", mode: .nym)?.port == 8443, "Nym arbitrary user hostname and port")
check(policy.address("keyword", mode: .tor) == (try? BrowserSearchProvider.duckDuckGo.searchURL("keyword")), "single keyword uses DuckDuckGo")
check(policy.address("public web search", mode: .nym) == (try? BrowserSearchProvider.duckDuckGo.searchURL("public web search")), "search phrase uses DuckDuckGo")
let preferences = WKWebpagePreferences()
preferences.allowsContentJavaScript = false
policy.configurePreferences(preferences)
check(preferences.allowsContentJavaScript && preferences.isLockdownModeEnabled, "WebKit QA JavaScript enabled and Lockdown configured")
let routeInterruption = BrowserInteractiveTorFailure(exitCode: nil, stopReason: "network-path-changed")
check(routeInterruption.display.contains("network-path-changed") && !routeInterruption.display.contains("状态"),
      "known route interruption distinguished before process exit")
let routeExit = BrowserInteractiveTorFailure(exitCode: 23, stopReason: "system-sleep")
check(routeExit.display.contains("system-sleep") && routeExit.display.contains("23"), "observed route exit preserves interruption and status")
let untrustedStopDetail = "try at https://private.invalid/extra"
let rawFailure = BrowserInteractiveTorFailure(exitCode: 12, stopReason: untrustedStopDetail)
check(rawFailure.display.contains("12") && !rawFailure.display.contains(untrustedStopDetail), "unknown Tor stop reason stays private")
for invalid in ["file:///etc/passwd", "javascript:alert(1)", "https://u:p@example.org", "https://localhost.",
                "http://0x7f000001/", "http://192.168.0.5/", "http://[::ffff:127.0.0.1]/", "http://[fe80::2%25en0]/"] {
    check(policy.address(invalid, mode: .tor) == nil, "rejected ambiguous/private target")
}
let onion = "http://a7d6x7r4p3nkaesamsm23rthkhuwt4jysqecenchbq3dkadiu6w7n2yd.onion"
check(policy.address(onion, mode: .nym) == nil, "Nym onion rejected")
check(policy.address("https://incorrect.onion", mode: .tor) == nil, "invalid Tor onion rejected")

let launcher = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
expected(.bundleUnavailable) { _ = try policy.installedChild(.nym, in: launcher) }
expected(.bundleIdentityMismatch) { _ = try policy.installedChild(.tor, in: launcher) }

let child = Process()
let input = Pipe(), output = Pipe()
child.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
child.arguments = ["-u", CommandLine.arguments[2]]
child.standardInput = input; child.standardOutput = output
try child.run()
defer {
    try? input.fileHandleForWriting.close()
    if child.isRunning { child.terminate() }
    child.waitUntilExit()
}
func line() throws -> UInt16 {
    var bytes = Data()
    while bytes.count < 8 {
        guard let next = try output.fileHandleForReading.read(upToCount: 1), !next.isEmpty else {
            fatalError("Original fixture listener exited")
        }
        if next == Data([10]), let port = UInt16(String(decoding: bytes, as: UTF8.self)) { return port }
        bytes += next
    }
    fatalError("Invalid local port")
}
let port = try line()
let listener = BrowserInteractiveRouteListener.self
guard let original = listener.observe(pid: child.processIdentifier, port: port) else {
    fatalError("Could not verify its own real IPv4 loopback listening socket")
}
check(listener.observe(pid: getpid(), port: port) == nil, "wrong PID denied")
check(listener.observe(pid: child.processIdentifier, port: port) == original, "unchanged listener live")
try input.fileHandleForWriting.write(contentsOf: Data("rebind\n".utf8))
let reboundPort = try line()
check(reboundPort == port, "same child rebound same port")
guard let rebound = listener.observe(pid: child.processIdentifier, port: port) else { fatalError("Rebound socket absent") }
check(original.pid == rebound.pid && original.startedSeconds == rebound.startedSeconds &&
      original.startedMicroseconds == rebound.startedMicroseconds && original.generation != rebound.generation,
      "rebound listener cannot use original pin")
try input.fileHandleForWriting.write(contentsOf: Data("exit\n".utf8))
child.waitUntilExit()
check(child.terminationStatus == 0 && listener.observe(pid: child.processIdentifier, port: port) == nil,
      "original process exit observed")
"""


def run(argv, name, output, seconds):
    completed = subprocess.run(argv, capture_output=True, timeout=seconds, check=False)
    (output / f"{name}.stdout").write_bytes(completed.stdout)
    (output / f"{name}.stderr").write_bytes(completed.stderr)
    (output / f"{name}.exit").write_text(f"{completed.returncode}\n")
    if completed.returncode:
        sys.stderr.buffer.write(completed.stderr)
        raise SystemExit(completed.returncode)
    sys.stdout.buffer.write(completed.stdout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--module-cache", type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=False, exist_ok=False)
    cache = args.module_cache or out / "module-cache"
    sdk = subprocess.check_output(["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
    compiler = ["/usr/bin/swiftc", "-sdk", sdk, "-swift-version", "6", "-module-cache-path", str(cache)]
    core = BROWSER / "native/Sources/YNXBrowserCore"
    # Use only the unchanged URL policy dependency closure. Extract the public
    # declaration from the source file rather than reimplementing it in the test.
    content = (core / "PrivacyRouteProvider.swift").read_text()
    mode = content.split("public enum PrivacyRouteMode:", 1)[1].split("public enum PrivacyRouteStatus", 1)[0]
    target = content.split("public enum PrivacyRouteWebTarget", 1)[1].split("/// A local adapter", 1)[0]
    (out / "mode.swift").write_text("import Foundation\npublic enum PrivacyRouteMode:" + mode + "public enum PrivacyRouteWebTarget" + target)
    sha = (core / "PageSelection.swift").read_text().split("enum BrowserSHA3 {", 1)[1]
    (out / "sha.swift").write_text("import Foundation\nenum BrowserSHA3 {" + sha)
    controller = CONTROLLER.read_text().split("@MainActor final class BrowserInteractiveRouteExperimentApplicationDelegate", 1)[0]
    (out / "main.swift").write_text(controller.replace("import YNXBrowserCore\n", "") + "#endif\n" + PROBE)
    (out / "fixture.py").write_text(CHILD)
    launcher = out / "Fixture Launcher.app"
    wrong = launcher / "Contents/Helpers/Tor Interactive QA.app/Contents"
    wrong.mkdir(parents=True)
    (wrong / "Info.plist").write_text("""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.ynxweb4.browser.qa.nym.interactive</string>
<key>YNXInteractiveRouteExperiment</key><true/>
</dict></plist>""")
    probe = out / "probe"
    run(compiler + ["-D", "YNX_PRIVACY_ACCEPTANCE", str(out / "main.swift"), str(out / "mode.swift"), str(out / "sha.swift"),
                    str(core / "Omnibox.swift"), "-o", str(probe)], "compile", out, 40)
    run([str(probe), str(launcher), str(out / "fixture.py")], "probe", out, 10)
    (out / "RESULT.json").write_text(json.dumps({
        "controllerSHA256": hashlib.sha256(CONTROLLER.read_bytes()).hexdigest(),
        "policyAndListenerExecuted": True,
        "webKitOrNestedLaunchExecuted": False,
        "signedNEOrRealRouteExecuted": False
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
