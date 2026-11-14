import Foundation
import Security
import Darwin
import YNXBrowserCore

private let hostIdentifier = "com.ynx.public.pageipc.host"
private let preparation = "PUBLIC-IPC-PREPARATION"
private let profile = "PUBLIC-ordinary"
private enum ProbeError: Error { case failed(String) }
private func save(_ value: Any, _ path: URL) throws {
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: path, options: .atomic)
}
private func object(_ path: URL) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(contentsOf: path)) as! [String: Any]
}
private func codeHash(_ executable: URL) throws -> (String, String) {
    var code: SecStaticCode?, info: CFDictionary?
    guard SecStaticCodeCreateWithPath(executable as CFURL, [], &code) == errSecSuccess, let code,
          SecStaticCodeCheckValidity(code, [], nil) == errSecSuccess,
          SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let info = info as? [String: Any], let identifier = info[kSecCodeInfoIdentifier as String] as? String,
          let hash = info[kSecCodeInfoUnique as String] as? Data else { throw ProbeError.failed("actual-code-signature") }
    return (identifier, hash.map { String(format: "%02x", $0) }.joined())
}

#if PUBLIC_IPC_SERVICE
/// PUBLIC fixture owner only; never claims Original Auth/Root qualification.
@MainActor private final class PublicOwner: BrowserOriginalPageReadoutOwner {
    let store = BrowserPageSelectionStore()
    var documents: [UUID: BrowserPageDocument] = [:]
    var content: [UUID: BrowserPageContent] = [:]
    var sources: [BrowserPageSource] = []
    var closed = false, active = 0
    let directory: URL
    let mode: String
    init(directory: URL, mode: String) throws {
        self.directory = directory; self.mode = mode
        let confirmations = (0..<3).map { index -> BrowserPageConfirmation in
            let doc = BrowserPageDocument(tabID: UUID(), profileID: profile, generation: 1,
                origin: "https://example.org", isPrivate: false)
            let text = BrowserPageContent(url: "https://example.org/public/\(index)", title: "PUBLIC page \(index)", text: "PUBLIC_SYNTHETIC_PAGE_\(index)")
            documents[doc.tabID] = doc; content[doc.tabID] = text
            return .init(document: doc, taskID: preparation, allowedFields: ["title", "text"], content: text, confirmed: true)
        }
        sources = try store.selectPages(confirmations)
        try save(["pid": getpid(), "rootQualified": false, "authQualified": false,
                  "references": sources.map { ["selectionId": $0.selectionID.uuidString, "version": $0.binding.sha512] }], directory.appendingPathComponent("fixture.json"))
    }
    func requireCurrent() throws { if closed { throw BrowserPageIPCFailure.sourceRejected } }
    func readOriginalBrowserPageReadout(_ request: Data) async throws -> Data {
        try requireCurrent()
        let input = try JSONSerialization.jsonObject(with: request) as? [String: Any]
        guard input?["schema"] as? String == "YNX_AI_BROWSER_PAGE_READ_REQUEST_V1",
              let refs = input?["references"] as? [[String: String]] else { throw BrowserPageIPCFailure.sourceRejected }
        let references = refs.map { BrowserPageSelectionReference(selectionID: $0["selectionId"] ?? "", version: $0["version"] ?? "") }
        let borrow = try store.borrowSelectedPages(references, taskID: preparation, profileID: profile, currentDocument: { [weak self] in self?.documents[$0] })
        active += 1
        defer {
            borrow.close(); active -= 1
            try? save(["active": active, "released": true], directory.appendingPathComponent("released.json"))
        }
        let batch = try await borrow.read { source in
            if source == self.sources[0] {
                try save(["active": self.active, "borrowHeld": true], self.directory.appendingPathComponent("held.json"))
                if ["busy", "cancel", "navigate", "clear", "exit"].contains(self.mode) {
                    let deadline = ContinuousClock.now.advanced(by: .seconds(8))
                    while ContinuousClock.now < deadline {
                        try Task.checkCancellation()
                        if let action = try? String(contentsOf: self.directory.appendingPathComponent("signal"), encoding: .utf8) {
                            if action == "navigate" { self.store.invalidate(tabID: self.sources[0].document.tabID); break }
                            if action == "clear" { self.store.removeAll(); break }
                            if action == "exit" { _exit(73) }
                            if action == "continue" { break }
                        }
                        try await Task.sleep(for: .milliseconds(20))
                    }
                }
            }
            return self.content[source.document.tabID]!
        }
        try borrow.requireCurrent()
        if mode == "response-limit" { return Data(repeating: 65, count: BrowserPageProtectedIPC.maximumResponseBytes + 1) }
        return try batch.encoded()
    }
    func close() async throws {
        closed = true; store.removeAll()
        guard active == 0 else { throw ProbeError.failed("PUBLIC-owner-children-retained") }
        try save(["closed": true, "active": active, "pid": getpid()], directory.appendingPathComponent("closed.json"))
    }
}

private final class PublicServiceDelegate: NSObject, NSXPCListenerDelegate, @unchecked Sendable {
    let owner: PublicOwner
    let directory: URL, mode: String, host: URL
    var transport: BrowserPageProtectedIPC?
    init(owner: PublicOwner, directory: URL, mode: String, host: URL) { self.owner = owner; self.directory = directory; self.mode = mode; self.host = host }
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        do {
            // Fixture registration derives the incarnation from this actual OS connection,
            // and code hash from the already sealed test Host executable, never request DATA.
            let (identifier, actualHash) = try codeHash(host)
            guard identifier == hostIdentifier else { return false }
            let hash = mode == "wrong-code" ? String(repeating: "0", count: actualHash.count) : actualHash
            let pid = mode == "wrong-peer" ? connection.processIdentifier + 1 : connection.processIdentifier
            let peer = try BrowserPageIPCPeer(pid: pid, uid: connection.effectiveUserIdentifier, identifier: identifier, codeDirectoryHash: hash)
            let service = BrowserPageProtectedIPC(listener: listener, peer: peer, owner: owner)
            transport = service
            return service.listener(listener, shouldAcceptNewConnection: connection)
        } catch { return false }
    }
}

@main private struct PublicIPCMain {
    @MainActor static func main() {
        do {
            let info = Bundle.main.infoDictionary!
            let directory = URL(fileURLWithPath: info["PUBLICFixtureDirectory"] as! String)
            let mode = info["PUBLICFixtureMode"] as! String
            let owner = try PublicOwner(directory: directory, mode: mode)
            let listener = NSXPCListener.service()
            let delegate = PublicServiceDelegate(owner: owner, directory: directory, mode: mode, host: URL(fileURLWithPath: info["PUBLICHostExecutable"] as! String))
            listener.delegate = delegate
            Task { @MainActor in
                while true {
                    if (try? String(contentsOf: directory.appendingPathComponent("shutdown"), encoding: .utf8)) == "close" {
                        do { if let transport = delegate.transport { try await transport.close() } else { try await owner.close(); listener.invalidate() }; exit(0) }
                        catch { try? save(["error": "PUBLIC-close-failed"], directory.appendingPathComponent("close-error.json")); exit(74) }
                    }
                    try? await Task.sleep(for: .milliseconds(20))
                }
            }
            // service().resume enters xpc_main/dispatch_main itself. It must be
            // the synchronous process entry, never a block already on main queue.
            withExtendedLifetime(delegate) { listener.resume() }
        } catch { exit(75) }
    }
}

#else
private final class ReplyBox: @unchecked Sendable {
    let lock = NSLock()
    var result: (Data?, String?)?
    func put(_ data: Data?, _ error: String?) { lock.lock(); if result == nil { result = (data, error) }; lock.unlock() }
    func take() -> (Data?, String?)? { lock.lock(); defer { lock.unlock() }; return result }
}
@MainActor private final class HostJourney {
    let directory: URL
    var rows: [[String: Any]] = []
    init(directory: URL) { self.directory = directory }
    func wait(_ label: String, _ predicate: () -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while !predicate() {
            if ContinuousClock.now >= deadline { throw ProbeError.failed("timeout-" + label) }
            try await Task.sleep(for: .milliseconds(20))
        }
    }
    func call(_ connection: NSXPCConnection, _ bytes: Data) -> ReplyBox {
        let box = ReplyBox()
        let failure: @Sendable (Error) -> Void = { _ in box.put(nil, "XPC_CONNECTION_LOST") }
        let proxy = connection.remoteObjectProxyWithErrorHandler(failure) as! BrowserOriginalPageReadoutIPC
        proxy.readOriginalBrowserPageReadout(bytes) { box.put($0, $1) }
        return box
    }
    func run(_ mode: String) async throws {
        let sub = directory.appendingPathComponent(mode)
        let connection = NSXPCConnection(serviceName: "com.ynx.public.pageipc." + mode)
        connection.remoteObjectInterface = NSXPCInterface(with: BrowserOriginalPageReadoutIPC.self)
        let lost = ReplyBox()
        connection.invalidationHandler = { lost.put(nil, "INVALIDATED") }
        connection.interruptionHandler = { lost.put(nil, "INTERRUPTED") }
        connection.resume()
        defer { connection.invalidate() }
        // The first ordinary message causes the embedded service to launch. This tiny
        // invalid request is rejected by production transport, not an activation protocol.
        let launch = call(connection, Data())
        _ = launch
        try await wait("service-fixture", { FileManager.default.fileExists(atPath: sub.appendingPathComponent("fixture.json").path) })
        let fixture = try object(sub.appendingPathComponent("fixture.json"))
        let request = try JSONSerialization.data(withJSONObject: ["schema": "YNX_AI_BROWSER_PAGE_READ_REQUEST_V1",
            "session": ["id": "PUBLIC-session", "account": "PUBLIC-account", "deviceId": "PUBLIC-holder"],
            "task": ["id": "PUBLIC-task", "revision": 1, "generation": 1, "holder": "PUBLIC-holder", "account": "PUBLIC-account"],
            "references": fixture["references"]!, "queryOriginal": true], options: [.sortedKeys])
        let bytes = mode == "request-limit" ? Data(repeating: 65, count: BrowserPageProtectedIPC.maximumRequestBytes + 1) : request
        let reply = call(connection, bytes)
        var additional: String?
        if ["busy", "cancel", "navigate", "clear", "exit"].contains(mode) {
            try await wait("borrow-held", { FileManager.default.fileExists(atPath: sub.appendingPathComponent("held.json").path) })
            if mode == "busy" {
                let second = call(connection, request)
                try await wait("busy", { second.take() != nil })
                guard second.take()?.0 == nil, second.take()?.1 == BrowserPageIPCFailure.busy.rawValue else { throw ProbeError.failed("busy-not-rejected") }
                additional = "one-call-busy-rejected"
            }
            if mode == "cancel" { connection.invalidate() }
            else { try (mode == "busy" ? "continue" : mode).write(to: sub.appendingPathComponent("signal"), atomically: true, encoding: .utf8) }
        }
        if mode == "cancel" {
            try await wait("cancel-release", { FileManager.default.fileExists(atPath: sub.appendingPathComponent("released.json").path) })
            guard reply.take()?.0 == nil else { throw ProbeError.failed("cancel-returned-body") }
        } else {
            try await wait("reply", { reply.take() != nil || lost.take() != nil })
            let result = reply.take() ?? (nil, "XPC_CONNECTION_LOST")
            if mode == "normal" || mode == "busy" {
                guard let data = result.0, result.1 == nil,
                      let batch = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      batch["schema"] as? String == BrowserPageReadBatch.schema,
                      let pages = batch["pages"] as? [[String: Any]], pages.count == 3 else { throw ProbeError.failed("normal-3-pages") }
                for (index, page) in pages.enumerated() {
                    guard let raw = (page["snapshotUTF8"] as? String)?.data(using: .utf8),
                          let ref = page["reference"] as? [String: String],
                          BrowserPageBinding.digest(raw).sha512 == ref["version"],
                          BrowserPageBinding.digest(raw).sha3_512 == page["sha3_512"] as? String,
                          raw.count == page["bytes"] as? Int,
                          String(decoding: raw, as: UTF8.self).contains("PUBLIC_SYNTHETIC_PAGE_\(index)") else { throw ProbeError.failed("actual-Core-byte-binding") }
                }
                try data.write(to: sub.appendingPathComponent("actual-public-readout.json"))
            } else {
                guard result.0 == nil, result.1 != nil else { throw ProbeError.failed("rejection-returned-body") }
                if mode == "request-limit", result.1 != BrowserPageIPCFailure.requestLimit.rawValue { throw ProbeError.failed("wrong-request-limit-error") }
                if mode == "response-limit", result.1 != BrowserPageIPCFailure.responseLimit.rawValue { throw ProbeError.failed("wrong-response-limit-error") }
            }
        }
        if mode != "exit" {
            try "close".write(to: sub.appendingPathComponent("shutdown"), atomically: true, encoding: .utf8)
            try await wait("owner-close", { FileManager.default.fileExists(atPath: sub.appendingPathComponent("closed.json").path) })
            let closed = try object(sub.appendingPathComponent("closed.json"))
            guard closed["closed"] as? Bool == true, closed["active"] as? Int == 0 else { throw ProbeError.failed("cleanup-debt") }
        }
        let pid = (fixture["pid"] as! NSNumber).int32Value
        try await wait("original-child-exit", { kill(pid, 0) != 0 && errno == ESRCH })
        rows.append(["case": mode, "status": "PASS", "servicePID": pid, "additional": additional ?? "", "childExited": true, "RootAuthQualification": "NOT_RUN"])
        try save(["cases": rows], directory.appendingPathComponent("progress.json"))
    }
    func all() async -> Int32 {
        do {
            for mode in ["normal", "wrong-peer", "wrong-code", "request-limit", "response-limit", "busy", "cancel", "navigate", "clear", "exit"] { try await run(mode) }
            try save(["status": "PASS", "cases": rows, "RootAuthQualification": "NOT_RUN", "network": "NOT_RUN"], directory.appendingPathComponent("RESULT.json"))
            return 0
        } catch {
            try? save(["status": "FAIL", "error": String(describing: error), "cases": rows, "RootAuthQualification": "NOT_RUN"], directory.appendingPathComponent("RESULT.json"))
            return 1
        }
    }
}
@main private struct PublicIPCMain {
    static func main() {
        guard CommandLine.arguments.count == 2 else { exit(64) }
        Task { @MainActor in exit(await HostJourney(directory: URL(fileURLWithPath: CommandLine.arguments[1])).all()) }
        dispatchMain()
    }
}
#endif
