import Foundation
import Security
import Darwin

private enum PublicFailure: Error { case assertion(String) }
private func check(_ condition: Bool, _ label: String) throws { if !condition { throw PublicFailure.assertion(label) } }
private func write(_ value: [String: Any], _ url: URL) throws {
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: url, options: .atomic)
}
private func publicCodeIdentity(_ url: URL) throws -> (String, String) {
    var code: SecStaticCode?, info: CFDictionary?
    guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let code,
          SecStaticCodeCheckValidity(code, [], nil) == errSecSuccess,
          SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let values = info as? [String: Any], let id = values[kSecCodeInfoIdentifier as String] as? String,
          let bytes = values[kSecCodeInfoUnique as String] as? Data else { throw PublicFailure.assertion("actual-code") }
    return (id, bytes.map { String(format: "%02x", $0) }.joined())
}
private final class PublicReply: @unchecked Sendable {
    private let lock = NSLock()
    private var value: (Data?, String?)?
    func put(_ body: Data?, _ error: String?) { lock.lock(); defer { lock.unlock() }; if value == nil { value = (body, error) } }
    func take() -> (Data?, String?)? { lock.lock(); defer { lock.unlock() }; return value }
}
@objc(PUBLICBrowserEndpointControl) protocol PublicControl: BrowserOriginalPageEndpointIPC {
    func warmup(withReply reply: @escaping @Sendable () -> Void)
    func exercise(withReply reply: @escaping @Sendable (Data?, String?) -> Void)
}

#if PUBLIC_ENDPOINT_SERVICE
private final class PublicReceiver: NSObject, PublicControl, @unchecked Sendable {
    private let lock = NSLock()
    private var endpoint: NSXPCListenerEndpoint?
    private var child: NSXPCConnection?
    private var offers = 0
    private let directory: URL, host: URL, mode: String
    init(directory: URL, host: URL, mode: String) { self.directory = directory; self.host = host; self.mode = mode }
    func warmup(withReply reply: @escaping @Sendable () -> Void) { reply() }
    func acceptOriginalBrowserPageEndpoint(_ endpoint: NSXPCListenerEndpoint, withReply reply: @escaping @Sendable () -> Void) {
        lock.lock(); offers += 1; let count = offers; self.endpoint = endpoint; lock.unlock()
        try? write(["nativeEndpoint": true, "offers": count, "pid": getpid(), "AuthQualified": false], directory.appendingPathComponent("offered.json"))
        if mode == "loss" { NSXPCConnection.current()?.invalidate(); return }
        if mode == "late-reply" {
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.6) { reply() }
        } else { reply() }
    }
    func exercise(withReply reply: @escaping @Sendable (Data?, String?) -> Void) {
        lock.lock(); let offered = endpoint; lock.unlock()
        guard let offered else { reply(nil, "NO_ENDPOINT"); return }
        do {
            let (identifier, cdhash) = try publicCodeIdentity(host)
            let requirement = try BrowserPageIPCPeer(pid: getpid(), uid: geteuid(), identifier: identifier, codeDirectoryHash: cdhash).requirement
            let connection = NSXPCConnection(listenerEndpoint: offered)
            connection.remoteObjectInterface = NSXPCInterface(with: BrowserOriginalPageReadoutIPC.self)
            connection.setCodeSigningRequirement(requirement)
            lock.lock(); child = connection; lock.unlock()
            connection.resume()
            let proxy = connection.remoteObjectProxyWithErrorHandler { _ in reply(nil, "PAGE_LOST") } as! BrowserOriginalPageReadoutIPC
            proxy.readOriginalBrowserPageReadout(Data("PUBLIC_SYNTHETIC_REQUEST".utf8), withReply: reply)
        } catch { reply(nil, "PUBLIC_CODE_INVALID") }
    }
    func close() { lock.lock(); let connection = child; child = nil; endpoint = nil; lock.unlock(); connection?.invalidate() }
}
private final class PublicDelegate: NSObject, NSXPCListenerDelegate, @unchecked Sendable {
    let receiver: PublicReceiver, host: URL, directory: URL
    init(receiver: PublicReceiver, host: URL, directory: URL) { self.receiver = receiver; self.host = host; self.directory = directory }
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        do {
            let (id, cdhash) = try publicCodeIdentity(host)
            let actual = try BrowserPageIPCPeer(pid: connection.processIdentifier, uid: connection.effectiveUserIdentifier, identifier: id, codeDirectoryHash: cdhash)
            connection.setCodeSigningRequirement(actual.requirement)
            connection.exportedInterface = NSXPCInterface(with: PublicControl.self); connection.exportedObject = receiver
            connection.resume()
            try write(["pid": getpid(), "actualCallerPID": connection.processIdentifier, "RootQualified": false], directory.appendingPathComponent("service.json"))
            return true
        } catch { return false }
    }
}
@main private struct PublicService {
    static func main() {
        let info = Bundle.main.infoDictionary!
        let directory = URL(fileURLWithPath: info["PUBLICDirectory"] as! String)
        let host = URL(fileURLWithPath: info["PUBLICHostExecutable"] as! String)
        let receiver = PublicReceiver(directory: directory, host: host, mode: info["PUBLICMode"] as! String)
        let delegate = PublicDelegate(receiver: receiver, host: host, directory: directory)
        let listener = NSXPCListener.service(); listener.delegate = delegate
        let timer = DispatchSource.makeTimerSource()
        timer.schedule(deadline: .now(), repeating: .milliseconds(20))
        let shutdown: @Sendable () -> Void = {
            if FileManager.default.fileExists(atPath: directory.appendingPathComponent("shutdown").path) {
                // Foundation service() is the same service singleton. Do not move
                // a non-Sendable listener out of the main entry's isolation.
                receiver.close(); NSXPCListener.service().invalidate()
                try? write(["closed": true, "pid": getpid(), "RootQualified": false], directory.appendingPathComponent("closed.json"))
                exit(0)
            }
        }
        timer.setEventHandler(handler: shutdown)
        timer.resume(); listener.resume(); dispatchMain()
    }
}
#else
@MainActor private final class PublicOwner: BrowserOriginalPageReadoutOwner {
    var closed = false, reads = 0, current = true, closes = 0
    func requireCurrent() throws { if closed || !current { throw BrowserPageIPCFailure.sourceRejected } }
    func readOriginalBrowserPageReadout(_ request: Data) async throws -> Data {
        try requireCurrent(); reads += 1
        try check(request == Data("PUBLIC_SYNTHETIC_REQUEST".utf8), "exact-request")
        return Data("PUBLIC_SYNTHETIC_RESPONSE".utf8)
    }
    func close() async throws { closed = true; closes += 1 }
}
@MainActor private final class PublicMountHolder { weak var mount: BrowserOriginalPageSourceMount? }
@MainActor private final class PublicHost {
    let root: URL
    init(_ root: URL) { self.root = root }
    func wait(_ label: String, _ predicate: () -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(8))
        while !predicate() { if ContinuousClock.now >= deadline { throw PublicFailure.assertion("timeout-" + label) }; try await Task.sleep(for: .milliseconds(10)) }
    }
    func run(_ mode: String) async throws {
        let directory = root.appendingPathComponent(mode)
        let id = "com.ynx.public.endpoint." + mode
        let service = Bundle.main.bundleURL.appendingPathComponent("Contents/XPCServices/" + id + ".xpc")
        let (actualID, actualHash) = try publicCodeIdentity(service)
        try check(actualID == id, "service-identifier")
        // Fixture-only warmup yields a real OS process identity, not permission.
        // Normal original Auth must supply its independently registered peer.
        let warmup = NSXPCConnection(serviceName: id)
        warmup.remoteObjectInterface = NSXPCInterface(with: PublicControl.self)
        let staticPeer = try BrowserPageIPCPeer(pid: getpid(), uid: geteuid(), identifier: id, codeDirectoryHash: actualHash)
        warmup.setCodeSigningRequirement(staticPeer.requirement); warmup.resume()
        defer { warmup.invalidate(); try? "close".write(to: directory.appendingPathComponent("shutdown"), atomically: true, encoding: .utf8) }
        let launched = PublicReply()
        let warmupFailed: @Sendable (Error) -> Void = { _ in launched.put(nil, "WARMUP_FAILED") }
        let proxy = warmup.remoteObjectProxyWithErrorHandler(warmupFailed) as! PublicControl
        proxy.warmup { launched.put(Data(), nil) }
        try await wait("warmup", { launched.take() != nil })
        try check(launched.take()?.1 == nil && warmup.processIdentifier > 1, "actual-service")
        let expectedPID = mode == "wrong-peer" ? warmup.processIdentifier + 100000 : warmup.processIdentifier
        let peer = try BrowserPageIPCPeer(pid: expectedPID, uid: geteuid(), identifier: id, codeDirectoryHash: actualHash)
        let config = try BrowserEmbeddedPageEndpointService(application: Bundle.main, identifier: id, codeDirectoryHash: actualHash, peer: peer)
        do {
            _ = try BrowserEmbeddedPageEndpointService(application: Bundle.main, identifier: id, codeDirectoryHash: String(repeating: "0", count: actualHash.count), peer: peer)
            throw PublicFailure.assertion("wrong-code-config-accepted")
        } catch BrowserPageEndpointFailure.invalidEmbeddedService { }
        let owner = PublicOwner()
        let holder = PublicMountHolder()
        var mount: BrowserOriginalPageSourceMount?
        var acquisitions = 0
        let channel = BrowserOriginalPageEndpointChannel(connection: config.makeConnection(), peer: peer,
            originalCurrent: { try owner.requireCurrent() }, retireEndpoint: { holder.mount?.invalidate() })
        let created = BrowserOriginalPageSourceMount { endpoint in
            acquisitions += 1
            do { try await channel.transfer(endpoint); return .init(owner: owner, peer: peer, error: nil) }
            catch { return .init(owner: owner, peer: peer, error: error) }
        }
        mount = created; holder.mount = created
        // Explicitly link the actual listener teardown on channel loss in this fixture.
        // Parent normal composition must likewise call mount.invalidate synchronously.
        let start = Task { @MainActor in try await created.start() }
        if mode == "cancel-before" { start.cancel() }
        if mode == "late-reply" {
            try await wait("offered", { FileManager.default.fileExists(atPath: directory.appendingPathComponent("offered.json").path) })
            start.cancel()
        }
        var succeeded = false
        do { _ = try await start.value; succeeded = true } catch { }
        if ["normal", "current-loss"].contains(mode) {
            try check(succeeded && channel.state == .delivered && owner.reads == 0, "delivered-only-before-read")
            do { try await channel.transfer(NSXPCListener.anonymous().endpoint); throw PublicFailure.assertion("replay-accepted") }
            catch BrowserPageEndpointFailure.alreadyTransferred { }
            if mode == "normal" {
                let result = PublicReply()
                proxy.exercise { result.put($0, $1) }
                try await wait("actual-reverse-read", { result.take() != nil })
                try check(result.take()?.0 == Data("PUBLIC_SYNTHETIC_RESPONSE".utf8) && result.take()?.1 == nil && owner.reads == 1, "reverse-page-rpc")
            } else {
                owner.current = false
                do { try channel.requireCurrent(); throw PublicFailure.assertion("current-loss-accepted") }
                catch BrowserPageIPCFailure.sourceRejected { }
                mount?.invalidate()
            }
        } else { try check(!succeeded && owner.reads == 0, "failed-transfer-no-read") }
        mount?.invalidate(); try await channel.close(); try await mount?.close()
        if mode == "cancel-before" {
            try check(acquisitions == 0 && owner.closes == 0 &&
                !FileManager.default.fileExists(atPath: directory.appendingPathComponent("offered.json").path), "never-acquired-owner-or-offered-endpoint")
            // This PUBLIC fixture object was never returned to/adopted by mount.
            // Its fixture creator, not mount, remains responsible for its cleanup.
            try await owner.close()
        }
        try check(channel.state == .closed && owner.closed, "actual-close")
        if mode == "late-reply" { try await Task.sleep(for: .milliseconds(750)); try check(channel.state == .closed && owner.reads == 0, "late-ack-no-resume") }
        try write(["mode": mode, "status": "PASS", "channelState": channel.state.rawValue,
            "mountState": mount?.state.rawValue ?? "missing", "ownerReads": owner.reads,
            "factoryCalls": acquisitions, "manualUnacquiredFixtureCleanup": mode == "cancel-before",
            "firstFailure": channel.firstFailure.map { String(describing: $0) } ?? "none",
            "actualServicePID": warmup.processIdentifier, "AuthOrRootQualification": "NOT_RUN", "GUIOrNetworkUsed": false], directory.appendingPathComponent("result.json"))
        try "close".write(to: directory.appendingPathComponent("shutdown"), atomically: true, encoding: .utf8)
        try await wait("service-close", { FileManager.default.fileExists(atPath: directory.appendingPathComponent("closed.json").path) })
    }
}
@main private struct PublicMain {
    @MainActor static func main() async {
        do {
            let host = PublicHost(URL(fileURLWithPath: CommandLine.arguments[1]))
            for mode in ["normal", "cancel-before", "wrong-peer", "late-reply", "loss", "current-loss"] { try await host.run(mode) }
            print("PUBLIC_ENDPOINT_CHANNEL_NEW6_PASS; Auth/Root NOT_RUN")
        } catch { print("PUBLIC_ENDPOINT_CHANNEL_FAILURE: \(error)"); exit(1) }
    }
}
#endif
