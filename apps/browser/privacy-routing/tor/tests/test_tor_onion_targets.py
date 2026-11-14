#!/usr/bin/env python3
"""Check route syntax and observe WebKit's .onion SOCKS CONNECT on loopback."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import platform
import socket
import threading

from test_r2_path_sample import run
from test_worker_ownership import segment


def onion(key, version=3):
    data = key + hashlib.sha3_256(b".onion checksum" + key + bytes([version])).digest()[:2] + bytes([version])
    return base64.b32encode(data).decode().lower() + ".onion"


POLICY = r'''
import Foundation

@main struct Probe {
    static func main() throws {
        let host = "__HOST__", other = "__OTHER__", wrongVersion = "__VERSION__"
        func url(_ value: String) -> URL { URL(string: value)! }
        func denied(_ input: String) -> Bool { (try? BrowserOmnibox.resolveOmnibox(input)) == nil }
        func allowed(_ value: String, _ mode: PrivacyRouteMode = .tor) -> Bool {
            PrivacyRouteWebTarget.allows(url(value), mode: mode)
        }
        func redirect(_ from: String, _ to: String) -> Bool {
            PrivacyRouteWebTarget.allowsDownloadRedirect(from: url(from), to: url(to), mode: .tor)
        }
        let checks = [
            "bareOnionNotSearched": denied(host),
            "enteredHTTPOnionNotOrdinary": denied("http://" + host + "/read"),
            "malformedOnionPortNotSearched": denied(host + ":bad"),
            "onionWithSpaceNotSearched": denied(host + " extra"),
            "schemeRelativeOnionNotSearched": denied("//" + host + "/read"),
            "nakedOnionWithPort": (try BrowserOmnibox.resolveOmnibox(host + ":81/a", allowTorOnion: true)).absoluteString == "http://" + host + ":81/a",
            "normalSearchPreserved": (try BrowserOmnibox.resolveOmnibox("public search")).host == "duckduckgo.com",
            "ordinaryNavigationBlocksOnion": !BrowserOmnibox.isNavigable(url("https://" + host)),
            "originalOptionalMapSignature": URL(string: "https://example.org").map(BrowserOmnibox.isNavigable) == true
                && URL(string: "https://" + host).map(BrowserOmnibox.isNavigable) == false,
            "allTorOnionSchemes": ["https", "http", "wss", "ws"].allSatisfy { allowed($0 + "://" + host + "/") },
            "allNymOnionSchemesDenied": ["https", "http", "wss", "ws"].allSatisfy { !allowed($0 + "://" + host + "/", .nym) },
            "uppercaseDNS": allowed("http://" + host.uppercased()),
            "badChecksum": !allowed("https://z" + host.dropFirst()),
            "badVersionWithValidChecksum": !allowed("https://" + wrongVersion),
            "subdomain": !allowed("http://sub." + host),
            "legacyOnion": !allowed("https://abcdefghijklmnoq.onion"),
            "trailingDot": !allowed("https://" + host + "."),
            "noncanonicalEncoding": !allowed("https://" + host.replacingOccurrences(of: ".onion", with: "%2Eonion")),
            "plainPublicStillDenied": !allowed("http://example.org") && !allowed("ws://example.org"),
            "normalTLSStillAllowed": allowed("https://example.org") && allowed("wss://example.org", .nym),
            "authUserInfoDenied": !allowed("http://user:pass@" + host),
            "sameServiceRedirect": redirect("http://" + host + "/a", "http://" + host + ":80/b"),
            "otherPortRedirectDenied": !redirect("http://" + host, "http://" + host + ":81"),
            "otherServiceRedirectDenied": !redirect("http://" + host, "http://" + other),
            "onionDowngradeDenied": !redirect("https://" + host, "http://" + host),
            "existingTLSRedirectPreserved": redirect("https://example.org", "https://example.net"),
            "sha3512PriorContract": BrowserSHA3_512.hash(Data("abc".utf8)) == "__SHA3512__"
        ]
        print(String(decoding: try JSONSerialization.data(withJSONObject: checks, options: [.sortedKeys]), as: UTF8.self))
        exit(checks.values.allSatisfy { $0 } ? 0 : 1)
    }
}
'''


WEBKIT = r'''
import AppKit
import Foundation
import Network
import WebKit

enum TorPlatformError: Error { case invalidPort }
@MainActor enum ActualFactory {
__FACTORY__
}

@main @MainActor final class Probe: NSObject, WKNavigationDelegate {
    static func main() throws {
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let configuration = try ActualFactory.configurationForControlledProbe(port: UInt16(CommandLine.arguments[1])!)
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let probe = Probe()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = probe
        guard !configuration.websiteDataStore.isPersistent,
              configuration.websiteDataStore.proxyConfigurations.count == 1,
              configuration.websiteDataStore.proxyConfigurations[0].allowFailover == false else { exit(2) }
        DispatchQueue.main.async {
            guard view.load(URLRequest(url: URL(string: "http://__HOST__/synthetic")!)) != nil else { exit(2) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 7) { exit(3) }
        application.run()
        withExtendedLifetime((view, probe)) {}
        exit(3)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { exit(0) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let error = error as NSError
        print("\(error.domain) \(error.code)")
        exit(4)
    }
}
'''


def observe_socks(listener, expected, observed):
    def read_exact(peer, count):
        value = bytearray()
        while len(value) < count:
            block = peer.recv(count - len(value))
            if not block:
                raise EOFError("truncated SOCKS exchange")
            value.extend(block)
        return bytes(value)

    try:
        peer, _ = listener.accept()
        with peer:
            peer.settimeout(5)
            greeting = read_exact(peer, 2)
            if greeting[0] != 5 or 0 not in read_exact(peer, greeting[1]):
                raise ValueError("invalid no-auth greeting")
            peer.sendall(b"\x05\x00")
            request = read_exact(peer, 4)
            observed["connect"] = request[:3] == b"\x05\x01\x00"
            observed["addressType"] = request[3]
            if request != b"\x05\x01\x00\x03":
                raise ValueError("expected a domain-name CONNECT")
            observed["domainMatchesSynthetic"] = read_exact(peer, read_exact(peer, 1)[0]) == expected.encode()
            observed["port"] = int.from_bytes(read_exact(peer, 2), "big")
            if not observed["domainMatchesSynthetic"] or observed["port"] != 80:
                raise ValueError("unexpected SOCKS target")
            peer.sendall(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x50")
            request = bytearray()
            while b"\r\n\r\n" not in request and len(request) < 8192:
                request.extend(read_exact(peer, 1))
            observed["httpInsideTunnel"] = request.startswith(b"GET /synthetic HTTP/1.")
            peer.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 9\r\nConnection: close\r\n\r\n<p>ok</p>")
    except (EOFError, OSError, ValueError) as error:
        observed["error"] = str(error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--observe-webkit", action="store_true", help="also attempt a no-window loopback SOCKS capture")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    native = Path(__file__).resolve().parents[3] / "native/Sources"
    core = native / "YNXBrowserCore"
    sources = [core / "Omnibox.swift", core / "PrivacyRouteProvider.swift", core / "PageSelection.swift",
               native / "YNXBrowserNative/PrivacyTorPlatform.swift"]
    raw = {path: path.read_bytes() for path in sources}
    host, other, version = onion(bytes(range(32))), onion(bytes(reversed(range(32)))), onion(bytes(range(32)), 4)
    source = output / "ActualPolicy.swift"
    route, digest = raw[sources[1]].decode(), raw[sources[2]].decode()
    source.write_text(POLICY.replace("__HOST__", host).replace("__OTHER__", other).replace("__VERSION__", version)
                      .replace("__SHA3512__", hashlib.sha3_512(b"abc").hexdigest())
                      + "\n" + segment(route, "public enum PrivacyRouteMode:") + "\n"
                      + segment(route, "public enum PrivacyRouteWebTarget {") + "\n"
                      + segment(digest, "enum BrowserSHA3_512 {") + "\n" + segment(digest, "enum BrowserSHA3 {"))
    core_input = output / "Omnibox.swift"
    core_input.write_bytes(raw[sources[0]])
    swift = ["/usr/bin/xcrun", "swiftc", "-swift-version", "6", "-j", "1", "-parse-as-library",
             "-target", f"{platform.machine()}-apple-macosx14.0", "-module-cache-path", str(output / "module-cache")]
    policy = output / "policy"
    processes = {"policyCompile": run(swift + [str(core_input), str(source), "-o", str(policy)], output, "policy-compile", 30)}
    if processes["policyCompile"]["originalWait"] == 0:
        processes["policy"] = run([str(policy)], output, "policy", 8)
    observed = {}
    expected_socks = {"connect": True, "addressType": 3, "domainMatchesSynthetic": True,
                      "port": 80, "httpInsideTunnel": True}
    if args.observe_webkit:
        wk_source = output / "ActualProxy.swift"
        wk_source.write_text(WEBKIT.replace("__HOST__", host).replace("__FACTORY__", segment(
            raw[sources[3]].decode(), "static func configurationForControlledProbe(")))
        app = output / "proxy"
        processes["webkitCompile"] = run(swift + [str(wk_source), "-o", str(app)], output, "webkit-compile", 30)
        if processes["webkitCompile"]["originalWait"] == 0:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.bind(("127.0.0.1", 0))
                listener.listen(1)
                listener.settimeout(9)
                worker = threading.Thread(target=observe_socks, args=(listener, host, observed))
                worker.start()
                processes["webkit"] = run([str(app), str(listener.getsockname()[1])], output, "webkit", 10)
                worker.join()
    passed = ("policy" in processes and all(p["originalWait"] == 0 and p["reaped"] for p in processes.values())
              and (not args.observe_webkit or observed == expected_socks)
              and all(path.read_bytes() == value for path, value in raw.items()))
    (output / "RESULT.json").write_text(json.dumps({
        "status": "PASS" if passed else "FAIL", "processes": processes,
        "ownedLoopbackSOCKS": observed if args.observe_webkit else "NOT_RUN",
        "sources": {str(path.relative_to(native)): hashlib.sha256(value).hexdigest() for path, value in raw.items()},
        "actualArti": "NOT_RUN", "publicNetwork": "NOT_RUN", "onionService": "NOT_RUN", "leakMatrix": "NOT_RUN",
    }, indent=2) + "\n")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
