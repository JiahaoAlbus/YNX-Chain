import Foundation
import YNXBrowserCore

/// New compile-flag boundary regression only. No opaque authority is fabricated.
@main struct TypedTrialEntrypointDeltaProbe {
    @MainActor static func main() async throws {
        var checks = 0
        do {
            try TorProtectedRouteProvider.preflight(team: "ABCDEFGHIJ", identifier: RoutedIsolationMode.tor.bundleIdentifier,
                helperSHA256: String(repeating: "a", count: 64), port: 19150)
            throw NSError(domain: "TorTypedTrialDelta", code: 1)
        } catch TorCoordinatorFailure.platformDenied { checks += 1 }
        guard !RoutedPlatformIsolationAdmission.current.permitsWebContent else { throw NSError(domain: "TorTypedTrialDelta", code: 2) }
        checks += 1
        let absent = URL(fileURLWithPath: "/private/tmp/ynx-no-qualified-tor-" + UUID().uuidString)
        let provider = TorProtectedRouteProvider(helperSHA256: String(repeating: "a", count: 64), explicitUserAction: UUID(), applicationSupport: absent)
        do { _ = try await provider.start(); throw NSError(domain: "TorTypedTrialDelta", code: 3) }
        catch TorCoordinatorFailure.signingNotConfigured { checks += 1 }
        guard !FileManager.default.fileExists(atPath: absent.path), provider.cleanupConfirmed else { throw NSError(domain: "TorTypedTrialDelta", code: 4) }
        checks += 1
        #if YNX_PRIVACY_ACCEPTANCE
        // Typecheck the authentic caller signature only; no authority or protection is made.
        let typedFactory: (SyntheticTrialAuthority, BrowserRouteProtection) throws -> TorProtectedRouteProvider = { authority, protection in
            try TorProtectedRouteProvider(acceptanceAuthority: authority, protection: protection,
                helperSHA256: String(repeating: "a", count: 64), explicitUserAction: UUID())
        }
        _ = typedFactory
        print("TYPED_TRIAL_DELTA acceptance build: \(checks) checks PASS; production guard unchanged; opaque/vendor/IPC/WK/network NOT_RUN")
        #else
        print("TYPED_TRIAL_DELTA production build: \(checks) checks PASS; opaque/vendor/IPC/WK/network NOT_RUN")
        #endif
    }
}
