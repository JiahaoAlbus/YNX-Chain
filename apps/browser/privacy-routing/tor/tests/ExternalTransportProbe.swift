import Foundation

@main enum ExternalTransportProbe {
    @MainActor static func main() async throws {
        var checks = 0
        func bad(_ text: String) {
            var parser = TorTransportProtocolParser()
            do { try parser.consume(Data(text.utf8)); preconditionFailure("malformed protocol accepted") } catch { checks += 1 }
        }
        var parser = TorTransportProtocolParser()
        try parser.consume(Data("VER".utf8)); precondition(parser.completedPort == nil); checks += 1
        try parser.consume(Data("SION 1\nSTATUS TYPE=version IMPLEMENTATION=lyrebird\nCMETHOD obfs4 socks5 127.0.0.1:12345\n".utf8))
        precondition(parser.completedPort == nil); checks += 1
        try parser.consume(Data("CMETHODS DO".utf8)); precondition(parser.completedPort == nil); checks += 1
        try parser.consume(Data("NE\r\n".utf8)); precondition(parser.completedPort == 12345); checks += 1
        for malformed in ["VERSION 2\n", "CMETHODS DONE\n", "VERSION 1\nVERSION 1\n", "VERSION 1\nCMETHOD obfs4 socks4 127.0.0.1:12345\n", "VERSION 1\nCMETHOD obfs4 socks5 0.0.0.0:12345\n", "VERSION 1\nCMETHOD obfs4 socks5 [::1]:12345\n", "VERSION 1\nCMETHOD obfs4 socks5 127.0.0.1:0\n", "VERSION 1\nCMETHOD obfs4 socks5 127.0.0.1:65536\n", "VERSION 1\nCMETHOD obfs4 socks5 127.0.0.1:12345\nCMETHOD obfs4 socks5 127.0.0.1:12345\n", "VERSION 1\nCMETHOD-ERROR obfs4 failure\n", "VERSION 1\nENV-ERROR unavailable\n", "VERSION 1\nCMETHOD snowflake socks5 127.0.0.1:12345\n", String(repeating: "X", count: 4097)] { bad(malformed) }
        let fingerprint = String(repeating: "A", count: 40)
        let publicLine = "obfs4 203.0.113.7:443 \(fingerprint) cert=synthetic iat-mode=0"
        let ipv6 = "obfs4 [2001:db8::7]:8443 \(fingerprint) cert=synthetic iat-mode=0"
        let peers = try TorBridgeEntryPeer.parse([publicLine, publicLine, ipv6])
        precondition(peers.count == 2 && peers[0].address == "203.0.113.7" && peers[1].address == "2001:db8::7"); checks += 1
        do { _ = try TorBridgeEntryPeer.parse(["obfs4 bridge.test:443 \(fingerprint) cert=synthetic"]); preconditionFailure("hostname cannot be an exact entry peer") } catch { checks += 1 }
        let directory = URL(fileURLWithPath: "/private/tmp/synthetic-tor-config-only")
        let managed = ArtiProcessAdapter.BridgeConfiguration(lines: [publicLine], transport: URL(fileURLWithPath: "/synthetic/lyrebird"), transportSHA256: BundledTorBackend.lyrebirdSHA256)
        let original = try ArtiProcessAdapter.configuration(port: 19150, sessionDirectory: directory, deferBootstrap: false, bridge: managed)
        precondition(original.contains("path = \"/synthetic/lyrebird\"") && original.contains("run_on_startup = true") && !original.contains("proxy_addr")); checks += 1
        var external = managed; external.externalProxyPort = 12345
        let configured = try ArtiProcessAdapter.configuration(port: 19150, sessionDirectory: directory, deferBootstrap: false, bridge: external)
        precondition(configured.contains("proxy_addr = \"127.0.0.1:12345\"") && !configured.contains("\npath =") && !configured.contains("arguments =") && !configured.contains("run_on_startup")); checks += 1
        precondition(configured.contains(publicLine) && configured.contains("watch_configuration = false") && configured.contains("enable = false") && configured.contains("permit_debugging = false")); checks += 1
        external.externalProxyPort = 0
        do { _ = try ArtiProcessAdapter.configuration(port: 19150, sessionDirectory: directory, bridge: external); preconditionFailure("zero external port accepted") } catch { checks += 1 }
        let environment = TorExternalTransport.environment(directory: directory)
        precondition(Set(environment.keys) == ["PATH", "HOME", "TOR_PT_MANAGED_TRANSPORT_VER", "TOR_PT_STATE_LOCATION", "TOR_PT_CLIENT_TRANSPORTS", "TOR_PT_EXIT_ON_STDIN_CLOSE"] && environment["TOR_PT_EXIT_ON_STDIN_CLOSE"] == "1" && environment["TOR_PT_CLIENT_TRANSPORTS"] == "obfs4"); checks += 1
        let transport = TorExternalTransport()
        let initial = try await transport.poll { _ in }
        precondition(initial == .stopped && transport.entryPeers.isEmpty); checks += 1
        await transport.stop()
        precondition(transport.state == .stopped); checks += 1
        print("PASS \(checks) new external PT protocol/exact-peer/config checks; synthetic only; no files/process/network")
    }
}
