
#if YNX_PRIVACY_ACCEPTANCE
// Appended to the actual private adapter's copied file by the offline driver.
// These fixture-only members are absent from every application target.
extension ArtiProcessAdapter {
    func exerciseCoverageBoundary(fixture: URL, session: URL, producerLimit: Bool) async throws -> Int32 {
        let hash = SHA256.hash(data: try Data(contentsOf: fixture)).map { String(format: "%02x", $0) }.joined()
        try start(pin: BinaryPin(executable: fixture, binarySHA256: hash,
            sourceArchiveSHA256: BundledTorBackend.sourceSHA256, version: "2.7.0"),
            port: 63786, sessionDirectory: session, deferBootstrap: true)
        guard let original = processIdentifier else { throw TorPlatformError.invalidPin }
        var firstError: Error?
        do {
            let expected = generation
            publicPolicyFatalEnabled = true // This copied fixture never supplies authority/trace/targets.
            let payload = producerLimit ? "YNX_PUBLIC_PHASE_V1 LIMIT_REACHED\n" : String(repeating: "YNX_PUBLIC_PHASE_V1 OWNER_CLOSED\n", count: 256)
            let receivedAt = DispatchTime.now().uptimeNanoseconds
            consumePublicEntryPhases(Data(payload.utf8), generation: expected, receivedAt: receivedAt)
            let laterFatal = Data("YNX_PUBLIC_PHASE_V1 OWNER_CLOSED\nYNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET NON_PUBLIC\n".utf8)
            #if P05_LEGACY_COVERAGE_RED
            // Actual old parser has already stopped returning events, so this
            // genuine fixed-policy line no longer reaches the old fatal latch.
            consumePublicEntryPhases(laterFatal, generation: expected, receivedAt: DispatchTime.now().uptimeNanoseconds)
            guard publicEntryPhases.truncated, publicBackendFatal == nil, state != .stopping,
                  process?.isRunning == true else { throw TorPlatformError.invalidPin }
            #else
            guard let first = publicBackendFatal, first.kind == "diagnosticCoverageIncomplete",
                  first.reason == (producerLimit ? "PARSER_OR_PRODUCER_LIMIT" : "EVENT_BUDGET"),
                  first.generation == expected, first.observedMonotonicNS == receivedAt,
                  (first.processedMonotonicNS ?? 0) >= receivedAt,
                  state == .stopping, generation != expected,
                  lastStopReason == "fixed-public-coverage-incomplete",
                  publicEntryPhases.summary["monitoringCoverageAvailable"] as? Bool == false else { throw TorPlatformError.invalidPin }
            if !producerLimit {
                guard publicEntryPhases.emittedEvents == 256, !publicEntryPhases.truncated else { throw TorPlatformError.invalidPin }
            }
            // Exactly256 is already fenced, before a257th benign event/fatal.
            // No independent event or trace write is necessary for this fence.
            consumePublicEntryPhases(laterFatal, generation: expected, receivedAt: DispatchTime.now().uptimeNanoseconds)
            guard publicBackendFatal == first, state != .bootstrapReady else { throw TorPlatformError.invalidPin }
            #endif
        } catch { firstError = error }
        // Original Process cleanup on every assertion path; no managed PT claim.
        stop(reason: "explicit-stop")
        let end = ContinuousClock.now.advanced(by: .seconds(16))
        while processIdentifier != nil, ContinuousClock.now < end { _ = pollProcess(); try? await Task.sleep(for: .milliseconds(20)) }
        guard processIdentifier == nil else { throw TorPlatformError.alreadyRunning }
        if let firstError { throw firstError }
        return original
    }
}
#endif
