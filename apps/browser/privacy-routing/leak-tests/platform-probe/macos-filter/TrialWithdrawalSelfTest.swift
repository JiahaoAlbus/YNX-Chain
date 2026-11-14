import Foundation

private enum WithdrawalProbeFailure: Error { case failed(String), sourceLost, laterClose }
@MainActor private func check(_ value: Bool, _ name: String) throws {
    if !value { throw WithdrawalProbeFailure.failed(name) }
}
@main private struct TrialWithdrawalSelfTest {
    @MainActor static func main() async {
        do {
            if CommandLine.arguments.contains("--legacy-child-only") {
                // Exact former allSatisfy closure. DATA fixture only, no Gate/Root/NE.
                struct Exit { let childReaped: Bool }
                struct Gate { let observedExit: Exit? }
                let gates = [Gate(observedExit: .init(childReaped: true))]
                let legacy = gates.allSatisfy({ $0.observedExit?.childReaped == true })
                print("{\"oldActualClosureAcceptsChildReceiptWithoutHelperClosure\":\(legacy),\"expectedFailure\":true,\"actualGateOrNE\":false}")
                Foundation.exit(legacy ? 1 : 2)
            }
            var cases: [String] = []
            var idleCalls = 0
            let idle = SyntheticTrialWithdrawal(deadline: .now.advanced(by: .milliseconds(30))) { idleCalls += 1 }
            try await Task.sleep(for: .milliseconds(65))
            try check(idleCalls == 1 && idle.failure is SyntheticTrialLifetimeFailure, "idle-expiry-without-request")
            cases.append("idle-expiry-without-request")

            var synchronousCalls = 0
            let expired = SyntheticTrialWithdrawal(deadline: .now.advanced(by: .milliseconds(-1))) { synchronousCalls += 1 }
            do { try expired.requireCurrent(); throw WithdrawalProbeFailure.failed("expired-check-returned") }
            catch is SyntheticTrialLifetimeFailure { try check(synchronousCalls == 1, "synchronous-withdraw-before-throw") }
            cases.append("synchronous-deadline-withdraw")

            var lossCalls = 0
            let loss = SyntheticTrialWithdrawal(deadline: .now.advanced(by: .milliseconds(20))) { lossCalls += 1 }
            loss.withdraw(WithdrawalProbeFailure.sourceLost)
            loss.withdraw(WithdrawalProbeFailure.laterClose)
            try await Task.sleep(for: .milliseconds(45))
            do { try loss.requireCurrent(); throw WithdrawalProbeFailure.failed("loss-check-returned") }
            catch WithdrawalProbeFailure.sourceLost { try check(lossCalls == 1, "first-cause-and-once") }
            cases.append("first-control-loss-survives-expiry-close")

            var cancelledCalls = 0
            let cancelled = Task { @MainActor in
                SyntheticTrialWithdrawal(deadline: .now.advanced(by: .milliseconds(25))) { cancelledCalls += 1 }
            }
            cancelled.cancel()
            let owned = await cancelled.value
            try await Task.sleep(for: .milliseconds(55))
            try check(cancelledCalls == 1 && owned.failure != nil, "owned-expiry-not-caller-cancelled")
            cases.append("cancelled-caller-cannot-cancel-expiry")

            var droppedCalls = 0
            weak var dropped: SyntheticTrialWithdrawal?
            do {
                let owner = SyntheticTrialWithdrawal(deadline: .now.advanced(by: .milliseconds(25))) { droppedCalls += 1 }
                dropped = owner
            }
            try check(dropped == nil, "expiry-task-must-not-retain-owner")
            try await Task.sleep(for: .milliseconds(50))
            try check(droppedCalls == 0, "deinit-cancels-expiry")
            cases.append("owner-deinit-cancels-without-retain-cycle")

            var reentrant: SyntheticTrialWithdrawal?
            var reentrantCalls = 0
            reentrant = SyntheticTrialWithdrawal(deadline: .now.advanced(by: .seconds(1))) {
                reentrantCalls += 1; reentrant?.withdraw(WithdrawalProbeFailure.laterClose)
            }
            reentrant?.withdraw(WithdrawalProbeFailure.sourceLost)
            try check(reentrantCalls == 1, "reentrant-close-once")
            do { try reentrant?.requireCurrent(); throw WithdrawalProbeFailure.failed("reentrant-returned") }
            catch WithdrawalProbeFailure.sourceLost {}
            cases.append("reentrant-revocation-keeps-first-cause")

            var lateCommitted = false
            let late = SyntheticTrialWithdrawal(deadline: .now.advanced(by: .milliseconds(20))) {}
            try late.requireCurrent()
            try await Task.sleep(for: .milliseconds(45))
            do { try late.requireCurrent(); lateCommitted = true } catch is SyntheticTrialLifetimeFailure {}
            try check(!lateCommitted, "late-reply-cannot-commit")
            cases.append("post-await-check-rejects-expired-result")

            let good = ProtectedAcceptanceCleanupEvidence.confirms
            try check(good(true, 4242, 4242, 4242, true), "all-cleanup-evidence")
            try check(good(true, 4242, 4242, nil, true), "early-cancel-cleanup-only-identity")
            let denied = [
                good(true,4242,4242,4242,false), good(false,4242,4242,4242,true),
                good(true,nil,4242,4242,true), good(true,4242,nil,4242,true),
                good(true,4243,4242,4242,true), good(true,4242,4242,4243,true),
                good(true,1,1,nil,true), good(false,nil,nil,nil,true)
            ]
            try check(denied.allSatisfy { !$0 }, "cleanup-incomplete-or-wrong-identity-refused")
            cases.append("cleanup-10-conjunction-boundaries")
            reentrant = nil
            let result: [String: Any] = ["cases":cases,"cleanupDATACombinations":10,"actualPrimitive":true,
                "authenticQualificationConstructed":false,"signedXPCOrNE":"NOT_RUN","OSSocketDenial":"NOT_RUN",
                "noSocketOrBackendStarted":true,"productionRouteAdmission":false]
            print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
        } catch {
            print("{\"failed\":true,\"errorType\":\"\(String(describing:type(of:error)))\"}")
            Foundation.exit(1)
        }
    }
}
