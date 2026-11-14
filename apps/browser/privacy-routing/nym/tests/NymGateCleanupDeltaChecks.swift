import Foundation
import YNXBrowserCore

/// Consumer conjunction only; synthetic receipt values below are not authentic Gate receipts
/// and cannot release a production provider lease or create a protected route.
@MainActor enum NymGateCleanupDeltaChecks {
    static func run() -> Int {
        let pid: Int32 = 4242
        let exited = BackendProcessExit(pid: pid, code: 0, signal: nil, childReaped: true)
        let nonzero = BackendProcessExit(pid: pid, code: 1, signal: nil, childReaped: true)
        let signalled = BackendProcessExit(pid: pid, code: nil, signal: 2, childReaped: true)
        let pending = BackendProcessExit(pid: pid, code: nil, signal: nil, childReaped: false)
        let other = BackendProcessExit(pid: pid + 1, code: 0, signal: nil, childReaped: true)
        let checks: [(BackendProcessExit?, Int32?, Int32?, Bool, Bool)] = [
            (exited, pid, pid, false, false), // Child exit does not establish helper/FD closure.
            (nil, pid, pid, true, false),    // Cleanup without original child receipt is unknown.
            (pending, pid, pid, true, false),
            (other, pid, pid, true, false),
            (exited, nil, nil, true, false),
            (exited, 0, pid, true, false),
            (exited, pid, pid, true, true),
            (nonzero, pid, pid, true, true), // Reaped failure is cleanup, never route success.
            (signalled, pid, pid, true, true),
            (exited, nil, pid, true, true), // Early cancellation: authenticated cleanup-only PID.
            (exited, pid, pid + 1, true, false),
            (exited, nil, 1, true, false)
        ]
        for (receipt, expectedPID, cleanupPID, helperClosed, expected) in checks {
            precondition(NymProtectedRouteProvider.hasConfirmedGateCleanup(receipt: receipt, preparedPID: expectedPID,
                cleanupChildPID: cleanupPID, helperCleanupConfirmed: helperClosed) == expected)
        }
        return checks.count
    }
}
