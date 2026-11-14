import Foundation
import YNXBrowserCore

@MainActor enum NymStartupDeltaChecks {
    static func run() async throws -> Int {
        var checks = 0
        let owned = NymStartupOperation()
        var lateFactory: CheckedContinuation<Void, Never>?
        var adoptedLateOwner = false, workerCancelled = false
        let original = Task { @MainActor in
            do {
                _ = try await owned.run {
                    await withCheckedContinuation { lateFactory = $0 }
                    // Model a real external factory that returns its original owned object
                    // after cancellation. It must be adopted before checking cancellation.
                    adoptedLateOwner = true
                    try Task.checkCancellation()
                    fatalError("Cancelled startup advanced to route readiness")
                }
            } catch is CancellationError { workerCancelled = true }
            catch { fatalError("Unexpected startup failure: \(type(of: error))") }
        }
        while lateFactory == nil { await Task.yield() }
        precondition(owned.isRunning && !adoptedLateOwner); checks += 1
        do { _ = try await owned.run { fatalError("Second startup was executed") }; fatalError("Overlapping worker accepted") }
        catch NymProtectedFailure.ownershipConflict { checks += 1 }
        owned.cancel()
        var firstJoined = false, secondJoined = false
        let first = Task { @MainActor in await owned.join(); firstJoined = true }
        let second = Task { @MainActor in await owned.join(); secondJoined = true }
        for _ in 0..<20 { await Task.yield() }
        precondition(owned.isRunning && !firstJoined && !secondJoined && !adoptedLateOwner); checks += 1
        lateFactory!.resume()
        await first.value; await second.value; await original.value
        precondition(adoptedLateOwner && workerCancelled && firstJoined && secondJoined && !owned.isRunning); checks += 1

        // The next owned operation may start only after the old worker actually completed;
        // joining/finishing the old identity cannot clear a different in-flight worker.
        let next = NymStartupOperation()
        let parent = Task { @MainActor in
            try await next.run { try await Task.sleep(for: .seconds(30)); throw NymProtectedFailure.cancelled }
        }
        while !next.isRunning { await Task.yield() }
        parent.cancel()
        do { _ = try await parent.value; fatalError("Parent cancellation ignored") }
        catch is CancellationError { checks += 1 }
        precondition(!next.isRunning); checks += 1

        struct UnknownCalleeError: Error {}
        let matrix: [(Error, NymProtectedStage, NymProtectedFailure)] = [
            (CancellationError(), .directory, .cancelled),
            (ProtectionLeaseFailure.signingNotConfigured, .identityPreflight, .signingNotConfigured),
            (ProtectionLeaseFailure.wrongApplicationInstance, .identityPreflight, .wrongApplication),
            (ProtectionLeaseFailure.providerRestarted, .proof, .controlLeaseLost),
            (NymProtectedFailure.proofTimedOut, .proof, .proofTimedOut),
            (NymRouteAdapterError.profileInUse, .profile, .ownershipConflict),
            (NymRouteAdapterError.probeFailed, .proof, .proofFailed),
            (BundledNymSupplyError.staleDirectory, .directory, .staleNumericPlan),
            (BundledNymSupplyError.missingResource, .supply, .supplyRejected),
            (UnknownCalleeError(), .proofResource, .proofNotSupplied),
            (UnknownCalleeError(), .directory, .directoryFailed),
            (UnknownCalleeError(), .gateway, .gatewayFailed),
            (UnknownCalleeError(), .numericPolicy, .invalidNumericPlan)
        ]
        for (error, stage, expected) in matrix {
            precondition(NymProtectedRouteProvider.classify(error, stage: stage) == expected); checks += 1
        }
        // Actual production entry: no test fixture authority or Team injection. New wrapper
        // must refuse before suppliers and preserve the preflight first-cause through cleanup.
        var suppliers = 0
        let identity = try NymCodeSignatureIdentity(identifier: "not-real", codeDirectoryHash: String(repeating: "a", count: 40), teamIdentifier: nil)
        let provider = NymProtectedRouteProvider(helperSHA256: String(repeating: "a", count: 64), expectedPackageIdentity: identity,
            profile: nil, explicitUserAction: UUID()) { suppliers += 1; fatalError("NoTeam consulted inputs") }
        do { _ = try await provider.start(); fatalError("NoTeam started route") }
        catch NymProtectedFailure.signingNotConfigured { checks += 1 }
        precondition(suppliers == 0 && provider.firstFailure == .signingNotConfigured && provider.firstFailureStage == .identityPreflight); checks += 1
        async let one = provider.awaitCleanupConfirmation()
        async let two = provider.awaitCleanupConfirmation()
        let results = await (one, two)
        precondition(results.0 && results.1 && provider.cleanupConfirmed && provider.firstFailure == .signingNotConfigured); checks += 1
        precondition(!RoutedPlatformIsolationAdmission.current.permitsWebContent); checks += 1
        return checks
    }
}
