
#if YNX_PRIVACY_ACCEPTANCE
// Appended to a copy of the actual adapter file only by the offline driver.
// No such fixture method exists in the Native application target.
extension ArtiProcessAdapter {
    func exercisePublicPolicyFatal(fixture: URL, session: URL) async throws -> Int32 {
        let hash = SHA256.hash(data: try Data(contentsOf: fixture)).map { String(format: "%02x", $0) }.joined()
        try start(pin: BinaryPin(executable: fixture, binarySHA256: hash,
            sourceArchiveSHA256: BundledTorBackend.sourceSHA256, version: "2.7.0"),
            port: 63786, sessionDirectory: session, deferBootstrap: true)
        guard let original = processIdentifier else { throw TorPlatformError.binaryUnavailable }
        do {
            let knownTupleAbsence = try TorPublicRuntimeTrace.fixtureOriginalPresenceObserver(original)
            guard knownTupleAbsence() == false else { throw TorPlatformError.invalidPin }
            let expected = generation
            publicPolicyFatalEnabled = true // Synthetic fixture only, no trace, role or scope authority.
            let ordinary = Data("YNX_PUBLIC_PHASE_V1 OWNER_CLOSED\nWebRTC: fixed QA entry attempt incomplete\nWebRTC: Closing\n".utf8)
            consumePublicEntryPhases(ordinary, generation: expected, receivedAt: DispatchTime.now().uptimeNanoseconds)
            guard state != .stopping, publicBackendFatal == nil else { throw TorPlatformError.invalidPin }
            let fatal = Data("YNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET NON_PUBLIC\n".utf8)
            consumePublicEntryPhases(fatal, generation: UUID(), receivedAt: DispatchTime.now().uptimeNanoseconds)
            guard state != .stopping, publicBackendFatal == nil else { throw TorPlatformError.invalidPin }
            consumePublicEntryPhases(fatal.prefix(13), generation: expected, receivedAt: DispatchTime.now().uptimeNanoseconds)
            guard state != .stopping else { throw TorPlatformError.invalidPin }
            consumePublicEntryPhases(fatal.dropFirst(13), generation: expected, receivedAt: DispatchTime.now().uptimeNanoseconds)
            guard state == .stopping, publicBackendFatal?.summary == "policyRejected:UDP_SEND_TARGET:NON_PUBLIC",
                  lastStopReason == "fixed-public-policy-rejected" else { throw TorPlatformError.invalidPin }
            // Old callback after the synchronous fence cannot resurrect readiness or overwrite cause.
            consumePublicEntryPhases(Data("YNX_PUBLIC_REJECTION_V1 NET_RESOLVE EXPIRED\n".utf8), generation: expected, receivedAt: DispatchTime.now().uptimeNanoseconds)
            guard publicBackendFatal?.reason == "NON_PUBLIC" else { throw TorPlatformError.invalidPin }
            let deadline = ContinuousClock.now.advanced(by: .seconds(16))
            while processIdentifier != nil, ContinuousClock.now < deadline { _ = pollProcess(); try await Task.sleep(for: .milliseconds(20)) }
            guard processIdentifier == nil else { throw TorPlatformError.alreadyRunning }
            guard knownTupleAbsence() == true else { throw TorPlatformError.invalidPin }
            return original // Actual direct child's original Process exit observed; no managed PT claimed.
        } catch {
            stop()
            let deadline = ContinuousClock.now.advanced(by: .seconds(16))
            while processIdentifier != nil, ContinuousClock.now < deadline { _ = pollProcess(); try? await Task.sleep(for: .milliseconds(20)) }
            throw error
        }
    }
}
extension TorPublicRuntimeTrace {
    static func fixtureOriginalPresenceObserver(_ pid: Int32) throws -> @MainActor () -> Bool? {
        guard let value = identity(pid) else { throw TorPlatformError.invalidPin }
        let tuple = ManagedIdentity(pid: pid, seconds: value.info.pbi_start_tvsec,
            microseconds: value.info.pbi_start_tvusec, path: value.path)
        // Wrong incarnation and empty inventory remain UNKNOWN; never reattach.
        let wrong = ManagedIdentity(pid: pid, seconds: tuple.seconds, microseconds: tuple.microseconds + 1, path: tuple.path)
        guard observeKnownManagedTransportAbsence([]) == nil,
              observeKnownManagedTransportAbsence([wrong]) == nil else { throw TorPlatformError.invalidPin }
        return { observeKnownManagedTransportAbsence([tuple]) }
    }
}

#endif
