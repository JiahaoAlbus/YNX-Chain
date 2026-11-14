import Foundation
import YNXBrowserCore

/// New dispatcher only. Links actual Native/Core source, never NSApplication/product main/WK.
@main struct ProtectedAcceptanceDispatcherProbe {
    @MainActor static func main() throws {
        precondition(!ProtectedAcceptanceDispatcher.claims(["probe"]))
        precondition(ProtectedAcceptanceDispatcher.claims(["probe", "--p05-protected-acceptance"]))
        var noTeam = false
        do { _ = try ProtectedAcceptanceDispatcher.parse(["probe", "--p05-protected-acceptance=/does-not-exist/private-launch.json"]) }
        catch ProtectionLeaseFailure.signingNotConfigured { noTeam = true }
        precondition(noTeam)
        let result: [String: Any] = ["schema": "P05_ACTUAL_DISPATCHER_PREFLIGHT_V1", "checks": ["ordinary-not-claimed", "malformed-prefix-claimed", "real-NoTeam-before-launch-input-host-XPC-WK"],
            "actualDispatcherCompiled": true, "hostCreated": false, "NSApplicationStarted": false, "WKCreated": false, "XPCStarted": false,
            "actualSignedRouteExecution": "NOT_RUN", "productionRouteAdmission": false]
        print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
    }
}
