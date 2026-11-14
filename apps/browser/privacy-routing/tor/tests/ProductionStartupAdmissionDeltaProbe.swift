import Foundation
import Darwin

// PUBLIC control-flow doubles only. They cannot construct a production qualification,
// start Root IPC, create a profile, or supply a backend/OS permission.
enum PrivacyRouteMode { case tor, nym }
enum FixtureFailure: Error { case issuerMissing, revoked, wrongMode }
enum TorCoordinatorFailure: Error {
    case signingNotConfigured, wrongApplication, invalidEndpoint, helperPinMissing, platformDenied, cancelled
    static func classify(_ error: Error) -> Self { .platformDenied } // Callback is never fired by these doubles.
}
enum RoutedIsolationMode { case tor; var bundleIdentifier: String { "com.ynxweb4.browser.route.tor" } }
struct RoutedPlatformIsolationAdmission { static let current = Self(); var permitsWebContent: Bool { false } }
struct FixtureBundle {
    var team = "ABCDEFGHIJ"
    var bundleIdentifier: String? = RoutedIsolationMode.tor.bundleIdentifier
    func object(forInfoDictionaryKey key: String) -> Any? { key == "YNXReviewedTeamIdentifier" ? team : nil }
}
@MainActor final class BrowserRouteProtection {
    static var constructions = 0
    static var constructorFailure: FixtureFailure? = .issuerMissing
    let mode: PrivacyRouteMode
    var failure: Error?
    var checks = 0
    var fences: [TorCoordinatorFailure] = []
    init(fixtureMode: PrivacyRouteMode = .tor, failure: Error? = nil) { mode = fixtureMode; self.failure = failure }
    init(mode: PrivacyRouteMode, onLeaseLost: @escaping @MainActor (Error) -> Void) throws {
        Self.constructions += 1
        if let failure = Self.constructorFailure { throw failure }
        self.mode = mode
    }
    func requireBackendStartupQualification(mode: PrivacyRouteMode) throws {
        checks += 1
        guard self.mode == mode else { throw FixtureFailure.wrongMode }
        if let failure { throw failure }
    }
    #if YNX_PRIVACY_ACCEPTANCE
    func requireSyntheticTrialAuthority(_ authority: SyntheticTrialAuthority) throws { throw FixtureFailure.issuerMissing }
    #endif
}
#if YNX_PRIVACY_ACCEPTANCE
enum FixtureIsolationMode { case tor }
struct SyntheticTrialAuthority {
    func authorizeBackendPreparation(mode: FixtureIsolationMode) throws { throw FixtureFailure.issuerMissing }
}
#endif

@main struct ProductionStartupAdmissionDeltaProbe {
    @MainActor static func main() {
        do {
            var checks = 0
            func check(_ value: Bool, _ label: String) throws {
                guard value else { throw NSError(domain: "TorStartupAdmission." + label, code: checks) }
                checks += 1
            }
            let hash = String(repeating: "a", count: 64)
            // This owner-double merely observes whether the actual callee reaches it.
            // A no-throw fixture check is not a real qualification or route PASS.
            let observed = BrowserRouteProtection()
            let entry = ActualStartupAdmission(protection: observed)
            if CommandLine.arguments.contains("--legacy-counterexample") {
                do { try entry.touchOfflineFixtureAfterAuthorization(helperSHA256: hash); throw FixtureFailure.revoked }
                catch TorCoordinatorFailure.platformDenied { try check(observed.checks == 0 && entry.offlineTouches == 0, "duplicate-static-gate-prevented-owned-check") }
                print("TOR_PRODUCTION_STARTUP_BUG_REPRODUCED \(checks) check; actual callee denied before observing supplied owner; qualification/backend/network NOT_RUN")
                return
            }
            try entry.touchOfflineFixtureAfterAuthorization(helperSHA256: hash)
            try check(observed.checks == 1 && entry.offlineTouches == 1, "same-owned-check-before-offline-boundary")
            try check(BrowserRouteProtection.constructions == 0 && entry.protection === observed, "no-owner-replacement")
            observed.failure = FixtureFailure.revoked
            do { try entry.touchOfflineFixtureAfterAuthorization(helperSHA256: hash); throw TorCoordinatorFailure.platformDenied }
            catch FixtureFailure.revoked { try check(observed.checks == 2 && entry.offlineTouches == 1, "recheck-live-owner-not-cached-result") }
            let unavailable = BrowserRouteProtection(failure: FixtureFailure.issuerMissing)
            let absent = ActualStartupAdmission(protection: unavailable)
            do { try absent.touchOfflineFixtureAfterAuthorization(helperSHA256: hash); throw TorCoordinatorFailure.platformDenied }
            catch FixtureFailure.issuerMissing { try check(unavailable.checks == 1 && absent.offlineTouches == 0, "missing-issuer-no-offline-side-effect") }
            let wrong = BrowserRouteProtection(fixtureMode: .nym)
            let wrongEntry = ActualStartupAdmission(protection: wrong)
            do { try wrongEntry.touchOfflineFixtureAfterAuthorization(helperSHA256: hash); throw TorCoordinatorFailure.platformDenied }
            catch FixtureFailure.wrongMode { try check(wrong.checks == 1 && wrongEntry.offlineTouches == 0, "wrong-mode-owner-refused") }
            let nilOwner = ActualStartupAdmission()
            do { try nilOwner.touchOfflineFixtureAfterAuthorization(helperSHA256: hash); throw TorCoordinatorFailure.platformDenied }
            catch FixtureFailure.issuerMissing { try check(BrowserRouteProtection.constructions == 1 && nilOwner.protection == nil && nilOwner.offlineTouches == 0, "normal-factory-missing-issuer-propagates") }
            let invalid = ActualStartupAdmission(protection: observed)
            invalid.bundle.team = ""
            do { try invalid.touchOfflineFixtureAfterAuthorization(helperSHA256: hash); throw FixtureFailure.revoked }
            catch TorCoordinatorFailure.signingNotConfigured { try check(observed.checks == 2 && invalid.offlineTouches == 0, "no-team-before-owner-or-resource") }
            let wrongApp = ActualStartupAdmission(protection: observed)
            wrongApp.bundle.bundleIdentifier = "Standard"
            do { try wrongApp.touchOfflineFixtureAfterAuthorization(helperSHA256: hash); throw FixtureFailure.revoked }
            catch TorCoordinatorFailure.wrongApplication { try check(observed.checks == 2 && wrongApp.offlineTouches == 0, "wrong-app-before-owner") }
            let badPin = ActualStartupAdmission(protection: observed)
            do { try badPin.touchOfflineFixtureAfterAuthorization(helperSHA256: "bad"); throw FixtureFailure.revoked }
            catch TorCoordinatorFailure.helperPinMissing { try check(observed.checks == 2 && badPin.offlineTouches == 0, "helper-pin-before-owner") }
            try check(!RoutedPlatformIsolationAdmission.current.permitsWebContent, "public-current-still-false")
            do { try ActualStartupAdmission.preflight(team: "ABCDEFGHIJ", identifier: RoutedIsolationMode.tor.bundleIdentifier, helperSHA256: hash, port: 19150); throw FixtureFailure.revoked }
            catch TorCoordinatorFailure.platformDenied { try check(true, "legacy-unqualified-preflight-remains-denied") }
            print("TOR_PRODUCTION_STARTUP_DELTA \(checks) checks PASS; actual callee with PUBLIC control-flow doubles; real qualification/Root/backend/WK/network NOT_RUN")
        } catch {
            FileHandle.standardError.write(Data("TOR_PRODUCTION_STARTUP_DELTA FAIL \(error)\n".utf8)); exit(1)
        }
    }
}
