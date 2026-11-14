import Foundation
import Darwin

@main struct QualificationFailureDeltaProbe {
    @MainActor static func main() {
        do {
            var checks = 0
            func check(_ value: Bool, _ label: String) throws {
                guard value else { throw NSError(domain: "TorQualificationFailure." + label, code: checks) }
                checks += 1
            }
            let cases: [(RoutedQualificationFailure, TorCoordinatorFailure)] = [
                (.signingNotConfigured, .signingNotConfigured), (.wrongMode, .wrongApplication),
                (.invalidSignature, .codeRejected), (.helperNotBound, .helperPinMissing),
                (.qualificationIssuerNotSupplied, .qualificationNotSupplied),
                (.installationChanged, .qualificationLost), (.expired, .qualificationLost),
                (.revoked, .qualificationLost), (.closed, .qualificationLost)
            ]
            let hash = String(repeating: "a", count: 64)
            for (failure, expected) in cases {
                let owner = BrowserRouteProtection(failure: failure)
                let entry = ActualStartupAdmission(protection: owner)
                entry.observeAuthorization(helperSHA256: hash)
                try check(entry.firstFailure == expected, "specific-category")
                try check(entry.firstQualificationFailure == failure, "typed-first-cause")
                try check(entry.offlineTouches == 0 && owner.checks == 1, "qualification-refused-before-supply-profile")
            }
            let owner = BrowserRouteProtection(failure: RoutedQualificationFailure.expired)
            let entry = ActualStartupAdmission(protection: owner)
            entry.observeAuthorization(helperSHA256: hash)
            owner.failure = RoutedQualificationFailure.revoked
            entry.observeAuthorization(helperSHA256: hash)
            try check(entry.firstQualificationFailure == .expired && entry.firstFailure == .qualificationLost, "expiry-not-overwritten-by-revocation")
            try check(entry.offlineTouches == 0 && owner.checks == 2, "rejected-owner-rechecked")
            entry.observe(TorCoordinatorFailure.cleanupUnconfirmed)
            try check(entry.firstQualificationFailure == .expired && entry.firstFailure == .qualificationLost && entry.lastFailure == .cleanupUnconfirmed, "cleanup-keeps-first-qualification")
            let earlier = ActualStartupAdmission(protection: owner)
            earlier.observe(TorCoordinatorFailure.networkUnavailable)
            earlier.observe(RoutedQualificationFailure.revoked)
            try check(earlier.firstFailure == .networkUnavailable && earlier.firstQualificationFailure == .revoked, "earlier-network-first-cause-not-rewritten")
            try check(BrowserRouteProtection.constructions == 0, "no-real-or-replacement-owner-created")
            print("TOR_QUALIFICATION_FAILURE_DELTA \(checks) checks PASS; actual classifier/recording/authorization slices; PUBLIC rejection doubles; real issuer/Root/backend/network NOT_RUN")
        } catch {
            FileHandle.standardError.write(Data("TOR_QUALIFICATION_FAILURE_DELTA FAIL \(error)\n".utf8)); exit(1)
        }
    }
}
