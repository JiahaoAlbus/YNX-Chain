#if YNX_PRIVACY_ACCEPTANCE
import Foundation
import Darwin

/// PUBLIC DATA fixtures only; no manufactured authority, peer or NE callback.
@main struct SyntheticProviderFaultSelfTest {
    @MainActor static func main() throws {
        if CommandLine.arguments.dropFirst() == ["--owned-harmless-self-exit"] { SyntheticProviderFaultExit.terminateSelf() }
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        var checks: [String] = []
        func check(_ name: String, _ value: Bool) { precondition(value, name); checks.append(name) }
        func rejects(_ name: String, _ operation: () throws -> Void) {
            do { try operation(); preconditionFailure(name) } catch { checks.append(name) }
        }
        let hash = String(repeating: "a", count: 64), run = UUID().uuidString.lowercased()
        let profile = "synthetic-" + run
        let binding = SyntheticTrialBinding(mode: .tor, runID: run, epoch: UUID().uuidString,
            profileID: profile, profileSHA256: SyntheticProviderFaultWire.hash(Data(profile.utf8)),
            providerGeneration: UUID().uuidString, rootAuditTokenSHA256: hash, manifestSHA256: hash,
            bootstrapSHA256: hash, executableSHA256: hash)
        func request(_ operation: String = "arm", ticket: String? = nil, sequence: UInt64 = 3,
                     nonce: String = UUID().uuidString.lowercased(), pin: String? = nil,
                     bound: SyntheticTrialBinding? = nil) -> SyntheticProviderFaultRequest {
            .init(schema: "P05_SYNTHETIC_PROVIDER_SELF_FAULT_V1", operation: operation, nonce: nonce,
                  binding: bound ?? binding, routeSequence: sequence, expectedProviderSHA256: pin ?? hash, ticketID: ticket)
        }
        let q = request(), bytes = try SyntheticProviderFaultWire.encode(q)
        check("canonical-roundtrip", try SyntheticProviderFaultWire.decode(SyntheticProviderFaultRequest.self, from: bytes) == q)
        for (name, data) in [("unknown-ready", Data((String(decoding: bytes.dropLast(), as: UTF8.self) + ",\"ready\":true}").utf8)),
                             ("duplicate", Data((String(decoding: bytes.dropLast(), as: UTF8.self) + ",\"operation\":\"arm\"}").utf8)),
                             ("oversize", Data(repeating: 32, count: 8193)), ("empty", Data())] {
            rejects(name) { _ = try SyntheticProviderFaultWire.decode(SyntheticProviderFaultRequest.self, from: data) }
        }
        rejects("zero-sequence") { try SyntheticProviderFaultWire.requireRequest(request(sequence: 0), operation: "arm") }
        rejects("bad-provider-pin") { try SyntheticProviderFaultWire.requireRequest(request(pin: "true"), operation: "arm") }
        rejects("ticket-in-arm") { try SyntheticProviderFaultWire.requireRequest(request(ticket: UUID().uuidString.lowercased()), operation: "arm") }
        rejects("missing-commit-ticket") { try SyntheticProviderFaultWire.requireRequest(request("commit"), operation: "commit") }
        rejects("noncanonical-nonce") { try SyntheticProviderFaultWire.requireRequest(request(nonce: UUID().uuidString), operation: "arm") }
        check("marker-only-CFBoolean-true", SyntheticProviderFaultWire.markerEnabled(true) && !SyntheticProviderFaultWire.markerEnabled(1) && !SyntheticProviderFaultWire.markerEnabled("true") && !SyntheticProviderFaultWire.markerEnabled(false))
        let now = ContinuousClock.now, session = UUID()
        var fence = SyntheticProviderFaultFence()
        let ticket = try fence.arm(q, session: session, now: now)
        check("arm-no-effect", fence.used && !fence.committed)
        rejects("arm-never-renews") { _ = try fence.arm(q, session: session, now: now) }
        func commit(_ ticket: String, sequence: UInt64? = nil, nonce: String? = nil, pin: String? = nil,
                    bound: SyntheticTrialBinding? = nil) -> SyntheticProviderFaultRequest {
            request("commit", ticket: ticket, sequence: sequence ?? q.routeSequence, nonce: nonce ?? q.nonce, pin: pin, bound: bound)
        }
        rejects("wrong-session") { try fence.consume(commit(ticket), session: UUID(), now: now) }
        rejects("wrong-ticket") { try fence.consume(commit(UUID().uuidString.lowercased()), session: session, now: now) }
        rejects("wrong-route-sequence") { try fence.consume(commit(ticket, sequence: 4), session: session, now: now) }
        rejects("wrong-nonce") { try fence.consume(commit(ticket, nonce: UUID().uuidString.lowercased()), session: session, now: now) }
        rejects("wrong-artifact") { try fence.consume(commit(ticket, pin: String(repeating: "b", count: 64)), session: session, now: now) }
        let other = SyntheticTrialBinding(mode: .nym, runID: run, epoch: binding.epoch, profileID: profile,
            profileSHA256: binding.profileSHA256, providerGeneration: binding.providerGeneration,
            rootAuditTokenSHA256: hash, manifestSHA256: hash, bootstrapSHA256: hash, executableSHA256: hash)
        rejects("wrong-binding-mode") { try fence.consume(commit(ticket, bound: other), session: session, now: now) }
        try fence.consume(commit(ticket), session: session, now: now.advanced(by: .milliseconds(1999)))
        check("single-commit", fence.committed)
        rejects("commit-replay") { try fence.consume(commit(ticket), session: session, now: now) }
        var expired = SyntheticProviderFaultFence(); let expiredTicket = try expired.arm(q, session: session, now: now)
        rejects("exact-deadline-refused") { try expired.consume(commit(expiredTicket), session: session, now: now.advanced(by: .seconds(2))) }
        rejects("expiry-does-not-renew") { _ = try expired.arm(q, session: session, now: now) }
        var lost = SyntheticProviderFaultFence(); let lostTicket = try lost.arm(q, session: session, now: now)
        lost.connectionLost(session)
        rejects("late-after-connection-loss") { try lost.consume(commit(lostTicket), session: session, now: now) }
        rejects("connection-loss-sticky") { _ = try lost.arm(q, session: session, now: now) }
        var invalidated = SyntheticProviderFaultFence(); let invalidTicket = try invalidated.arm(q, session: session, now: now)
        invalidated.invalidate()
        rejects("sleep-stop-invalidated") { try invalidated.consume(commit(invalidTicket), session: session, now: now) }
        let intent = try SyntheticFaultCommitIntentJournal.record(in: directory, binding: binding, fault: "route-loss", commandSHA256: hash)
        let path = directory.appendingPathComponent("p05-protected-fault-\(run).intent")
        let data = try Data(contentsOf: path), value = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        check("durable-intent-not-applied", intent == SyntheticProviderFaultWire.hash(data) && value["state"] as? String == "commit-intent-not-applied" && value["faultApplied"] == nil)
        rejects("cross-fault-run-replay") { _ = try SyntheticFaultCommitIntentJournal.record(in: directory, binding: binding, fault: "provider-crash", commandSHA256: hash) }
        let link = directory.appendingPathComponent("unsafe-link", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: directory)
        rejects("symlink-directory") { _ = try SyntheticFaultCommitIntentJournal.record(in: link, binding: binding, fault: "provider-crash", commandSHA256: hash) }
        let publicDirectory = directory.appendingPathComponent("unsafe-mode", isDirectory: true)
        try FileManager.default.createDirectory(at: publicDirectory, withIntermediateDirectories: false)
        chmod(publicDirectory.path, 0o755)
        rejects("nonprivate-directory") { _ = try SyntheticFaultCommitIntentJournal.record(in: publicDirectory, binding: binding, fault: "provider-crash", commandSHA256: hash) }
        #if P05_FULL_FAULT_CLIENT_PROBE
        // Real actual factory preflight, before IPC/files. This unsigned PUBLIC
        // executable has no Team; never supplies a fake authority/NSXPC peer.
        rejects("actual-client-NoTeam-first") { try SyntheticProviderSelfFaultAttempt.preflight() }
        #endif
        print(String(decoding: try JSONSerialization.data(withJSONObject: ["checks": checks, "count": checks.count,
            "actualNE": "NOT_RUN", "signedProviderXPC": "NOT_RUN", "qualificationConstructed": false]), as: UTF8.self))
    }
}
#endif
