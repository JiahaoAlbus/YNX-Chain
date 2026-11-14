import Foundation
import CryptoKit
import Darwin
import Network
import CoreFoundation

enum PublicArtiRuntimeVariant: Equatable, Sendable { case baseline, channelTimeoutThirtySeconds }

/// Compiled byte/source pins for the same derived artifact used by the Browser
/// V2. An Info flag alone cannot choose a binary, source, URL or permission.
@MainActor enum PublicArtiChannelTimeoutCLIArtifact {
    static let binarySHA256 = "e76e9049e5a7becf2be31683879d42851a386d985e2bd86ef73e1459ea8e68f6"
    static let sourceSHA256 = "a72764db4438ec7b4132307bc98932225183e9bdeb1b677731c08ad307d27270"
    static func read(_ url: URL, limit: Int) throws -> Data {
        let fd = open(url.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw TorPlatformError.invalidPin }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? handle.close() }
        var before = stat(), after = stat()
        guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
              before.st_uid == getuid(), before.st_nlink == 1, before.st_mode & 0o022 == 0,
              before.st_size >= 0, before.st_size <= limit else { throw TorPlatformError.invalidPin }
        var result = Data()
        while result.count <= limit {
            let block = try handle.read(upToCount: min(16_384, limit + 1 - result.count)) ?? Data()
            if block.isEmpty { break }; result.append(block)
        }
        guard result.count <= limit, result.count == Int(before.st_size), fstat(fd, &after) == 0,
              before.st_dev == after.st_dev, before.st_ino == after.st_ino, before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec else { throw TorPlatformError.invalidPin }
        return result
    }
    static func marked() throws -> Bool {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "YNXPublicArtiChannelTimeoutExperiment") else { return false }
        guard let flag = raw as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID() else { throw TorPlatformError.invalidPin }
        return flag.boolValue
    }
    static func executable(variant: PublicArtiRuntimeVariant, baseline: ArtiProcessAdapter.BinaryPin) throws -> URL {
        if variant == .baseline {
            guard try !marked() else { throw TorPlatformError.invalidPin }
            return baseline.executable
        }
        guard Bundle.main.bundleIdentifier == "com.ynxweb4.browser.qa.tor.public-search.r2-cli", try marked(),
              let resources = Bundle.main.resourceURL else { throw TorPlatformError.invalidPin }
        let directory = resources.appendingPathComponent("ChannelTimeoutQA", isDirectory: true)
        let bytes = try read(directory.appendingPathComponent("manifest.json"), limit: 16_384)
        guard let manifest = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(manifest.keys) == Set(["schema", "artiSHA256", "sourceInputsSHA256", "baseArtiSHA256", "baseSourceArchiveSHA256", "nonDirectSeconds", "directSeconds"]),
              try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys, .withoutEscapingSlashes]) == bytes,
              manifest["schema"] as? String == "P05_DERIVED_ARTI_PUBLIC_CHANNEL_TIMEOUT_ARTIFACT_V1",
              manifest["artiSHA256"] as? String == binarySHA256, manifest["sourceInputsSHA256"] as? String == sourceSHA256,
              manifest["baseArtiSHA256"] as? String == BundledTorBackend.artiSHA256,
              manifest["baseSourceArchiveSHA256"] as? String == BundledTorBackend.sourceSHA256,
              integer(manifest["nonDirectSeconds"]) == 30, integer(manifest["directSeconds"]) == 5 else { throw TorPlatformError.invalidPin }
        let executable = directory.appendingPathComponent("ArtiPublicChannelTimeout30")
        guard FileManager.default.isExecutableFile(atPath: executable.path),
              SuccessorPublicQA.digest(try read(executable, limit: 64 * 1024 * 1024)) == binarySHA256 else { throw TorPlatformError.invalidPin }
        return executable
    }
    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              !["d", "f"].contains(String(cString: number.objCType)) else { return nil }
        return number.intValue
    }
}

/// Independent PUBLIC A leg: direct Process, no Browser lifecycle or path-triggered stop.
/// Path changes are observations and invalidate a claim of identical A/B conditions.
@MainActor final class SuccessorIndependentArti {
    let trace: TorPublicRuntimeTrace
    private var process: Process?
    private var pipe: Pipe?
    private var parser = ArtiBootstrapSignalParser()
    private var entryPhases = SnowflakeSafePhaseRecorder()
    private var monitor: NWPathMonitor?
    private var initialPath = false
    private var lockFD: Int32 = -1
    private var stopTask: Task<Void, Never>?
    private(set) var state: ArtiProcessAdapter.State = .stopped
    private(set) var lastStopReason: String?
    private(set) var pathEvents = 0
    private(set) var diagnosticFailure: String?
    var processIdentifier: Int32? { process?.processIdentifier }
    init(trace: TorPublicRuntimeTrace) { self.trace = trace }
    func start(prepared: BundledTorBackend.PreparedBackend, variant: PublicArtiRuntimeVariant = .baseline) throws {
        guard process == nil else { throw TorPlatformError.alreadyRunning }
        let executable = try PublicArtiChannelTimeoutCLIArtifact.executable(variant: variant, baseline: prepared.pin)
        let directory = prepared.directory
        let fd = open(directory.appendingPathComponent(".ynx-native-route.lock").path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        var info = stat()
        guard fd >= 0 else { throw TorPlatformError.unsafeSessionDirectory }
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
              info.st_mode & 0o077 == 0, info.st_nlink == 1, flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); throw TorPlatformError.alreadyRunning }
        lockFD = fd
        var started = false
        defer { if !started { releaseLock() } }
        let configuration = try ArtiProcessAdapter.configuration(port: SuccessorPublicQA.port, sessionDirectory: directory, deferBootstrap: false, bridge: nil) + "\n[bridges]\nenabled = true\n"
        let config = directory.appendingPathComponent("arti.toml")
        try configuration.write(to: config, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: config.path)
        let task = Process(), diagnostics = Pipe()
        task.executableURL = executable
        task.arguments = try ["proxy", "--config", config.path, "--log-level", "info"] + SuccessorPublicQA.overrideArguments(prepared: prepared)
        task.environment = SuccessorPublicQA.environment(profile: directory)
        task.currentDirectoryURL = directory; task.standardInput = FileHandle.nullDevice
        task.standardOutput = FileHandle.nullDevice; task.standardError = diagnostics
        diagnostics.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData, ingress = DispatchTime.now().uptimeNanoseconds
            guard !bytes.isEmpty else {
                handle.readabilityHandler = nil
                Task { @MainActor [weak self] in self?.trace.record("stderrEOF", capturedAt: ingress) }
                return
            }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.trace.stderr(bytes, capturedAt: ingress)
                for fields in self.entryPhases.consume(bytes, at: ingress) {
                    self.trace.record("snowflakeEntryPhase", fields, capturedAt: ingress)
                    if let phase = fields["phase"] as? String,
                       ["entryPolicyRejected", "entryPolicyRejectionDetail", "entryArgsRejected", "entryDialRejected"].contains(phase), self.diagnosticFailure == nil {
                        self.diagnosticFailure = "verifiedBackendPolicyFatal"
                        self.stop(reason: "fixed-public-policy-rejected")
                    }
                }
                if self.entryPhases.monitoringCoverageFailure(at: ingress) != nil, self.diagnosticFailure == nil {
                    self.diagnosticFailure = "diagnosticCoverageIncomplete"
                    self.trace.record("diagnosticCoverageIncomplete", ["independentCLI": true])
                    self.stop(reason: "fixed-public-coverage-incomplete")
                }
                guard self.process?.isRunning == true, self.state != .stopping else { return }
                for signal in self.parser.consume(bytes) {
                    self.trace.record("officialBootstrapSignal", ["signal": signal == .ready ? "ready" : "deferred"])
                    if signal == .ready { self.state = .bootstrapReady }
                }
            }
        }
        do {
            guard try PublicArtiChannelTimeoutCLIArtifact.executable(variant: variant, baseline: prepared.pin) == executable else { throw TorPlatformError.invalidPin }
            try task.run()
        }
        catch { diagnostics.fileHandleForReading.readabilityHandler = nil; throw error }
        process = task; pipe = diagnostics; state = .processRunningOnly; started = true
        trace.launched(pid: task.processIdentifier, transport: prepared.bridge.transport)
        trace.record("independentCLIProcessIdentity", ["pid": task.processIdentifier, "pgid": getpgid(task.processIdentifier), "session": getsid(task.processIdentifier)])
        trace.record("independentCLIExperiment", ["rawProcessNoBrowserLifecycle": true, "NWPathObservationOnly": true, "notProductFenceRelaxation": true])
        let monitor = NWPathMonitor(); self.monitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            let value = TorPublicObservablePath(path), ingress = DispatchTime.now().uptimeNanoseconds
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.pathEvents += 1
                self.trace.path(value, baselineAlreadySet: self.initialPath, capturedAt: ingress)
                if value.status == "satisfied" { self.initialPath = true }
                self.trace.record("independentCLIPathObservation", ["noAutomaticBrowserStop": true, "ABConditionsNotProvenIdentical": true])
            }
        }
        monitor.start(queue: DispatchQueue(label: "com.ynx.r2.independent-public-cli-path"))
    }
    func pollProcess() -> ArtiProcessAdapter.State {
        trace.observeManagedTransport()
        if let task = process, !task.isRunning {
            trace.record("exitObserved", ["pid": task.processIdentifier, "terminationStatus": task.terminationStatus,
                "terminationReason": task.terminationReason == .exit ? "exit" : "uncaughtSignal", "lastStopReason": lastStopReason ?? "none"])
            trace.checkpoint("exitStderrCheckpoint")
            trace.record("snowflakeEntryPhaseCoverage", entryPhases.summary)
            state = .exited(task.terminationStatus); process = nil
            pipe?.fileHandleForReading.readabilityHandler = nil; pipe = nil
            monitor?.cancel(); monitor = nil; releaseLock()
        }
        return state
    }
    func stop(reason: String) {
        trace.record("stopRequested", ["reason": reason, "processRunning": process?.isRunning == true, "independentCLI": true])
        guard stopTask == nil, let task = process, task.isRunning else { _ = pollProcess(); return }
        lastStopReason = reason; state = .stopping; monitor?.cancel(); monitor = nil
        trace.record("interruptRequested", ["pid": task.processIdentifier, "signal": "SIGINT", "reason": reason])
        task.interrupt()
        stopTask = Task { @MainActor [self, task] in
            defer { stopTask = nil }
            let end = ContinuousClock.now.advanced(by: .seconds(12))
            while task.isRunning, ContinuousClock.now < end { try? await Task.sleep(for: .milliseconds(100)) }
            if task.isRunning, process === task {
                trace.record("killRequested", ["pid": task.processIdentifier, "signal": "SIGKILL", "afterSeconds": 12])
                _ = kill(task.processIdentifier, SIGKILL)
            }
            _ = pollProcess()
        }
    }
    private func releaseLock() {
        if lockFD >= 0 { _ = flock(lockFD, LOCK_UN); close(lockFD); lockFD = -1 }
    }
}

/// Fixed PUBLIC experiment. This fixture has no Root/Auth/NE/production admission.
@main struct SuccessorPublicQA {
    static let port: UInt16 = 63782
    static let successorSHA256 = "8d072f55417245ac63abad63d04a4c89590dc99d62f53b7e1373418539645922"
    @MainActor static var helper: URL?
    static let https = "https://www.iana.org/domains/reserved"
    static let ddg = "https://html.duckduckgo.com/html/?q=YNX%20browser"
    static var fixedTargets: [String] { [https, ddg] }
    @MainActor static var retainedAdapter: SuccessorIndependentArti?
    @MainActor static var retainedCurl: Process?
    @MainActor static func main() async {
        guard CommandLine.arguments.count == 3 else { exit(64) }
        let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        do {
            if CommandLine.arguments[1] == "--offline-sampler-controls" { try await offlineSamplerControls(output); return }
            if CommandLine.arguments[1] == "--offline-launch-controls" { try offlineLaunchControls(output); return }
            if CommandLine.arguments[1] == "--prepare-only" {
                try recordPrepareStage(.entered)
                helper = try verifiedHelper(output)
                try recordPrepareStage(.helperVerified)
                try prepare(output)
                return
            }
            helper = try verifiedHelper(output)
            if CommandLine.arguments[1] == "--seal-scope-only" { try await sealScope(output); return }
            let variant: PublicArtiRuntimeVariant
            if CommandLine.arguments[1] == "--run-prepared" { variant = .baseline }
            else if CommandLine.arguments[1] == "--run-channel-timeout-prepared" { variant = .channelTimeoutThirtySeconds }
            else { exit(64) }
            let result = try await run(output, variant: variant)
            exit(try await finishRun(result, output: output))
        } catch {
            let value = error as NSError
            let result: [String: Any] = ["status": "PREPARATION_OR_RUN_REJECTED", "domain": value.domain, "code": value.code, "noProductionAdmission": true]
            try? write(result, output.appendingPathComponent("CLI-FIRST-ERROR.json"))
            exit(2)
        }
    }

    @MainActor static func finishRun(_ result: [String: Any], output: URL) async throws -> Int32 {
        let status = result["status"] as? String
        func drainOwnedHandles() async {
            while retainedAdapter?.processIdentifier != nil || retainedCurl?.isRunning == true {
                _ = retainedAdapter?.pollProcess()
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        do {
            try write(result, output.appendingPathComponent("CLI-RESULT.json"))
            print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
        } catch {
            // Preserve the publication error after the original handles have exited.
            await drainOwnedHandles()
            throw error
        }
        if status == "CLEANUP_UNKNOWN" {
            await drainOwnedHandles()
            try write(["status": "LATE_OWNED_HANDLE_EXIT_OBSERVED", "originalOutcomeRemainsUNKNOWN": true], output.appendingPathComponent("CLI-LATE-CLEANUP.json"))
            return 2
        }
        return status == "PUBLIC_HTTPS_VALIDATED" || status == "PUBLIC_SEARCH_WEBSITE_RESPONSE_OBSERVED" ? 0 : 1
    }

    static func environment(profile: URL) -> [String: String] {
        var result = ["PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C",
            "YNX_PUBLIC_ENTRY_QA_ROLE": "tor-fixed-public-backend",
            "YNX_PUBLIC_ENTRY_QA_PROFILE_HOME": profile.path]
        if let originalHome = ProcessInfo.processInfo.environment["HOME"] { result["HOME"] = originalHome }
        return result
    }
    @MainActor static func verifiedHelper(_ output: URL) throws -> URL {
        let name = try String(contentsOf: output.appendingPathComponent("SUCCESSOR-HELPER-PATH.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let url = URL(fileURLWithPath: name)
        var info = stat()
        guard name.hasPrefix("/"), lstat(name, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
            info.st_uid == getuid(), FileManager.default.isExecutableFile(atPath: name),
            digest(try Data(contentsOf: url)) == successorSHA256 else { throw TorPlatformError.invalidPin }
        return url
    }
    /// The fixed helper invokes the same real loader then closes without any PT
    /// socket setup. Scope is prepared separately by the original parent producer.
    @MainActor static func sealScope(_ output: URL) async throws {
        let name = try String(contentsOf: output.appendingPathComponent("CLI-PROFILE-PATH.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let profile = URL(fileURLWithPath: name)
        let state = profile.appendingPathComponent("scope-check-state", isDirectory: true)
        try FileManager.default.createDirectory(at: state, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var env = environment(profile: profile)
        env["TOR_PT_STATE_LOCATION"] = state.path; env["TOR_PT_CLIENT_TRANSPORTS"] = "snowflake"
        env["TOR_PT_EXIT_ON_STDIN_CLOSE"] = "1"; env["TOR_PT_SERVER_TRANSPORTS"] = ""; env["TOR_PT_PROXY"] = ""
        let task = Process(), bytes = Pipe()
        task.executableURL = helper; task.arguments = ["-checkScopeOnly"]; task.environment = env
        task.standardInput = FileHandle.nullDevice; task.standardOutput = bytes; task.standardError = FileHandle.nullDevice
        try task.run()
        try bytes.fileHandleForWriting.close()
        let deadline = ContinuousClock.now.advanced(by: .seconds(8))
        while task.isRunning && ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(10)) }
        if task.isRunning {
            task.terminate()
            let stopEnd = ContinuousClock.now.advanced(by: .seconds(2))
            while task.isRunning && ContinuousClock.now < stopEnd { try? await Task.sleep(for: .milliseconds(10)) }
            if task.isRunning { _ = kill(task.processIdentifier, SIGKILL) }
            while task.isRunning { try? await Task.sleep(for: .milliseconds(100)) } // retain exact owner if OS exit is late
            throw TorPlatformError.invalidPin
        }
        let raw = bytes.fileHandleForReading.readDataToEndOfFile()
        guard task.terminationStatus == 0, raw.count <= 4096,
            let value = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
            value["schema"] as? String == "P05_PUBLIC_ENTRY_QA_SCOPE_CHECK_V1",
            value["scopeValidated"] as? Bool == true, value["network"] as? String == "NOT_RUN" else { throw TorPlatformError.invalidPin }
        let scope = try Data(contentsOf: profile.appendingPathComponent(".ynx-public-entry-qa-scope.json"))
        let planBytes = try Data(contentsOf: output.appendingPathComponent("CLI-PLAN.json"))
        let plan = try JSONSerialization.jsonObject(with: planBytes) as! [String: Any]
        let scopeInput = try JSONSerialization.jsonObject(with: scope) as! [String: Any]
        guard let runID = plan["runID"] as? String, scopeInput["runID"] as? String == runID,
            plan["profile"] as? String == profile.path, plan["fixedTargets"] as? [String] == fixedTargets else { throw TorPlatformError.invalidPin }
        try write(["schema": "P05_SUCCESSOR_SCOPE_SEAL_V1", "scopeSHA256": digest(scope), "helperSHA256": successorSHA256,
            "runID": runID, "profile": profile.path, "planSHA256": digest(planBytes), "fixedTargets": fixedTargets, "fixedMethod": "GET", "loaderPID": task.processIdentifier, "loaderExit": task.terminationStatus,
            "network": "NOT_RUN", "notAnAuthority": true], output.appendingPathComponent("SCOPE-SEALED.json"))
    }

    // Cancellation and budget are local effect guards, never route qualification.
    static func requireBackendEffect(cancelled: Bool, remaining: Duration) throws {
        guard !cancelled, remaining >= .seconds(49) else { throw TorPlatformError.invalidPin }
    }
    static func offlineLaunchControls(_ output: URL) throws {
        var records: [[String: Any]] = []
        for (name, cancelled, seconds, expected) in [("cancelled-after-await", true, 650, false), ("expired", false, 0, false), ("cleanup-reserve", false, 48, false), ("active-budget", false, 49, true)] {
            var launches = 0
            do { try requireBackendEffect(cancelled: cancelled, remaining: .seconds(seconds)); launches += 1 } catch { }
            guard (launches == 1) == expected else { throw TorPlatformError.invalidPin }
            records.append(["case": name, "effectCounter": launches, "expected": expected])
        }
        try write(["schema": "P05_SUCCESSOR_OFFLINE_EFFECT_CONTROLS_V1", "status": "PASS", "records": records, "ProcessRun": "NOT_RUN", "network": "NOT_RUN"], output.appendingPathComponent("OFFLINE-LAUNCH-CONTROLS.json"))
    }

    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func write(_ value: [String: Any], _ file: URL) throws {
        try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: file, options: [.withoutOverwriting])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    @MainActor static func preparedProfile(supply: BundledTorBackend.VerifiedSupply, scratch: URL) throws -> BundledTorBackend.PreparedBackend {
        guard let helper else { throw TorPlatformError.invalidPin }
        let bytes = try Data(contentsOf: supply.resourceDirectory.appendingPathComponent("public-bridges.json"))
        guard digest(bytes) == BundledTorBackend.bridgesSHA256,
              let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let bridges = value["bridges"] as? [String: Any], let lines = bridges["snowflake"] as? [String], lines.count == 2,
              digest(Data(lines[0].utf8)) == "9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f" else { throw TorPlatformError.invalidPin }
        let base = try supply.prepareProfile(applicationSupport: scratch, bridgeSource: .bundledPublic)
        let selected = ArtiProcessAdapter.BridgeConfiguration(lines: [lines[0]], transport: helper, transportSHA256: successorSHA256)
        return .init(pin: base.pin, directory: base.directory, bridge: selected, manifestSHA256: base.manifestSHA256)
    }
    @MainActor static func configuration(prepared: BundledTorBackend.PreparedBackend) throws -> String {
        guard prepared.bridge.lines.count == 1,
              digest(Data(prepared.bridge.lines[0].utf8)) == "9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f",
              prepared.bridge.transportSHA256 == successorSHA256 else { throw TorPlatformError.invalidPin }
        func quote<T: Encodable>(_ value: T) throws -> String {
            let encoder = JSONEncoder(); encoder.outputFormatting = .withoutEscapingSlashes
            return String(decoding: try encoder.encode(value), as: UTF8.self)
        }
        // Dedicated reviewed QA only. Production BridgeConfiguration still accepts obfs4 only.
        return try ArtiProcessAdapter.configuration(port: port, sessionDirectory: prepared.directory, deferBootstrap: false, bridge: nil)
            + "\n[bridges]\nenabled = true\nbridges = " + quote(prepared.bridge.lines)
            + "\n[[bridges.transports]]\nprotocols = [\"snowflake\"]\npath = " + quote(prepared.bridge.transport.path)
            + "\narguments = []\nrun_on_startup = true\n"
    }
    @MainActor static func overrideArguments(prepared: BundledTorBackend.PreparedBackend) throws -> [String] {
        _ = try configuration(prepared: prepared) // exact reviewed line and fixed vendor guard
        let encoder = JSONEncoder(); encoder.outputFormatting = .withoutEscapingSlashes
        let lines = String(decoding: try encoder.encode(prepared.bridge.lines), as: UTF8.self)
        let path = String(decoding: try encoder.encode(prepared.bridge.transport.path), as: UTF8.self)
        return ["-o", "bridges.bridges=" + lines, "-o", "bridges.transports=[{protocols=[\"snowflake\"],path=" + path + ",arguments=[],run_on_startup=true}]"]
    }
    @MainActor static func observedPTInitialisation(trace: TorPublicRuntimeTrace) -> Bool {
        guard let bytes = try? Data(contentsOf: trace.file), bytes.count <= 512 * 1024 else { return false }
        return String(decoding: bytes, as: UTF8.self).contains("PT binary initialisation done")
    }

    private enum PrepareStage: String {
        case entered = "ENTERED"
        case helperVerified = "HELPER_VERIFIED"
        case supplyVerified = "SUPPLY_VERIFIED"
        case derivedArtifactVerified = "DERIVED_ARTIFACT_VERIFIED"
        case profilePrepared = "PROFILE_PREPARED"
        case planWritten = "PLAN_WRITTEN"
    }

    private static func recordPrepareStage(_ stage: PrepareStage) throws {
        // Write immediately to the owner's stderr pipe, even if the next phase stalls.
        try FileHandle.standardError.write(contentsOf: Data("P05_PUBLIC_PREPARE_\(stage.rawValue)\n".utf8))
    }

    @MainActor static func prepare(_ output: URL) throws {
        // The build recipe supplies only a fixed reviewed resource directory, never URL/bridge inputs.
        let resourceFile = output.appendingPathComponent("REVIEWED-RESOURCE-PATH.txt")
        let resources = URL(fileURLWithPath: try String(contentsOf: resourceFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), isDirectory: true)
        let supply = try BundledTorBackend.load(resourceDirectory: resources)
        try recordPrepareStage(.supplyVerified)
        if try PublicArtiChannelTimeoutCLIArtifact.marked() {
            _ = try PublicArtiChannelTimeoutCLIArtifact.executable(variant: .channelTimeoutThirtySeconds, baseline: supply.pin)
            try recordPrepareStage(.derivedArtifactVerified)
        }
        let scratch = try ActualPublicScratch.make()
        let prepared = try preparedProfile(supply: supply, scratch: scratch)
        try recordPrepareStage(.profilePrepared)
        let config = try configuration(prepared: prepared)
        let overrides = try overrideArguments(prepared: prepared)
        let baseOnly = try ArtiProcessAdapter.configuration(port: port, sessionDirectory: prepared.directory, deferBootstrap: false, bridge: nil) + "\n[bridges]\nenabled = true\n"
        var info = stat(); guard lstat(scratch.path, &info) == 0 else { throw TorPlatformError.unsafeSessionDirectory }
        let plan: [String: Any] = ["schema": "P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V1", "runID": UUID().uuidString.lowercased(), "createdAt": Date().timeIntervalSince1970,
            "scratch": scratch.path, "scratchDevice": info.st_dev, "scratchInode": info.st_ino,
            "profile": prepared.directory.path, "resources": resources.path, "port": port,
            "argvRedacted": [prepared.pin.executable.path, "proxy", "--config", prepared.directory.appendingPathComponent("arti.toml").path, "--log-level", "info", "-o", "bridges.bridges=<exact-reviewed-first-snowflake>", "-o", "bridges.transports=<fixed-snowflake-managed-contract>"],
            "artiSHA256": prepared.pin.binarySHA256, "lyrebirdSHA256": prepared.bridge.transportSHA256,
            "publicBridgesSHA256": BundledTorBackend.bridgesSHA256, "bridgeCount": prepared.bridge.lines.count, "chosenLineSHA256": "9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f",
            "configurationSHA256": digest(Data(config.utf8)),
            "configBaseOnDiskSHA256": digest(Data(baseOnly.utf8)),
            "argvOverrideJSONSHA256": digest(try JSONEncoder().encode(overrides)),
            "effectiveSemantics": "base config has no bridge endpoints; CLI -o injects only exact reviewed first line and fixed managed snowflake transport; overrides win upstream config resolution", "bootstrapDeadlineSeconds": 600, "httpsDeadlineSeconds": 20,
            "experimentDifference": "Snowflake PUBLIC backend QA only; closed numeric map + NEW QA successor guard; noBrowserQualification; no network authorization from this file",
            "fixedHTTPS": https, "fixedTargets": fixedTargets, "fixedMethod": "GET", "networkAtPreparation": "NOT_SAMPLED; NO_NETWORK_LEG_STARTED", "privacyAdmission": "UNCHANGED_BLOCKED"]
        try prepared.directory.path.write(to: output.appendingPathComponent("CLI-PROFILE-PATH.txt"), atomically: false, encoding: .utf8)
        try write(plan, output.appendingPathComponent("CLI-PLAN.json"))
        try recordPrepareStage(.planWritten)
        print(String(decoding: try JSONSerialization.data(withJSONObject: plan, options: [.sortedKeys]), as: UTF8.self))
    }
    /// Keep the exact sampler alive across its callback/await lifetime; an observed
    /// path still does not prove that unobserved network properties are unchanged.
    @MainActor static func retainedRead<S: AnyObject, V>(_ sample: S, read: @MainActor (S) async -> V) async -> V {
        let value = await read(sample)
        return withExtendedLifetime(sample) { value }
    }
    @MainActor final class SamplerProbe { }
    @MainActor static func offlineSamplerControls(_ output: URL) async throws {
        var previous: SamplerProbe? = SamplerProbe()
        weak var oldWeak = previous
        previous = nil
        await Task.yield()
        guard oldWeak == nil else { throw TorPlatformError.invalidPin }
        weak var positiveWeak: SamplerProbe?
        let observed: Bool = await retainedRead(SamplerProbe()) { sample in
            positiveWeak = sample
            let callback = Task { @MainActor [weak sample] in await Task.yield(); return sample != nil }
            return await callback.value
        }
        await Task.yield()
        guard observed, positiveWeak == nil else { throw TorPlatformError.invalidPin }
        try write(["schema": "P05_SUCCESSOR_OFFLINE_SAMPLER_CONTROLS_V1", "status": "PASS",
            "oldWeakTemporaryGone": true, "retainedReadCallbackSawSameObject": observed,
            "objectReleasedAfterReturn": positiveWeak == nil, "NWPath": "NOT_RUN", "network": "NOT_RUN"],
            output.appendingPathComponent("OFFLINE-SAMPLER-CONTROLS.json"))
    }

    @MainActor final class PathSample {
        var value: TorPublicObservablePath?
        func read() async -> TorPublicObservablePath? {
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { [weak self] path in
                let observed = TorPublicObservablePath(path)
                Task { @MainActor [weak self] in self?.value = observed }
            }
            monitor.start(queue: DispatchQueue(label: "com.ynx.r2.public-path-sample"))
            defer { monitor.cancel() }
            for _ in 0..<40 { if value != nil { return value }; try? await Task.sleep(for: .milliseconds(50)) }
            return value
        }
    }
    @MainActor final class Cancellation {
        var requested = false
        var sources: [DispatchSourceSignal] = []
        init() {
            for number in [SIGINT, SIGTERM] {
                _ = Darwin.signal(number, SIG_IGN)
                let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
                source.setEventHandler { [weak self] in Task { @MainActor [weak self] in self?.requested = true } }
                source.resume(); sources.append(source)
            }
        }
    }
    @MainActor static func run(_ output: URL, variant: PublicArtiRuntimeVariant = .baseline) async throws -> [String: Any] {
        let start = ContinuousClock.now
        let plan = try JSONSerialization.jsonObject(with: Data(contentsOf: output.appendingPathComponent("CLI-PLAN.json"))) as! [String: Any]
        let schema = variant == .baseline ? "P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V1" : "P05_SUCCESSOR_SNOWFLAKE_QA_PLAN_V2"
        let artiSHA256 = variant == .baseline ? BundledTorBackend.artiSHA256 : PublicArtiChannelTimeoutCLIArtifact.binarySHA256
        guard plan["schema"] as? String == schema, plan["port"] as? Int == Int(port),
              // This independent CLI runtime is the original Arti baseline.
              // A separately derived Browser experiment plan cannot silently
              // execute FBB here merely because its PT/scope fields match.
              plan["artiSHA256"] as? String == artiSHA256,
              plan["fixedHTTPS"] as? String == https, plan["fixedTargets"] as? [String] == fixedTargets, plan["fixedMethod"] as? String == "GET", let created = plan["createdAt"] as? Double,
              (0...1800).contains(Date().timeIntervalSince1970 - created), let name = plan["scratch"] as? String,
              name.split(separator: "/").last?.hasPrefix("ynx-public-search-") == true,
              let resources = plan["resources"] as? String else { throw TorPlatformError.invalidPin }
        let scratch = name.withCString { URL(fileURLWithFileSystemRepresentation: $0, isDirectory: true, relativeTo: nil) }
        var info = stat()
        guard lstat(name, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o7777 == 0o700,
              info.st_mode & S_IFMT == S_IFDIR, NSNumber(value: info.st_dev) == plan["scratchDevice"] as? NSNumber,
              NSNumber(value: info.st_ino) == plan["scratchInode"] as? NSNumber else { throw TorPlatformError.unsafeSessionDirectory }
        let supply = try BundledTorBackend.load(resourceDirectory: URL(fileURLWithPath: resources, isDirectory: true))
        let selectedArti = try PublicArtiChannelTimeoutCLIArtifact.executable(variant: variant, baseline: supply.pin)
        if variant == .channelTimeoutThirtySeconds {
            guard plan["artiVariant"] as? String == "non-direct-channel-30s",
                  plan["artiSourceInputsSHA256"] as? String == PublicArtiChannelTimeoutCLIArtifact.sourceSHA256,
                  (plan["argvRedacted"] as? [String])?.first == selectedArti.path else { throw TorPlatformError.invalidPin }
        }
        let once = open(output.appendingPathComponent("RUN-ONCE").path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard once >= 0 else { throw TorPlatformError.alreadyRunning }; close(once)
        let prepared = try preparedProfile(supply: supply, scratch: scratch)
        guard prepared.directory.path == plan["profile"] as? String,
              digest(Data(try configuration(prepared: prepared).utf8)) == plan["configurationSHA256"] as? String else { throw TorPlatformError.invalidPin }
        let currentOverrides = try overrideArguments(prepared: prepared)
        let currentBase = try ArtiProcessAdapter.configuration(port: port, sessionDirectory: prepared.directory, deferBootstrap: false, bridge: nil) + "\n[bridges]\nenabled = true\n"
        guard digest(try JSONEncoder().encode(currentOverrides)) == plan["argvOverrideJSONSHA256"] as? String,
              digest(Data(currentBase.utf8)) == plan["configBaseOnDiskSHA256"] as? String else { throw TorPlatformError.invalidPin }
        let scopeBytes = try Data(contentsOf: prepared.directory.appendingPathComponent(".ynx-public-entry-qa-scope.json"))
        let scopeInput = try JSONSerialization.jsonObject(with: scopeBytes) as! [String: Any]
        let nowNano = Date().timeIntervalSince1970 * 1e9
        guard let planDeadline = scopeInput["planDeadlineUnixNano"] as? NSNumber,
            let mapDeadline = scopeInput["mappingExpiresUnixNano"] as? NSNumber,
            min(planDeadline.doubleValue, mapDeadline.doubleValue) > nowNano + 35e9 else { throw TorPlatformError.invalidPin }
        let seal = try JSONSerialization.jsonObject(with: Data(contentsOf: output.appendingPathComponent("SCOPE-SEALED.json"))) as! [String: Any]
        guard digest(scopeBytes) == seal["scopeSHA256"] as? String, successorSHA256 == seal["helperSHA256"] as? String, seal["runID"] as? String == scopeInput["runID"] as? String, seal["runID"] as? String == plan["runID"] as? String, seal["profile"] as? String == prepared.directory.path, seal["planSHA256"] as? String == digest(try Data(contentsOf: output.appendingPathComponent("CLI-PLAN.json"))), seal["fixedTargets"] as? [String] == fixedTargets, seal["fixedMethod"] as? String == "GET" else { throw TorPlatformError.invalidPin }
        let remainingScopeNanos = Int64(min(planDeadline.doubleValue, mapDeadline.doubleValue) - nowNano)
        let scopeRunDeadline = min(start.advanced(by: .seconds(650)), ContinuousClock.now.advanced(by: .nanoseconds(remainingScopeNanos)))
        let cancellation = Cancellation()
        let trace = try TorPublicRuntimeTrace(directory: scratch, execution: .adjacentCLI)
        let adapter = SuccessorIndependentArti(trace: trace)
        retainedAdapter = adapter
        let before = await retainedRead(PathSample()) { await $0.read() }
        if let before { trace.record("comparisonNetworkBefore", try pathDictionary(before)) }
        else { trace.record("comparisonNetworkBeforeUnavailable") }
        var result: [String: Any] = ["schema": "P05_SUCCESSOR_SNOWFLAKE_QA_RESULT_V1", "ownerPID": getpid(), "entryTransport": "snowflake", "startWallUTC": ISO8601DateFormatter().string(from: Date()), "trace": trace.file.path, "privacyAdmission": "UNCHANGED_BLOCKED", "sameObservableIsNotProofOfSameNetwork": true, "experimentDifference": "Snowflake PUBLIC backend QA only; closed numeric map + NEW QA successor guard; noBrowserQualification; no network authorization from this file"]
        result["artiSHA256"] = artiSHA256
        result["artiVariant"] = variant == .baseline ? "original-fbb" : "non-direct-channel-30s"
        if variant == .channelTimeoutThirtySeconds { result["artiSourceInputsSHA256"] = PublicArtiChannelTimeoutCLIArtifact.sourceSHA256 }
        var firstCause: String?, ready = false
        do {
            trace.record("controllerStage", ["stage": "backendLaunch"])
            try requireBackendEffect(cancelled: cancellation.requested, remaining: ContinuousClock.now.duration(to: scopeRunDeadline))
            try adapter.start(prepared: prepared, variant: variant)
            result["artiPID"] = adapter.processIdentifier
            trace.record("controllerStage", ["stage": "bootstrap"])
            let deadline = min(start.advanced(by: .seconds(600)), scopeRunDeadline.advanced(by: .seconds(-25)))
            var ptInitialised = false
            var ptAbsenceRecorded = false
            while ContinuousClock.now < deadline, !cancellation.requested {
                let state = adapter.pollProcess()
                ptInitialised = Self.observedPTInitialisation(trace: trace)
                if !ptInitialised && !ptAbsenceRecorded && start.duration(to: .now) > .seconds(30) {
                    ptAbsenceRecorded = true
                    trace.record("managedPTInitLogNotObservedAt30s", ["logAbsenceIsNotPTFailure": true, "continueBoundedBootstrap": true])
                }
                if state == .bootstrapReady { ready = true; break }
                if case .exited(let code) = state { result["exitDuringBootstrap"] = code; firstCause = "backendExited"; break }
                if state == .stopping || state == .stopped { firstCause = adapter.diagnosticFailure ?? "routeFenceOrStop"; break }
                try await Task.sleep(for: .milliseconds(100))
            }
            if !ready && firstCause == nil { firstCause = cancellation.requested ? "callerCancelled" : "bootstrapTimedOut" }
            result["bootstrapDurationSeconds"] = Double(start.duration(to: .now).components.seconds) + Double(start.duration(to: .now).components.attoseconds) / 1e18
            if ready && !cancellation.requested && ContinuousClock.now.advanced(by: .seconds(49)) < scopeRunDeadline {
                trace.record("controllerStage", ["stage": "fixedPublicHTTPS"])
                if variant == .channelTimeoutThirtySeconds {
                    let response = try await requestHTTPS(output: output, adapter: adapter, cancellation: cancellation, target: .ddg)
                    result["DDG"] = response
                    let transport = response["transportObserved"] as? Bool == true
                    result["searchTransportObserved"] = transport
                    result["searchWebsiteState"] = response["websiteState"] ?? "UNREACHABLE"
                    if !transport { firstCause = response["firstCause"] as? String ?? "fixedSearchTransportFailed" }
                    result["IANA"] = ["state": "NOT_RUN", "reason": "sameFixedDDGComparisonOnly"]
                } else {
                let response = try await requestHTTPS(output: output, adapter: adapter, cancellation: cancellation)
                result["HTTPS"] = response
                if response["validated"] as? Bool != true { firstCause = response["firstCause"] as? String ?? "httpsValidationFailed" }
                else if !cancellation.requested && ContinuousClock.now.advanced(by: .seconds(49)) < scopeRunDeadline {
                    result["DDG"] = try await requestHTTPS(output: output, adapter: adapter, cancellation: cancellation, target: .ddg)
                } else { result["DDG"] = ["state": "NOT_RUN", "reason": "insufficientTimeOrCancellation"] }
                }
            } else if ready && firstCause == nil { firstCause = "insufficientRemainingHTTPSAndCleanupBudget" }
        } catch {
            let value = error as NSError
            firstCause = "nativeLaunchOrObservationError"; result["errorDomain"] = value.domain; result["errorCode"] = value.code
        }
        if firstCause == nil, let failure = adapter.diagnosticFailure { firstCause = failure }
        trace.record("controllerStage", ["stage": "cleanup"])
        let stopBeforeCleanup = adapter.lastStopReason
        adapter.stop(reason: "snowflake-qa-stop")
        let cleanupDeadline = min(ContinuousClock.now.advanced(by: .seconds(25)), scopeRunDeadline.advanced(by: .seconds(-2)))
        while adapter.processIdentifier != nil, ContinuousClock.now < cleanupDeadline { _ = adapter.pollProcess(); try? await Task.sleep(for: .milliseconds(100)) }
        _ = adapter.pollProcess()
        result["cleanupConfirmedForOriginalArtiHandle"] = adapter.processIdentifier == nil
        result["cleanupConfirmedForOwnedCurlHandle"] = retainedCurl?.isRunning != true
        result["managedPTReap"] = "NOT_A_DIRECT_CHILD; public incarnation observation is not waitpid"
        result["originalStopReasonBeforeCleanup"] = stopBeforeCleanup ?? "none"
        result["independentCLIPathEventCount"] = adapter.pathEvents
        result["ABNetworkConditionsNotProvenIdentical"] = true
        let after = await retainedRead(PathSample()) { await $0.read() }
        if let after { trace.record("comparisonNetworkAfter", try pathDictionary(after)) }
        result["sameObservableBeforeAfter"] = before.flatMap { left in after.map { left == $0 } } as Any? ?? NSNull()
        trace.checkpoint("cliFinalCheckpoint")
        if adapter.processIdentifier != nil || retainedCurl?.isRunning == true { result["status"] = "CLEANUP_UNKNOWN" }
        else if let firstCause { result["status"] = "PUBLIC_DIAGNOSTIC_INCOMPLETE"; result["firstCause"] = firstCause }
        else { result["status"] = variant == .baseline ? "PUBLIC_HTTPS_VALIDATED" : "PUBLIC_SEARCH_WEBSITE_RESPONSE_OBSERVED" }
        result["officialReadyObserved"] = ready
        result["endWallUTC"] = ISO8601DateFormatter().string(from: Date())
        return result
    }
    static func pathDictionary(_ path: TorPublicObservablePath) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(path)) as! [String: Any]
    }
    enum FixedTarget { case iana, ddg }
    @MainActor static func requestHTTPS(output: URL, adapter: SuccessorIndependentArti, cancellation: Cancellation, target: FixedTarget = .iana) async throws -> [String: Any] {
        let fixedURL = target == .iana ? https : ddg
        let absentWebsite = target == .ddg ? "UNREACHABLE" : "NOT_APPLICABLE"
        func failed(_ cause: String, fenced: Bool) -> [String: Any] {
            ["firstCause": cause, "routeFenceObserved": fenced, "transportObserved": false,
             "validated": false, "websiteState": absentWebsite]
        }
        let stem = target == .iana ? "public-https" : "public-ddg"
        let body = output.appendingPathComponent(stem+".body"), metadata = output.appendingPathComponent(stem+".metadata"), errors = output.appendingPathComponent(stem+".stderr")
        for file in [body, metadata, errors] { guard FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw TorPlatformError.unsafeSessionDirectory } }
        let standard = try FileHandle(forWritingTo: metadata), error = try FileHandle(forWritingTo: errors)
        defer { try? standard.close(); try? error.close() }
        let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        task.arguments = ["--disable", "--silent", "--show-error", "--proxy", "socks5h://127.0.0.1:\(port)", "--noproxy", "", "--proto", "=https", "--connect-timeout", "15", "--max-time", "20", "--max-redirs", "0", "--max-filesize", "262144", "--output", body.path, "--write-out", "%{http_code}\n%{ssl_verify_result}\n", fixedURL]
        task.environment = environment(profile: URL(fileURLWithPath: try String(contentsOf: output.appendingPathComponent("CLI-PROFILE-PATH.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))); task.standardInput = FileHandle.nullDevice; task.standardOutput = standard; task.standardError = error
        guard !cancellation.requested, !Task.isCancelled else { return failed("callerCancelled", fenced: true) }
        guard adapter.pollProcess() == .bootstrapReady else { return failed("routeFencedBeforeRequest", fenced: true) }
        try task.run(); retainedCurl = task; let pid = task.processIdentifier
        defer { if !task.isRunning { retainedCurl = nil } }
        let end = ContinuousClock.now.advanced(by: .seconds(22))
        var interruption: String?
        while task.isRunning, ContinuousClock.now < end {
            if cancellation.requested || Task.isCancelled { interruption = "callerCancelled"; break }
            if adapter.pollProcess() != .bootstrapReady { interruption = "routeFencedDuringRequest"; break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        if task.isRunning {
            if interruption == nil { interruption = "curlExitDeadlineExpired" }
            task.terminate(); let deadline = ContinuousClock.now.advanced(by: .seconds(2))
            while task.isRunning, ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(50)) }
            if task.isRunning { _ = kill(pid, SIGKILL) }
            let reaped = ContinuousClock.now.advanced(by: .seconds(2))
            while task.isRunning, ContinuousClock.now < reaped { try? await Task.sleep(for: .milliseconds(50)) }
        }
        guard !task.isRunning else {
            var receipt = failed(interruption ?? "curlExitUnconfirmed", fenced: interruption != "curlExitDeadlineExpired")
            receipt["curlPID"] = pid; receipt["cleanup"] = "UNKNOWN"
            return receipt
        }
        if interruption == nil {
            if cancellation.requested || Task.isCancelled { interruption = "callerCancelled" }
            else if adapter.pollProcess() != .bootstrapReady { interruption = "routeFencedDuringRequest" }
        }
        var receipt: [String: Any] = ["curlPID": pid, "terminationStatus": task.terminationStatus,
            "terminationReason": task.terminationReason == .exit ? "exit" : "uncaughtSignal",
            "target": fixedURL, "normalTLS": true, "forcedSOCKS5h": true]
        if let interruption {
            receipt.merge(failed(interruption, fenced: interruption != "curlExitDeadlineExpired")) { _, new in new }
            return receipt
        }
        let bytes = try Data(contentsOf: body), values = (try String(contentsOf: metadata, encoding: .utf8)).split(separator: "\n").map(String.init)
        let transportObserved = task.terminationStatus == 0 && values.count == 2 && values[1] == "0"
            && values[0].range(of: "^[1-5][0-9]{2}$", options: .regularExpression) != nil
        var websiteState = absentWebsite
        if target == .ddg && transportObserved {
            let html = String(decoding: bytes, as: UTF8.self)
            if html.contains("id=\"challenge-form\"") && html.contains("anomaly.js") { websiteState = "CAPTCHA" }
            else if values == ["200", "0"], html.range(of: #"<a\b[^>]*class=["'][^"']*\bresult__a\b"#, options: .regularExpression) != nil { websiteState = "RESULTS_OBSERVED" }
            else if let code = values.first, code == "403" || code == "418" || code == "429" { websiteState = "HTTP_REFUSED" }
            else if values == ["200", "0"] { websiteState = "NO_RESULTS_OBSERVED" }
            else { websiteState = "HTTP_RESPONSE_UNCLASSIFIED" }
        }
        receipt.merge(["websiteState": websiteState, "validated": transportObserved && values[0] == "200" && !bytes.isEmpty,
            "routeFenceObserved": false, "transportObserved": transportObserved, "httpAndTLSResult": values,
            "bodyBytes": bytes.count, "bodySHA256": digest(bytes)]) { _, new in new }
        return receipt
    }
}
