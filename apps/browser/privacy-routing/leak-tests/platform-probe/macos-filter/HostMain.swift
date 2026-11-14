import Foundation
import NetworkExtension
import SystemExtensions
import CryptoKit
import Darwin
import AppKit

private func privateData(_ path: String, limit: Int) throws -> Data {
    guard path.hasPrefix("/") else { throw FilterFailure.rejected("Absolute owned review path required") }
    let fd = Darwin.open(path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw FilterFailure.rejected("Review open failed: \(errno)") }
    defer { Darwin.close(fd) }
    var before = stat(), after = stat(), atPath = stat()
    guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG, before.st_uid == getuid(),
          before.st_mode & 0o022 == 0, before.st_size > 0, before.st_size <= limit
    else { throw FilterFailure.rejected("Review must be a bounded current-user owned regular non-writable file") }
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
    var bytes = Data()
    let size = Int(before.st_size)
    while bytes.count < size {
        let count = min(size - bytes.count, 16_384)
        guard let chunk = try handle.read(upToCount: count), !chunk.isEmpty, chunk.count <= count
        else { throw FilterFailure.rejected("Review ended before its observed size") }
        bytes.append(chunk)
    }
    let extra = try handle.read(upToCount: 1)
    guard extra?.isEmpty != false, fstat(fd, &after) == 0, lstat(path, &atPath) == 0,
          sameReviewFile(before, after), sameReviewFile(before, atPath)
    else { throw FilterFailure.rejected("Review changed during read") }
    return bytes
}

private func sameReviewFile(_ before: stat, _ after: stat) -> Bool {
    before.st_dev == after.st_dev && before.st_ino == after.st_ino &&
        before.st_mode == after.st_mode && before.st_uid == after.st_uid &&
        before.st_size == after.st_size &&
        before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec &&
        before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec &&
        before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec &&
        before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec
}
private func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
private func emit(_ dictionary: [String: Any]) { if let data = try? JSONSerialization.data(withJSONObject: dictionary, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) { print(text); fflush(stdout) } }
private func spin(until predicate: () -> Bool, seconds: TimeInterval = 30) throws { let until = Date().addingTimeInterval(seconds); while !predicate() && Date() < until { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }; guard predicate() else { throw FilterFailure.rejected("Bounded system operation timed out") } }

enum ReviewedFilterHostEvidence {
    enum PreferenceAction: String { case create, alreadyConfigured, refuse }
    enum ActivationState: String {
        case completed
        case pendingReboot = "pending-reboot"
        case unknown

        init(_ result: OSSystemExtensionRequest.Result) {
            switch result {
            case .completed: self = .completed
            case .willCompleteAfterReboot: self = .pendingReboot
            @unknown default: self = .unknown
            }
        }

        func receipt(result: OSSystemExtensionRequest.Result) -> [String: Any] {
            [
                "activationResult": result.rawValue,
                "activationState": rawValue,
                "acceptedByOS": self != .unknown,
                "activationCompleted": self == .completed,
                "requiresReboot": self == .pendingReboot,
                "networkAcceptance": "NOT_RUN",
                "productionRouteAdmission": false,
            ]
        }
    }

    static let filterDescription = "YNX dedicated Browser route fence"

    static func preferenceAction(
        _ configuration: NEFilterProviderConfiguration?,
        enabled: Bool,
        grade: NEFilterManager.Grade,
        description: String?,
        disablesEncryptedDNS: Bool,
        providerIdentifier: String
    ) -> PreferenceAction {
        guard !disablesEncryptedDNS else { return .refuse }
        guard let configuration else { return enabled ? .refuse : .create }
        guard configuration.filterDataProviderBundleIdentifier == providerIdentifier,
              configuration.filterSockets, !configuration.filterPackets,
              configuration.filterPacketProviderBundleIdentifier == nil,
              configuration.vendorConfiguration?.isEmpty != false,
              configuration.serverAddress == nil,
              configuration.username == nil,
              configuration.organization == nil,
              configuration.passwordReference == nil,
              configuration.identityReference == nil,
              enabled, grade == .firewall, description == filterDescription
        else { return .refuse }
        return .alreadyConfigured
    }
}

private final class Activation: NSObject, OSSystemExtensionRequestDelegate {
    var done = false, error: Error?
    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) { self.error = error; done = true }
    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        let state = ReviewedFilterHostEvidence.ActivationState(result)
        emit(state.receipt(result: result))
        if state == .unknown {
            error = FilterFailure.rejected("Unrecognized activation result")
        }
        done = true
    }
    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) { emit(["systemUserApprovalRequired": true, "provider": FilterBuild.providerIdentifier]) }
    func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties, withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction { .cancel } // Never silently replace an installed owner version.
}

private final class ReviewedController {
    let connection: NSXPCConnection
    let proxy: ScopedFilterControl
    var lost = false
    init() throws {
        guard FilterBuild.configured else { throw FilterFailure.rejected("No reviewed Developer ID team configured") }
        connection = NSXPCConnection(machServiceName: FilterBuild.service, options: .privileged)
        connection.setCodeSigningRequirement(FilterBuild.requirement(identifier: FilterBuild.providerIdentifier))
        connection.remoteObjectInterface = NSXPCInterface(with: ScopedFilterControl.self)
        guard let proxy = connection.remoteObjectProxyWithErrorHandler({ error in emit(["controlError": String(describing: error), "routeMustRemainBlocked": true]) }) as? ScopedFilterControl else { throw FilterFailure.rejected("Public NSXPC interface unavailable") }
        self.proxy = proxy
        connection.invalidationHandler = { [weak self] in self?.lost = true }; connection.interruptionHandler = { [weak self] in self?.lost = true }; connection.resume()
    }
    func invoke(_ action: (@escaping (Data?, String?) -> Void) -> Void) throws -> Data {
        var done = false, result: Data?, failure: String?
        action { data, error in result = data; failure = error; done = true }
        try spin(until: { done || self.lost }, seconds: 10)
        guard !lost, failure == nil, let result else { throw FilterFailure.rejected(failure ?? "Authenticated provider connection lost") }; return result
    }
    deinit { connection.invalidate() }
}

@main enum HostMain {
    static func main() {
        do { try run(Array(CommandLine.arguments.dropFirst())) }
        catch { emit(["error": String(describing: error), "productionRouteAdmission": false, "systemIsolationAcceptance": "NOT_RUN"]); exit(78) }
    }
    static func run(_ args: [String]) throws {
        if args == ["--self-identity"] {
            let identifier = Bundle.main.bundleIdentifier ?? "YNXFilterHost"
            let pin = try PublicIdentity.pinSelf(requirement: "identifier \"\(identifier)\"")
            print(String(data: try JSONEncoder().encode(pin), encoding: .utf8)!); return
        }
        guard let command = args.first else { emit(["commands": ["--self-identity", "--review-manifest PATH SHA256", "--activate-reviewed-provider PROVIDER_ID", "--configure-reviewed-filter PROVIDER_ID", "--serve-reviewed MANIFEST SHA256 STATE_FILE"], "automaticallyActivates": false]); return }
        if command == "--review-manifest", args.count == 3 {
            let bytes = try privateData(args[1], limit: 131072); guard digest(bytes) == args[2] else { throw FilterFailure.rejected("Review SHA256 mismatch") }
            let review = try JSONDecoder().decode(ReviewedFilterRun.self, from: bytes); try review.validate(); try review.verifyLive()
            emit(["runID": review.runID, "epoch": review.epoch, "livePinsVerified": true, "activated": false, "productionRouteAdmission": false]); return
        }
        guard FilterBuild.configured else { throw FilterFailure.rejected("Signing team is NOT_CONFIGURED; activation/configuration/control forbidden") }
        _ = try PublicIdentity.pinSelf(requirement: FilterBuild.requirement(identifier: FilterBuild.hostIdentifier))
        guard Bundle.main.bundleIdentifier == FilterBuild.hostIdentifier,
              let registeredBundle = NSRunningApplication.current.bundleURL,
              registeredBundle.resolvingSymlinksInPath() == Bundle.main.bundleURL.resolvingSymlinksInPath() else { throw FilterFailure.rejected("Separately registered LaunchServices host instance required; CLI parent responsibility is not accepted") }
        let application = NSApplication.shared; application.setActivationPolicy(.prohibited); application.finishLaunching()
        // LS association is necessary, not proof of NE source-app responsibility. Only the real
        // controlled kernel callback can validate the routed Browser's separate app audit token.
        if command == "--activate-reviewed-provider", args == [command, FilterBuild.providerIdentifier] {
            let delegate = Activation(); let request = OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: FilterBuild.providerIdentifier, queue: .main); request.delegate = delegate
            OSSystemExtensionManager.shared.submitRequest(request); try spin(until: { delegate.done }, seconds: 120); if let error = delegate.error { throw error }; return
        }
        if command == "--configure-reviewed-filter", args == [command, FilterBuild.providerIdentifier] {
            let manager = NEFilterManager.shared(); var loaded = false, failure: Error?
            manager.loadFromPreferences { error in failure = error; loaded = true }; try spin(until: { loaded }); if let failure { throw failure }
            var disablesEncryptedDNS = false
            if #available(macOS 15.0, *) {
                disablesEncryptedDNS = manager.disableEncryptedDNSSettings
            }
            switch ReviewedFilterHostEvidence.preferenceAction(
                manager.providerConfiguration, enabled: manager.isEnabled, grade: manager.grade,
                description: manager.localizedDescription, disablesEncryptedDNS: disablesEncryptedDNS,
                providerIdentifier: FilterBuild.providerIdentifier
            ) {
            case .refuse:
                throw FilterFailure.rejected("Existing owner filter configuration differs; do not overwrite")
            case .alreadyConfigured:
                emit(["configurationState": "already-configured", "configurationSaved": false,
                      "networkAcceptance": "NOT_RUN", "productionRouteAdmission": false]); return
            case .create:
                break
            }
            let configuration = NEFilterProviderConfiguration(); configuration.filterSockets = true; configuration.filterPackets = false; configuration.filterDataProviderBundleIdentifier = FilterBuild.providerIdentifier
            manager.providerConfiguration = configuration; manager.localizedDescription = ReviewedFilterHostEvidence.filterDescription; manager.grade = .firewall; manager.isEnabled = true
            var saved = false; manager.saveToPreferences { error in failure = error; saved = true }; try spin(until: { saved }); if let failure { throw failure }
            emit(["configurationState": "saved", "configurationSaved": true, "systemUserAuthorizationMayBeRequired": true,
                  "networkAcceptance": "NOT_RUN", "productionRouteAdmission": false]); return
        }
        if command == "--serve-reviewed" { throw FilterFailure.rejected("Legacy state-file permission removed; use the routed app's authenticated V2 client. Host only activates/configures the filter.") }
        throw FilterFailure.rejected("Exact reviewed command/arguments required; no system action performed")
    }
}
