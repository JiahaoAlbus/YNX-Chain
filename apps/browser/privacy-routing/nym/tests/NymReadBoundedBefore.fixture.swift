// Frozen failing DATA-only excerpts from Native source fb5e3c11e2ea73b40bb7509a23da629b6e30ecf37c657d92d6d682ddfd2134e8.
// Compiled only inside the controlled no-authority pipe fixture, never product code.
enum NymProtectedFailure: String, Error {
    case signingNotConfigured, wrongApplication, platformDenied, invalidEndpoint, helperPinMissing
    case invalidNumericPlan, staleNumericPlan, unattributedRuntimeDNS, identityRejected
    case profileProvisioningRequired, provisioningUnknown, unsafeJournal, ownershipConflict
    case cancelled, backendExited, bootstrapTimedOut, proofFailed, cleanupUnconfirmed
    case proofNotSupplied, controlPlaneFailed, invalidProfileReceipt, unsupportedRuntime
    case supplyRejected, directoryFailed, gatewayFailed, controlLeaseLost, proofTimedOut, networkChanged
    case helperContractMismatch, outputCaptureIncomplete, qualificationNotSupplied, qualificationLost
    case proofScopeNotSupplied, proofScopeLost
}
enum NymProtectedStage: String, Sendable {
    case idle, identityPreflight, supply, proofResource, directory, profile, gateway
    case numericPolicy, bootstrap, proof, routeConnect, connected, cleanup
}
private func readBounded(_ gate: OwnedBackendStartGate, limit: Int, seconds: Int, expected: UUID, consume: (Data) throws -> Bool) async throws {
        let fd = gate.backendOutput.fileDescriptor, flags = fcntl(gate.backendOutput.fileDescriptor, F_GETFL)
        guard flags >= 0, fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0 else { throw NymProtectedFailure.backendExited }
        let deadline = ContinuousClock.now.advanced(by: .seconds(seconds)); var total = 0
        while ContinuousClock.now < deadline {
            try require(expected)
            guard try protection?.bootstrapControlLease.phase == .blocked, try await gate.poll() == nil,
                  let vendor, try await vendor.poll() == nil else { throw NymProtectedFailure.backendExited }
            var buffer = [UInt8](repeating: 0, count: 2048); let n = read(fd, &buffer, buffer.count)
            if n > 0 { total += n; guard total <= limit else { throw NymProtectedFailure.proofFailed }; if try consume(Data(buffer.prefix(n))) { return } }
            else if n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR { throw NymProtectedFailure.backendExited }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw operationStage == .proof ? NymProtectedFailure.proofTimedOut : .bootstrapTimedOut
    }
