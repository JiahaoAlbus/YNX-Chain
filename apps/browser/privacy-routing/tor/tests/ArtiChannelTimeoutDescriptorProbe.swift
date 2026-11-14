import Foundation

/// Actual decoder DATA controls. No profile, process, socket or authority.
@main struct ArtiChannelTimeoutDescriptorProbe {
    @MainActor static func main() throws {
        let baseline: [String: Any] = [
            "schema": "P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V1",
            "runID": "00000000-0000-4000-8000-000000000033",
            "profile": "/synthetic/Tor", "scratch": "/synthetic",
            "profileDevice": 1, "profileInode": 2, "scratchDevice": 1, "scratchInode": 3,
            "scopeSHA256": String(repeating: "a", count: 64),
            "helperSHA256": TorSnowflakePublicBrowserBackend.helperSHA256,
            "sourceInputsSHA256": TorSnowflakePublicBrowserBackend.sourceInputsSHA256,
            "reviewedSourceSHA256": BundledTorBackend.bridgesSHA256,
            "selectedBridgeLineSHA256": TorSnowflakePublicBrowserBackend.firstLineSHA256,
            "deadlineUnixNano": 1, "fixedTarget": TorPublicSearchDiagnosticPolicy.target
        ]
        func bytes(_ value: [String: Any]) throws -> Data {
            try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        }
        _ = try TorSnowflakePublicBrowserBackend.decodeDescriptor(bytes(baseline))
        var experiment = baseline
        experiment["schema"] = "P05_PUBLIC_SNOWFLAKE_BROWSER_LAUNCH_V2"
        experiment["artiVariant"] = "non-direct-channel-30s"
        experiment["artiSHA256"] = String(repeating: "1", count: 64) // never a supplied artifact pin
        experiment["artiSourceInputsSHA256"] = TorSnowflakePublicBrowserBackend.channelTimeoutSourceInputsSHA256
        var rejected = 0
        for (value, variant) in [(experiment, TorSnowflakePublicBrowserBackend.ArtiVariant.publishedBaseline),
                                  (baseline, .nonDirectChannelThirtySeconds),
                                  (experiment, .nonDirectChannelThirtySeconds)] {
            do {
                _ = try TorSnowflakePublicBrowserBackend.decodeDescriptor(bytes(value), variant: variant)
            } catch { rejected += 1; continue }
            throw NSError(domain: "P05SyntheticControl", code: 1)
        }
        guard rejected == 3 else { throw NSError(domain: "P05SyntheticControl", code: 2) }
        print("{\"schema\":\"P05_DERIVED_ARTI_VARIANT_DATA_CONTROLS_V1\",\"V1Accepted\":true,\"incompatibleOrUnsuppliedV2Rejected\":3,\"profileReads\":0,\"processStarts\":0,\"network\":\"NOT_RUN\",\"notAuthority\":true}")
    }
}
