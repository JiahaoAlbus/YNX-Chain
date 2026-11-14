#if YNX_PRIVACY_ACCEPTANCE
import AppKit
import CryptoKit
import Darwin
import WebKit
import YNXBrowserCore

enum ProtectedAcceptanceFailure: Error { case malformedInput, bindingChanged, stalePhase, wrongFrame, notAttached }

enum ProtectedAcceptancePrivateInput {
    private enum ReadFailure: Error { case commandReplaced }

    final class Directory {
        private let parent: URL
        private let descriptor: Int32
        private let initial: stat

        init(containing url: URL) throws {
            guard url.isFileURL, url.standardizedFileURL == url else { throw ProtectedAcceptanceFailure.malformedInput }
            let parent = url.deletingLastPathComponent()
            guard parent.resolvingSymlinksInPath() == parent else { throw ProtectedAcceptanceFailure.malformedInput }
            let fd = Darwin.open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard fd >= 0 else { throw ProtectedAcceptanceFailure.malformedInput }
            var initial = stat(), current = stat()
            guard fstat(fd, &initial) == 0, privateDirectory(initial),
                  lstat(parent.path, &current) == 0, privateDirectory(current), sameInode(initial, current) else {
                Darwin.close(fd); throw ProtectedAcceptanceFailure.malformedInput
            }
            self.parent = parent; descriptor = fd; self.initial = initial
        }
        deinit { Darwin.close(descriptor) }

        private func requireCurrent() throws {
            var current = stat()
            guard parent.resolvingSymlinksInPath() == parent, lstat(parent.path, &current) == 0,
                  privateDirectory(current), sameInode(initial, current) else { throw ProtectedAcceptanceFailure.malformedInput }
        }

        func read(_ url: URL, maximum: Int, atomicCommand: Bool = false) throws -> Data {
            guard url.isFileURL, url.standardizedFileURL == url, url.deletingLastPathComponent() == parent else {
                throw ProtectedAcceptanceFailure.malformedInput
            }
            // The bridge publishes complete commands by rename. Re-read a raced replacement
            // within the same held directory without dispatching the displaced snapshot.
            for _ in 0..<3 {
                try requireCurrent()
                do {
                    let bytes = try readLeaf(url.lastPathComponent, in: descriptor, maximum: maximum, atomicCommand: atomicCommand)
                    try requireCurrent()
                    return bytes
                } catch ReadFailure.commandReplaced { continue }
            }
            throw ProtectedAcceptanceFailure.malformedInput
        }
    }

    private static func readLeaf(_ name: String, in directory: Int32, maximum: Int, atomicCommand: Bool) throws -> Data {
        let fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard fd >= 0 else { throw ProtectedAcceptanceFailure.malformedInput }
        defer { Darwin.close(fd) }
        var before = stat()
        guard fstat(fd, &before) == 0 else { throw ProtectedAcceptanceFailure.malformedInput }
        if atomicCommand && before.st_nlink == 0 {
            var replacement = stat()
            if fstatat(directory, name, &replacement, AT_SYMLINK_NOFOLLOW) == 0,
               privateFile(replacement, maximum: maximum), !sameInode(before, replacement) { throw ReadFailure.commandReplaced }
        }
        guard privateFile(before, maximum: maximum) else { throw ProtectedAcceptanceFailure.malformedInput }
        var bytes = Data(count: Int(before.st_size))
        try bytes.withUnsafeMutableBytes { buffer in
            guard let base = buffer.baseAddress else { throw ProtectedAcceptanceFailure.malformedInput }
            var offset = 0
            while offset < buffer.count {
                let count = pread(fd, base.advanced(by: offset), buffer.count - offset, off_t(offset))
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw ProtectedAcceptanceFailure.malformedInput }
                offset += count
            }
        }
        var after = stat(), atPath = stat()
        guard fstat(fd, &after) == 0, fstatat(directory, name, &atPath, AT_SYMLINK_NOFOLLOW) == 0,
              privateFile(atPath, maximum: maximum) else { throw ProtectedAcceptanceFailure.malformedInput }
        if atomicCommand && !sameInode(before, atPath) { throw ReadFailure.commandReplaced }
        guard [after, atPath].allSatisfy({ current in
            privateFile(current, maximum: maximum) && sameInode(before, current) && current.st_size == before.st_size &&
            current.st_mtimespec.tv_sec == before.st_mtimespec.tv_sec && current.st_mtimespec.tv_nsec == before.st_mtimespec.tv_nsec &&
            current.st_ctimespec.tv_sec == before.st_ctimespec.tv_sec && current.st_ctimespec.tv_nsec == before.st_ctimespec.tv_nsec
        }) else { throw ProtectedAcceptanceFailure.malformedInput }
        return bytes
    }

    private static func privateFile(_ info: stat, maximum: Int) -> Bool {
        info.st_mode & S_IFMT == S_IFREG && info.st_uid == getuid() && info.st_nlink == 1 &&
            info.st_mode & 0o777 == 0o600 && info.st_size > 0 && info.st_size <= maximum
    }
    private static func privateDirectory(_ info: stat) -> Bool {
        info.st_mode & S_IFMT == S_IFDIR && info.st_uid == getuid() && info.st_mode & 0o777 == 0o700
    }
    private static func sameInode(_ left: stat, _ right: stat) -> Bool {
        left.st_dev == right.st_dev && left.st_ino == right.st_ino
    }
}

/// Compiled only into the separately reviewed acceptance build. No runtime flag or production
/// admission override. The existing real page/protection and their normal delegates remain in use.
@MainActor final class ProtectedAcceptanceConsumer: NSObject, WKScriptMessageHandler {
    struct Input {
        let runID: String, manifestSHA256: String, bootstrapSHA256: String, html: String
        let origins: [URL]
        static func read(manifestURL: URL, expectedManifestSHA256: String, bootstrapURL: URL, expectedBootstrapSHA256: String,
                         directory: ProtectedAcceptancePrivateInput.Directory? = nil) throws -> Input {
            guard expectedManifestSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  expectedBootstrapSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  manifestURL.deletingLastPathComponent() == bootstrapURL.deletingLastPathComponent() else { throw ProtectedAcceptanceFailure.malformedInput }
            let owner = try directory ?? ProtectedAcceptancePrivateInput.Directory(containing: manifestURL)
            let manifest = try owner.read(manifestURL, maximum: 65536)
            let bootstrap = try owner.read(bootstrapURL, maximum: 131072)
            let hash: (Data) -> String = { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() }
            guard hash(manifest) == expectedManifestSHA256, hash(bootstrap) == expectedBootstrapSHA256,
                  let html = String(data: bootstrap, encoding: .utf8),
                  let object = try JSONSerialization.jsonObject(with: manifest) as? [String: Any],
                  object["schema"] as? String == "P05_PUBLIC_NONCE_FIXTURE_V1",
                  let runID = object["runID"] as? String, runID.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil,
                  let fixture = object["publicFixture"] as? [String: Any], fixture["nonce"] as? String == runID,
                  let flow = object["acceptance"] as? [String: Any], flow["schema"] as? String == "P05_INFLIGHT_ACCEPTANCE_FLOWS_V1",
                  let rawOrigins = object["origins"] as? [String], rawOrigins.count == 2, Set(rawOrigins).count == 2,
                  fixture["origins"] as? [String] == rawOrigins,
                  let paths = flow["paths"] as? [String: String], Set(paths.keys) == ["streamDownload", "longWss", "sameOriginRedirect", "crossOriginRedirect", "downgradeRedirect"],
                  paths.values.allSatisfy({ $0.hasPrefix("/ynx-route-probe/\(runID)/") && !$0.contains("..") && !$0.contains("?") && !$0.contains("#") }) else { throw ProtectedAcceptanceFailure.malformedInput }
            let origins = try rawOrigins.map { text -> URL in
                guard let parts = URLComponents(string: text), parts.scheme == "https", parts.port == nil,
                      parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
                      parts.path.isEmpty, let host = parts.host, host.range(of: "^[a-z0-9][a-z0-9.-]*[a-z0-9]$", options: .regularExpression) != nil,
                      host.split(separator: ".").count >= 2, host.split(separator: ".").last?.allSatisfy({ $0.isLetter }) == true,
                      let url = parts.url, url.absoluteString == text else { throw ProtectedAcceptanceFailure.malformedInput }
                return url
            }
            return Input(runID: runID, manifestSHA256: expectedManifestSHA256, bootstrapSHA256: expectedBootstrapSHA256, html: html, origins: origins)
        }
    }
    static func preflight() throws {
        let team = Bundle.main.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? "NOT_CONFIGURED"
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { throw ProtectionLeaseFailure.signingNotConfigured }
        guard RoutedPlatformIsolationAdmission.current.permitsWebContent else { throw PrivacyRouteError.blocked }
    }
    private var authority: SyntheticTrialAuthority?
    private var protection: BrowserRouteProtection
    private weak var page: RoutedBrowserPage?
    private let input: Input
    private var rootBinding: [String: String]
    private var attached = false
    private var instrumentReady = false
    private var phaseSequence: UInt64 = 0, messageSequence: UInt64 = 0, recordSequence: UInt64 = 0
    private var phase = "startup"
    private var observations = 0
    var hasInFlightObservationCapacity: Bool { attached && instrumentReady && observations < 2048 }
    private let emitRecord: @MainActor ([String: String]) -> Void

    init(protection: BrowserRouteProtection, page: RoutedBrowserPage, manifestURL: URL, expectedManifestSHA256: String, bootstrapURL: URL, expectedBootstrapSHA256: String, record: @escaping @MainActor ([String: String]) -> Void) throws {
        try Self.preflight() // NoTeam/current=false before reading files or installing any handler.
        let input = try Input.read(manifestURL: manifestURL, expectedManifestSHA256: expectedManifestSHA256, bootstrapURL: bootstrapURL, expectedBootstrapSHA256: expectedBootstrapSHA256)
        let binding = try protection.acceptanceBinding(manifestSHA256: expectedManifestSHA256, bootstrapSHA256: expectedBootstrapSHA256)
        try Self.validate(binding, input: input)
        self.protection = protection; self.page = page; self.input = input; self.rootBinding = binding; emitRecord = record
        super.init()
    }
    init(authority: SyntheticTrialAuthority, protection: BrowserRouteProtection, page: RoutedBrowserPage, manifestURL: URL, expectedManifestSHA256: String, bootstrapURL: URL, expectedBootstrapSHA256: String,
         directory: ProtectedAcceptancePrivateInput.Directory? = nil, record: @escaping @MainActor ([String: String]) -> Void) throws {
        try SyntheticTrialAuthority.signingPreflight()
        _ = try authority.requireQualification()
        let input = try Input.read(manifestURL: manifestURL, expectedManifestSHA256: expectedManifestSHA256, bootstrapURL: bootstrapURL, expectedBootstrapSHA256: expectedBootstrapSHA256, directory: directory)
        guard authority.binding.runID == input.runID, authority.binding.manifestSHA256 == input.manifestSHA256,
              authority.binding.bootstrapSHA256 == input.bootstrapSHA256, authority.scope.origins == input.origins else { throw ProtectedAcceptanceFailure.bindingChanged }
        let binding = try protection.acceptanceBinding(manifestSHA256: expectedManifestSHA256, bootstrapSHA256: expectedBootstrapSHA256)
        try Self.validate(binding, input: input)
        try Self.validateAuthorityBinding(binding, authority: authority)
        self.authority = authority; self.protection = protection; self.page = page; self.input = input; rootBinding = binding; emitRecord = record
        super.init()
    }
    func attach() throws {
        guard !attached, let page else { throw ProtectedAcceptanceFailure.notAttached }
        try checkLiveBinding()
        instrumentReady = false
        page.acceptanceRecord = { [weak self] kind, values in self?.nativeRecord(kind, values) }
        do { try page.installAcceptanceBootstrap(html: input.html, baseURL: input.origins[0].appendingPathComponent("ynx-route-probe/" + input.runID + "/bootstrap").appending(queryItems: [URLQueryItem(name: "probe", value: "baseline-https")]), handler: self); attached = true; output("consumer-attached", [:]) }
        catch { page.acceptanceRecord = nil; throw error }
    }
    /// Explicit commands only. A blocked fault retry is recorded as refused and never evaluates
    /// JS. New user-retry requires reattach to a fresh real page/protection after actual closure.
    func explicitPhase(_ next: String, sequence: UInt64) async throws {
        let ordered = ["baseline", "fault-retry", "user-retry"]
        guard attached, instrumentReady, sequence == phaseSequence + 1, sequence <= 3, next == ordered[Int(sequence - 1)], let page else { throw ProtectedAcceptanceFailure.stalePhase }
        phaseSequence = sequence; phase = next
        do { try checkLiveBinding(); try await page.performAcceptancePhase(next); output("phase-dispatched", ["phase": next]) }
        catch { output("phase-refused", ["phase": next]); throw error }
    }
    func reattachAfterObservedClosure(authority nextAuthority: SyntheticTrialAuthority, protection: BrowserRouteProtection, page: RoutedBrowserPage, closure: RootControlClosureReceipt) throws {
        guard phaseSequence == 2, closure.schema == "P05_OBSERVED_CONTROL_CLOSURE_V1", closure.state == .closedDenyOnly, closure.ownerControlClosed, closure.preparationControlClosed,
              closure.runID == rootBinding["runID"], closure.epoch == rootBinding["epoch"], closure.providerGeneration == rootBinding["providerGeneration"], closure.rootAuditTokenSHA256 == rootBinding["rootAuditTokenSHA256"] else { throw ProtectedAcceptanceFailure.bindingChanged }
        guard closure.mode.rawValue == rootBinding["mode"] else { throw ProtectedAcceptanceFailure.bindingChanged }
        _ = try nextAuthority.requireQualification()
        guard nextAuthority.binding.runID == input.runID, nextAuthority.binding.manifestSHA256 == input.manifestSHA256,
              nextAuthority.binding.bootstrapSHA256 == input.bootstrapSHA256 else { throw ProtectedAcceptanceFailure.bindingChanged }
        let next = try protection.acceptanceBinding(manifestSHA256: input.manifestSHA256, bootstrapSHA256: input.bootstrapSHA256)
        try Self.validate(next, input: input)
        try Self.validateAuthorityBinding(next, authority: nextAuthority)
        guard next["mode"] == rootBinding["mode"], next["epoch"] != rootBinding["epoch"], next["rootAuditTokenSHA256"] == rootBinding["rootAuditTokenSHA256"], next["executableSHA256"] == rootBinding["executableSHA256"] else { throw ProtectedAcceptanceFailure.bindingChanged }
        detach(); authority = nextAuthority; self.protection = protection; self.page = page; rootBinding = next; messageSequence = 0; phase = "startup"
        instrumentReady = false; try attach()
    }
    func detach() { page?.removeAcceptanceHandler(); attached = false; instrumentReady = false }
    private static func validate(_ value: [String: String], input: Input) throws {
        guard Set(value.keys) == ["consumer", "mode", "runID", "epoch", "providerGeneration", "rootAuditTokenSHA256", "executableSHA256", "rootPID", "manifestSHA256", "bootstrapSHA256"],
              value["consumer"] == "BrowserRouteProtection", ["tor", "nym"].contains(value["mode"] ?? ""), value["runID"] == input.runID,
              UUID(uuidString: value["epoch"] ?? "") != nil, UUID(uuidString: value["providerGeneration"] ?? "") != nil,
              value["rootPID"] == String(getpid()), value["manifestSHA256"] == input.manifestSHA256, value["bootstrapSHA256"] == input.bootstrapSHA256,
              [value["rootAuditTokenSHA256"], value["executableSHA256"]].allSatisfy({ $0?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }) else { throw ProtectedAcceptanceFailure.bindingChanged }
    }
    private static func validateAuthorityBinding(_ value: [String: String], authority: SyntheticTrialAuthority) throws {
        let b = authority.binding
        guard value["mode"] == b.mode.rawValue, value["runID"] == b.runID, value["epoch"] == b.epoch,
              value["providerGeneration"] == b.providerGeneration, value["rootAuditTokenSHA256"] == b.rootAuditTokenSHA256,
              value["executableSHA256"] == b.executableSHA256 else { throw ProtectedAcceptanceFailure.bindingChanged }
    }
    private func checkLiveBinding() throws {
        if let authority { try authority.verify(binding: authority.binding); _ = try authority.requireLive() }
        let current = try protection.acceptanceBinding(manifestSHA256: input.manifestSHA256, bootstrapSHA256: input.bootstrapSHA256)
        guard current == rootBinding else { throw ProtectedAcceptanceFailure.bindingChanged }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard attached, message.name == "p05Acceptance", message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https", message.frameInfo.securityOrigin.host == input.origins[0].host,
              [0, 443].contains(message.frameInfo.securityOrigin.port), let body = message.body as? [String: Any], body["runID"] as? String == input.runID,
              Set(body.keys).isSubset(of: ["runID", "sequence", "phase", "kind", "probeID", "status", "bytes", "frameSequence", "sha256", "candidateType", "addressFamily"]),
              let sequence = body["sequence"] as? NSNumber, CFGetTypeID(sequence) != CFBooleanGetTypeID(), sequence.doubleValue == Double(sequence.uint64Value), sequence.uint64Value == messageSequence + 1,
              let eventPhase = body["phase"] as? String, eventPhase == phase,
              let kind = body["kind"] as? String, ["instrument-ready", "phase-started", "https", "wss", "download", "ws", "rtc", "ice"].contains(kind), observations < 2048 else { return }
        guard kind == "instrument-ready" ? (eventPhase == "startup" && sequence.uint64Value == 1 && !instrumentReady) : (eventPhase != "startup" && instrumentReady) else { return }
        var sanitized = ["phase": eventPhase, "messageKind": kind]
        if let id = body["probeID"] { guard let id = id as? String, id.hasPrefix(eventPhase + "-"), id.range(of: "^(baseline|fault-retry|user-retry)-(https|long-wss|stream-download|redirect-same|redirect-cross|redirect-http|cross-origin|plain-ws)$", options: .regularExpression) != nil else { return }; sanitized["probeID"] = id }
        for key in ["bytes", "frameSequence"] where body[key] != nil {
            guard let number = body[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == Double(number.uint64Value), number.uint64Value <= (key == "bytes" ? 8_388_608 : 128) else { return }; sanitized[key] = number.stringValue
        }
        for (key, allowed) in ["status": ["body-match", "body-mismatch", "rejected", "closed", "opened", "requested-not-completion", "unavailable", "offer-created"], "candidateType": ["host", "srflx", "prflx", "relay", "unknown"], "addressFamily": ["ipv4", "ipv6", "mdns", "unknown"]] where body[key] != nil {
            guard let value = body[key] as? String, allowed.contains(value) else { return }; sanitized[key] = value
        }
        if let hash = body["sha256"] { guard let hash = hash as? String, hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return }; sanitized["sha256"] = hash }
        // No raw host/IP, URL, file path or arbitrary message text can cross this boundary.
        messageSequence = sequence.uint64Value; observations += 1
        if kind == "instrument-ready" { instrumentReady = true }
        output("instrument", sanitized)
    }
    private func nativeRecord(_ kind: String, _ values: [String: String]) {
        guard ["download-accepted", "download-progress", "download-destination", "download-redirect", "download-committed", "download-failed", "blocked"].contains(kind), observations < 2048 else { return }
        var safe: [String: String] = [:]
        for (key, value) in values {
            switch key {
            case "downloadID": guard UUID(uuidString: value) != nil else { return }
            case "generation", "bytes": guard let integer = UInt64(value), integer <= 1 << 50 else { return }
            case "committed", "crossOrigin", "nativeWebViewRemoved": guard ["true", "false"].contains(value) else { return }
            case "policy": guard ["allow", "cancel"].contains(value) else { return }
            case "scheme": guard ["https", "http", "blob", "other"].contains(value) else { return }
            case "sha256": guard value == "not-observed" || value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return }
            default: return
            }; safe[key] = value
        }
        observations += 1; output(kind, safe)
    }
    private func output(_ kind: String, _ detail: [String: String]) {
        recordSequence &+= 1
        emitRecord(rootBinding.merging(detail) { _, new in new }.merging(["schema": "P05_PROTECTED_ACCEPTANCE_EVENT_V1", "recordSequence": String(recordSequence), "kind": kind, "atMonotonicNanoseconds": String(DispatchTime.now().uptimeNanoseconds)]) { _, new in new })
    }
}
#endif
