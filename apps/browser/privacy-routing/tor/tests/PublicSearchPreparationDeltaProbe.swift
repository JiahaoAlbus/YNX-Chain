import Foundation
import CryptoKit
import Darwin
import YNXBrowserCore

/// Only verified resource reads and a fresh owner-only directory. No adapter/process/WK start.
@main struct PublicSearchPreparationDeltaProbe {
    @MainActor static func main() {
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        var stage = "supply.load"
        var result: [String: Any] = ["schema": "P05_PUBLIC_SEARCH_OFFLINE_PREPARATION_V1", "pid": getpid(), "uid": getuid(), "vendorOrWKStarted": false]
        do {
            let resources = URL(fileURLWithPath: "/REDACTED_USER/Applications/YNX Tor Public Search QA.app/Contents/Resources/PrivacyBackends/Tor", isDirectory: true)
            let supply = try BundledTorBackend.load(resourceDirectory: resources)
            stage = "scratch.create"
            let scratch = try ActualPublicScratch.make()
            result["scratch"] = scratch.path
            stage = "profile.prepare"
            let prepared = try supply.prepareProfile(applicationSupport: scratch, bridgeSource: .bundledPublic)
            result["preparedProfile"] = prepared.directory.path
            stage = "configuration.encode"
            let config = try ArtiProcessAdapter.configuration(port: 63779, sessionDirectory: prepared.directory, deferBootstrap: false, bridge: prepared.bridge)
            result["configurationBytes"] = config.utf8.count
            result["configurationSHA256"] = SHA256.hash(data: Data(config.utf8)).map { String(format: "%02x", $0) }.joined()
            stage = "unsafeReplacement.reject"
            let second = try ActualPublicScratch.make()
            let descriptor = open(second.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard descriptor >= 0 else { throw ActualPublicScratch.Failure.scratchRejected }
            defer { close(descriptor) }
            let kept = second.path + "-original"
            guard rename(second.path, kept) == 0, mkdir(second.path, 0o700) == 0 else { throw ActualPublicScratch.Failure.scratchRejected }
            var denied: [String] = []
            do { _ = try ActualPublicScratch.validate(descriptor, second.path) }
            catch ActualPublicScratch.Failure.scratchRejected { denied.append("different-directory-inode") }
            guard rmdir(second.path) == 0, symlink(kept, second.path) == 0 else { throw ActualPublicScratch.Failure.scratchRejected }
            do { _ = try ActualPublicScratch.validate(descriptor, second.path) }
            catch ActualPublicScratch.Failure.scratchRejected { denied.append("replacement-symlink") }
            do { _ = try supply.prepareProfile(applicationSupport: second, bridgeSource: .bundledPublic) }
            catch BundledTorBackend.Failure.unsafeProfile { denied.append("shared-strict-loader-still-rejects-symlink") }
            guard denied.count == 3 else { throw ActualPublicScratch.Failure.scratchRejected }
            result["unsafeReplacementRejections"] = denied
            result["preservedSyntheticReplacementRoot"] = second.path
            result["status"] = "OFFLINE_PREPARATION_PASS_NOT_GUI_PERMISSION_OR_BACKEND_PROOF"
        } catch {
            result["status"] = "OFFLINE_PREPARATION_FAILED"
            let value = error as NSError
            result["errorDomain"] = value.domain; result["errorCode"] = value.code
            if let typed = error as? BundledTorBackend.Failure { result["typedFailure"] = "BundledTorBackend." + typed.rawValue }
            else if let typed = error as? ActualPublicScratch.Failure { result["typedFailure"] = "Diagnostic." + typed.rawValue }
            else if let typed = error as? TorPlatformError { result["typedFailure"] = String(describing: typed) }
            result["errnoAtCatchNotNecessarilyCausal"] = errno
        }
        result["lastStage"] = stage
        do {
            let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output.appendingPathComponent("preparation.json"), options: [.withoutOverwriting])
            FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data("\n".utf8))
        } catch { FileHandle.standardError.write(Data("PREPARATION_RECEIPT_WRITE_FAILED\n".utf8)); exit(2) }
        if result["status"] as? String == "OFFLINE_PREPARATION_FAILED" { exit(1) }
    }
}
