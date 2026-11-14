import Foundation
import CryptoKit
import Darwin

/// PUBLIC log bytes only. No vendor, listener, proxy, Root or readiness permit is created.
@main struct ReadinessEnvelopeDeltaProbe {
    static func main() {
        do {
            let ready = "Sufficiently bootstrapped; proxy now functional."
            let target = "arti::subcommands::proxy: "
            let time = "2026-11-02T00:00:00Z"
            let forged = time + " WARN other_module: INFO " + target + ready + "\n"
            if CommandLine.arguments.dropFirst() == ["--legacy-counterexample"] {
                var parser = ArtiBootstrapSignalParser()
                guard parser.consume(Data(forged.utf8)) == [.ready] else { throw NSError(domain: "TorEnvelopeCounterexampleNotObserved", code: 1) }
                print("TOR_ENVELOPE_BUG_REPRODUCED actual parser accepted WARN other-target payload as ready; PUBLIC bytes, vendor/network NOT_RUN")
                return
            }
            var checks = 0
            func check(_ condition: Bool, _ label: String) throws {
                guard condition else { throw NSError(domain: "TorEnvelopeDelta." + label, code: checks) }
                checks += 1
            }
            for line in [
                forged,
                time + " INFO other_module: INFO " + target + ready + "\n",
                time + " NOTINFO " + target + ready + "\n",
                time + " WARN " + target + ready + "\n",
                time + " INFO " + target + "message=\"INFO " + target + ready + "\n",
                time + " INFO arti::subcommands::proxy::other: " + ready + "\n",
                "arbitrary INFO " + target + ready + "\n",
                "PUBLIC-secret.invalid/INFO " + target + ready + "\n",
                "2026-11-02T00:00:00+08:00 INFO " + target + ready + "\n",
                "2026-99-02T00:00:00Z INFO " + target + ready + "\n",
                time + " INFO run_proxy: " + target + ready + "\n",
                time + " INFO " + target + ready + " trailing-field=1\n"
            ] {
                var parser = ArtiBootstrapSignalParser()
                try check(parser.consume(Data(line.utf8)).isEmpty, "reject-non-envelope")
                var marker = TorBootstrapOutputMarker()
                try check(try marker.consume(Data(line.utf8)) == nil, "no-owned-marker-for-non-envelope")
            }
            for stamp in [time, "2026-11-02T00:00:00.123Z", "2026-11-02T00:00:00.123456789Z"] {
                let raw = Data((stamp + "  INFO " + target + ready).utf8)
                var parser = ArtiBootstrapSignalParser()
                try check(parser.consume(raw).isEmpty, "no-partial-ready")
                try check(parser.consume(Data([10])) == [.ready], "valid-complete-envelope")
                var marker = TorBootstrapOutputMarker()
                let digest = SHA256.hash(data: raw).map { String(format: "%02x", $0) }.joined()
                try check(try marker.consume(raw + Data([10])) == digest, "exact-owned-output-marker")
            }
            var deferred = ArtiBootstrapSignalParser()
            try check(deferred.consume(Data((time + " INFO " + target + "Bootstrapping deferred.\n").utf8)) == [.deferred], "deferred-remains-not-ready")
            var noProxy = ArtiBootstrapSignalParser()
            try check(noProxy.consume(Data((time + " INFO " + target + "Sufficiently bootstrapped.\n").utf8)).isEmpty, "no-proxy-not-ready")
            var quotedDeferred = ArtiBootstrapSignalParser()
            try check(quotedDeferred.consume(Data((time + " WARN other: INFO " + target + "Bootstrapping deferred.\n").utf8)).isEmpty, "wrong-target-cannot-defer")
            let raw = Data(("  " + time + "  INFO " + target + ready).utf8)
            var marker = TorBootstrapOutputMarker()
            try check(try marker.consume(raw + Data([13, 10])) == SHA256.hash(data: raw).map { String(format: "%02x", $0) }.joined(), "raw-prefix-and-crlf-marker-preserved")
            print("TOR_READINESS_ENVELOPE_DELTA \(checks) checks PASS; parser/marker only; backend/BrowserRouteReady/NE/network NOT_RUN")
        } catch { FileHandle.standardError.write(Data("TOR_READINESS_ENVELOPE_DELTA FAIL \(error)\n".utf8)); exit(1) }
    }
}
