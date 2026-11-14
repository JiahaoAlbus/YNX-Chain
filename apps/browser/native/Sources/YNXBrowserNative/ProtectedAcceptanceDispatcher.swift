#if YNX_PRIVACY_ACCEPTANCE
import Foundation

/// Closure evidence only. A physical child receipt and helper closure are both
/// required; this DATA predicate never grants Root, route, or replacement authority.
enum ProtectedAcceptanceCleanupEvidence {
    static func confirms(childReaped: Bool, exitPID: Int32?, cleanupChildPID: Int32?,
                         preparedPID: Int32?, helperCleanupConfirmed: Bool) -> Bool {
        guard childReaped, helperCleanupConfirmed, let exitPID, let cleanupChildPID,
              cleanupChildPID > 1, exitPID == cleanupChildPID,
              preparedPID == nil || preparedPID == cleanupChildPID else { return false }
        return true
    }
}

enum ProtectedAcceptanceInFlightEvidence {
    private struct DownloadProgress {
        let acceptedAt: UInt64
        var destinationAt: UInt64?
        var bytes: UInt64 = 0
    }

    static func confirms(_ observations: ArraySlice<[String: String]>, binding: [String: String],
                         baselineAt: UInt64, activeDownloadIDs: Set<String>) -> Bool {
        var startedAt: UInt64?
        var matchingFrames = Set<UInt64>()
        var downloads: [String: DownloadProgress] = [:]
        var ended = Set<String>()
        for item in observations {
            guard item["schema"] == "P05_PROTECTED_ACCEPTANCE_EVENT_V1",
                  binding.allSatisfy({ item[$0.key] == $0.value }),
                  let at = UInt64(item["atMonotonicNanoseconds"] ?? ""), at >= baselineAt else { continue }
            if item["kind"] == "blocked" { return false }
            if item["kind"] == "instrument", item["messageKind"] == "phase-started", item["phase"] == "baseline" {
                guard startedAt == nil else { return false }
                startedAt = at
                continue
            }
            guard let startedAt, at >= startedAt else { continue }
            if item["kind"] == "instrument", item["messageKind"] == "wss",
               item["phase"] == "baseline", item["probeID"] == "baseline-long-wss" {
                if ["closed", "rejected", "body-mismatch"].contains(item["status"] ?? "") { return false }
                if item["status"] == "body-match", let sequence = UInt64(item["frameSequence"] ?? ""),
                   (1...128).contains(sequence), let hash = item["sha256"],
                   hash.utf8.count == 64, hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) {
                    matchingFrames.insert(sequence)
                }
                continue
            }
            guard let id = item["downloadID"], activeDownloadIDs.contains(id), !ended.contains(id) else { continue }
            switch item["kind"] {
            case "download-committed", "download-failed":
                ended.insert(id); downloads.removeValue(forKey: id)
            case "download-accepted" where item["committed"] == "false":
                if downloads[id] == nil { downloads[id] = DownloadProgress(acceptedAt: at) }
            case "download-destination" where item["committed"] == "false":
                if let download = downloads[id], download.destinationAt == nil, at >= download.acceptedAt,
                   UInt64(item["generation"] ?? "") != nil { downloads[id]?.destinationAt = at }
            case "download-progress" where item["committed"] == "false":
                if let download = downloads[id], let destination = download.destinationAt, at >= destination,
                   let bytes = UInt64(item["bytes"] ?? "") { downloads[id]?.bytes = max(download.bytes, bytes) }
            default: break
            }
        }
        return matchingFrames.contains(1) && matchingFrames.contains(2) && downloads.values.contains { $0.bytes >= 16384 }
    }
}

/// Host partial ownership begins BEFORE open is awaited; no attachment is needed
/// to owe cleanup. Only the original host's confirmed close clears this debt.
@MainActor final class ProtectedAcceptanceHostCustody {
    private(set) var hasPartialOwner = false
    private var shutdown: Task<Bool, Never>?
    func beginOpening() throws {
        guard !hasPartialOwner, shutdown == nil else { throw ProtectedSyntheticWindowFailure.alreadyStarted }
        hasPartialOwner = true
    }
    func close(using closeOriginal: @escaping @MainActor () async -> Bool) async -> Bool {
        if let shutdown { return await shutdown.value }
        guard hasPartialOwner else { return true }
        let work = Task { @MainActor in await closeOriginal() }; shutdown = work
        let confirmed = await work.value
        if confirmed { hasPartialOwner = false }
        shutdown = nil
        return confirmed
    }
}

#if !YNX_SYNTHETIC_LIFECYCLE_PROBE
import AppKit
import CryptoKit
import Darwin
import WebKit
import YNXBrowserCore

@MainActor struct ProtectedAcceptanceAttachment {
    let protection: BrowserRouteProtection
    let page: RoutedBrowserPage
    let authority: SyntheticTrialAuthority
}
/// Implemented by the existing real routed Window owner. No alternate proxy/provider shell.
@MainActor protocol ProtectedAcceptanceWindowHosting: AnyObject {
    /// Actual provider/session startup; return only its real connected objects. Do not openHome.
    func openAcceptanceRoute(mode: PrivacyRouteMode, runID: String, inputs: ProtectedAcceptanceTrialInputs) async throws -> ProtectedAcceptanceAttachment
    /// Existing shutdown + provider cleanup. The dispatcher additionally verifies owned gates
    /// and authenticated remote closure; this Boolean alone never authorizes a replacement.
    func closeAcceptanceRoute() async -> Bool
}
enum ProtectedAcceptanceDispatchFailure: Error { case invalidCommand, invalidLaunch, wrongState, unavailableFault, closureUnknown, outputLimit }

/// Real test-only command dispatcher. Every target phase is explicit; no timer/recovery can
/// navigate. NoTeam/current=false is checked before input files, host creation, XPC or WebKit.
@MainActor final class ProtectedAcceptanceDispatcher {
    struct Launch {
        let mode: PrivacyRouteMode
        let manifest: URL, bootstrap: URL, command: URL
        let manifestSHA256: String, bootstrapSHA256: String
        let timeoutSeconds: UInt64
        let directory: ProtectedAcceptancePrivateInput.Directory
    }
    static func claims(_ arguments: [String]) -> Bool { arguments.dropFirst().contains { $0.hasPrefix("--p05-protected-acceptance") } }
    static func parse(_ arguments: [String]) throws -> Launch? {
        guard claims(arguments) else { return nil }
        try SyntheticTrialAuthority.signingPreflight()
        let tail = Array(arguments.dropFirst()), prefix = "--p05-protected-acceptance="
        guard tail.count == 1, tail[0].hasPrefix(prefix) else { throw ProtectedAcceptanceDispatchFailure.invalidLaunch }
        let suppliedPath = String(tail[0].dropFirst(prefix.count))
        guard suppliedPath.hasPrefix("/") else { throw ProtectedAcceptanceDispatchFailure.invalidLaunch }
        let file = URL(fileURLWithPath: suppliedPath)
        let directory = try ProtectedAcceptancePrivateInput.Directory(containing: file)
        let raw = try readPrivate(file, in: directory, maximum: 8192)
        guard let value = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
              Set(value.keys) == ["schema", "mode", "manifest", "manifestSHA256", "bootstrap", "bootstrapSHA256", "command", "timeoutSeconds"],
              value["schema"] as? String == "P05_PROTECTED_ACCEPTANCE_LAUNCH_V1",
              let modeName = value["mode"] as? String, let mode = PrivacyRouteMode(launchValue: modeName),
              Bundle.main.bundleIdentifier == mode.bundleIdentifier,
              let manifest = value["manifest"] as? String, let bootstrap = value["bootstrap"] as? String,
              let command = value["command"] as? String, let manifestSHA = value["manifestSHA256"] as? String,
              let bootstrapSHA = value["bootstrapSHA256"] as? String,
              [manifestSHA, bootstrapSHA].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
              let timeout = value["timeoutSeconds"] as? NSNumber, CFGetTypeID(timeout) != CFBooleanGetTypeID(),
              timeout.doubleValue == Double(timeout.uint64Value), (10...600).contains(timeout.uint64Value) else { throw ProtectedAcceptanceDispatchFailure.invalidLaunch }
        guard [manifest, bootstrap, command].allSatisfy({ $0.hasPrefix("/") && !$0.contains("\0") }) else { throw ProtectedAcceptanceDispatchFailure.invalidLaunch }
        let urls = [manifest, bootstrap, command].map { URL(fileURLWithPath: $0) }
        guard urls.allSatisfy({ $0.path.hasPrefix("/") && $0.standardizedFileURL == $0 && $0.deletingLastPathComponent() == file.deletingLastPathComponent() }) else { throw ProtectedAcceptanceDispatchFailure.invalidLaunch }
        return Launch(mode: mode, manifest: urls[0], bootstrap: urls[1], command: urls[2], manifestSHA256: manifestSHA, bootstrapSHA256: bootstrapSHA, timeoutSeconds: timeout.uint64Value, directory: directory)
    }
    private static func readPrivate(_ url: URL, in directory: ProtectedAcceptancePrivateInput.Directory, maximum: Int, atomicCommand: Bool = false) throws -> Data {
        do { return try directory.read(url, maximum: maximum, atomicCommand: atomicCommand) }
        catch { throw ProtectedAcceptanceDispatchFailure.invalidLaunch }
    }
    private let launch: Launch, input: ProtectedAcceptanceConsumer.Input
    private let host: any ProtectedAcceptanceWindowHosting
    private let emit: @MainActor ([String: String]) -> Void
    private var attachment: ProtectedAcceptanceAttachment?, consumer: ProtectedAcceptanceConsumer?
    private var preparation: RoutedRootPreparation?, gates: [OwnedBackendStartGate] = []
    private var closure: RootControlClosureReceipt?
    private let hostCustody = ProtectedAcceptanceHostCustody()
    private(set) var firstFailure: Error?
    private var native: [[String: String]] = []
    private var rootBinding: [String: String] = [:]
    private var sequence: UInt64 = 0, phaseSequence: UInt64 = 0, baselineIndex = 0
    private var baselineAt: UInt64?
    private var busy = false, finished = false, faultApplied = false, faultCommitIntent = false
    private var providerFaultAttempt: SyntheticProviderSelfFaultAttempt?
    private var pendingUserRequest: String?
    private var controlTask: Task<Void, Never>?
    private var terminationTask: Task<Bool, Never>?

    init(launch: Launch, hostFactory: @MainActor () throws -> any ProtectedAcceptanceWindowHosting,
         record: @escaping @MainActor ([String: String]) -> Void) throws {
        try SyntheticTrialAuthority.signingPreflight()
        self.launch = launch
        input = try ProtectedAcceptanceConsumer.Input.read(manifestURL: launch.manifest, expectedManifestSHA256: launch.manifestSHA256,
            bootstrapURL: launch.bootstrap, expectedBootstrapSHA256: launch.bootstrapSHA256, directory: launch.directory)
        host = try hostFactory(); emit = record
    }
    /// Owner installs this only after strict test-entry claim, instead of ordinary app startup.
    /// Atomic command-file replacement is allowed; SHA/sequence binds each observed command.
    func startCommandLoop() {
        guard controlTask == nil, !finished else { return }
        let end = DispatchTime.now().uptimeNanoseconds + launch.timeoutSeconds * 1_000_000_000
        controlTask = Task { @MainActor [weak self] in
            guard let self else { return }
            var lastHash = ""
            while !finished && !Task.isCancelled && DispatchTime.now().uptimeNanoseconds < end {
                do {
                    let bytes = try Self.readPrivate(launch.command, in: launch.directory, maximum: 4096, atomicCommand: true)
                    let hash = Self.hash(bytes)
                    if hash != lastHash { lastHash = hash; try await dispatch(bytes, commandSHA256: hash) }
                } catch {
                    if firstFailure == nil { firstFailure = error }
                    output("command-failed", ["effectState": faultCommitIntent ? "UNKNOWN-preserved-no-retry" : "refused-no-retry", "error": String(describing: type(of: error))])
                    await terminate(); return
                }
                try? await Task.sleep(for: .milliseconds(100)) // Read-only; never a phase trigger.
            }
            if !finished { output("deadline", ["effectState": "UNKNOWN-no-automatic-retry"]); await terminate() }
        }
    }
    private func dispatch(_ bytes: Data, commandSHA256: String) async throws {
        guard !busy, !finished, let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(value.keys) == ["schema", "runID", "sequence", "operation"], value["schema"] as? String == "P05_PROTECTED_ACCEPTANCE_COMMAND_V1",
              value["runID"] as? String == input.runID, let number = value["sequence"] as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == Double(number.uint64Value), number.uint64Value == sequence + 1,
              let operation = value["operation"] as? String else { throw ProtectedAcceptanceDispatchFailure.invalidCommand }
        busy = true; defer { busy = false }; sequence = number.uint64Value
        output("command-accepted", ["operation": operation, "commandSHA256": commandSHA256, "sequence": String(sequence)])
        switch operation {
        case "open": guard attachment == nil, consumer == nil, closure == nil else { throw ProtectedAcceptanceDispatchFailure.wrongState }; try await open()
        case "baseline":
            guard phaseSequence == 0, let consumer else { throw ProtectedAcceptanceDispatchFailure.wrongState }
            try await waitForReady(); baselineIndex = native.count; baselineAt = DispatchTime.now().uptimeNanoseconds
            try await consumer.explicitPhase("baseline", sequence: 1); phaseSequence = 1
        case "route-loss": try await routeLoss(commandSHA256: commandSHA256)
        case "provider-crash": try await providerSelfFault(commandSHA256: commandSHA256)
        case "fault-retry":
            guard faultApplied, phaseSequence == 1, let consumer else { throw ProtectedAcceptanceDispatchFailure.wrongState }
            let before = native.count
            do { try await consumer.explicitPhase("fault-retry", sequence: 2); throw ProtectedAcceptanceDispatchFailure.wrongState }
            catch let error as ProtectedAcceptanceDispatchFailure { throw error }
            catch {
                guard native.dropFirst(before).contains(where: { $0["kind"] == "phase-refused" && $0["phase"] == "fault-retry" }) else { throw error }
                phaseSequence = 2; output("fault-retry-refused", ["commandSHA256": commandSHA256])
            }
        case "close": try await closeWholeWindow()
        case "rebuild-quiet":
            guard closure != nil, attachment == nil, phaseSequence == 2 else { throw ProtectedAcceptanceDispatchFailure.wrongState }
            try await open(); output("route-rebuilt-quiet", ["targetDispatchState": "idle-no-phase", "controlState": "connected", "noAutomaticRequest": "true"])
        case "request-user-retry":
            guard closure != nil, phaseSequence == 2, pendingUserRequest == nil, let attachment else { throw ProtectedAcceptanceDispatchFailure.wrongState }
            _ = try attachment.protection.acceptanceBinding(manifestSHA256: launch.manifestSHA256, bootstrapSHA256: launch.bootstrapSHA256)
            pendingUserRequest = commandSHA256
            output("explicit-request-acknowledged", ["actionReceiptSHA256": commandSHA256, "humanClickClaimed": "false", "targetRequestDispatched": "false"])
        case "user-retry":
            guard closure != nil, phaseSequence == 2, let consumer, let request = pendingUserRequest else { throw ProtectedAcceptanceDispatchFailure.wrongState }
            pendingUserRequest = nil // A failed/UNKNOWN dispatch cannot reuse this explicit command.
            try await waitForReady(); try await consumer.explicitPhase("user-retry", sequence: 3); phaseSequence = 3
            output("explicit-user-retry", ["commandSHA256": commandSHA256, "actionReceiptSHA256": request, "humanClickClaimed": "false"])
        case "finish": await terminate()
        default: throw ProtectedAcceptanceDispatchFailure.unavailableFault // No fake WebContent crash/disable/sleep action.
        }
    }
    private func open() async throws {
        try hostCustody.beginOpening()
        do {
        let next = try await host.openAcceptanceRoute(mode: launch.mode, runID: input.runID, inputs: .init(manifestURL: launch.manifest, expectedManifestSHA256: launch.manifestSHA256, bootstrapURL: launch.bootstrap, expectedBootstrapSHA256: launch.bootstrapSHA256))
        attachment = next
        guard !finished else { next.page.block("验收已关闭。"); throw ProtectedAcceptanceDispatchFailure.wrongState }
        let held = try next.protection.acceptancePreparationForClosure()
        let tracked = next.protection.acceptanceOwnedBackendGates()
        preparation = held; gates = tracked
        rootBinding = try next.protection.acceptanceBinding(manifestSHA256: launch.manifestSHA256, bootstrapSHA256: launch.bootstrapSHA256)
        guard !tracked.isEmpty else { throw ProtectedAcceptanceDispatchFailure.wrongState }
        if let consumer, let closure { try consumer.reattachAfterObservedClosure(authority: next.authority, protection: next.protection, page: next.page, closure: closure) }
        else {
            let actual = try ProtectedAcceptanceConsumer(authority: next.authority, protection: next.protection, page: next.page, manifestURL: launch.manifest,
                expectedManifestSHA256: launch.manifestSHA256, bootstrapURL: launch.bootstrap, expectedBootstrapSHA256: launch.bootstrapSHA256,
                directory: launch.directory) { [weak self] event in
                guard let self, native.count < 4096 else { return }; native.append(event); emit(event)
            }
            consumer = actual; try actual.attach()
        }
        } catch {
            if firstFailure == nil { firstFailure = error }
            let confirmed = await hostCustody.close { [host] in await host.closeAcceptanceRoute() }
            if !confirmed { output("cleanup-unknown", ["effectState": "UNKNOWN-retain-original-no-retry"]) }
            throw firstFailure ?? error
        }
    }
    private func waitForReady() async throws {
        let end = DispatchTime.now().uptimeNanoseconds + 10_000_000_000
        while DispatchTime.now().uptimeNanoseconds < end {
            guard let attachment else { throw ProtectedAcceptanceDispatchFailure.wrongState }
            let binding = try attachment.protection.acceptanceBinding(manifestSHA256: launch.manifestSHA256, bootstrapSHA256: launch.bootstrapSHA256)
            if native.contains(where: { event in
                event["schema"] == "P05_PROTECTED_ACCEPTANCE_EVENT_V1" &&
                event["kind"] == "instrument" && event["messageKind"] == "instrument-ready" &&
                binding.allSatisfy { event[$0.key] == $0.value }
            }) { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        throw ProtectionLeaseFailure.replyTimeout
    }
    private func requireInFlightFaultState() throws -> ProtectedAcceptanceAttachment {
        guard !finished, phaseSequence == 1, !faultCommitIntent, let attachment, let baselineAt,
              consumer?.hasInFlightObservationCapacity == true, native.count < 4096 else { throw ProtectedAcceptanceDispatchFailure.wrongState }
        let binding = try attachment.protection.acceptanceBinding(manifestSHA256: launch.manifestSHA256, bootstrapSHA256: launch.bootstrapSHA256)
        guard binding == rootBinding,
              ProtectedAcceptanceInFlightEvidence.confirms(native.dropFirst(baselineIndex), binding: binding, baselineAt: baselineAt,
                                                          activeDownloadIDs: attachment.page.acceptanceInFlightDownloadIDs()),
              gates.contains(where: { $0.isRunning && $0.prepared != nil }) else { throw ProtectedAcceptanceDispatchFailure.wrongState }
        return attachment
    }
    private func routeLoss(commandSHA256: String) async throws {
        let attachment = try requireInFlightFaultState()
        faultCommitIntent = true // Local replay fence, never evidence of an applied fault.
        let intent = try SyntheticFaultCommitIntentJournal.record(in: launch.command.deletingLastPathComponent(), binding: attachment.authority.binding,
            fault: "route-loss", commandSHA256: commandSHA256)
        output("fault-commit-intent", ["fault": "route-loss", "commandSHA256": commandSHA256, "commitIntentSHA256": intent, "faultApplied": "false"])
        let before = native.count
        for gate in gates { await gate.stop() } // Actual original owner handles, never PID/name search.
        guard gates.allSatisfy(Self.cleanupComplete) else { throw ProtectedAcceptanceDispatchFailure.closureUnknown }
        var exits: [[String: String]] = []
        for gate in gates {
            guard let exit = gate.observedExit, let cleanupPID = gate.cleanupChildPID,
                  Self.cleanupComplete(gate) else { throw ProtectedAcceptanceDispatchFailure.closureUnknown }
            let code = exit.code.map { String($0) } ?? "none", signal = exit.signal.map { String($0) } ?? "none"
            let pin = gate.prepared.map { Self.hash($0.processPinJSON) } ?? "not-prepared"
            exits.append(["pid": String(exit.pid), "code": code, "signal": signal, "childReaped": "true", "preparedPinSHA256": pin,
                          "cleanupChildPID": String(cleanupPID), "helperCleanupConfirmed": "true"])
        }
        let receipt = try JSONSerialization.data(withJSONObject: ["rootBinding": rootBinding, "commandSHA256": commandSHA256, "ownedExits": exits], options: [.sortedKeys])
        output("fault-action-returned", ["fault": "route-loss", "commandSHA256": commandSHA256,
            "actionReceiptSHA256": Self.hash(receipt), "ownedExitReceiptJSON": String(decoding: receipt, as: UTF8.self), "effectState": "requires-closure-readback"])
        let until = DispatchTime.now().uptimeNanoseconds + 10_000_000_000
        while DispatchTime.now().uptimeNanoseconds < until {
            if native.dropFirst(before).contains(where: { $0["kind"] == "blocked" && $0["nativeWebViewRemoved"] == "true" }) {
                faultApplied = true
                output("fault-applied-observed", ["fault": "route-loss", "observation": "owned-children-reaped-and-native-blocked", "osPacketDrop": "NOT_OBSERVED"])
                return
            }
            try await Task.sleep(for: .milliseconds(20))
        }
        throw ProtectedAcceptanceDispatchFailure.closureUnknown // Does not manufacture a route-loss detector.
    }
    private func providerSelfFault(commandSHA256: String) async throws {
        let actual = try requireInFlightFaultState()
        let attempt = try await SyntheticProviderSelfFaultAttempt.arm(authority: actual.authority)
        providerFaultAttempt = attempt // Retain original custody even on late closure or journal failure.
        guard !finished, attachment?.authority === actual.authority else { attempt.close(); throw ProtectedAcceptanceDispatchFailure.wrongState }
        _ = try actual.authority.requireLive()
        output("fault-armed", ["fault": "provider-crash", "armReceiptSHA256": attempt.armReceiptSHA256, "faultApplied": "false"])
        faultCommitIntent = true
        try attempt.recordCommitIntent(in: launch.command.deletingLastPathComponent(), commandSHA256: commandSHA256)
        output("fault-commit-intent", ["fault": "provider-crash", "commandSHA256": commandSHA256,
            "commitIntentSHA256": attempt.commitIntentSHA256 ?? "not-recorded", "faultApplied": "false"])
        let result = await attempt.commitAndObserve()
        guard result == .transportClosedAfterCommit else {
            output("fault-closure-unknown", ["fault": "provider-crash", "outcome": result.rawValue, "faultApplied": "false",
                "effectState": "UNKNOWN-retain-original-no-retry", "firstFailure": attempt.firstFailure?.rawValue ?? "unknown"])
            throw ProtectedAcceptanceDispatchFailure.closureUnknown
        }
        faultApplied = true
        output("fault-applied-observed", ["fault": "provider-crash", "observation": "transportClosedAfterCommit",
            "providerPID": attempt.providerPID.map(String.init) ?? "not-observed", "providerWaitpid": "NOT_OBSERVED",
            "providerExited": "NOT_OBSERVED", "osPacketDrop": "NOT_OBSERVED", "productionRouteAdmission": "false"])
        // The provider's authenticated remote closure ACK is now unavailable.
        // closeWholeWindow must retain UNKNOWN; no fabricated deny-only receipt,
        // replacement epoch or automatic target retry is authorized by this event.
    }
    private func closeWholeWindow() async throws {
        guard let attachment else { throw ProtectedAcceptanceDispatchFailure.wrongState }
        attachment.page.block("受控断路验收关闭。")
        let ownerCleanup = await hostCustody.close { [host] in await host.closeAcceptanceRoute() }
        for gate in gates { await gate.stop() }
        guard ownerCleanup, let preparation, gates.allSatisfy(Self.cleanupComplete) else { throw ProtectedAcceptanceDispatchFailure.closureUnknown }
        let snapshot = attachment.page.acceptanceCloseSnapshot()
        guard snapshot["blocked"] == "true", snapshot["webViewRetained"] == "false",
              snapshot["pendingDownloads"] == "0", snapshot["pendingDownloadRetirements"] == "0",
              snapshot["savePanels"] == "0", snapshot["pendingDestinationDecisions"] == "0" else {
            throw ProtectedAcceptanceDispatchFailure.closureUnknown
        }
        let observed = try await RootClosureObserver.awaitClosed(preparation: preparation)
        closure = observed; consumer?.detach(); self.attachment = nil; self.preparation = nil; gates.removeAll()
        output("whole-window-closed", ["providerGeneration": observed.providerGeneration, "closedEpoch": observed.epoch,
            "remoteState": observed.state.rawValue, "localWebViewRetained": "false", "ownedChildrenReaped": "true", "ownedHelpersCleanupConfirmed": "true", "osCrashNoLeakProof": "NOT_RUN"])
    }
    func terminate() async {
        if let terminationTask { _ = await terminationTask.value; return }
        if finished, attachment == nil, !hostCustody.hasPartialOwner { return }
        finished = true
        let work = Task { @MainActor [self] in await performTermination() }
        terminationTask = work
        if !(await work.value) { terminationTask = nil } // Only a later explicit close retries original cleanup.
    }
    private func performTermination() async -> Bool {
        let task = controlTask; controlTask = nil; defer { task?.cancel() }
        await providerFaultAttempt?.closeAndJoin()
        if attachment != nil {
            do { try await closeWholeWindow() }
            catch { if firstFailure == nil { firstFailure = error }; output("cleanup-unknown", ["effectState": "UNKNOWN-retain-original-no-retry"]); return false }
        } else if hostCustody.hasPartialOwner {
            guard await hostCustody.close(using: { [host] in await host.closeAcceptanceRoute() }) else {
                output("cleanup-unknown", ["effectState": "UNKNOWN-retain-original-no-retry"]); return false
            }
        }
        consumer?.detach(); output("finished", ["targetVerdict": "INCOMPLETE", "productionRouteAdmission": "false"])
        return true
    }
    private func output(_ kind: String, _ detail: [String: String]) {
        emit(rootBinding.merging(detail) { _, new in new }.merging(["schema": "P05_PROTECTED_DISPATCH_EVENT_V1", "kind": kind, "runID": input.runID,
            "atMonotonicNanoseconds": String(DispatchTime.now().uptimeNanoseconds)]) { _, new in new })
    }
    private static func cleanupComplete(_ gate: OwnedBackendStartGate) -> Bool {
        let exit = gate.observedExit
        return ProtectedAcceptanceCleanupEvidence.confirms(childReaped: exit?.childReaped == true, exitPID: exit?.pid,
            cleanupChildPID: gate.cleanupChildPID, preparedPID: gate.prepared?.pid, helperCleanupConfirmed: gate.cleanupConfirmed)
    }
    private static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
}
#endif // !YNX_SYNTHETIC_LIFECYCLE_PROBE
#endif
