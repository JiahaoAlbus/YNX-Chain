import AppKit
import WebKit
import YNXBrowserCore

@MainActor private final class Driver: NSObject, WKDownloadDelegate {
    enum Mode { case cancel, broken, denied, success, retirement, lateRetirement }
    private let web: WKWebView
    private let root: URL
    private let base: URL
    private let mode: Mode
    private var continuation: CheckedContinuation<Void, any Error>?
    private var progress: NSKeyValueObservation?
    private var lease: RoutedDownloadFileLease?
    private let retirement = RoutedDownloadRetirement()
    private var retirementStarted = false
    private(set) var actualCancels = 0
    private(set) var actualFailures = 0
    private(set) var actualPartObserved = false
    private(set) var actualAuthorizationRejection = false
    private let original = Data("existing completed destination".utf8)
    private let sentinel = Data("unowned partial".utf8)

    init(base: URL, root: URL, mode: Mode) throws {
        self.base = base; self.root = root; self.mode = mode
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        try original.write(to: root.appendingPathComponent("kept.bin"))
        try sentinel.write(to: root.appendingPathComponent(".ynx-download-unowned.part"))
    }
    func run() async throws {
        let path = mode == .cancel || mode == .retirement || mode == .lateRetirement ? "download-slow" : mode == .broken ? "download-broken" : "download"
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            web.startDownload(using: URLRequest(url: base.appendingPathComponent(path))) { [self] download in
                if mode == .lateRetirement {
                    download.delegate = self
                    retirementStarted = true
                    retirement.begin(download, file: nil)
                    retirement.cancel(download)
                    Task { @MainActor [self] in
                        let closed = await retirement.awaitClosure()
                        precondition(closed)
                        done()
                    }
                    return
                }
                progress = download.progress.observe(\.completedUnitCount, options: [.new]) { [weak self, weak download] value, _ in
                    let count = value.completedUnitCount
                    Task { @MainActor [weak self, weak download] in
                        guard let self, let download, (self.mode == .cancel || self.mode == .retirement), count > 0,
                              let lease = self.lease, lease.state == .pending else { return }
                        self.actualPartObserved = FileManager.default.fileExists(atPath: lease.staging.path)
                        if self.mode == .retirement { await self.retire(download, lease: lease) }
                        else { self.cancel(download, lease: lease) }
                    }
                }
                download.delegate = self
            }
        }
        progress = nil
        if mode != .lateRetirement {
            precondition(lease.map { !FileManager.default.fileExists(atPath: $0.staging.path) } ?? false)
        }
        let preservedSentinel = try Data(contentsOf: root.appendingPathComponent(".ynx-download-unowned.part"))
        precondition(preservedSentinel == sentinel)
        if mode != .success {
            let preservedFinal = try Data(contentsOf: root.appendingPathComponent("kept.bin"))
            precondition(preservedFinal == original)
        }
    }
    private func done(_ error: (any Error)? = nil) {
        let pending = continuation; continuation = nil
        if let error { pending?.resume(throwing: error) } else { pending?.resume() }
    }
    private func cancel(_ download: WKDownload, lease: RoutedDownloadFileLease) {
        lease.cancelTransport { complete in
            download.cancel { [self] _ in
                actualCancels += 1; complete()
                precondition(lease.state == .revoked)
                done()
            }
        }
    }
    private func retire(_ download: WKDownload, lease: RoutedDownloadFileLease) async {
        guard !retirementStarted else { return }
        retirementStarted = true
        retirement.begin(download, file: lease)
        let prematureClosure = await retirement.awaitClosure(timeout: .zero)
        precondition(!prematureClosure && retirement.pendingCount == 1)
        retirement.cancel(download)
        retirement.didTerminate(download) // A failure delegate can precede cancel's completion callback.
        let closureBeforeCancelCallback = await retirement.awaitClosure(timeout: .zero)
        precondition(!closureBeforeCancelCallback && retirement.pendingCount == 1)
        let terminalClosure = await retirement.awaitClosure()
        precondition(terminalClosure && retirement.pendingCount == 0 && lease.state == .revoked)
        retirement.didTerminate(download) // A repeated terminal event cannot reopen the entry.
        precondition(retirement.pendingCount == 0)
        done()
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        do {
            let file = try RoutedDownloadFileLease(destination: root.appendingPathComponent("kept.bin"))
            lease = file
            precondition(file.staging.deletingLastPathComponent() != root)
            completionHandler(file.staging)
        } catch {
            completionHandler(nil)
            done(error)
        }
    }
    func downloadDidFinish(_ download: WKDownload) {
        precondition(mode != .retirement, "the streamed download finished before the explicit cancellation")
        guard let lease else { done(CocoaError(.fileNoSuchFile)); return }
        do {
            try lease.commit {
                // This rejection exercises local commit fencing, not a fake route permission.
                if mode == .denied { throw CocoaError(.userCancelled) }
            }
            precondition(mode == .success && lease.state == .committed)
            done()
        } catch {
            if mode == .denied {
                actualAuthorizationRejection = true
                precondition(lease.state == .revoked); done()
            } else { done(error) }
        }
    }
    func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
        actualFailures += 1
        if (mode == .retirement || mode == .lateRetirement) && retirementStarted { return }
        guard let lease else { done(error); return }
        if lease.state == .revoked { return } // Wait for the actual cancel completion.
        guard mode == .broken else { done(error); return }
        actualPartObserved = FileManager.default.fileExists(atPath: lease.staging.path)
        cancel(download, lease: lease)
    }
}

@main private struct Probe {
    @MainActor static func main() async throws {
        let retirementOnly = CommandLine.arguments.count == 4 && CommandLine.arguments[3] == "--retirement-only"
        guard CommandLine.arguments.count == 3 || retirementOnly, let base = URL(string: CommandLine.arguments[1]),
              base.scheme == "http", base.host == "127.0.0.1", base.port != nil else { throw CocoaError(.fileReadInvalidFileName) }
        NSApplication.shared.setActivationPolicy(.prohibited)
        let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        if retirementOnly {
            let driver = try Driver(base: base, root: root.appendingPathComponent("retirement"), mode: .retirement)
            try await driver.run()
            precondition(driver.actualPartObserved)
            let late = try Driver(base: base, root: root.appendingPathComponent("late-retirement"), mode: .lateRetirement)
            try await late.run()
            print("""
                {"status":"PASS","actualWKCancelCallback":true,"closureBeforeCallback":false,"ownedPartialRemoved":true,"existingFinalPreserved":true,"duplicateTerminalIgnored":true}
                """)
            return
        }
        let injected = try RoutedDownloadFileLease(destination: root.appendingPathComponent("untouched.bin"))
        try Data("original".utf8).write(to: injected.destination)
        try Data("owned".utf8).write(to: injected.staging)
        var callback: (@MainActor () -> Void)?, requests = 0
        injected.cancelTransport { requests += 1; callback = $0 }
        precondition(!FileManager.default.fileExists(atPath: injected.staging.path))
        // Deliberately injected write, clearly separate from real WebKit callback observations.
        injected.cancelTransport { _ in requests += 1 }
        // Inject the recreated staging directory as well; a retained writer with
        // an open file descriptor alone cannot recreate that removed pathname.
        try FileManager.default.createDirectory(at: injected.staging.deletingLastPathComponent(), withIntermediateDirectories: false)
        try Data("late owned write".utf8).write(to: injected.staging)
        callback?(); precondition(requests == 1 && !FileManager.default.fileExists(atPath: injected.staging.path))
        do { try injected.commit {}; preconditionFailure("revoked file committed") } catch {}
        let originalDestination = try Data(contentsOf: injected.destination)
        precondition(originalDestination == Data("original".utf8))

        let reentrant = try RoutedDownloadFileLease(destination: root.appendingPathComponent("reentrant.bin"))
        try Data("partial".utf8).write(to: reentrant.staging)
        do { try reentrant.commit { reentrant.revoke() }; preconditionFailure("reentrant revoke committed") } catch {}
        precondition(!FileManager.default.fileExists(atPath: reentrant.destination.path))

        let revokedAtPublish = try RoutedDownloadFileLease(destination: root.appendingPathComponent("revoked-before-publish.bin"))
        try Data("original".utf8).write(to: revokedAtPublish.destination)
        try Data("complete transfer".utf8).write(to: revokedAtPublish.staging)
        var publicationChecked = false
        do {
            try revokedAtPublish.commit(authorize: {}, beforePublish: {
                publicationChecked = true
                revokedAtPublish.revoke()
            })
            preconditionFailure("revocation at publication committed")
        } catch {}
        precondition(publicationChecked && revokedAtPublish.state == .revoked)
        let keptDestination = try Data(contentsOf: revokedAtPublish.destination)
        precondition(keptDestination == Data("original".utf8))
        precondition(!FileManager.default.fileExists(atPath: revokedAtPublish.staging.deletingLastPathComponent().path))
        let destinationEntries = try FileManager.default.contentsOfDirectory(atPath: root.path)
        precondition(destinationEntries.allSatisfy { !$0.hasPrefix(".ynx-download-") })

        var cancels = 0, failures = 0, part = false, rejection = false
        for (index, mode) in [Driver.Mode.cancel, .broken, .denied, .success].enumerated() {
            let driver = try Driver(base: base, root: root.appendingPathComponent("case-\(index)"), mode: mode)
            try await driver.run()
            cancels += driver.actualCancels; failures += driver.actualFailures
            part = part || driver.actualPartObserved; rejection = rejection || driver.actualAuthorizationRejection
        }
        precondition(cancels == 2 && failures >= 1 && part && rejection)
        let result: [String: Any] = ["status": "PASS", "realWKCancelCallbacks": cancels,
            "realFailureCallbacks": failures, "actualOwnedPartObserved": part,
            "oldFinalAndUnownedPartialPreserved": true, "injectedLateWriteRemoved": true,
            "duplicateCancelCoalesced": true, "revokedAndReentrantCommitRejected": true,
            "authorizationFailureRemovesPartial": rejection, "actualSuccessfulCommit": true,
            "stagingSeparateFromDestination": true, "revocationAtPublicationPreservesExistingFile": true,
            "normalSavePanel": "NOT_RUN", "privateRouteSafety": "NOT_RUN", "visibleGUI": "NOT_RUN"]
        print(String(data: try JSONSerialization.data(withJSONObject: result, options: .sortedKeys), encoding: .utf8)!)
    }
}
