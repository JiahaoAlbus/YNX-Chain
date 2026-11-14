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
        let configuration = try ArtiProcessAdapter.configuration(port: R2AdjacentCLI.port, sessionDirectory: directory, deferBootstrap: false, bridge: prepared.bridge)
        let config = directory.appendingPathComponent("arti.toml")
        try configuration.write(to: config, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: config.path)
        trace.record("controllerStage", ["stage": "configurationWritten"])
        if let binding = ArtiProcessAdapter.publicComparisonBinding(pin: prepared.pin, port: R2AdjacentCLI.port,
                directory: directory, bridge: prepared.bridge, config: configuration) {
            trace.record("fixedBackendComparisonBinding", binding)
        }
        let task = Process(), diagnostics = Pipe()
        task.executableURL = prepared.pin.executable
        task.arguments = ["proxy", "--config", config.path, "--log-level", "info"]
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
                guard self.process?.isRunning == true, self.state != .stopping else { return }
                for signal in self.parser.consume(bytes) {
                    self.trace.record("officialBootstrapSignal", ["signal": signal == .ready ? "ready" : "deferred"])
                    if signal == .ready { self.state = .bootstrapReady }
                }
            }
        }
        trace.record("controllerStage", ["stage": "artiSpawnRequested"])
        do { try task.run() }
        catch {
            diagnostics.fileHandleForReading.readabilityHandler = nil
            let failure = error as NSError
            trace.record("artiSpawnRejected", ["domain": failure.domain, "code": failure.code])
            throw error
        }
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
@main struct R2AdjacentCLI {
    static let port: UInt16 = 63780
    static let https = "https://www.iana.org/domains/reserved"
    @MainActor static var retainedAdapter: R2IndependentArti?
    @MainActor static var retainedCurl: Process?
    @MainActor static func main() async {
        guard CommandLine.arguments.count == 3 else { exit(64) }
        let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        var runFirstCause: String?
        do {
            if CommandLine.arguments[1] == "--prepare-only" {
                try recordPrepareStage(.entered)
                try prepare(output)
                return
            }
            guard CommandLine.arguments[1] == "--run-prepared" else { exit(64) }
            let result = try await run(output)
            runFirstCause = result["firstCause"] as? String
            try write(result, output.appendingPathComponent("CLI-RESULT.json"))
            print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
            if result["status"] as? String == "CLEANUP_UNKNOWN" {
                // An UNKNOWN receipt ends the bounded experiment, not ownership of live children.
                await awaitOwnedCleanup()
                try write(["status": "LATE_OWNED_HANDLE_EXIT_OBSERVED", "originalOutcomeRemainsUNKNOWN": true], output.appendingPathComponent("CLI-LATE-CLEANUP.json"))
                exit(2)
            }
            exit(result["status"] as? String == "PUBLIC_HTTPS_VALIDATED" ? 0 : 1)
        } catch {
            let value = error as NSError
            var result: [String: Any] = ["status": "PREPARATION_OR_RUN_REJECTED", "domain": value.domain, "code": value.code, "noProductionAdmission": true]
            if let runFirstCause { result["runFirstCause"] = runFirstCause }
            try? write(result, output.appendingPathComponent("CLI-FIRST-ERROR.json"))
            await awaitOwnedCleanup()
            exit(2)
        }
    }
    @MainActor private static func awaitOwnedCleanup() async {
        while retainedAdapter?.processIdentifier != nil || retainedCurl?.isRunning == true {
            _ = retainedAdapter?.pollProcess()
            try? await Task.sleep(for: .milliseconds(250))
        }
    }
    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func write(_ value: [String: Any], _ file: URL) throws {
        try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: file, options: [.withoutOverwriting])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    private enum PrepareStage: String {
        case entered = "ENTERED"
        case supplyVerified = "SUPPLY_VERIFIED"
        case profilePrepared = "PROFILE_PREPARED"
        case configValidated = "CONFIG_VALIDATED"
        case planWritten = "PLAN_WRITTEN"
    }
    private static func recordPrepareStage(_ stage: PrepareStage) throws {
        try FileHandle.standardError.write(contentsOf: Data("P05_R2_TOR_PREPARE_\(stage.rawValue)\n".utf8))
    }
    @MainActor static func prepare(_ output: URL) throws {
        // The build recipe supplies only a fixed reviewed resource directory, never URL/bridge inputs.
        let resourceFile = output.appendingPathComponent("REVIEWED-RESOURCE-PATH.txt")
        let resources = URL(fileURLWithPath: try String(contentsOf: resourceFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), isDirectory: true)
        let supply = try BundledTorBackend.load(resourceDirectory: resources)
        try recordPrepareStage(.supplyVerified)
        let scratch = try ActualPublicScratch.make()
        let prepared = try supply.prepareProfile(applicationSupport: scratch, bridgeSource: .bundledPublic)
        try recordPrepareStage(.profilePrepared)
        let config = try ArtiProcessAdapter.configuration(port: port, sessionDirectory: prepared.directory, deferBootstrap: false, bridge: prepared.bridge)
        try recordPrepareStage(.configValidated)
        var info = stat(); guard lstat(scratch.path, &info) == 0 else { throw TorPlatformError.unsafeSessionDirectory }
        let plan: [String: Any] = ["schema": "P05_R2_TOR_ADJACENT_CLI_PLAN_V1", "createdAt": Date().timeIntervalSince1970,
            "scratch": scratch.path, "scratchDevice": info.st_dev, "scratchInode": info.st_ino,
            "profile": prepared.directory.path, "resources": resources.path, "port": port,
            "argv": [prepared.pin.executable.path, "proxy", "--config", prepared.directory.appendingPathComponent("arti.toml").path, "--log-level", "info"],
            "artiSHA256": prepared.pin.binarySHA256, "lyrebirdSHA256": prepared.bridge.transportSHA256,
            "publicBridgesSHA256": BundledTorBackend.bridgesSHA256, "bridgeCount": prepared.bridge.lines.count,
            "configurationSHA256": digest(Data(config.utf8)), "bootstrapDeadlineSeconds": 600, "httpsDeadlineSeconds": 45,
            "experimentDifference": "independent-raw-Process; NWPath-observation-only; Browser-B-keeps-path-fence",
            "fixedHTTPS": https, "networkAtPreparation": "NOT_SAMPLED; NO_NETWORK_LEG_STARTED", "privacyAdmission": "UNCHANGED_BLOCKED"]
        try write(plan, output.appendingPathComponent("CLI-PLAN.json"))
        try recordPrepareStage(.planWritten)
        print(String(decoding: try JSONSerialization.data(withJSONObject: plan, options: [.sortedKeys]), as: UTF8.self))
    }
    @MainActor final class PathSample {
        var value: TorPublicObservablePath?
        func read() async -> TorPublicObservablePath? {
            let monitor = NWPathMonitor()
            // The monitor is local; its handler owns the sampler until cancellation.
            monitor.pathUpdateHandler = { [self] path in
                let observed = TorPublicObservablePath(path)
                Task { @MainActor [self] in value = observed }
            }
            monitor.start(queue: DispatchQueue(label: "com.ynx.r2.public-path-sample"))
            defer {
                monitor.pathUpdateHandler = nil
                monitor.cancel()
            }
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
        guard plan["schema"] as? String == "P05_R2_TOR_ADJACENT_CLI_PLAN_V1", plan["port"] as? Int == Int(port),
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
        let prepared = try supply.prepareProfile(applicationSupport: scratch, bridgeSource: .bundledPublic)
        guard prepared.directory.path == plan["profile"] as? String,
              digest(Data(try ArtiProcessAdapter.configuration(port: port, sessionDirectory: prepared.directory, deferBootstrap: false, bridge: prepared.bridge).utf8)) == plan["configurationSHA256"] as? String else { throw TorPlatformError.invalidPin }
        let cancellation = Cancellation()
        let trace = try TorPublicRuntimeTrace(directory: scratch, execution: .adjacentCLI)
        trace.record("controllerStage", ["stage": "supplyAndConfigurationVerified",
            "artiSHA256": prepared.pin.binarySHA256, "lyrebirdSHA256": prepared.bridge.transportSHA256,
            "publicBridgeCount": prepared.bridge.lines.count])
        let adapter = R2IndependentArti(trace: trace)
        retainedAdapter = adapter
        let before = await PathSample().read()
        if let before { trace.record("comparisonNetworkBefore", try pathDictionary(before)) }
        else { trace.record("comparisonNetworkBeforeUnavailable") }
        var result: [String: Any] = ["schema": "P05_R2_TOR_ADJACENT_CLI_RESULT_V1", "ownerPID": getpid(), "startWallUTC": ISO8601DateFormatter().string(from: Date()), "trace": trace.file.path, "privacyAdmission": "UNCHANGED_BLOCKED", "sameObservableIsNotProofOfSameNetwork": true, "experimentDifference": "independent-raw-Process; NWPath-observation-only; Browser-B-keeps-path-fence"]
        var firstCause: String?, ready = false, httpsValidated = false
        let start = ContinuousClock.now
        do {
            guard !cancellation.requested else { throw CancellationError() }
            trace.record("controllerStage", ["stage": "backendLaunch"])
            try adapter.start(prepared: prepared)
            result["artiPID"] = adapter.processIdentifier
            trace.record("controllerStage", ["stage": "bootstrap"])
            let deadline = start.advanced(by: .seconds(600))
            while ContinuousClock.now < deadline, !cancellation.requested {
                let state = adapter.pollProcess()
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
                httpsValidated = response["validated"] as? Bool == true
                trace.record("controllerStage", ["stage": "fixedPublicHTTPSCompleted",
                    "validTLSAndHTTP200": httpsValidated])
                if !httpsValidated {
                    firstCause = response["firstCause"] as? String ?? "httpsValidationFailed"
                }
            }
        } catch {
            let value = error as NSError
            firstCause = cancellation.requested || error is CancellationError ? "callerCancelled" : "nativeLaunchOrObservationError"
            result["errorDomain"] = value.domain; result["errorCode"] = value.code
        }
        if !httpsValidated && firstCause == nil {
            firstCause = cancellation.requested || Task.isCancelled ? "callerCancelled" : "httpsValidationUnconfirmed"
        }
        trace.record("controllerStage", ["stage": "cleanup"])
        let stopBeforeCleanup = adapter.lastStopReason
        adapter.stop(reason: "r2-cli-stop")
        let cleanupDeadline = ContinuousClock.now.advanced(by: .seconds(25))
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
        if let firstCause { result["firstCause"] = firstCause }
        if adapter.processIdentifier != nil || retainedCurl?.isRunning == true { result["status"] = "CLEANUP_UNKNOWN" }
        else { result["status"] = httpsValidated && firstCause == nil ? "PUBLIC_HTTPS_VALIDATED" : "PUBLIC_DIAGNOSTIC_INCOMPLETE" }
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
        task.arguments = ["--disable", "--silent", "--show-error", "--proxy", "socks5h://127.0.0.1:\(port)", "--noproxy", "", "--proto", "=https", "--connect-timeout", "20", "--max-time", "45", "--max-redirs", "0", "--max-filesize", "262144", "--output", body.path, "--write-out", "%{http_code}\n%{ssl_verify_result}\n", https]
        task.environment = ["PATH": "/usr/bin:/bin", "HOME": output.path]; task.standardInput = FileHandle.nullDevice; task.standardOutput = standard; task.standardError = error
        guard !cancellation.requested, !Task.isCancelled else {
            return ["validated": false, "firstCause": "callerCancelled", "routeFenceObserved": true]
        }
        guard adapter.pollProcess() == .bootstrapReady else {
            return ["validated": false, "firstCause": "routeFencedBeforeRequest", "routeFenceObserved": true]
        }
        try task.run(); retainedCurl = task; let pid = task.processIdentifier
        adapter.trace.record("controllerStage", ["stage": "fixedSOCKS5hRequestSpawned", "pid": pid])
        defer { if !task.isRunning { retainedCurl = nil } }
        let end = ContinuousClock.now.advanced(by: .seconds(50))
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
        guard !task.isRunning else { return ["validated": false, "curlPID": pid, "cleanup": "UNKNOWN", "firstCause": interruption ?? "curlExitUnconfirmed"] }
        // A fast curl exit can bypass the polling loop. Recheck before accepting its output.
        if interruption == nil {
            if cancellation.requested || Task.isCancelled { interruption = "callerCancelled" }
            else if adapter.pollProcess() != .bootstrapReady { interruption = "routeFencedDuringRequest" }
        }
        let fenced = interruption == "callerCancelled" || interruption == "routeFencedDuringRequest"
        var receipt: [String: Any] = ["curlPID": pid, "terminationStatus": task.terminationStatus,
            "terminationReason": task.terminationReason == .exit ? "exit" : "uncaughtSignal", "routeFenceObserved": fenced,
            "target": https, "normalTLS": true, "forcedSOCKS5h": true]
        if let interruption {
            receipt["validated"] = false
            receipt["firstCause"] = interruption
            return receipt
        }
        let bytes = try Data(contentsOf: body), values = (try String(contentsOf: metadata, encoding: .utf8)).split(separator: "\n").map(String.init)
        let failure = httpsFailure(exit: task.terminationStatus, result: values, bodyIsEmpty: bytes.isEmpty)
        receipt["validated"] = failure == nil
        receipt["firstCause"] = failure as Any? ?? NSNull()
        receipt["httpAndTLSResult"] = values
        receipt["bodyBytes"] = bytes.count
        receipt["bodySHA256"] = digest(bytes)
        return receipt
    }
    static func httpsFailure(exit: Int32, result: [String], bodyIsEmpty: Bool) -> String? {
        if exit == 60 { return "tlsVerificationFailed" }
        if exit == 35 { return "tlsHandshakeFailed" }
        if exit == 7 { return "connectFailed" }
        if exit == 97 { return "proxyHandshakeFailed" }
        if exit == 28 { return "requestTimedOutStageUnknown" }
        if exit != 0 { return "curlTransferFailed" }
        if result.count != 2 || result[1] != "0" { return "tlsResultUnverified" }
        if result[0] != "200" { return "unexpectedHTTPStatus" }
        return bodyIsEmpty ? "emptyHTTPSBody" : nil
    }
}
