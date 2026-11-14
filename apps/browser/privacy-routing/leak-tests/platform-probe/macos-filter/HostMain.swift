import Foundation
import NetworkExtension
import SystemExtensions
import CryptoKit
import Darwin
import AppKit

private func privateData(_ path: String, limit: Int) throws -> Data {
    guard path.hasPrefix("/") else { throw FilterFailure.rejected("Absolute owned review path required") }
    let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { throw FilterFailure.rejected("Review open failed: \(errno)") }; defer { close(fd) }
    var info = stat(); guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_uid == getuid(), info.st_mode & 0o022 == 0, info.st_size > 0, info.st_size <= limit else { throw FilterFailure.rejected("Review must be a bounded current-user owned regular non-writable file") }
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false); let bytes = try handle.readToEnd() ?? Data(); guard bytes.count <= limit else { throw FilterFailure.rejected("Review grew beyond limit") }; return bytes
}
private func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
private func emit(_ dictionary: [String: Any]) { if let data = try? JSONSerialization.data(withJSONObject: dictionary, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) { print(text); fflush(stdout) } }
private func spin(until predicate: () -> Bool, seconds: TimeInterval = 30) throws { let until = Date().addingTimeInterval(seconds); while !predicate() && Date() < until { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }; guard predicate() else { throw FilterFailure.rejected("Bounded system operation timed out") } }

private final class Activation: NSObject, OSSystemExtensionRequestDelegate {
    var done = false, error: Error?
    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) { self.error = error; done = true }
    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) { emit(["activationResult": result.rawValue, "acceptedByOS": true, "networkAcceptance": "NOT_RUN"]); done = true }
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
            if let old = manager.providerConfiguration?.filterDataProviderBundleIdentifier, old != FilterBuild.providerIdentifier { throw FilterFailure.rejected("Existing owner filter configuration differs; do not overwrite") }
            let configuration = NEFilterProviderConfiguration(); configuration.filterSockets = true; configuration.filterPackets = false; configuration.filterDataProviderBundleIdentifier = FilterBuild.providerIdentifier
            manager.providerConfiguration = configuration; manager.localizedDescription = "YNX dedicated Browser route fence"; manager.grade = .firewall; manager.isEnabled = true
            var saved = false; manager.saveToPreferences { error in failure = error; saved = true }; try spin(until: { saved }); if let failure { throw failure }
            emit(["configurationSaved": true, "systemUserAuthorizationMayBeRequired": true, "productionRouteAdmission": false]); return
        }
        if command == "--serve-reviewed", args.count == 4 {
            let bytes = try privateData(args[1], limit: 131072); guard digest(bytes) == args[2] else { throw FilterFailure.rejected("Review SHA256 mismatch") }
            let review = try JSONDecoder().decode(ReviewedFilterRun.self, from: bytes); try review.validate(); try review.verifyLive()
            guard URL(fileURLWithPath: args[3]).deletingLastPathComponent() == URL(fileURLWithPath: args[1]).deletingLastPathComponent() else { throw FilterFailure.rejected("State file must share the owned private manifest directory") }
            let controller = try ReviewedController(); let enrolled = try controller.invoke { controller.proxy.enroll(bytes, withReply: $0) }; print(String(data: enrolled, encoding: .utf8)!); fflush(stdout)
            var previous: Data?
            while Date().timeIntervalSince1970 < review.expiresAt && !controller.lost {
                if FileManager.default.fileExists(atPath: args[3]) {
                    let state = try privateData(args[3], limit: 4096)
                    if state != previous { let value = try JSONDecoder().decode(RouteStateRequest.self, from: state); guard value.runID == review.runID, value.epoch == review.epoch else { throw FilterFailure.rejected("State file run/epoch mismatch") }; let result = try controller.invoke { controller.proxy.routeState(state, withReply: $0) }; print(String(data: result, encoding: .utf8)!); fflush(stdout); previous = state }
                }
                RunLoop.current.run(until: Date().addingTimeInterval(0.2))
            }
            // Controller teardown invalidates the enrolled session; provider blocks retained flows.
            throw FilterFailure.rejected("Reviewed lifetime expired or authenticated provider lost; Browser must close its protected data store")
        }
        throw FilterFailure.rejected("Exact reviewed command/arguments required; no system action performed")
    }
}
