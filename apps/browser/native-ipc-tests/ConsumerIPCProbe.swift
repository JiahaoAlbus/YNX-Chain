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
    var closed = false, active = 0, extracts = 0
    let directory: URL
    let mode: String
    private var producer: BrowserNativePageReadoutProducer!
    // PUBLIC DATA only. Independently fixed operands, not an Auth Source/Grant.
    private let session = BrowserOriginalPageReadRequest.Session(id: "PUBLIC-session", account: "PUBLIC-account", deviceID: "PUBLIC-holder",
        productClientID: "PUBLIC-ai-client", bundleID: "com.ynx.public.ai", sessionBinding: "PUBLIC-session-binding")
    private let taskRevision: UInt64 = 17, taskGeneration: UInt64 = 9_007_199_254_740_993
    private let runID = "PUBLIC_RUN_17"
    private let unknown = BrowserPageSelectionReference(selectionID: "00000000-0000-4000-8000-000000000099", version: String(repeating: "f", count: 128))
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
        producer = makeProducer(profileID: profile)
        try save(["pid": getpid(), "rootQualified": false, "authQualified": false,
            "references": sources.map { ["selectionId": $0.selectionID.uuidString, "version": $0.binding.sha512] },
            "metadata": sources.map { ["tabId": $0.document.tabID.uuidString, "profileId": $0.document.profileID,
                "generation": $0.document.generation, "origin": $0.document.origin, "fields": $0.fields,
                "bytes": $0.binding.bytes, "sha3_512": $0.binding.sha3_512] }], directory.appendingPathComponent("fixture.json"))
        if mode == "consumer-stale" { store.invalidate(tabID: sources[0].document.tabID) }
    }
    private func makeProducer(profileID: String) -> BrowserNativePageReadoutProducer {
        BrowserNativePageReadoutProducer(profileID: profileID, store: store, taskID: { preparation },
            windowCurrent: { [weak self] in try self?.requireCurrent() }, currentDocument: { [weak self] in self?.documents[$0] },
            extract: { [self] source in
                extracts += 1
                if mode == "consumer-cancel", source == sources[0] {
                    try save(["active": active, "borrowHeld": true], directory.appendingPathComponent("held.json"))
                    let deadline = ContinuousClock.now.advanced(by: .seconds(8))
                    while ContinuousClock.now < deadline {
                        try Task.checkCancellation()
                        if (try? String(contentsOf: directory.appendingPathComponent("signal"), encoding: .utf8)) == "navigate" {
                            store.invalidate(tabID: sources[0].document.tabID)
                            producer.close() // Actual Native close revokes the held local borrow.
                            break
                        }
                        try await Task.sleep(for: .milliseconds(20))
                    }
                }
                return content[source.document.tabID]!
            })
    }
    func requireCurrent() throws { if closed { throw BrowserPageIPCFailure.sourceRejected } }
    func readOriginalBrowserPageReadout(_ request: Data) async throws -> Data {
        try requireCurrent()
        let subcaseName = (try? String(contentsOf: directory.appendingPathComponent("scenario"), encoding: .utf8)) ?? "default"
        let references = subcaseName == "unknown-ref" ? [unknown] : sources.map(BrowserPageSelectionReference.init(source:))
        // No values are read or copied from request to create expected DATA.
        let expected = BrowserOriginalPageReadExpectedData(runID: runID, session: session,
            taskID: preparation, account: "PUBLIC-account", holder: "PUBLIC-holder", revision: taskRevision,
            generation: taskGeneration, references: references, queryOriginal: true, authorizationRef: "")
        let owned = subcaseName == "unknown-profile" ? makeProducer(profileID: "PUBLIC-unowned-profile") : producer!
        active += 1
        defer {
            if owned !== producer { owned.close() }
            active -= 1
            try? save(["active": active, "released": true, "extracts": extracts, "subcase": subcaseName], directory.appendingPathComponent("released.json"))
        }
        return try await owned.readOriginalBrowserPageReadout(request, expected: expected)
    }

    func close() async throws {
        producer.close(); closed = true; store.removeAll()
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
    func request(_ refs: Any) throws -> [String: Any] {
        ["schema": "YNX_AI_BROWSER_PAGE_READ_REQUEST_V1", "runId": "PUBLIC_RUN_17",
         "session": ["id": "PUBLIC-session", "account": "PUBLIC-account", "deviceId": "PUBLIC-holder",
            "productClientId": "PUBLIC-ai-client", "bundleId": "com.ynx.public.ai", "sessionBinding": "PUBLIC-session-binding"],
         "task": ["id": preparation, "account": "PUBLIC-account", "holder": "PUBLIC-holder", "revision": UInt64(17),
            "generation": UInt64(9_007_199_254_740_993), "conversationId": "PUBLIC-conversation", "status": "prepared",
            "createdAt": "2026-11-01T00:00:00Z", "updatedAt": "2026-11-01T00:00:00Z",
            "cancelledAt": "0001-01-01T00:00:00Z", "agentConfigurationId": "", "agentConfigurationRevision": 0],
         "references": refs, "queryOriginal": true]
    }
    func run(_ mode: String) async throws {
        let sub = directory.appendingPathComponent(mode)
        let connection = NSXPCConnection(serviceName: "com.ynx.public.pageipc." + mode)
        connection.remoteObjectInterface = NSXPCInterface(with: BrowserOriginalPageReadoutIPC.self)
        connection.resume(); defer { connection.invalidate() }
        _ = call(connection, Data()) // Transport rejects empty bytes; launches service only.
        try await wait("service-fixture", { FileManager.default.fileExists(atPath: sub.appendingPathComponent("fixture.json").path) })
        let fixture = try object(sub.appendingPathComponent("fixture.json"))
        var rejected = [String]()
        if mode == "consumer-bindings" {
            for variant in ["session", "task", "revision", "generation", "run", "unknown-ref", "unknown-profile"] {
                var input = try request(fixture["references"]!)
                if variant == "session" { var session = input["session"] as! [String: String]; session["id"] = "PUBLIC-other-session"; input["session"] = session }
                if ["task", "revision", "generation"].contains(variant) {
                    var task = input["task"] as! [String: Any]
                    if variant == "task" { task["id"] = "PUBLIC-other-task" }
                    if variant == "revision" { task["revision"] = UInt64(18) }
                    if variant == "generation" { task["generation"] = UInt64(9_007_199_254_740_994) }
                    input["task"] = task
                }
                if variant == "run" { input["runId"] = "PUBLIC_OTHER_RUN" }
                if variant == "unknown-ref" { input["references"] = [["selectionId": "00000000-0000-4000-8000-000000000099", "version": String(repeating: "f", count: 128)]] }
                try variant.write(to: sub.appendingPathComponent("scenario"), atomically: true, encoding: .utf8)
                let reply = call(connection, try JSONSerialization.data(withJSONObject: input, options: [.sortedKeys]))
                try await wait("binding-reply", { reply.take() != nil })
                guard reply.take()?.0 == nil, reply.take()?.1 == BrowserPageIPCFailure.sourceRejected.rawValue else { throw ProbeError.failed("binding-not-rejected-" + variant) }
                let observed = try object(sub.appendingPathComponent("released.json"))
                guard observed["active"] as? Int == 0, observed["extracts"] as? Int == 0,
                      observed["subcase"] as? String == variant else { throw ProbeError.failed("binding-used-DOM-" + variant) }
                rejected.append(variant)
            }
            try save(["variants": rejected, "extracts": 0], sub.appendingPathComponent("rejections.json"))
        } else {
            let input = try JSONSerialization.data(withJSONObject: request(fixture["references"]!), options: [.sortedKeys])
            try input.write(to: sub.appendingPathComponent("actual-P08-request.json"))
            let reply = call(connection, input)
            if mode == "consumer-cancel" {
                try await wait("borrow-held", { FileManager.default.fileExists(atPath: sub.appendingPathComponent("held.json").path) })
                try "navigate".write(to: sub.appendingPathComponent("signal"), atomically: true, encoding: .utf8)
            }
            try await wait("consumer-reply", { reply.take() != nil })
            let result = reply.take()!
            if mode == "consumer-cancel" {
                guard result.0 == nil, result.1 == BrowserPageIPCFailure.sourceRejected.rawValue else { throw ProbeError.failed("cancel-returned-body") }
            } else {
                guard let data = result.0, result.1 == nil,
                      let batch = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      batch["schema"] as? String == BrowserPageReadBatch.schema,
                      let pages = batch["pages"] as? [[String: Any]], pages.count == 3 else { throw ProbeError.failed("consumer-3-pages") }
                for (index, page) in pages.enumerated() {
                    let original = (fixture["references"] as! [[String: String]])[index]
                    guard page["reference"] as? [String: String] == original else { throw ProbeError.failed("changed-original-reference") }
                    if mode == "consumer-stale", index == 0 {
                        guard page["state"] as? String == "STALE", page["snapshotUTF8"] == nil else { throw ProbeError.failed("stale-old-body") }
                    } else {
                        guard let raw = (page["snapshotUTF8"] as? String)?.data(using: .utf8), page["state"] as? String == "AVAILABLE",
                              BrowserPageBinding.digest(raw).sha512 == original["version"],
                              BrowserPageBinding.digest(raw).sha3_512 == page["sha3_512"] as? String,
                              raw.count == page["bytes"] as? Int,
                              String(decoding: raw, as: UTF8.self).contains("PUBLIC_SYNTHETIC_PAGE_\(index)") else { throw ProbeError.failed("actual-Core-byte-binding") }
                    }
                }
                try data.write(to: sub.appendingPathComponent("actual-public-readout.json"))
            }
        }
        try "close".write(to: sub.appendingPathComponent("shutdown"), atomically: true, encoding: .utf8)
        try await wait("owner-close", { FileManager.default.fileExists(atPath: sub.appendingPathComponent("closed.json").path) })
        let closed = try object(sub.appendingPathComponent("closed.json"))
        guard closed["closed"] as? Bool == true, closed["active"] as? Int == 0 else { throw ProbeError.failed("cleanup-debt") }
        let pid = (fixture["pid"] as! NSNumber).int32Value
        try await wait("original-child-exit", { kill(pid, 0) != 0 && errno == ESRCH })
        rows.append(["case": mode, "status": "PASS", "servicePID": pid, "rejectedVariants": rejected, "childExited": true, "RootAuthQualification": "NOT_RUN"])
        try save(["cases": rows], directory.appendingPathComponent("progress.json"))
    }

    func all() async -> Int32 {
        do {
            for mode in ["consumer-valid", "consumer-bindings", "consumer-cancel", "consumer-stale"] { try await run(mode) }
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
