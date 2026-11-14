import Foundation

/// New classification delta only. No authority, process, profile, IPC or WebKit is created.
@main struct TrialDiagnosticDeltaProbe {
    static func main() throws {
        var checks = 0
        func check(_ condition: Bool) throws {
            guard condition else { throw NSError(domain: "TorTrialDiagnosticDelta", code: checks) }
            checks += 1
        }
        #if YNX_PRIVACY_ACCEPTANCE
        let cases: [(SyntheticTrialFailure, TorCoordinatorFailure)] = [
            (.revoked, .trialAuthorityUnavailable), (.bindingMismatch, .trialBindingRejected),
            (.invalidScope, .trialScopeRejected), (.missingPins, .trialPinsMissing),
            (.invalidSignature, .codeRejected), (.canaryNotVerified, .trialQualificationMissing),
            (.canaryObservedLeak, .trialCanaryLeak), (.canaryTimeout, .trialCanaryTimedOut),
            (.targetDenied, .trialTargetDenied), (.routeNotVerified, .protectionLost)
        ]
        for (error, expected) in cases {
            let result = TorCoordinatorFailure.classify(error)
            try check(result == expected && result != .startupFailed)
            try check(result.rawValue.range(of: "^[A-Za-z]+$", options: .regularExpression) != nil)
        }
        // Revocation does not identify its cause: expiry, explicit revoke and transport
        // loss must never be presented as an invented specific network diagnosis.
        try check(TorCoordinatorFailure.classify(SyntheticTrialFailure.revoked).rawValue == "trialAuthorityUnavailable")
        #else
        // The production preprocessor path contains no SyntheticTrialFailure type or
        // trial category. A lookalike NSError cannot manufacture a typed trial outcome.
        try check(TorCoordinatorFailure.classify(NSError(domain: "SyntheticTrialFailure.revoked", code: 1)) == .startupFailed)
        #endif
        let privateText = "PUBLIC-synthetic-secret.invalid/profile/PUBLIC-no-logging"
        let untyped = NSError(domain: privateText, code: 99,
                              userInfo: [NSLocalizedDescriptionKey: privateText])
        let output = TorCoordinatorFailure.classify(untyped).rawValue
        try check(output == "startupFailed" && !output.contains(privateText))
        print("TOR_TRIAL_DIAGNOSTIC_DELTA \(checks) checks PASS; authority/vendor/IPC/WK/network NOT_RUN")
    }
}
