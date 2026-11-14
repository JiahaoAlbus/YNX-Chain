import Foundation
import CryptoKit
import Darwin
import Network

/// Independent PUBLIC A leg: direct Process, no Browser lifecycle or path-triggered stop.
/// Path changes are observations and invalidate a claim of identical A/B conditions.
@MainActor final class R2IndependentArti {
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
    var processIdentifier: Int32? { process?.processIdentifier }
    init(trace: TorPublicRuntimeTrace) { self.trace = trace }
    func start(prepared: BundledTorBackend.PreparedBackend) throws {
        guard process == nil else { throw TorPlatformError.alreadyRunning }
        let directory = prepared.directory
        let fd = open(directory.appendingPathComponent(".ynx-native-route.lock").path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        var info = stat()
        guard fd >= 0 else { throw TorPlatformError.unsafeSessionDirectory }
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
              info.st_mode & 0o077 == 0, info.st_nlink == 1, flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); throw TorPlatformError.alreadyRunning }
        lockFD = fd
        var started = false
        defer { if !started { releaseLock() } }
        let configuration = try ArtiProcessAdapter.configuration(port: SnowflakeReviewedQA.port, sessionDirectory: directory, deferBootstrap: false, bridge: nil) + "\n[bridges]\nenabled = true\n"
        let config = directory.appendingPathComponent("arti.toml")
        try configuration.write(to: config, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: config.path)
        let task = Process(), diagnostics = Pipe()
        task.executableURL = prepared.pin.executable
        task.arguments = try ["proxy", "--config", config.path, "--log-level", "info"] + SnowflakeReviewedQA.overrideArguments(prepared: prepared)
        task.environment = ["PATH": "/usr/bin:/bin", "HOME": directory.path]
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
                }
                guard self.process?.isRunning == true, self.state != .stopping else { return }
                for signal in self.parser.consume(bytes) {
                    self.trace.record("officialBootstrapSignal", ["signal": signal == .ready ? "ready" : "deferred"])
                    if signal == .ready { self.state = .bootstrapReady }
                }
            }
        }
        do { try task.run() }
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
@main struct SnowflakeReviewedQA {
    static let port: UInt16 = 63781
    static let https = "https://www.iana.org/domains/reserved"
    @MainActor static var retainedAdapter: R2IndependentArti?
    @MainActor static var retainedCurl: Process?
    @MainActor static func main() async {
        guard CommandLine.arguments.count == 3 else { exit(64) }
        let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        do {
            if CommandLine.arguments[1] == "--prepare-only" { try prepare(output); return }
            guard CommandLine.arguments[1] == "--run-prepared" else { exit(64) }
            let result = try await run(output)
            try write(result, output.appendingPathComponent("CLI-RESULT.json"))
            print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
            if result["status"] as? String == "CLEANUP_UNKNOWN" {
                // An UNKNOWN receipt ends the bounded experiment, not ownership of live children.
                while retainedAdapter?.processIdentifier != nil || retainedCurl?.isRunning == true {
                    _ = retainedAdapter?.pollProcess(); try? await Task.sleep(for: .milliseconds(250))
                }
                try write(["status": "LATE_OWNED_HANDLE_EXIT_OBSERVED", "originalOutcomeRemainsUNKNOWN": true], output.appendingPathComponent("CLI-LATE-CLEANUP.json"))
                exit(2)
            }
            exit(result["status"] as? String == "PUBLIC_HTTPS_VALIDATED" ? 0 : 1)
        } catch {
            let value = error as NSError
            let result: [String: Any] = ["status": "PREPARATION_OR_RUN_REJECTED", "domain": value.domain, "code": value.code, "noProductionAdmission": true]
            try? write(result, output.appendingPathComponent("CLI-FIRST-ERROR.json"))
            exit(2)
        }
    }
    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func write(_ value: [String: Any], _ file: URL) throws {
        try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: file, options: [.withoutOverwriting])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    @MainActor static func preparedProfile(supply: BundledTorBackend.VerifiedSupply, scratch: URL) throws -> BundledTorBackend.PreparedBackend {
        let bytes = try Data(contentsOf: supply.resourceDirectory.appendingPathComponent("public-bridges.json"))
        guard digest(bytes) == BundledTorBackend.bridgesSHA256,
              let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let bridges = value["bridges"] as? [String: Any], let lines = bridges["snowflake"] as? [String], lines.count == 2,
              digest(Data(lines[0].utf8)) == "9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f" else { throw TorPlatformError.invalidPin }
        let base = try supply.prepareProfile(applicationSupport: scratch, bridgeSource: .bundledPublic)
        let selected = ArtiProcessAdapter.BridgeConfiguration(lines: [lines[0]], transport: supply.publicBridge.transport, transportSHA256: BundledTorBackend.lyrebirdSHA256)
        return .init(pin: base.pin, directory: base.directory, bridge: selected, manifestSHA256: base.manifestSHA256)
    }
    @MainActor static func configuration(prepared: BundledTorBackend.PreparedBackend) throws -> String {
        guard prepared.bridge.lines.count == 1,
              digest(Data(prepared.bridge.lines[0].utf8)) == "9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f",
              prepared.bridge.transportSHA256 == BundledTorBackend.lyrebirdSHA256 else { throw TorPlatformError.invalidPin }
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

    @MainActor static func prepare(_ output: URL) throws {
        // The build recipe supplies only a fixed reviewed resource directory, never URL/bridge inputs.
        let resourceFile = output.appendingPathComponent("REVIEWED-RESOURCE-PATH.txt")
        let resources = URL(fileURLWithPath: try String(contentsOf: resourceFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), isDirectory: true)
        let supply = try BundledTorBackend.load(resourceDirectory: resources)
        let scratch = try ActualPublicScratch.make()
        let prepared = try preparedProfile(supply: supply, scratch: scratch)
        let config = try configuration(prepared: prepared)
        let overrides = try overrideArguments(prepared: prepared)
        let baseOnly = try ArtiProcessAdapter.configuration(port: port, sessionDirectory: prepared.directory, deferBootstrap: false, bridge: nil) + "\n[bridges]\nenabled = true\n"
        var info = stat(); guard lstat(scratch.path, &info) == 0 else { throw TorPlatformError.unsafeSessionDirectory }
        let plan: [String: Any] = ["schema": "P05_REVIEWED_SNOWFLAKE_QA_PLAN_V1", "createdAt": Date().timeIntervalSince1970,
            "scratch": scratch.path, "scratchDevice": info.st_dev, "scratchInode": info.st_ino,
            "profile": prepared.directory.path, "resources": resources.path, "port": port,
            "argvRedacted": [prepared.pin.executable.path, "proxy", "--config", prepared.directory.appendingPathComponent("arti.toml").path, "--log-level", "info", "-o", "bridges.bridges=<exact-reviewed-first-snowflake>", "-o", "bridges.transports=<fixed-snowflake-managed-contract>"],
            "artiSHA256": prepared.pin.binarySHA256, "lyrebirdSHA256": prepared.bridge.transportSHA256,
            "publicBridgesSHA256": BundledTorBackend.bridgesSHA256, "bridgeCount": prepared.bridge.lines.count, "chosenLineSHA256": "9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f",
            "configurationSHA256": digest(Data(config.utf8)),
            "configBaseOnDiskSHA256": digest(Data(baseOnly.utf8)),
            "argvOverrideJSONSHA256": digest(try JSONEncoder().encode(overrides)),
            "effectiveSemantics": "base config has no bridge endpoints; CLI -o injects only exact reviewed first line and fixed managed snowflake transport; overrides win upstream config resolution", "bootstrapDeadlineSeconds": 600, "httpsDeadlineSeconds": 30,
            "experimentDifference": "Snowflake PUBLIC backend QA only; reviewed broker/front/ICE/dynamic-peer scope; noBrowserQualification",
            "fixedHTTPS": https, "networkAtPreparation": "NOT_SAMPLED; NO_NETWORK_LEG_STARTED", "privacyAdmission": "UNCHANGED_BLOCKED"]
        try write(plan, output.appendingPathComponent("CLI-PLAN.json"))
        print(String(decoding: try JSONSerialization.data(withJSONObject: plan, options: [.sortedKeys]), as: UTF8.self))
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
    @MainActor static func run(_ output: URL) async throws -> [String: Any] {
        let plan = try JSONSerialization.jsonObject(with: Data(contentsOf: output.appendingPathComponent("CLI-PLAN.json"))) as! [String: Any]
        guard plan["schema"] as? String == "P05_REVIEWED_SNOWFLAKE_QA_PLAN_V1", plan["port"] as? Int == Int(port),
              plan["fixedHTTPS"] as? String == https, let created = plan["createdAt"] as? Double,
              (0...1800).contains(Date().timeIntervalSince1970 - created), let name = plan["scratch"] as? String,
              name.split(separator: "/").last?.hasPrefix("ynx-public-search-") == true,
              let resources = plan["resources"] as? String else { throw TorPlatformError.invalidPin }
        let scratch = name.withCString { URL(fileURLWithFileSystemRepresentation: $0, isDirectory: true, relativeTo: nil) }
        var info = stat()
        guard lstat(name, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o7777 == 0o700,
              info.st_mode & S_IFMT == S_IFDIR, NSNumber(value: info.st_dev) == plan["scratchDevice"] as? NSNumber,
              NSNumber(value: info.st_ino) == plan["scratchInode"] as? NSNumber else { throw TorPlatformError.unsafeSessionDirectory }
        let once = open(output.appendingPathComponent("RUN-ONCE").path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard once >= 0 else { throw TorPlatformError.alreadyRunning }; close(once)
        let supply = try BundledTorBackend.load(resourceDirectory: URL(fileURLWithPath: resources, isDirectory: true))
        let prepared = try preparedProfile(supply: supply, scratch: scratch)
        guard prepared.directory.path == plan["profile"] as? String,
              digest(Data(try configuration(prepared: prepared).utf8)) == plan["configurationSHA256"] as? String else { throw TorPlatformError.invalidPin }
        let currentOverrides = try overrideArguments(prepared: prepared)
        let currentBase = try ArtiProcessAdapter.configuration(port: port, sessionDirectory: prepared.directory, deferBootstrap: false, bridge: nil) + "\n[bridges]\nenabled = true\n"
        guard digest(try JSONEncoder().encode(currentOverrides)) == plan["argvOverrideJSONSHA256"] as? String,
              digest(Data(currentBase.utf8)) == plan["configBaseOnDiskSHA256"] as? String else { throw TorPlatformError.invalidPin }
        let cancellation = Cancellation()
        let trace = try TorPublicRuntimeTrace(directory: scratch, execution: .adjacentCLI)
        let adapter = R2IndependentArti(trace: trace)
        retainedAdapter = adapter
        let before = await PathSample().read()
        if let before { trace.record("comparisonNetworkBefore", try pathDictionary(before)) }
        else { trace.record("comparisonNetworkBeforeUnavailable") }
        var result: [String: Any] = ["schema": "P05_REVIEWED_SNOWFLAKE_QA_RESULT_V1", "ownerPID": getpid(), "entryTransport": "snowflake", "startWallUTC": ISO8601DateFormatter().string(from: Date()), "trace": trace.file.path, "privacyAdmission": "UNCHANGED_BLOCKED", "sameObservableIsNotProofOfSameNetwork": true, "experimentDifference": "Snowflake PUBLIC backend QA only; reviewed broker/front/ICE/dynamic-peer scope; noBrowserQualification"]
        var firstCause: String?, ready = false
        let start = ContinuousClock.now
        do {
            trace.record("controllerStage", ["stage": "backendLaunch"])
            try adapter.start(prepared: prepared)
            result["artiPID"] = adapter.processIdentifier
            trace.record("controllerStage", ["stage": "bootstrap"])
            let deadline = start.advanced(by: .seconds(600))
            var ptInitialised = false
            while ContinuousClock.now < deadline, !cancellation.requested {
                let state = adapter.pollProcess()
                ptInitialised = Self.observedPTInitialisation(trace: trace)
                if !ptInitialised && start.duration(to: .now) > .seconds(30) { firstCause = "managedPTInitNotObservedWithin30s"; break }
                if state == .bootstrapReady { ready = true; break }
                if case .exited(let code) = state { result["exitDuringBootstrap"] = code; firstCause = "backendExited"; break }
                if state == .stopping || state == .stopped { firstCause = "routeFenceOrStop"; break }
                try await Task.sleep(for: .milliseconds(100))
            }
            if !ready && firstCause == nil { firstCause = cancellation.requested ? "callerCancelled" : "bootstrapTimedOut" }
            result["bootstrapDurationSeconds"] = Double(start.duration(to: .now).components.seconds) + Double(start.duration(to: .now).components.attoseconds) / 1e18
            if ready && !cancellation.requested {
                trace.record("controllerStage", ["stage": "fixedPublicHTTPS"])
                let response = try await requestHTTPS(output: output, adapter: adapter, cancellation: cancellation)
                result["HTTPS"] = response
                if response["validated"] as? Bool != true { firstCause = "httpsValidationFailed" }
            }
        } catch {
            let value = error as NSError
            firstCause = "nativeLaunchOrObservationError"; result["errorDomain"] = value.domain; result["errorCode"] = value.code
        }
        trace.record("controllerStage", ["stage": "cleanup"])
        let stopBeforeCleanup = adapter.lastStopReason
        adapter.stop(reason: "snowflake-qa-stop")
        let cleanupDeadline = min(ContinuousClock.now.advanced(by: .seconds(25)), start.advanced(by: .seconds(648)))
        while adapter.processIdentifier != nil, ContinuousClock.now < cleanupDeadline { _ = adapter.pollProcess(); try? await Task.sleep(for: .milliseconds(100)) }
        _ = adapter.pollProcess()
        result["cleanupConfirmedForOriginalArtiHandle"] = adapter.processIdentifier == nil
        result["cleanupConfirmedForOwnedCurlHandle"] = retainedCurl?.isRunning != true
        result["managedPTReap"] = "NOT_A_DIRECT_CHILD; public incarnation observation is not waitpid"
        result["originalStopReasonBeforeCleanup"] = stopBeforeCleanup ?? "none"
        result["independentCLIPathEventCount"] = adapter.pathEvents
        result["ABNetworkConditionsNotProvenIdentical"] = true
        let after = await PathSample().read()
        if let after { trace.record("comparisonNetworkAfter", try pathDictionary(after)) }
        result["sameObservableBeforeAfter"] = before.flatMap { left in after.map { left == $0 } } as Any? ?? NSNull()
        trace.checkpoint("cliFinalCheckpoint")
        if adapter.processIdentifier != nil || retainedCurl?.isRunning == true { result["status"] = "CLEANUP_UNKNOWN" }
        else if let firstCause { result["status"] = "PUBLIC_DIAGNOSTIC_INCOMPLETE"; result["firstCause"] = firstCause }
        else { result["status"] = "PUBLIC_HTTPS_VALIDATED" }
        result["officialReadyObserved"] = ready
        result["endWallUTC"] = ISO8601DateFormatter().string(from: Date())
        return result
    }
    static func pathDictionary(_ path: TorPublicObservablePath) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(path)) as! [String: Any]
    }
    @MainActor static func requestHTTPS(output: URL, adapter: R2IndependentArti, cancellation: Cancellation) async throws -> [String: Any] {
        let body = output.appendingPathComponent("public-https.body"), metadata = output.appendingPathComponent("public-https.metadata"), errors = output.appendingPathComponent("public-https.stderr")
        for file in [body, metadata, errors] { guard FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw TorPlatformError.unsafeSessionDirectory } }
        let standard = try FileHandle(forWritingTo: metadata), error = try FileHandle(forWritingTo: errors)
        defer { try? standard.close(); try? error.close() }
        let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        task.arguments = ["--disable", "--silent", "--show-error", "--proxy", "socks5h://127.0.0.1:\(port)", "--noproxy", "", "--proto", "=https", "--connect-timeout", "20", "--max-time", "30", "--max-redirs", "0", "--max-filesize", "262144", "--output", body.path, "--write-out", "%{http_code}\n%{ssl_verify_result}\n", https]
        task.environment = ["PATH": "/usr/bin:/bin", "HOME": output.path]; task.standardInput = FileHandle.nullDevice; task.standardOutput = standard; task.standardError = error
        try task.run(); retainedCurl = task; let pid = task.processIdentifier
        defer { if !task.isRunning { retainedCurl = nil } }
        let end = ContinuousClock.now.advanced(by: .seconds(32))
        var fenced = false
        while task.isRunning, ContinuousClock.now < end {
            if cancellation.requested || adapter.pollProcess() != .bootstrapReady { fenced = true; task.terminate(); break }
            try await Task.sleep(for: .milliseconds(100))
        }
        if task.isRunning {
            task.terminate(); let deadline = ContinuousClock.now.advanced(by: .seconds(2))
            while task.isRunning, ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(50)) }
            if task.isRunning { _ = kill(pid, SIGKILL) }
            let reaped = ContinuousClock.now.advanced(by: .seconds(2))
            while task.isRunning, ContinuousClock.now < reaped { try? await Task.sleep(for: .milliseconds(50)) }
        }
        guard !task.isRunning else { return ["validated": false, "curlPID": pid, "cleanup": "UNKNOWN"] }
        let bytes = try Data(contentsOf: body), values = (try String(contentsOf: metadata, encoding: .utf8)).split(separator: "\n").map(String.init)
        return ["validated": !fenced && task.terminationStatus == 0 && values == ["200", "0"] && !bytes.isEmpty,
            "curlPID": pid, "terminationStatus": task.terminationStatus, "terminationReason": task.terminationReason == .exit ? "exit" : "uncaughtSignal", "routeFenceObserved": fenced, "httpAndTLSResult": values, "bodyBytes": bytes.count, "bodySHA256": digest(bytes), "target": https, "normalTLS": true, "forcedSOCKS5h": true]
    }
}
