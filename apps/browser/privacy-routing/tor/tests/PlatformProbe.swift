import Foundation
import WebKit

@main enum PlatformProbe {
    @MainActor static func main() async throws {
        var passed = 0
        func check(_ value: Bool, _ message: String) throws {
            guard value else { throw NSError(domain: "TorPlatformProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
            passed += 1
        }
        let configuration = try ArtiProcessAdapter.configuration(port: 19150, sessionDirectory: URL(fileURLWithPath: "/tmp/synthetic-route-session"))
        try check(configuration.contains("socks_listen = [\"127.0.0.1:19150\"]") && configuration.contains("dns_listen = []") && configuration.contains("[rpc]\nenable = false"), "loopback-only SOCKS, no DNS/RPC listeners")
        try check(configuration.contains("\"/tmp/synthetic-route-session/cache\"") && !configuration.contains("\\/"), "TOML path does not use invalid JSON slash escapes")
        do { _ = try ArtiProcessAdapter.configuration(port: 0, sessionDirectory: URL(fileURLWithPath: "/tmp/unused")); throw NSError(domain: "unexpected", code: 1) }
        catch TorPlatformError.invalidPort { passed += 1 }
        let first = try TorRoutedWebViewFactory.configurationForControlledProbe(port: 19150)
        let second = try TorRoutedWebViewFactory.configurationForControlledProbe(port: 19151)
        try check(!first.websiteDataStore.isPersistent && !second.websiteDataStore.isPersistent && first.websiteDataStore !== second.websiteDataStore, "each window has a separate nonpersistent store")
        try check(first.websiteDataStore.proxyConfigurations.count == 1 && first.websiteDataStore.proxyConfigurations[0].allowFailover == false, "explicit direct fallback disabled before any view")
        do { _ = try TorRoutedWebViewFactory.makeWebView(endpoint: PrivacyRouteEndpoint(port: 19150)); throw NSError(domain: "unexpected", code: 2) }
        catch TorPlatformError.webKitIsolationNotVerified { passed += 1 }
        let adapter = ArtiProcessAdapter()
        let pin = ArtiProcessAdapter.BinaryPin(executable: URL(fileURLWithPath: "/bin/sh"), binarySHA256: String(repeating: "0", count: 64), sourceArchiveSHA256: "a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813", version: "2.7.0")
        do { try adapter.start(pin: pin, port: 19150, sessionDirectory: URL(fileURLWithPath: "/tmp/not-created")); throw NSError(domain: "unexpected", code: 3) }
        catch TorPlatformError.binaryMismatch { passed += 1 }
        try check(adapter.pollProcess() == .stopped, "bad pin never started a process")
        let provider = TorRouteProvider()
        do { _ = try await provider.start(); throw NSError(domain: "unexpected", code: 4) }
        catch PrivacyRouteError.blocked { }
        await provider.stop()
        let status = await provider.status()
        if case .blocked = status { passed += 1 } else { throw NSError(domain: "unexpected", code: 5) }
        var parser = ArtiBootstrapSignalParser()
        let prefix = "2026-10-31T10:00:00Z INFO arti::subcommands::proxy: "
        try check(parser.consume(Data((prefix + "Starting Arti in proxy mode\n").utf8)).isEmpty, "listener is not ready")
        try check(parser.consume(Data((prefix + "Sufficiently bootstrapped;").utf8)).isEmpty, "partial marker is not ready")
        try check(parser.consume(Data(" proxy now functional.\n".utf8)) == [.ready], "whole fixed upstream bootstrap marker")
        try check(parser.consume(Data((prefix + "Bootstrapping deferred.\n").utf8)) == [.deferred], "manual mode stays deferred")
        print("Tor platform controlled checks: \(passed) passed; no WKWebView, route process or external request created")
    }
}
