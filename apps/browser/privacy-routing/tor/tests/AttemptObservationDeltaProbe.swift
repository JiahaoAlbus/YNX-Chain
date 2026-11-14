#if YNX_PRIVACY_ACCEPTANCE
import Foundation
@main struct AttemptObservationDeltaProbe {
    static func require(_ condition: Bool, _ label: String) throws {
        if !condition { throw NSError(domain: "P05AttemptObservationDelta", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
    }
    static func main() throws {
        guard CommandLine.arguments.count == 2 else { throw NSError(domain: "P05AttemptObservationDelta", code: 64) }
        let raw = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        try require(raw.count <= 65536, "bounded actual Go capture")
        var checks = 0
        for chunk in [1, 4096] {
            var recorder = SnowflakeSafePhaseRecorder(began: 0), cursor = 0
            var events: [[String: Any]] = []
            while cursor < raw.count { let end = min(raw.count, cursor + chunk); events += recorder.consume(raw.subdata(in: cursor..<end), at: 1); cursor = end }
            let frames = events.filter { $0["phase"] as? String == "entryAttemptSummary" }
            try require(frames.count == 8, "four actual copy cases emit two bounded frames each")
            let origins = ["LOCAL_EOF", "REMOTE_EOF", "LOCAL_DIRECTION_ERROR", "REMOTE_DIRECTION_ERROR"]
            let codes = ["NONE", "NONE", "TIMEOUT", "OTHER"]
            for id in 1...4 {
                let pair = frames.filter { $0["localAttempt"] as? Int == id }
                try require(pair.count == 2 && pair[0]["snapshot"] as? String == "COPY_FIRST" && pair[1]["snapshot"] as? String == "COPY_DONE", "same local attempt pre/post close")
                try require(pair[0]["copyOrigin"] as? String == origins[id-1] && pair[0]["copyErrorCode"] as? String == codes[id-1], "EOF versus direction/error cause retained")
                try require(pair[0]["brokerStatus"] as? Int == 200 && pair[0]["candidatesKept"] as? Int == 1 && pair[0]["candidatesDropped"] as? Int == 1, "bounded synthetic status/count control")
            }
            let text = String(decoding: try JSONSerialization.data(withJSONObject: frames), as: UTF8.self)
            for forbidden in ["secret.invalid", "10.1.2.3", "u:p@", "credential", "SDP?token"] { try require(!text.contains(forbidden), "no dynamic network/error text") }
            checks += 1
        }
        let valid = "YNX_PUBLIC_ATTEMPT_V1 1 10 COPY_FIRST WAITING_DC CHECKING NEW APPLIED 200 1 1 LOCAL_EOF NONE 0 0"
        try require(SnowflakeSafePhaseRecorder.classify(Data(valid.utf8)) != nil, "canonical frame accepted")
        for bad in [valid+" secret.invalid", valid.replacingOccurrences(of: "V1 1 ", with: "V1 0 "), valid.replacingOccurrences(of: "V1 1 ", with: "V1 1025 "), valid.replacingOccurrences(of: "1 10", with: "1 1.5"), valid.replacingOccurrences(of: "200 1 1", with: "600 1 1"), valid.replacingOccurrences(of: "200 1 1", with: "200 256 1"), valid.replacingOccurrences(of: "NONE 0 0", with: "NONE 8 0"), valid.replacingOccurrences(of: "WAITING_DC", with: "secret.invalid"), valid+"\u{1b}[0m"] {
            try require(SnowflakeSafePhaseRecorder.classify(Data(bad.utf8)) == nil, "unknown field or injection rejected"); checks += 1
        }
        let observations: [(String, String)] = [
            ("Attempt 1: Problem opening a channel to 10.1.2.3:9: Channel for secret.invalid credentialtoken timed out", "ARTI_CHANNEL_TIMEOUT"),
            ("Network IO error, or TLS error, in TLS negotiation, talking to https://u:p@[fd00::1]/?credentialtoken", "ARTI_CHANNEL_TLS_IO"),
            ("Protocol error while opening a channel with secret.invalid credentialtoken", "ARTI_CHANNEL_PROTOCOL_ERROR")
        ]
        for (input, code) in observations {
            let fields = TorPublicStderrSanitizer.line(Data(input.utf8))
            try require(fields["pinnedErrorTemplateObserved"] as? String == code && fields["errorTemplateScope"] as? String == "continuation-text-not-typed-error", "pinned template class is not typed-error proof")
            let text = String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self)
            for forbidden in ["10.1.2.3", "secret.invalid", "credentialtoken", "u:p@", "fd00::1"] { try require(!text.contains(forbidden), "variable fields omitted") }
            checks += 1
        }
        print("{\"status\":\"PASS\",\"newChecks\":\(checks),\"actualGoFramesParsed\":8,\"network\":\"NOT_RUN\",\"noRootOrBrowserQualification\":true}")
    }
}
#endif
