import Foundation
import YNXBrowserCore

@MainActor enum NymCaptureConsumerDeltaChecks {
    static func run() -> Int {
        let operations: [(String, NymProtectedFailure)] = [
            ("output-capture-limit", .helperContractMismatch),
            ("output-capture-ack", .helperContractMismatch),
            ("output-capture-incomplete", .outputCaptureIncomplete)
        ]
        for (operation, expected) in operations {
            let failure = BackendStartGateFailure(operation: operation, detail: "Synthetic public diagnostic only")
            precondition(NymProtectedRouteProvider.classify(failure, stage: .directory) == expected)
            precondition(NymProtectedRouteProvider.classify(failure, stage: .gateway) == expected)
        }
        return operations.count * 2
    }
}
