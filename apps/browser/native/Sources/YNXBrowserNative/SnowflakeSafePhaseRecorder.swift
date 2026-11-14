#if YNX_PRIVACY_ACCEPTANCE
import Foundation

/// PUBLIC backend fixture diagnostics only. This creates no route/qualification authority.
/// Unknown text, addresses, error descriptions and SDP never leave this bounded parser.
struct SnowflakeSafePhaseRecorder {
    private(set) var inputBytes = 0
    private(set) var completeLines = 0
    private(set) var emittedEvents = 0
    private(set) var omittedLines = 0
    private(set) var truncated = false
    private var pending = Data()
    private var droppingLongLine = false
    private let began: UInt64
    static let byteLimit = 2 * 1024 * 1024
    static let lineLimit = 8192
    static let eventLimit = 256
    static let lineByteLimit = 8192
    static let durationNS: UInt64 = 650_000_000_000

    init(began: UInt64 = DispatchTime.now().uptimeNanoseconds) { self.began = began }

    mutating func consume(_ bytes: Data, at now: UInt64) -> [[String: Any]] {
        guard now >= began, now - began <= Self.durationNS, !truncated else {
            truncated = true; pending.removeAll(keepingCapacity: false); return []
        }
        var result: [[String: Any]] = []
        // Check before each byte, so a large read cannot cross the budget or retain a huge line.
        for byte in bytes {
            guard inputBytes < Self.byteLimit, completeLines < Self.lineLimit else {
                truncated = true; pending.removeAll(keepingCapacity: false); break
            }
            inputBytes += 1
            if byte == 10 {
                completeLines += 1
                defer { pending.removeAll(keepingCapacity: true); droppingLongLine = false }
                if droppingLongLine { omittedLines += 1; continue }
                if pending.last == 13 { pending.removeLast() }
                guard let fields = Self.classify(pending) else { omittedLines += 1; continue }
                guard emittedEvents < Self.eventLimit else { truncated = true; break }
                emittedEvents += 1
                let producerTruncated = fields["producerCoverageTruncated"] as? Bool == true
                var event = fields
                event["observedMonotonicNS"] = now
                event["sequence"] = emittedEvents
                result.append(event)
                if producerTruncated { truncated = true; pending.removeAll(keepingCapacity: false); break }
            } else if !droppingLongLine {
                if pending.count < Self.lineByteLimit { pending.append(byte) }
                else { droppingLongLine = true; pending.removeAll(keepingCapacity: false) }
            }
        }
        return result
    }

    /// Capture is this QA attempt's verified phase-control input. Reaching a
    /// budget exhausts it, including when consume() has already returned [].
    func monitoringCoverageFailure(at now: UInt64) -> String? {
        if now < began || now - began > Self.durationNS { return "TIME_BUDGET" }
        if inputBytes >= Self.byteLimit { return "BYTE_BUDGET" }
        if completeLines >= Self.lineLimit { return "LINE_BUDGET" }
        if emittedEvents >= Self.eventLimit { return "EVENT_BUDGET" }
        if truncated { return "PARSER_OR_PRODUCER_LIMIT" }
        return nil
    }

    var summary: [String: Any] {
        let coverageFailure = monitoringCoverageFailure(at: DispatchTime.now().uptimeNanoseconds)
        return ["inputBytes": inputBytes, "completeLines": completeLines, "phaseEvents": emittedEvents,
         "omittedLines": omittedLines, "partialLineBytes": pending.count,
         "coverageTruncated": truncated,
         "monitoringCoverageAvailable": coverageFailure == nil,
         "monitoringCoverageFailureReason": coverageFailure ?? "NONE",
         "rawTextPersisted": false,
         "captureProvesEmissionByFixedLyrebird": false]
    }

    private static func match(_ pattern: String, _ text: String) -> [String]? {
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let found = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              found.range == NSRange(text.startIndex..., in: text) else { return nil }
        return (1..<found.numberOfRanges).map {
            guard let r = Range(found.range(at: $0), in: text) else { return "" }
            return String(text[r])
        }
    }

    /// Source constants: exact replacement 3e42aebe21a57f14f47d4312ce5fbc8adf039d84.
    /// Matching is anchored; no generic substring/error-string passthrough is permitted.
    static func classify(_ bytes: Data) -> [String: Any]? {
        guard !bytes.isEmpty, bytes.count <= lineByteLimit,
              bytes.allSatisfy({ $0 >= 32 && $0 != 127 }),
              var message = String(data: bytes, encoding: .utf8) else { return nil }
        var envelope = "direct-stderr"
        if let wrapped = match(#"[0-9T:.+Z-]{20,40} +(ERROR|WARN|INFO|DEBUG|TRACE) +tor_ptmgr::ipc(?:::sealed)?: \[pt [^\]\r\n]{1,512}\] (.{1,7500})"#, message) {
            message = wrapped[1]; envelope = "arti-pt-log"
        } else if message.contains("tor_ptmgr::") { return nil }
        // Go standard logger timestamp; not copied to output. Arbitrary leading text is rejected.
        if let timed = match(#"[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})? (.+)"#, message) {
            message = timed[0]
        }
        // NEW QA helper: one pre-close and one post-close snapshot per local
        // SOCKS attempt, not per packet. Every value is a bounded local counter
        // or closed enum; no network address, SDP, error tail or peer ID exists.
        if let fields = match(#"YNX_PUBLIC_ATTEMPT_V1 ([0-9]{1,4}) ([0-9]{1,6}) (COPY_FIRST|COPY_DONE|DIAL_FAILED|SOCKS_REPLY_FAILED) (PREPARING|BROKER|REMOTE_DESCRIPTION|WAITING_DC|DATA_OPEN|OWNER_CANCELLED|DATA_TIMEOUT|SETUP_ERROR) (UNOBSERVED|NEW|CHECKING|CONNECTED|COMPLETED|FAILED|DISCONNECTED|CLOSED) (UNOBSERVED|NEW|CONNECTING|CONNECTED|CLOSED|FAILED) (NOT_REACHED|FILTERED|APPLIED|EMPTY|PARSE_ERROR|CLOSED_OWNER) ([0-9]{1,3}) ([0-9]{1,3}) ([0-9]{1,3}) (NONE|LOCAL_EOF|LOCAL_DIRECTION_ERROR|REMOTE_EOF|REMOTE_DIRECTION_ERROR|DIAL_ERROR|SOCKS_REPLY_ERROR) (NONE|EOF|UNEXPECTED_EOF|CLOSED|PIPE|RESET|TIMEOUT|CANCELLED|OTHER) ([0-7]) ([0-9]{1,4})"#, message),
           let attempt = Int(fields[0]), (1...1024).contains(attempt),
           let elapsed = Int(fields[1]), elapsed <= 650000,
           let status = Int(fields[7]), status == 0 || (100...599).contains(status),
           let kept = Int(fields[8]), let dropped = Int(fields[9]), kept + dropped <= 256, let seen = Int(fields[12]), let peer = Int(fields[13]), peer <= 1024 {
            return ["schema": "P05_SNOWFLAKE_SAFE_PHASE_V1", "envelope": envelope,
                    "phase": "entryAttemptSummary", "localAttempt": attempt, "elapsedMS": elapsed,
                    "snapshot": fields[2], "wait": fields[3], "ICEState": fields[4], "DTLSState": fields[5],
                    "SDPState": fields[6], "brokerStatus": status, "candidatesKept": kept,
                    "candidatesDropped": dropped, "copyOrigin": fields[10], "copyErrorCode": fields[11], "connectedStatesObservedMask": seen, "preparingPeerIteration": peer, "statesMayDescribePrefetch": true,
                    "localCounterNotNetworkIdentity": true, "copyErrorDirectionNotSocketOrigin": true]
        }
        if let rejected = match(#"YNX_PUBLIC_REJECTION_V1 (PACKET_SEND_TARGET|PACKET_READ_SOURCE|UDP_SEND_TARGET|UDP_READ_SOURCE|UDP_CONNECTED_PEER|NET_LISTEN|NET_DIAL|NET_RESOLVE|BROKER_BINDING|OTHER_GUARD) (ADDRESS_SHAPE|PORT|ZONE|NON_PUBLIC|FAMILY|EXPIRED|PEER_BINDING|APPROVED_MAP|NETWORK_KIND|OOB|OTHER_RULE)"#, message) {
            return ["schema": "P05_SNOWFLAKE_SAFE_PHASE_V1", "envelope": envelope,
                    "phase": "entryPolicyRejectionDetail", "rejectionSite": rejected[0], "rejectionReason": rejected[1]]
        }
        let markers: [String: String] = [
            "SINK_INSTALLED": "backendPhaseSinkInstalled", "SF_DIAL_BEGIN": "entryDialBegin",
            "SF_ARGS_REJECTED": "entryArgsRejected", "SF_DIAL_REJECTED": "entryDialRejected",
            "POLICY_REJECTED": "entryPolicyRejected", "OWNER_CLOSED": "entryOwnerClosed",
            "CLEANUP_UNKNOWN": "entryCleanupUnknown"
        ]
        let markerPrefix = "YNX_PUBLIC_PHASE_V1 "
        if message == markerPrefix + "LIMIT_REACHED" {
            return ["schema": "P05_SNOWFLAKE_SAFE_PHASE_V1", "envelope": envelope,
                    "phase": "producerCoverageTruncated", "producerCoverageTruncated": true]
        }
        if message.hasPrefix(markerPrefix), let phase = markers[String(message.dropFirst(markerPrefix.count))] {
            return ["schema": "P05_SNOWFLAKE_SAFE_PHASE_V1", "envelope": envelope, "phase": phase]
        }
        let fixed: [String: String] = [
            "Negotiating via HTTP rendezvous...": "brokerHTTPAttempt",
            "HTTP rendezvous transport failure: TLSRejected": "brokerTLSRejected",
            "HTTP rendezvous transport failure: Cancelled": "brokerRequestCancelled",
            "HTTP rendezvous transport failure: Timeout": "brokerTransportTimeout",
            "HTTP rendezvous transport failure: Other": "brokerTransportFailed",
            "WebRTC: fixed QA entry attempt incomplete": "entryAttemptIncomplete",
            "Received Answer.": "brokerAnswerParsed",
            "WebRTC: DataChannel created": "dataChannelCreated",
            "WebRTC: Created offer": "ICEOfferCreated",
            "WebRTC: Set local description": "localDescriptionSet",
            "WebRTC: DataChannel.OnOpen": "dataChannelOpen",
            "WebRTC: DataChannel.OnClose": "dataChannelClosed",
            "WebRTC: Closing": "peerClosing",
            "ConnectLoop: stopped.": "connectLoopStopped",
            "WebRTC: timeout waiting for DataChannel.OnOpen  Retrying...": "dataChannelOpenTimeout"
        ]
        var fields: [String: Any] = ["schema": "P05_SNOWFLAKE_SAFE_PHASE_V1", "envelope": envelope]
        if let phase = fixed[message] { fields["phase"] = phase; return fields }
        if let code = match(#"HTTP rendezvous response: ([1-5][0-9]{2})(?: [A-Za-z -]{1,64})?"#, message), let status = Int(code[0]) {
            fields["phase"] = "brokerHTTPResponse"; fields["statusCode"] = status; return fields
        }
        if let nat = match(#"NAT Type: (unknown|restricted|unrestricted)"#, message) {
            fields["phase"] = "NATResult"; fields["NATCategory"] = nat[0]; return fields
        }
        // Dynamic tails exist in upstream source. Drop the complete tail, not a guessed redaction.
        let prefixes: [(String, String)] = [
            ("Warning: NAT checking failed for server at ", "NATCheckFailed"),
            ("Error resolving address: ", "STUNAddressResolutionFailed"),
            ("WebRTC: Unable to SetRemoteDescription:", "remoteDescriptionRejected"),
            ("CovertDTLS ERROR: ", "covertDTLSSetupFailed"),
            ("NewPeerConnection ERROR: ", "peerConnectionCreationFailed"),
            ("CreateDataChannel ERROR: ", "dataChannelCreationFailed"),
            ("Failed to prepare offer ", "ICEOfferCreationFailed"),
            ("Failed to apply offer ", "localDescriptionRejected")
        ]
        for (prefix, phase) in prefixes where message.hasPrefix(prefix) && message.count > prefix.count {
            fields["phase"] = phase; fields["errorDetail"] = "omitted"; return fields
        }
        // In particular: no Received answer:<SDP>, URL/front/ICE server, arbitrary WebRTC error,
        // Pion diagnostic, nonce, peer identity, or unverified DTLS handshake category is emitted.
        return nil
    }
}

/// QA observation only. Ordinary stream closure never becomes a root policy failure.
/// Each detail is independently fatal: concurrent streams may interleave records.
struct TorPublicBackendFatalLatch {
    struct Failure: Equatable {
        let kind: String
        let site: String?
        let reason: String?
        let generation: UUID
        let observedMonotonicNS: UInt64?
        let processedMonotonicNS: UInt64?
        var summary: String { [kind, site, reason].compactMap { $0 }.joined(separator: ":") }
    }
    private var generation: UUID?
    private(set) var first: Failure?
    mutating func begin(_ generation: UUID) { self.generation = generation; first = nil }
    mutating func fence() { generation = nil } // Keep first cause for the UI/receipt.
    @discardableResult
    mutating func observe(_ event: [String: Any], generation: UUID) -> Bool {
        guard self.generation == generation, first == nil,
              event["schema"] as? String == "P05_SNOWFLAKE_SAFE_PHASE_V1",
              let phase = event["phase"] as? String else { return false }
        if phase == "entryPolicyRejectionDetail", let site = event["rejectionSite"] as? String,
           let reason = event["rejectionReason"] as? String,
           let verified = SnowflakeSafePhaseRecorder.classify(Data("YNX_PUBLIC_REJECTION_V1 \(site) \(reason)".utf8)),
           verified["phase"] as? String == phase {
            first = Failure(kind: "policyRejected", site: site, reason: reason, generation: generation,
                observedMonotonicNS: event["observedMonotonicNS"] as? UInt64, processedMonotonicNS: DispatchTime.now().uptimeNanoseconds)
        } else if phase == "entryPolicyRejected" {
            first = Failure(kind: "policyRejected", site: nil, reason: nil, generation: generation,
                observedMonotonicNS: event["observedMonotonicNS"] as? UInt64, processedMonotonicNS: DispatchTime.now().uptimeNanoseconds)
        }
        return first != nil
    }
    @discardableResult
    mutating func coverageIncomplete(reason: String, generation: UUID, observedAt: UInt64, processedAt: UInt64) -> Bool {
        guard self.generation == generation, first == nil,
              ["TIME_BUDGET", "BYTE_BUDGET", "LINE_BUDGET", "EVENT_BUDGET", "PARSER_OR_PRODUCER_LIMIT"].contains(reason) else { return false }
        first = Failure(kind: "diagnosticCoverageIncomplete", site: nil, reason: reason,
            generation: generation, observedMonotonicNS: observedAt, processedMonotonicNS: processedAt)
        return true
    }

}

#endif
