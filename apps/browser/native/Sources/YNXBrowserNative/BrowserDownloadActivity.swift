import Darwin
import Foundation
import YNXBrowserCore

/// Window-local presentation and cancellation fence for one exact WKDownload lifetime.
/// This is never persisted; only the existing successful file-commit path writes history.
@MainActor final class BrowserDownloadActivity {
    enum Phase: Equatable { case starting, choosingDestination, transferring, cancelling, cancelled, failed, completed }
    let id = UUID()
    let isPrivate: Bool
    let source: String
    private(set) var title = "Download"
    private(set) var phase: Phase = .starting
    private(set) var failureMessage: String?
    private(set) var percent: Int?
    private var decision: BrowserDownloadDecision?
    private var saveRecovery: BrowserDownloadFile.OrdinaryRecovery?
    private var cancellationStarted = false
    private let changed: () -> Void

    init(context: BrowserDownloadContext, changed: @escaping () -> Void) {
        isPrivate = context.isPrivate; source = context.source; self.changed = changed
    }
    var canCancel: Bool { [.starting, .choosingDestination, .transferring].contains(phase) }
    var canFinish: Bool { phase == .transferring }
    var canSaveAgain: Bool { phase == .failed && saveRecovery != nil }
    var isTerminal: Bool { [.cancelled, .failed, .completed].contains(phase) }
    var status: String {
        switch phase {
        case .starting: return "Starting download…"
        case .choosingDestination: return "Choose where to save…"
        case .transferring: return percent.map { "Downloading · \($0)%" } ?? "Downloading…"
        case .cancelling: return "Cancelling…"
        case .cancelled: return "Cancelled · no completion recorded"
        case .failed: return failureMessage ?? "Failed · no completion recorded"
        case .completed: return isPrivate ? "Completed · private, not saved in history" : "Completed"
        }
    }
    @discardableResult func attachDecision(_ ticket: BrowserDownloadDecision, suggestedFilename: String) -> Bool {
        guard canCancel else { ticket.cancel(); return false }
        decision = ticket; title = suggestedFilename; phase = .choosingDestination; changed(); return true
    }
    @discardableResult func destinationChosen(filename: String) -> Bool {
        guard phase == .choosingDestination, decision?.isPending == true else { return false }
        title = filename; phase = .transferring; changed(); return true
    }
    func updateProgress(completed: Int64, total: Int64, indeterminate: Bool) {
        guard phase == .transferring else { return }
        let next = !indeterminate && total > 0 && completed >= 0
            ? Int(min(100, max(0, Double(completed) / Double(total) * 100))) : nil
        guard next != percent else { return }
        percent = next; changed()
    }
    /// Owner close sets every activity's fence before revoking any callback.
    func prepareCancellation() {
        guard canCancel else { return }
        phase = .cancelling; percent = nil; changed()
    }
    /// Mark first, revoke the exact destination callback second, then end the owned panel
    /// and cancel the transport. A reentrant/late finish cannot pass canFinish afterwards.
    @discardableResult func cancel(revokePanel: () -> Void,
        cancelTransport: (@escaping @MainActor () -> Void) -> Void,
        cleanupOwnPartial: @escaping @MainActor () -> Void) -> Bool {
        prepareCancellation()
        guard phase == .cancelling, !cancellationStarted else { return false }
        cancellationStarted = true
        let ticket = decision; decision = nil
        ticket?.cancel()
        revokePanel()
        cleanupOwnPartial()
        cancelTransport { [weak self] in
            cleanupOwnPartial()
            guard let self, self.phase == .cancelling else { return }
            self.phase = .cancelled; self.changed()
        }
        return true
    }
    func fail(_ message: String) {
        guard canCancel else { return }
        phase = .failed; percent = nil; failureMessage = message; decision = nil; changed()
    }
    @discardableResult func finishSave(staging: URL, destination: URL, defaults: UserDefaults) -> Bool {
        guard canFinish else { return false }
        let recovery: BrowserDownloadFile.OrdinaryRecovery
        do { recovery = try .init(staging: staging) }
        catch {
            // A rejected entry is no longer a verified payload. Remove only its empty parent.
            staging.deletingLastPathComponent().withUnsafeFileSystemRepresentation { path in
                if let path { _ = Darwin.rmdir(path) }
            }
            fail("Could not read the downloaded file")
            return false
        }
        do { try recovery.save(to: destination) }
        catch {
            if isPrivate { recovery.discard() } else { saveRecovery = recovery }
            fail(isPrivate ? "Could not save the private download" : "Could not save · choose another location")
            return false
        }
        recordSavedFile(at: destination, defaults: defaults, recovery: recovery)
        return true
    }

    @discardableResult func saveAgain(to destination: URL, defaults: UserDefaults) -> Bool {
        guard phase == .failed, let recovery = saveRecovery else { return false }
        do { try recovery.save(to: destination) }
        catch {
            failureMessage = "Could not save · choose another location"
            changed()
            return false
        }
        saveRecovery = nil
        recordSavedFile(at: destination, defaults: defaults, recovery: recovery)
        return true
    }

    func discardSaveRecovery() {
        saveRecovery?.discard()
        saveRecovery = nil
    }

    private func recordSavedFile(at destination: URL, defaults: UserDefaults, recovery: BrowserDownloadFile.OrdinaryRecovery) {
        recovery.discard()
        title = destination.lastPathComponent
        BrowserDownloadPersistence.persistFinishedDownload(
            context: .init(source: source, isPrivate: isPrivate, destinationFilename: title), defaults: defaults)
        phase = .completed; percent = nil; decision = nil; failureMessage = nil; changed()
    }

    @discardableResult func complete() -> Bool {
        guard canFinish else { return false }
        phase = .completed; percent = nil; decision = nil; changed(); return true
    }
}
