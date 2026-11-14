import Foundation
import CryptoKit

/// Synthetic byte-parser delta only. Does not create a gate/ACK/process or request network.
@main struct OutputMarkerDeltaProbe {
    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func check(_ value: Bool, _ label: String) throws {
        guard value else { throw NSError(domain: "TorOutputMarkerDelta", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
    }
    static func rejects(_ body: () throws -> Void) -> Bool { do { try body(); return false } catch { return true } }
    @MainActor static func main() throws {
        var checks = 0
        let raw = Data("2026-11-02T00:00:00Z  INFO arti::subcommands::proxy: Sufficiently bootstrapped; proxy now functional.".utf8)
        var partial = TorBootstrapOutputMarker()
        let first = try partial.consume(raw.prefix(23)); try check(first == nil, "split line cannot mark readiness"); checks += 1
        let remainder = try partial.consume(raw.dropFirst(23)); try check(remainder == nil, "missing LF cannot mark readiness"); checks += 1
        let complete = try partial.consume(Data([10])); try check(complete == digest(raw), "LF completion preserves raw log prefix"); checks += 1
        var crlf = TorBootstrapOutputMarker()
        let crlfMarker = try crlf.consume(raw + Data([13, 10])); try check(crlfMarker == digest(raw), "one optional CR excluded"); checks += 1
        var leading = TorBootstrapOutputMarker(); let prefixed = Data([32, 32]) + raw
        let leadingMarker = try leading.consume(prefixed + Data([10])); try check(leadingMarker == digest(prefixed) && leadingMarker != digest(raw), "leading spaces retained in helper marker"); checks += 1
        var trailing = TorBootstrapOutputMarker()
        let trailingMarker = try trailing.consume(raw + Data([32, 10])); try check(trailingMarker == nil, "trailing bytes cannot forge official suffix"); checks += 1
        var wrongModule = TorBootstrapOutputMarker()
        let wrong = Data("2026-11-02T00:00:00Z INFO arbitrary: Sufficiently bootstrapped; proxy now functional.\n".utf8)
        let wrongMarker = try wrongModule.consume(wrong); try check(wrongMarker == nil, "wrong upstream module cannot mark readiness"); checks += 1
        var deferred = TorBootstrapOutputMarker()
        let deferredMarker = try deferred.consume(Data("2026-11-02T00:00:00Z INFO arti::subcommands::proxy: Bootstrapping deferred.\n".utf8)); try check(deferredMarker == nil, "deferred bootstrap is not ready"); checks += 1
        var noProxy = TorBootstrapOutputMarker()
        let noProxyMarker = try noProxy.consume(Data("2026-11-02T00:00:00Z INFO arti::subcommands::proxy: Sufficiently bootstrapped.\n".utf8)); try check(noProxyMarker == nil, "no SOCKS functionality signal cannot mark route ready"); checks += 1
        var longLine = TorBootstrapOutputMarker(); try check(rejects { _ = try longLine.consume(Data(repeating: 65, count: 4097)) }, "bounded incomplete line"); checks += 1
        var budget = TorBootstrapOutputMarker(); let lines = Data(String(repeating: "synthetic informational output\n", count: 3000).utf8)
        _ = try budget.consume(lines); try check(rejects { _ = try budget.consume(lines) }, "pre-bootstrap capture stays within helper128KiB"); checks += 1
        let ptRaw = Data("VERSION 1\r\nCMETHOD obfs4 socks5 127.0.0.1:23456\r\nCMETHODS DONE".utf8)
        var pt = TorTransportProtocolParser(); try pt.consume(ptRaw)
        try check(pt.completedPort == nil && pt.completionMarkerSHA256 == nil, "PT full LF marker required before discard"); checks += 1
        try pt.consume(Data([13, 10])); try check(pt.completedPort == 23456 && pt.completionMarkerSHA256 == digest(Data("CMETHODS DONE".utf8)), "PT marker matches helper exact CRLF normalization"); checks += 1
        var badPT = TorTransportProtocolParser()
        try check(rejects { try badPT.consume(Data("VERSION 1\nCMETHODS DONE\n".utf8)) } && badPT.completedPort == nil, "PT marker cannot skip method enrollment"); checks += 1
        print("SYNTHETIC_OUTPUT_MARKER_DELTA checks=\(checks) PASS; gate/vendor/NE/network NOT_RUN")
    }
}
