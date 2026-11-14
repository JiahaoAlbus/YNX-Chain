import AppKit
import WebKit
import YNXBrowserCore

@MainActor private final class DownloadDriver: NSObject, WKDownloadDelegate {
    enum Mode: Equatable { case cancel, choosingCancel, queuedResolveCancel, close, broken, success, privateSuccess, saveAgain, discardRecovery, privateSaveFailure }
    private let view: WKWebView
    private let defaults: UserDefaults
    private let base: URL
    private let directory: URL
    private let ledger = BrowserDownloadDecisionLedger()
    private var activity: BrowserDownloadActivity!
    private var actualDownload: WKDownload?
    private var progressObservation: NSKeyValueObservation?
    private var continuation: CheckedContinuation<Void, any Error>?
    private var staging: URL?
    private var destination: URL!
    private var mode: Mode = .cancel
    private var context: BrowserDownloadContext!
    private(set) var cancelCallbacks = 0
    private(set) var failureCallbacks = 0
    private(set) var finishCallbacks = 0
    private(set) var observedActualProgress = false
    private(set) var partExistedBeforeCancellation = false
    private(set) var rejectedLateCallbacks = false

    init(base: URL, directory: URL, defaults: UserDefaults) {
        self.base = base; self.directory = directory; self.defaults = defaults
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        view = WKWebView(frame: .zero, configuration: configuration)
        super.init()
    }
    func run(_ mode: Mode) async throws {
        self.mode = mode
        let saves = [.success, .privateSuccess, .saveAgain, .discardRecovery, .privateSaveFailure].contains(mode)
        let path = mode == .broken ? "broken" : saves ? "success" : "slow"
        let url = base.appendingPathComponent(path)
        context = .init(source: url.absoluteString, isPrivate: [.privateSuccess, .privateSaveFailure].contains(mode), destinationFilename: "kept.bin")
        activity = BrowserDownloadActivity(context: context, changed: {})
        if [.saveAgain, .discardRecovery, .privateSaveFailure].contains(mode) {
            destination = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false)
        } else {
            destination = directory.appendingPathComponent("kept.bin")
        }
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            view.startDownload(using: URLRequest(url: url)) { [weak self] download in
                guard let self else { return }
                self.actualDownload = download
                self.progressObservation = download.progress.observe(\.fractionCompleted, options: [.initial, .new]) { [weak self] progress, _ in
                    let completed = progress.completedUnitCount, total = progress.totalUnitCount, indeterminate = progress.isIndeterminate
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        self.activity.updateProgress(completed: completed, total: total, indeterminate: indeterminate)
                        if total > 0 && completed > 0 { self.observedActualProgress = true }
                        if [.cancel, .close].contains(self.mode), completed > 0, self.activity.canCancel {
                            self.partExistedBeforeCancellation = self.staging.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
                            if self.mode == .close { self.activity.prepareCancellation(); self.ledger.close() }
                            self.cancel(download)
                        }
                    }
                }
                download.delegate = self
            }
        }
        try await Task.sleep(for: .milliseconds(100))
        progressObservation = nil
        precondition(staging.map { !FileManager.default.fileExists(atPath: $0.path) } ?? true)
    }
    private func done() { let pending = continuation; continuation = nil; pending?.resume() }
    private func cleanup() { if let staging { BrowserDownloadFile.discardOrdinaryStaging(staging) } }
    private func cancel(_ download: WKDownload) {
        let cancelled = activity.cancel(revokePanel: {
            precondition(self.ledger.pendingCount == 0, "exact destination must be revoked before panel/transport cancellation")
        }, cancelTransport: { completion in
            download.cancel { [weak self] _ in
                guard let self else { return }
                self.cancelCallbacks += 1
                completion()
                precondition(self.activity.phase == .cancelled)
                // Inject terminal callbacks into the same fence used by main.swift. These
                // are explicitly injections, not claimed WebKit late-callback observations.
                self.activity.fail("injected late failure")
                self.activity.updateProgress(completed: 100, total: 100, indeterminate: false)
                self.rejectedLateCallbacks = !self.activity.complete() && !self.activity.canFinish
                precondition(self.activity.percent == nil && self.activity.phase == .cancelled)
                self.done()
            }
        }, cleanupOwnPartial: { self.cleanup() })
        precondition(cancelled)
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        let ticket = ledger.begin(downloadID: ObjectIdentifier(download), completion: completionHandler)
        precondition(activity.attachDecision(ticket, suggestedFilename: suggestedFilename))
        precondition(activity.phase == .choosingDestination && activity.percent == nil)
        if mode == .choosingCancel { cancel(download); return }
        do {
            staging = try BrowserDownloadFile.makeOrdinaryStagingURL()
        } catch {
            ticket.cancel()
            let pending = continuation; continuation = nil; pending?.resume(throwing: error)
            return
        }
        precondition(staging?.deletingLastPathComponent() != destination.deletingLastPathComponent())
        precondition(activity.destinationChosen(filename: destination.lastPathComponent))
        activity.updateProgress(completed: 20, total: 0, indeterminate: true)
        precondition(activity.percent == nil, "unknown progress must not become a fabricated percentage")
        if mode == .queuedResolveCancel {
            cancel(download)
            precondition(!ticket.resolve(staging), "queued old destination must not resurrect")
        } else { precondition(ticket.resolve(staging)) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        finishCallbacks += 1
        guard activity.canFinish else { cleanup(); return }
        do {
            let previous = defaults.data(forKey: BrowserDownloadPersistence.defaultsKey)
            let saved = activity.finishSave(staging: staging!, destination: destination, defaults: defaults)
            if [.success, .privateSuccess].contains(mode) {
                precondition(saved && activity.phase == .completed)
            } else {
                precondition([.saveAgain, .discardRecovery, .privateSaveFailure].contains(mode))
                precondition(!saved && activity.phase == .failed && !activity.canFinish)
                precondition(defaults.data(forKey: BrowserDownloadPersistence.defaultsKey) == previous)
                let retry = directory.appendingPathComponent(UUID().uuidString + "-recovered.bin")
                if mode == .privateSaveFailure {
                    precondition(!activity.canSaveAgain && !FileManager.default.fileExists(atPath: staging!.path))
                    precondition(!activity.saveAgain(to: retry, defaults: defaults))
                } else {
                    let bytes = try Data(contentsOf: staging!)
                    precondition(bytes == Data(repeating: 0x5a, count: 65_536) && activity.canSaveAgain)
                    activity.fail("injected late transport failure")
                    precondition(!activity.complete() && activity.canSaveAgain)
                    if mode == .discardRecovery {
                        activity.discardSaveRecovery()
                        precondition(!activity.saveAgain(to: retry, defaults: defaults))
                    } else {
                        precondition(!activity.saveAgain(to: destination, defaults: defaults) && activity.canSaveAgain)
                        precondition(activity.saveAgain(to: retry, defaults: defaults) && activity.phase == .completed)
                        let published = try Data(contentsOf: retry)
                        precondition(published == bytes)
                        precondition(!activity.saveAgain(to: retry, defaults: defaults))
                        let records = BrowserDownloadPersistence.decodeRecords(from: defaults.data(forKey: BrowserDownloadPersistence.defaultsKey))
                        precondition(records.count == 1 && records[0].filename == retry.lastPathComponent && records[0].source == context.source)
                    }
                }
                precondition(FileManager.default.fileExists(atPath: destination.path))
            }
            done()
        } catch { let pending = continuation; continuation = nil; pending?.resume(throwing: error) }
    }
    func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
        failureCallbacks += 1
        cleanup()
        if activity.phase == .cancelling || activity.phase == .cancelled { return }
        precondition(mode == .broken, "unexpected actual WebKit failure: \(error)")
        activity.fail("Failed · no completion recorded")
        precondition(activity.phase == .failed && !activity.canFinish)
        done()
    }
}

@main private struct ActivityProbe {
    @MainActor static func main() async throws {
        guard [3, 4].contains(CommandLine.arguments.count), let base = URL(string: CommandLine.arguments[1]),
              base.host == "127.0.0.1", base.scheme == "http", base.port != nil else { throw CocoaError(.fileReadInvalidFileName) }
        NSApplication.shared.setActivationPolicy(.prohibited) // Never activated, no NSWindow/panel created.
        let directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        let suite = "com.ynx.browser.activity-delta.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        precondition(defaults.persistentDomain(forName: suite) == nil)
        let marker = UUID().uuidString
        defaults.set(marker, forKey: "testOwner")
        defer {
            if defaults.string(forKey: "testOwner") == marker { defaults.removePersistentDomain(forName: suite); defaults.synchronize() }
        }
        func verifySaveRecovery(using recoveryDefaults: UserDefaults) async throws {
            for mode: DownloadDriver.Mode in [.privateSaveFailure, .discardRecovery, .saveAgain] {
                let driver = DownloadDriver(base: base, directory: directory, defaults: recoveryDefaults)
                try await driver.run(mode)
                precondition(driver.failureCallbacks == 0 && driver.finishCallbacks == 1)
            }
        }
        if CommandLine.arguments.last == "--save-recovery-only" {
            try await verifySaveRecovery(using: defaults)
            print(#"{"status":"PASS","actualCompletedDownloads":3,"recoverySavedAfterFinalDestinationFailure":true,"ownerDiscardAndPrivateFailureRemovedStaging":true,"installedDownloadsUI":"NOT_RUN"}"#)
            return
        }
        let destination = directory.appendingPathComponent("kept.bin"), sentinel = directory.appendingPathComponent(".ynx-download-unowned.part")
        let original = Data("existing completed file remains untouched".utf8), unowned = Data("unowned partial remains untouched".utf8)
        try original.write(to: destination); try unowned.write(to: sentinel)
        var actualCancelCallbacks = 0, networkFailures = 0, actualProgress = false, actualPart = false
        for mode: DownloadDriver.Mode in [.choosingCancel, .queuedResolveCancel, .cancel, .close, .broken] {
            let driver = DownloadDriver(base: base, directory: directory, defaults: defaults)
            try await driver.run(mode)
            let kept = try Data(contentsOf: destination), retained = try Data(contentsOf: sentinel)
            precondition(kept == original && retained == unowned)
            precondition(BrowserDownloadPersistence.decodeRecords(from: defaults.data(forKey: "downloads")).isEmpty)
            actualCancelCallbacks += driver.cancelCallbacks; networkFailures += driver.failureCallbacks
            actualProgress = actualProgress || driver.observedActualProgress; actualPart = actualPart || driver.partExistedBeforeCancellation
            if mode != .broken { precondition(driver.rejectedLateCallbacks) }
        }
        let ordinary = DownloadDriver(base: base, directory: directory, defaults: defaults)
        try await ordinary.run(.success)
        let records = BrowserDownloadPersistence.decodeRecords(from: defaults.data(forKey: "downloads"))
        precondition(records.count == 1 && records[0].filename == "kept.bin")
        let privateDriver = DownloadDriver(base: base, directory: directory, defaults: defaults)
        try await privateDriver.run(.privateSuccess)
        precondition(BrowserDownloadPersistence.decodeRecords(from: defaults.data(forKey: "downloads")) == records)
        let finishedBytes = try Data(contentsOf: destination), sentinelBytes = try Data(contentsOf: sentinel)
        precondition(finishedBytes == Data(repeating: 0x5a, count: 65536) && sentinelBytes == unowned)
        precondition(actualCancelCallbacks == 4 && networkFailures >= 1 && actualProgress && actualPart)
        defaults.removeObject(forKey: BrowserDownloadPersistence.defaultsKey)
        try await verifySaveRecovery(using: defaults)
        let receipt: [String: Any] = ["schema": "YNX_DOWNLOAD_ACTIVITY_WEBKIT_DELTA_V1", "status": "PASS",
            "realWKCancelCallbacks": actualCancelCallbacks, "actualNetworkFailureCallbacks": networkFailures,
            "actualProgressAndOwnedPartObserved": actualProgress && actualPart,
            "choosingAndQueuedDestinationRevoked": true, "ownerCloseFence": true,
            "injectedLateCallbackFence": true, "existingFinalAndUnownedPartPreserved": true,
            "ordinaryCompletionRecords": records.count, "privateAddsNoCompletionRecord": true,
            "actualSaveRecoveryCallbacks": 3,
            "webKitDestinationSeparateFromSelectedDirectory": true,
            "dataStore": "nonPersistent", "network": "numeric-loopback-only",
            "visibleGUI": "NOT_RUN", "normalUserSavePanel": "NOT_RUN", "installedDownloadsUI": "NOT_RUN"]
        let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
    }
}
