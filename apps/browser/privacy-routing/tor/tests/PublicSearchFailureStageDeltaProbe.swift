import Foundation
import Darwin

@MainActor final class FailureStatus { var stringValue = "" }
@MainActor final class FailureAdapter { var lastStopReason: String? }

@main struct PublicSearchFailureStageDeltaProbe {
    @MainActor static func main() {
        do {
            var checks = 0
            func check(_ value: Bool, _ label: String) throws {
                guard value else { throw NSError(domain: "PublicFailureStage." + label, code: checks) }
                checks += 1
            }
            let profile = ActualPublicFailure(stage: "profilePrepare")
            profile.observe(BundledTorBackend.Failure.unsafeProfile)
            try check(profile.firstFailure == .profileRejected && profile.firstTypedFailure == "BundledTorBackend.unsafeProfile", "actual-typed-profile-first-cause")
            try check(profile.firstErrorSummary?.contains("stage=profilePrepare") == true && profile.firstErrorCode != nil, "first-stage-and-nserror-code")
            let old = profile.firstErrorSummary
            profile.startupStage = "backendLaunch"; profile.observe(NSError(domain: NSPOSIXErrorDomain, code: 13))
            profile.cleanupFailure()
            try check(profile.firstErrorSummary == old && profile.firstFailure == .profileRejected, "later-launch-cleanup-cannot-replace-first-cause")
            let gate = ActualPublicFailure(stage: "backendLaunch")
            gate.observe(TorPlatformError.binaryMismatch)
            try check(gate.firstFailure == .backendLaunchRejected && gate.firstTypedFailure == "TorPlatformError.binaryMismatch", "pin-gate-distinct-typed")
            let launch = ActualPublicFailure(stage: "backendLaunch")
            launch.observe(NSError(domain: NSCocoaErrorDomain, code: 513, userInfo: [NSFilePathErrorKey: "/PRIVATE_SHOULD_NOT_LOG", NSLocalizedDescriptionKey: "obfs4 PRIVATE_BRIDGE_RAW", NSURLErrorFailingURLErrorKey: URL(string: "https://PRIVATE_SHOULD_NOT_LOG.example/")!]))
            try check(launch.firstFailure == .backendLaunchRejected && launch.firstErrorDomain == NSCocoaErrorDomain && launch.firstErrorCode == 513, "spawn-api-error-retained")
            try check(!launch.status.stringValue.contains("PRIVATE") && !launch.status.stringValue.contains("obfs4") && !launch.status.stringValue.contains("https://"), "no-userinfo-path-bridge-url")
            let exit = ActualPublicFailure(stage: "bootstrap")
            exit.originalBackendPID = 12345; exit.backendExitStatus = 64; exit.observe(ActualPublicFailure.Failure.backendExited)
            try check(exit.firstFailure == .backendExited && exit.firstErrorSummary?.contains("exitStatus=64") == true && exit.firstErrorSummary?.contains("pid=12345") == true, "original-short-exit-code-not-spawn-throw")
            let stopped = ActualPublicFailure(stage: "bootstrap")
            stopped.adapter.lastStopReason = "system-sleep"; stopped.observe(ActualPublicFailure.Failure.backendLost)
            try check(stopped.firstErrorSummary?.contains("stop=system-sleep") == true, "existing-adapter-interruption-reason")
            let unsafe = ActualPublicFailure(stage: "bootstrap")
            unsafe.adapter.lastStopReason = "PRIVATE_BRIDGE_RAW"; unsafe.observe(ActualPublicFailure.Failure.backendLost)
            try check(unsafe.firstErrorSummary?.contains("stop=other") == true && !unsafe.status.stringValue.contains("PRIVATE"), "unknown-stop-reason-not-printed")
            let tls = ActualPublicFailure(stage: "fixedDocumentLoad")
            tls.observe(NSError(domain: NSURLErrorDomain, code: -1202, userInfo: [NSURLErrorFailingURLStringErrorKey: "https://PRIVATE.example/"]))
            try check(tls.firstFailure == .tlsFailed && tls.firstErrorCode == -1202 && !tls.status.stringValue.contains("https://"), "tls-certificate-error-specific")
            let network = ActualPublicFailure(stage: "fixedDocumentLoad")
            network.observe(NSError(domain: NSURLErrorDomain, code: -1001))
            try check(network.firstFailure == .networkFailed && network.firstErrorCode == -1001, "network-timeout-distinct-from-tls")
            let domain = ActualPublicFailure(stage: "fixedDocumentLoad")
            domain.observe(NSError(domain: "https://PRIVATE.example/\nobfs4", code: 7))
            try check(domain.firstErrorDomain == "OtherNSErrorDomain" && !domain.status.stringValue.contains("PRIVATE"), "unsafe-domain-redacted")
            print("PUBLIC_SEARCH_FAILURE_STAGE_DELTA \(checks) checks PASS; actual failure formatting/classification only; process/WK/network NOT_RUN")
        } catch { FileHandle.standardError.write(Data("PUBLIC_SEARCH_FAILURE_STAGE_DELTA FAIL \(error)\n".utf8)); exit(1) }
    }
}
