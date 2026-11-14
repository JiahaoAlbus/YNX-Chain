import Foundation
import Darwin

@main struct R2RuntimeTraceDeltaProbe {
    @MainActor static func main() throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        if CommandLine.arguments.contains("--sealed-target-only") {
            let value = TorPublicStderrSanitizer.line(Data("2026-11-07T10:00:00Z INFO tor_ptmgr::ipc::sealed: PT binary initialisation done identity=SensitiveBridgeToken0123456789".utf8))
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
            precondition((value["sanitizedLine"] as? String) == "2026-11-07T10:00:00Z INFO tor_ptmgr::ipc::sealed: PT binary initialisation done" && !encoded.contains("SensitiveBridgeToken"))
            print("R2_SEALED_TARGET_NEW_CONTROL=1; original31 not repeated; no backend/network")
            return
        }
        if CommandLine.arguments.contains("--wrong-role") {
            do { _ = try TorPublicRuntimeTrace(directory: directory, execution: .adjacentCLI); fatalError("wrong role accepted") }
            catch TorPlatformError.invalidPin { print("WRONG_ROLE_REJECTED"); return }
        }
        var checks = 0
        func check(_ condition: @autoclosure () -> Bool, _ name: String) {
            guard condition() else { fatalError(name) }; checks += 1
        }
        let prefix = "2026-11-07T10:00:00Z INFO tor_dirmgr::bootstrap: "
        let secrets = ["198.51.100.23:443", "[2001:db8:1::44]:9001", "bridge.private.example", "https://alice:password@secret.example/private?q=credential", "cert=VGhpc0lzQVNlbnNpdGl2ZUJyaWRnZUNlcnQ", "$0123456789ABCDEF0123456789ABCDEF01234567", "/Users/alice/.private/bridge", "longSensitiveToken0123456789ABCDEFGHIJK"]
        for secret in secrets {
            let line = prefix + "Downloading a consensus. attempt=" + secret
            let value = TorPublicStderrSanitizer.line(Data(line.utf8))
            let json = String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
            check(!json.contains(secret), "secret leaked: " + secret)
            check((value["sanitizedLine"] as? String)?.hasSuffix("Downloading a consensus.") == true, "known source excerpt missing")
        }
        let unknown = TorPublicStderrSanitizer.line(Data((prefix + "unknown user content " + secrets.joined(separator: " ")).utf8))
        check(unknown["sanitizedLine"] == nil && unknown["textDisposition"] as? String == "omitted-unknown-template", "unknown content was retained")
        let module = TorPublicStderrSanitizer.line(Data("2026-11-07T10:00:00Z ERROR secret_module: Downloading a consensus.".utf8))
        check(module["target"] == nil && module["sanitizedLine"] == nil, "unknown module retained")
        let ansi = TorPublicStderrSanitizer.line(Data(("\u{1b}[32m" + prefix + "1: Downloading certificates for consensus (we are missing 2/9).\u{1b}[0m").utf8))
        check((ansi["sanitizedLine"] as? String)?.contains("missing 2/9") == true, "known ANSI stage not preserved")
        let control = TorPublicStderrSanitizer.line(Data((prefix + "Downloading a consensus.\u{1b}]52;c;secret").utf8))
        check(control["sanitizedLine"] == nil, "OSC control retained")
        check(TorPublicStderrSanitizer.line(Data(repeating: 65, count: 4097))["sanitizedLine"] == nil, "overlong line retained")
        check(TorPublicStderrSanitizer.line(Data([255, 254, 0]))["sanitizedLine"] == nil, "invalid encoding retained")
        check(TorPublicStderrSanitizer.line(Data((prefix + "Downloading a consensus.\n" + secrets[0]).utf8))["sanitizedLine"] == nil, "multiline content retained")
        let trace = try TorPublicRuntimeTrace(directory: directory, execution: .adjacentCLI)
        let state = Data(#"{"status":"satisfied","interfaceTypes":["wifi"],"expensive":false,"constrained":false,"supportsIPv4":true,"supportsIPv6":true,"supportsDNS":true}"#.utf8)
        let path = try JSONDecoder().decode(TorPublicObservablePath.self, from: state)
        trace.path(path, baselineAlreadySet: false, capturedAt: 11)
        trace.path(path, baselineAlreadySet: true, capturedAt: 12)
        let full = Data((prefix + "1: Downloading a consensus. attempt=" + secrets[3] + "\n").utf8)
        trace.stderr(Data(full.prefix(17)), capturedAt: 13); trace.stderr(Data(full.dropFirst(17)), capturedAt: 14)
        trace.stderr(Data((prefix + "unknown " + secrets[2] + "\n").utf8), capturedAt: 15)
        trace.stderr(Data((String(repeating: "X", count: 5000) + "\n").utf8), capturedAt: 16)
        trace.stderr(Data(repeating: 65, count: 1_000_000), capturedAt: 17)
        trace.stderr(Data(("\n" + String(repeating: prefix + "Downloading a consensus.\n", count: 800)).utf8), capturedAt: 18)
        trace.checkpoint("fixtureCheckpoint")
        let original = try Data(contentsOf: trace.file)
        let rows = try String(decoding: original, as: UTF8.self).split(separator: "\n").map { try JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any] }
        let paths = rows.filter { $0["event"] as? String == "networkPath" }
        check(paths.count == 2 && paths[1]["sameObservable"] as? Bool == true, "observable comparison incorrect")
        check(paths[1]["sameObservableIsNotProofOfSameNetwork"] as? Bool == true, "same observable overstated")
        let lines = rows.filter { $0["event"] as? String == "stderrLine" }
        check(lines.count == 512, "stderr line budget exceeded or missing")
        check(lines.contains { $0["textDisposition"] as? String == "omitted-overlong-line" }, "overlong stream not accounted")
        let checkpoint = rows.last!
        check(checkpoint["stderrPrefixHashedBytes"] as? Int == 262_144, "raw hash prefix unbounded")
        check((checkpoint["stderrBytesObserved"] as? Int ?? 0) > 1_000_000, "total count lost")
        check(secrets.allSatisfy { !String(decoding: original, as: UTF8.self).contains($0) }, "stream secret leaked")
        for _ in 0..<2000 { trace.record("fixtureFill", ["text": String(repeating: "Q", count: 4000)]) }
        let capped = try Data(contentsOf: trace.file)
        check(capped.count <= 512 * 1024, "file byte cap exceeded")
        print("R2_TRACE_NEW_CHECKS=\(checks); synthetic offline only; no Arti/PT/network")
    }
}
