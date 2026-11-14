import Foundation
import YNXBrowserCore

/// Identity operands and error diagnostics are DATA, never a qualification capability.
@MainActor enum NymQualificationDeltaChecks {
    static func run() throws -> Int {
        let hash = String(repeating: "a", count: 64)
        let rejected: [(String, String?, String, NymProtectedFailure)] = [
            ("NOT_CONFIGURED", nil, "bad", .signingNotConfigured),
            ("FIXTURE001", "ordinary", hash, .wrongApplication),
            ("FIXTURE001", RoutedIsolationMode.nym.bundleIdentifier, "bad", .helperPinMissing)
        ]
        for (team, identifier, pin, expected) in rejected {
            do {
                try NymProtectedRouteProvider.validateIdentityInputs(team: team, identifier: identifier, helperSHA256: pin)
                preconditionFailure("Invalid identity operand accepted")
            } catch let failure as NymProtectedFailure { precondition(failure == expected) }
        }
        // Passing syntactic identity operands supplies no owner, lease or admission.
        try NymProtectedRouteProvider.validateIdentityInputs(team: "FIXTURE001", identifier: RoutedIsolationMode.nym.bundleIdentifier, helperSHA256: hash)
        let mapping: [(RoutedQualificationFailure, NymProtectedFailure)] = [
            (.signingNotConfigured, .signingNotConfigured), (.wrongMode, .wrongApplication),
            (.invalidSignature, .identityRejected), (.helperNotBound, .helperPinMissing),
            (.qualificationIssuerNotSupplied, .qualificationNotSupplied),
            (.installationChanged, .qualificationLost), (.expired, .qualificationLost),
            (.revoked, .qualificationLost), (.closed, .qualificationLost)
        ]
        for (failure, expected) in mapping {
            precondition(NymProtectedRouteProvider.classify(failure, stage: .identityPreflight) == expected)
        }
        return rejected.count + 1 + mapping.count
    }
}
