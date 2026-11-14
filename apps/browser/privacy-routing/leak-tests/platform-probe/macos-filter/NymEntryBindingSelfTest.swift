import Darwin
import Foundation

@main enum NymEntryBindingSelfTest {
    private static let requirement = "identifier \"NymEntryBindingSelfTest\""
    private static let loopback = "127.0.0.1"

    // This child owns only a loopback listener and reports its own public identity.
    // It never starts Nym, answers SOCKS requests or opens a provider connection.
    static func main() throws {
        setbuf(stdout, nil)
        if CommandLine.arguments.dropFirst().first == "--owned-listener" {
            let requested = UInt16(CommandLine.arguments[2])!
            let ipv6 = CommandLine.arguments[3] == "::1"
            func listenOn<Address>(_ descriptor: Int32, _ address: inout Address) throws {
                var length = socklen_t(MemoryLayout<Address>.size)
                try withUnsafeMutablePointer(to: &address) {
                    try $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        guard bind(descriptor, $0, length) == 0, listen(descriptor, 1) == 0,
                              getsockname(descriptor, $0, &length) == 0
                        else { throw FilterFailure.rejected("fixture bind/listen/readback") }
                    }
                }
            }
            func openListener(_ requested: UInt16) throws -> (Int32, UInt16) {
                let descriptor = Darwin.socket(ipv6 ? AF_INET6 : AF_INET, SOCK_STREAM, IPPROTO_TCP)
                guard descriptor >= 0 else { throw FilterFailure.rejected("fixture socket") }
                do {
                    if ipv6 {
                        var address = sockaddr_in6()
                        address.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
                        address.sin6_family = sa_family_t(AF_INET6)
                        address.sin6_port = requested.bigEndian
                        address.sin6_addr = in6addr_loopback
                        try listenOn(descriptor, &address)
                        return (descriptor, UInt16(bigEndian: address.sin6_port))
                    }
                    var address = sockaddr_in()
                    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                    address.sin_family = sa_family_t(AF_INET)
                    address.sin_port = requested.bigEndian
                    address.sin_addr.s_addr = inet_addr(loopback)
                    try listenOn(descriptor, &address)
                    return (descriptor, UInt16(bigEndian: address.sin_port))
                } catch {
                    Darwin.close(descriptor)
                    throw error
                }
            }
            let (descriptor, port) = try openListener(requested)
            let pin = try PublicIdentity.pinSelf(requirement: requirement)
            print(String(decoding: try JSONEncoder().encode(pin), as: UTF8.self))
            print(port)
            guard readLine() == "close-listener" else { throw FilterFailure.rejected("fixture command") }
            guard Darwin.close(descriptor) == 0 else { throw FilterFailure.rejected("fixture close") }
            print("listener-closed")
            var command = readLine()
            if command == "reopen-listener" {
                let (reopened, _) = try openListener(port)
                defer { Darwin.close(reopened) }
                print("listener-reopened")
                command = readLine()
            }
            guard command == "exit" else { throw FilterFailure.rejected("fixture exit command") }
            return
        }
        if CommandLine.arguments.dropFirst().first == "--listener-loss-only" {
            try runListenerLossChecks()
            return
        }
        if CommandLine.arguments.dropFirst().first == "--listener-generation-only" {
            try runListenerGenerationChecks()
            return
        }
        if CommandLine.arguments.dropFirst().first == "--tor-listener-generation-only" {
            try runTorListenerGenerationChecks()
            return
        }
        if CommandLine.arguments.dropFirst().first == "--existing-flow-revoke-only" {
            try runExistingFlowRevocationChecks()
            return
        }
        if CommandLine.arguments.dropFirst().first == "--proof-flow-authorization-only" {
            try runProofFlowAuthorizationChecks()
            return
        }
        try runPolicyChecks()
    }

    private static func runProofFlowAuthorizationChecks() throws {
        let root = try PublicIdentity.pinSelf(requirement: requirement)
        let server = try OwnedListener()
        defer { server.dispose() }
        let child = try OwnedListener()
        defer { child.dispose() }
        let entry = server.endpoint
        let upstream = FilterEndpoint(host: "192.0.2.29", port: 443, transport: IPPROTO_TCP)
        let backend = BackendPin(role: "nym", process: server.pin, responsibleAppTokens: [root.token.hex],
                                 destinations: [upstream], listeningEntries: [entry])
        let helper = BackendPin(role: "nym-helper", process: child.pin, responsibleAppTokens: [root.token.hex],
                                destinations: [entry])
        let review = ReviewedFilterRun(schema: "P05_REVIEWED_FILTER_RUN_V1", runID: "proof-flow-authorization",
                                       epoch: UUID().uuidString, expiresAt: Date().timeIntervalSince1970 + 120,
                                       browser: root, entryOwner: server.pin, entries: [entry], backends: [backend, helper])
        let cache = try VerifiedPinCache(pins: [root, server.pin, child.pin])
        var rules = ScopedRunRules(review: review, mode: .nym)
        let bound = ProofFlowBinding(child: child.pin, root: root.token, graphRevision: 2, port: entry.port)
        func decide(binding: ProofFlowBinding? = nil, authorized: Bool = true, live: Bool = true,
                    remote: FilterEndpoint? = nil, direction: ScopedRunRules.Direction = .outbound) -> ScopedRunRules.Verdict {
            rules.decision(sourceApp: root.token, sourceProcess: child.pin.token, endpoint: remote ?? entry,
                           localEndpoint: direction == .inbound ? entry : nil, direction: direction,
                           live: cache.isCurrent, listener: cache.ownsListener, listenerGeneration: cache.listenerGeneration,
                           proofAuthorized: { pin, endpoint in
                               binding?.authorizes(child: pin, root: root.token, graphRevision: 2, port: endpoint.port,
                                                   authorized: authorized, live: live) == true
                           })
        }
        var failures = 0
        func check(_ label: String, _ pass: Bool) {
            print("\(pass ? "PASS" : "FAIL") \(label)")
            if !pass { failures += 1 }
        }
        check("graph edge alone must deny a first-seen helper", decide() == .ownedDrop)
        check("registered but unauthorized helper remains denied", decide(binding: bound, authorized: false) == .ownedDrop)
        check("expired grant remains denied", decide(binding: bound, live: false) == .ownedDrop)
        check("wrong child, Root, revision and entry port are independently denied", [
            ProofFlowBinding(child: server.pin, root: root.token, graphRevision: 2, port: entry.port),
            ProofFlowBinding(child: child.pin, root: server.pin.token, graphRevision: 2, port: entry.port),
            ProofFlowBinding(child: child.pin, root: root.token, graphRevision: 1, port: entry.port),
            ProofFlowBinding(child: child.pin, root: root.token, graphRevision: 2, port: 0),
        ].allSatisfy { decide(binding: $0) == .ownedDrop })
        check("authorized helper cannot use other endpoints or receive an inbound flow",
              decide(binding: bound, remote: child.endpoint) == .ownedDrop && decide(binding: bound, direction: .inbound) == .ownedDrop)
        check("authorized exact entry stays available before first connect",
              rules.pinNymProofEntry(entry, listenerGeneration: cache.listenerGeneration) && decide(binding: bound) == .backendExactEndpointAllow)
        try rules.setConnected(sequence: 1, userActionReference: UUID().uuidString,
                               live: cache.isCurrent, listenerGeneration: cache.listenerGeneration)
        check("existing live grant still works on connected route", decide(binding: bound) == .backendExactEndpointAllow)
        try rules.disconnected(sequence: 2)
        check("blocked route rejects even a matching former grant", decide(binding: bound) == .ownedDrop)
        let upstreamVerdict = rules.decision(sourceApp: root.token, sourceProcess: server.pin.token, endpoint: upstream,
                                             live: cache.isCurrent, listener: cache.ownsListener, listenerGeneration: cache.listenerGeneration)
        check("unrelated reviewed transport stays available", upstreamVerdict == .backendExactEndpointAllow)
        try child.closeListener(); try child.waitForExit()
        try server.closeListener(); try server.waitForExit()
        print("Owned children reaped; SIGNED_NE_NOT_TESTED")
        if failures > 0 { exit(1) }
    }

    private static func runExistingFlowRevocationChecks() throws {
        let root = try PublicIdentity.pinSelf(requirement: requirement)
        let server = try OwnedListener()
        defer { server.dispose() }
        let helper = try OwnedListener()
        defer { helper.dispose() }
        let entry = server.endpoint
        let peer = FilterEndpoint(host: loopback, port: 30000, transport: IPPROTO_TCP)
        let upstream = FilterEndpoint(host: "192.0.2.29", port: 443, transport: IPPROTO_TCP)
        let owner = BackendPin(role: "nym", process: server.pin, responsibleAppTokens: [root.token.hex],
                               destinations: [upstream], listeningEntries: [entry])
        let proof = BackendPin(role: "nym-helper", process: helper.pin, responsibleAppTokens: [root.token.hex],
                               destinations: [entry])
        let review = ReviewedFilterRun(schema: "P05_REVIEWED_FILTER_RUN_V1", runID: "existing-flow-revoke",
                                       epoch: UUID().uuidString, expiresAt: Date().timeIntervalSince1970 + 120,
                                       browser: root, entryOwner: owner.process, entries: [entry], backends: [owner, proof])
        let cache = try VerifiedPinCache(pins: [root, server.pin, helper.pin])
        var rules = ScopedRunRules(review: review, mode: .nym)
        var failures = 0
        func check(_ name: String, _ value: Bool) {
            print("\(value ? "PASS" : "FAIL") \(name)")
            if !value { failures += 1 }
        }
        func decision(_ pin: ProcessPin, remote: FilterEndpoint, local: FilterEndpoint? = nil) -> ScopedRunRules.Verdict {
            rules.decision(sourceApp: root.token, sourceProcess: pin.token, endpoint: remote, localEndpoint: local,
                           direction: local == nil ? .outbound : .inbound, live: cache.isCurrent,
                           listener: cache.ownsListener, listenerGeneration: cache.listenerGeneration,
                           proofAuthorized: { $0 == helper.pin && $1 == entry })
        }

        check("initial blocked proof can pin real owned listener",
              rules.pinNymProofEntry(entry, listenerGeneration: cache.listenerGeneration))
        let proofOutbound = decision(helper.pin, remote: entry)
        let proofInbound = decision(server.pin, remote: peer, local: entry)
        check("initial blocked proof outbound and entry inbound are allowed",
              proofOutbound == .backendExactEndpointAllow && proofInbound == .backendListenerAllow)
        try rules.setConnected(sequence: 1, userActionReference: UUID().uuidString,
                               live: cache.isCurrent, listenerGeneration: cache.listenerGeneration)
        let browser = decision(root, remote: entry)
        check("connected Browser uses the original listener", browser == .browserProxyAllow)
        try rules.disconnected(sequence: 2)
        check("explicit block denies proof outbound and entry inbound on the same live listener",
              decision(helper.pin, remote: entry) == .ownedDrop &&
              decision(server.pin, remote: peer, local: entry) == .ownedDrop)
        check("post-connect block will not pin a proof grant in the same incarnation",
              !rules.pinNymProofEntry(entry, listenerGeneration: cache.listenerGeneration))
        let transport = decision(server.pin, remote: upstream)
        check("exact backend transport stays allowed and blocked reply sequence is preserved",
              transport == .backendExactEndpointAllow && !rules.connected && rules.sequence == 2)
        do {
            try rules.disconnected(sequence: 2)
            check("stale blocked request rejected", false)
        } catch {
            check("stale blocked request rejected", !rules.connected && rules.sequence == 2)
        }
        var currentRoot = RetainedRouteFlows<String>()
        var otherRoot = RetainedRouteFlows<String>()
        let recorded = currentRoot.retain("proof outbound", id: UUID(),
            entry: rules.isEntryFlow(proofOutbound, local: nil, remote: entry, direction: .outbound), process: helper.pin.token) &&
            currentRoot.retain("proof inbound", id: UUID(),
                entry: rules.isEntryFlow(proofInbound, local: entry, remote: peer, direction: .inbound), process: server.pin.token) &&
            currentRoot.retain("browser", id: UUID(),
                entry: rules.isEntryFlow(browser, local: nil, remote: entry, direction: .outbound), process: root.token) &&
            currentRoot.retain("backend transport", id: UUID(),
                entry: rules.isEntryFlow(transport, local: nil, remote: upstream, direction: .outbound), process: server.pin.token) &&
            otherRoot.retain("other root", id: UUID(), entry: true, process: helper.pin.token)
        check("records belong to a single root", recorded && !currentRoot.isEmpty && !otherRoot.isEmpty)
        check("proof outbound and inbound are both retained as entry traffic",
              rules.isEntryFlow(proofOutbound, local: nil, remote: entry, direction: .outbound) && rules.isEntryFlow(proofInbound, local: entry, remote: peer, direction: .inbound))
        check("proof revocation takes only exact process in owning root",
              currentRoot.take(.process(helper.pin.token)) == ["proof outbound"] && !otherRoot.isEmpty)
        check("entry revocation takes Browser and inbound and a duplicate observation takes nothing",
              Set(currentRoot.take(.entry)) == ["proof inbound", "browser"] && currentRoot.take(.entry).isEmpty &&
              currentRoot.take(.process(helper.pin.token)).isEmpty)
        check("full root closure takes its transport and leaves other root untouched",
              currentRoot.take(.all) == ["backend transport"] && currentRoot.isEmpty && otherRoot.take(.all) == ["other root"])
        try helper.closeListener()
        try helper.waitForExit()
        try server.closeListener()
        try server.waitForExit()
        print("Owned children reaped; SIGNED_NE_AND_KERNEL_DROP_NOT_TESTED")
        if failures > 0 { exit(1) }
    }

    private static func runTorListenerGenerationChecks() throws {
        let root = try PublicIdentity.pinSelf(requirement: requirement)
        let arti = try OwnedListener()
        defer { arti.dispose() }
        let lyrebird = try OwnedListener()
        defer { lyrebird.dispose() }
        let entry = arti.endpoint
        let bridge = FilterEndpoint(host: "192.0.2.20", port: 443, transport: IPPROTO_TCP)
        let artiPin = BackendPin(role: "arti", process: arti.pin, responsibleAppTokens: [root.token.hex], destinations: [])
        let pt = BackendPin(role: "obfs4", process: lyrebird.pin, responsibleAppTokens: [root.token.hex], destinations: [bridge])
        let review = ReviewedFilterRun(schema: "P05_REVIEWED_FILTER_RUN_V1", runID: "tor-entry-generation",
                                       epoch: UUID().uuidString, expiresAt: Date().timeIntervalSince1970 + 120,
                                       browser: root, entryOwner: arti.pin, entries: [entry], backends: [artiPin, pt])
        let cache = try VerifiedPinCache(pins: [root, arti.pin, lyrebird.pin])
        var rules = ScopedRunRules(review: review, mode: .tor)
        func decide(_ actor: ProcessPin, _ endpoint: FilterEndpoint, local: FilterEndpoint? = nil) -> ScopedRunRules.Verdict {
            rules.decision(sourceApp: root.token, sourceProcess: actor.token, endpoint: endpoint, localEndpoint: local,
                           direction: local == nil ? .outbound : .inbound, live: cache.isCurrent,
                           listener: cache.ownsListener, listenerGeneration: cache.listenerGeneration)
        }
        var failures = 0
        func check(_ name: String, _ condition: Bool) {
            print("\(condition ? "PASS" : "FAIL") \(name)")
            if !condition { failures += 1 }
        }
        check("Tor blocked startup supports Lyrebird bridge but refuses Browser", decide(lyrebird.pin, bridge) == .backendExactEndpointAllow &&
              decide(root, entry) == .ownedDrop && !rules.fenceIfListenerChanged(
                  listenerGeneration: cache.listenerGeneration))
        let reviewedPT = BackendPin(role: "obfs4", process: pt.process, responsibleAppTokens: pt.responsibleAppTokens,
                                    destinations: [bridge], listeningEntries: [lyrebird.endpoint])
        let reviewedArti = BackendPin(role: "arti", process: artiPin.process, responsibleAppTokens: artiPin.responsibleAppTokens,
                                      destinations: [lyrebird.endpoint])
        let updated = try BootstrapGraphPolicy.validate(current: review,
            proposed: .init(entryOwner: arti.pin, entries: [entry], backends: [reviewedArti, reviewedPT]),
            connected: false, live: cache.isCurrent, listener: cache.ownsListener)
        try rules.replaceBlockedGraph(updated)
        let localPeer = FilterEndpoint(host: loopback, port: 30000, transport: IPPROTO_TCP)
        check("Tor blocked reviewed Arti–Lyrebird edge is live",
              decide(arti.pin, lyrebird.endpoint) == .backendExactEndpointAllow &&
              decide(lyrebird.pin, localPeer, local: lyrebird.endpoint) == .backendListenerAllow)
        try rules.setConnected(sequence: 1, userActionReference: UUID().uuidString, live: cache.isCurrent,
                               listenerGeneration: cache.listenerGeneration)
        var watchdog = rules
        var inbound = rules
        check("Tor healthy Arti entry admits Browser and its inbound peer", decide(root, entry) == .browserProxyAllow &&
              decide(arti.pin, localPeer, local: entry) == .backendEntryAcceptAllow)
        check("Tor healthy snapshot stays connected", !watchdog.fenceIfListenerChanged(
              listenerGeneration: cache.listenerGeneration) && watchdog.connected)
        let originalGeneration = cache.listenerGeneration(arti.pin, entry)
        try arti.closeListener()
        try arti.reopenListener()
        let replacementGeneration = cache.listenerGeneration(arti.pin, entry)
        check("Tor same PID and port now have a different generation", originalGeneration != nil &&
              replacementGeneration != nil && originalGeneration != replacementGeneration && cache.isCurrent(arti.pin))
        check("Tor Browser flow fences the rebound entry", decide(root, entry) == .entryListenerLost &&
              !rules.connected && rules.entryLossFenced && rules.sequence == 1)
        let reboundInbound = inbound.decision(sourceApp: root.token, sourceProcess: arti.pin.token, endpoint: localPeer,
            localEndpoint: entry, direction: .inbound, live: cache.isCurrent, listener: cache.ownsListener,
            listenerGeneration: cache.listenerGeneration)
        check("Tor inbound entry flow also fences the rebound socket", reboundInbound == .entryListenerLost && !inbound.connected)
        check("Tor watchdog sees replacement while old sequence remains blocked", watchdog.fenceIfListenerChanged(
              listenerGeneration: cache.listenerGeneration) &&
              !watchdog.connected && watchdog.entryLossFenced && watchdog.sequence == 1)
        check("Tor cannot reconnect same epoch on a rebound entry", (try? rules.setConnected(sequence: 2,
              userActionReference: UUID().uuidString, live: cache.isCurrent,
              listenerGeneration: cache.listenerGeneration)) == nil)
        check("Tor unaffected reviewed transport edge remains available", decide(arti.pin, lyrebird.endpoint) == .backendExactEndpointAllow)
        try arti.waitForExit()
        try lyrebird.closeListener()
        try lyrebird.waitForExit()
        print("Tor fixture children reaped; ARTI_AND_NE_NOT_TESTED")
        if failures > 0 { exit(1) }
    }

    private static func runListenerGenerationChecks() throws {
        let root = try PublicIdentity.pinSelf(requirement: requirement)
        let route = try OwnedListener()
        defer { route.dispose() }
        let entry = route.endpoint
        let backend = BackendPin(role: "nym", process: route.pin, responsibleAppTokens: [root.token.hex],
                                 destinations: [], listeningEntries: [entry])
        let review = ReviewedFilterRun(schema: "P05_REVIEWED_FILTER_RUN_V1", runID: "nym-generation",
                                       epoch: UUID().uuidString, expiresAt: Date().timeIntervalSince1970 + 120,
                                       browser: root, entryOwner: route.pin, entries: [entry], backends: [backend])
        let cache = try VerifiedPinCache(pins: [root, route.pin])
        let originalGeneration = cache.listenerGeneration(route.pin, entry)
        guard let originalGeneration, originalGeneration == cache.listenerGeneration(route.pin, entry)
        else { throw FilterFailure.rejected("original listener generation missing or unstable") }
        var rules = ScopedRunRules(review: review, mode: .nym)
        try rules.setConnected(sequence: 1, userActionReference: UUID().uuidString,
                               live: cache.isCurrent, listenerGeneration: cache.listenerGeneration)
        var watchdogRules = rules
        var parkedRules = ScopedRunRules(review: review, mode: .nym)
        guard !parkedRules.fenceIfListenerChanged(listenerGeneration: cache.listenerGeneration),
              parkedRules.pinNymProofEntry(entry, listenerGeneration: cache.listenerGeneration),
              parkedRules.pinNymProofEntry(entry, listenerGeneration: cache.listenerGeneration),
              !parkedRules.connected
        else { throw FilterFailure.rejected("pre-connect proof could not bind healthy listener") }
        var firstConnectRules = parkedRules
        try firstConnectRules.setConnected(sequence: 1, userActionReference: UUID().uuidString,
            live: cache.isCurrent, listenerGeneration: cache.listenerGeneration)
        guard firstConnectRules.connected else { throw FilterFailure.rejected("first healthy connect after proof was refused") }
        var parkedConnectRules = parkedRules
        guard !watchdogRules.fenceIfListenerChanged(listenerGeneration: cache.listenerGeneration)
        else { throw FilterFailure.rejected("watchdog fenced unchanged owned listener") }
        func flow() -> ScopedRunRules.Verdict {
            rules.decision(sourceApp: root.token, sourceProcess: root.token, endpoint: entry,
                           live: cache.isCurrent, listener: cache.ownsListener, listenerGeneration: cache.listenerGeneration)
        }
        guard flow() == .browserProxyAllow else { throw FilterFailure.rejected("original listener refused") }
        try route.closeListener()
        try route.reopenListener() // No policy or socket-identity read between the two operations.
        guard cache.ownsListener(route.pin, entry) else { throw FilterFailure.rejected("same process did not rebind") }
        let newGeneration = cache.listenerGeneration(route.pin, entry)
        let changed = newGeneration != nil && newGeneration != originalGeneration
        let denied = flow() == .entryListenerLost && !rules.connected && rules.sequence == 1
        let watcherFenced = watchdogRules.fenceIfListenerChanged(
            listenerGeneration: cache.listenerGeneration) && !watchdogRules.connected && watchdogRules.sequence == 1
        let parkedFenced = parkedRules.fenceIfListenerChanged(
            listenerGeneration: cache.listenerGeneration) && parkedRules.entryLossFenced && parkedRules.sequence == 0
        let cannotReRegister = !parkedRules.pinNymProofEntry(entry, listenerGeneration: cache.listenerGeneration)
        let initialConnectRefused = (try? parkedConnectRules.setConnected(sequence: 1, userActionReference: UUID().uuidString,
            live: cache.isCurrent, listenerGeneration: cache.listenerGeneration)) == nil
            && parkedConnectRules.entryLossFenced && !parkedConnectRules.connected
        try route.waitForExit()
        print("\(changed ? "PASS" : "FAIL") same owner and endpoint have a new socket generation")
        print("\(denied ? "PASS" : "FAIL") closed-and-rebound listener is fenced without observing the gap")
        print("\(watcherFenced ? "PASS" : "FAIL") watchdog catches stale listener generation on its first sample")
        print("PASS authenticated proof can pin a parked listener and connect the same socket")
        print("\(parkedFenced ? "PASS" : "FAIL") refresh fences a replaced listener while proof route is still parked")
        print("\(cannotReRegister ? "PASS" : "FAIL") fenced route refuses a new proof entry pin")
        print("\(initialConnectRefused ? "PASS" : "FAIL") first connect cannot adopt a replacement after proof pin")
        print("Owned child reaped; NE_CALLBACK_NOT_TESTED")
        if !changed || !denied || !watcherFenced || !parkedFenced || !cannotReRegister || !initialConnectRefused { exit(1) }
    }

    private final class OwnedListener {
        let process = Process()
        let pin: ProcessPin
        let endpoint: FilterEndpoint
        private let input = Pipe(), output = Pipe()

        init(port: UInt16 = 0, host: String = loopback) throws {
            process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath()
            process.arguments = ["--owned-listener", String(port), host]
            process.standardInput = input
            process.standardOutput = output
            try process.run()
            do {
                let pin = try JSONDecoder().decode(ProcessPin.self, from: Self.line(output.fileHandleForReading))
                guard pin.pid == process.processIdentifier, pin.path == process.executableURL?.path, pin.requirement == requirement,
                      let port = UInt16(String(decoding: try Self.line(output.fileHandleForReading), as: UTF8.self))
                else { throw FilterFailure.rejected("fixture child pin/port mismatch") }
                self.pin = pin
                endpoint = .init(host: host, port: port, transport: IPPROTO_TCP)
            } catch {
                if process.isRunning { process.terminate() }
                process.waitUntilExit()
                throw error
            }
        }

        private static func line(_ descriptor: FileHandle) throws -> Data {
            var bytes = Data()
            let deadline = ContinuousClock.now + .seconds(3)
            while bytes.count < 4096, ContinuousClock.now < deadline {
                var input = pollfd(fd: descriptor.fileDescriptor, events: Int16(POLLIN), revents: 0)
                guard poll(&input, 1, 100) >= 0 else { break }
                if input.revents == 0 { continue }
                guard let byte = try descriptor.read(upToCount: 1), !byte.isEmpty else { break }
                if byte == Data([10]) { return bytes }
                bytes.append(byte)
            }
            throw FilterFailure.rejected("fixture child readback missing")
        }

        func closeListener() throws {
            try input.fileHandleForWriting.write(contentsOf: Data("close-listener\n".utf8))
            guard try Self.line(output.fileHandleForReading) == Data("listener-closed".utf8)
            else { throw FilterFailure.rejected("fixture listener was not closed") }
        }

        func reopenListener() throws {
            try input.fileHandleForWriting.write(contentsOf: Data("reopen-listener\n".utf8))
            guard try Self.line(output.fileHandleForReading) == Data("listener-reopened".utf8)
            else { throw FilterFailure.rejected("fixture listener was not restored") }
        }

        func waitForExit() throws {
            try input.fileHandleForWriting.write(contentsOf: Data("exit\n".utf8))
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw FilterFailure.rejected("fixture child failed") }
        }

        func dispose() {
            if process.isRunning { process.terminate() }
            process.waitUntilExit()
        }
    }

    private static func runListenerLossChecks() throws {
        let root = try PublicIdentity.pinSelf(requirement: requirement)
        let route = try OwnedListener()
        defer { route.dispose() }
        let entry = route.endpoint
        let backend = BackendPin(role: "nym", process: route.pin, responsibleAppTokens: [root.token.hex],
                                 destinations: [], listeningEntries: [entry])
        let review = ReviewedFilterRun(schema: "P05_REVIEWED_FILTER_RUN_V1", runID: "nym-entry-loss",
                                       epoch: UUID().uuidString, expiresAt: Date().timeIntervalSince1970 + 120,
                                       browser: root, entryOwner: route.pin, entries: [entry], backends: [backend])
        let cache = try VerifiedPinCache(pins: [root, route.pin])
        var rules = ScopedRunRules(review: review, mode: .nym)
        let action = UUID().uuidString
        try rules.setConnected(sequence: 1, userActionReference: action, live: cache.isCurrent, listenerGeneration: cache.listenerGeneration)

        func flow(_ endpoint: FilterEndpoint) -> ScopedRunRules.Verdict {
            rules.decision(sourceApp: root.token, sourceProcess: root.token, endpoint: endpoint,
                           live: cache.isCurrent, listener: cache.ownsListener, listenerGeneration: cache.listenerGeneration)
        }
        var failures = 0
        func check(_ name: String, _ condition: Bool) {
            print("\(condition ? "PASS" : "FAIL") \(name)")
            if !condition { failures += 1 }
        }
        let wrong = FilterEndpoint(host: entry.host, port: entry.port, transport: IPPROTO_UDP)
        check("ordinary policy denial leaves the live route connected", flow(wrong) == .ownedDrop && rules.connected)
        try route.closeListener()
        check("observed entry loss fences the current route immediately", flow(entry) == .entryListenerLost && !rules.connected)
        check("loss preserves original route acknowledgement sequence", rules.sequence == 1)
        try route.reopenListener()
        check("same process reacquired its actual original port", cache.ownsListener(route.pin, entry))
        check("same-incarnation reopen does not make the original route live", flow(entry) == .ownedDrop && !rules.connected)
        check("next explicit route change cannot revive a fenced epoch",
              (try? rules.setConnected(sequence: 2, userActionReference: UUID().uuidString, live: cache.isCurrent,
                                       listenerGeneration: cache.listenerGeneration)) == nil)
        try route.waitForExit()
        print("Owned child reaped; NE_CALLBACK_NOT_TESTED")
        if failures > 0 { exit(1) }
    }

    private static func runPolicyChecks() throws {
        let root = try PublicIdentity.pinSelf(requirement: requirement)
        let route = try OwnedListener()
        defer { route.dispose() }
        let helper = try OwnedListener()
        defer { helper.dispose() }
        let entry = route.endpoint
        let peer = FilterEndpoint(host: "192.0.2.29", port: 443, transport: IPPROTO_TCP)
        let nym = BackendPin(role: "nym", process: route.pin, responsibleAppTokens: [root.token.hex, route.pin.token.hex],
                             destinations: [peer])
        let proof = BackendPin(role: "nym-helper", process: helper.pin,
                               responsibleAppTokens: [root.token.hex, helper.pin.token.hex], destinations: [])
        let review = ReviewedFilterRun(schema: "P05_REVIEWED_FILTER_RUN_V1", runID: "nym-entry-binding",
                                       epoch: UUID().uuidString, expiresAt: Date().timeIntervalSince1970 + 120,
                                       browser: root, entryOwner: route.pin, entries: [entry], backends: [nym, proof])
        let cache = try VerifiedPinCache(pins: [root, route.pin, helper.pin])
        var failures = 0
        func check(_ name: String, _ value: Bool) {
            print("\(value ? "PASS" : "FAIL") \(name)")
            if !value { failures += 1 }
        }
        check("actual signature and holder", cache.ownsListener(route.pin, entry) && !cache.ownsListener(helper.pin, entry))
        let wrongIncarnation = ProcessPin(auditTokenHex: route.pin.auditTokenHex, pid: route.pin.pid,
                                         pidVersion: route.pin.pidVersion + 1, path: route.pin.path,
                                         sha256: route.pin.sha256, requirement: route.pin.requirement)
        check("real ticket cannot change its incarnation", (try? wrongIncarnation.verifyLive()) == nil)
        var readyNym = nym
        readyNym.listeningEntries = [entry]
        let readyProof = BackendPin(role: proof.role, process: helper.pin, responsibleAppTokens: proof.responsibleAppTokens,
                                    destinations: [entry], listeningEntries: [])
        let proposed = RoutedBackendReview(entryOwner: route.pin, entries: [entry], backends: [readyNym, readyProof])
        let graph = try BootstrapGraphPolicy.validate(current: review, proposed: proposed, connected: false,
                                                      live: cache.isCurrent, listener: cache.ownsListener)
        let wrongGraph = RoutedBackendReview(entryOwner: helper.pin, entries: [entry], backends: graph.backends)
        check("wrong graph owner rejected", (try? BootstrapGraphPolicy.validate(current: review, proposed: wrongGraph,
            connected: false, live: cache.isCurrent, listener: cache.ownsListener)) == nil)

        var rules = ScopedRunRules(review: graph, mode: .nym)
        func decide(_ actor: ProcessPin, _ destination: FilterEndpoint) -> ScopedRunRules.Verdict {
            rules.decision(sourceApp: root.token, sourceProcess: actor.token, endpoint: destination,
                           live: cache.isCurrent, listener: cache.ownsListener, listenerGeneration: cache.listenerGeneration,
                           proofAuthorized: { $0 == helper.pin && $1 == entry })
        }
        check("blocked browser denied", decide(root, entry) == .ownedDrop)
        let localPeer = FilterEndpoint(host: loopback, port: 30000, transport: IPPROTO_TCP)
        func acceptOnRoute() -> ScopedRunRules.Verdict {
            rules.decision(sourceApp: root.token, sourceProcess: route.pin.token, endpoint: localPeer,
                           localEndpoint: entry, direction: .inbound, live: cache.isCurrent, listener: cache.ownsListener,
                           listenerGeneration: cache.listenerGeneration)
        }
        check("bootstrap proof reaches live Nym entry", decide(helper.pin, entry) == .backendExactEndpointAllow)
        check("overlapping listening entry accepts loopback proof while Browser is parked", acceptOnRoute() == .backendListenerAllow)
        try rules.setConnected(sequence: 1, userActionReference: UUID().uuidString, live: cache.isCurrent,
                               listenerGeneration: cache.listenerGeneration)
        check("connected browser reaches exact live Nym entry", decide(root, entry) == .browserProxyAllow)
        check("browser cannot select another live loopback listener", decide(root, helper.endpoint) == .ownedDrop)

        try route.closeListener()
        check("original process still live after listener close", cache.isCurrent(route.pin) && !cache.ownsListener(route.pin, entry))
        check("live route without its listener cannot admit browser traffic", decide(root, entry) == .entryListenerLost)
        check("proof cannot connect to missing Nym listener", decide(helper.pin, entry) == .ownedDrop)
        check("overlapping listening entry cannot accept for its former owner", acceptOnRoute() == .ownedDrop)
        check("reviewed numeric Nym peer policy preserved", decide(route.pin, peer) == .backendExactEndpointAllow)
        let replacement = try OwnedListener(port: entry.port)
        defer { replacement.dispose() }
        check("replacement listener is real and independently pinned",
              replacement.pin.token != route.pin.token && PublicIdentity.ownsListener(replacement.pin, endpoint: entry))
        check("same numeric endpoint on wrong child cannot admit browser traffic", decide(root, entry) == .ownedDrop)
        check("same numeric endpoint on wrong child cannot admit proof traffic", decide(helper.pin, entry) == .ownedDrop)
        check("same numeric endpoint on wrong child cannot be accepted by former owner", acceptOnRoute() == .ownedDrop)
        try route.waitForExit()
        check("reaped route retains denial across proof and browser", !cache.isCurrent(route.pin) &&
              decide(root, entry) == .ownedDrop && decide(helper.pin, entry) == .ownedDrop)
        check("dead route cannot reconnect", (try? rules.setConnected(sequence: 2, userActionReference: UUID().uuidString,
              live: cache.isCurrent, listenerGeneration: cache.listenerGeneration)) == nil && !rules.connected)
        try helper.closeListener()
        try helper.waitForExit()
        try replacement.closeListener()
        try replacement.waitForExit()
        let ipv6 = try OwnedListener(host: "::1")
        defer { ipv6.dispose() }
        let v6Review = ReviewedFilterRun(schema: review.schema, runID: review.runID, epoch: review.epoch,
                                         expiresAt: review.expiresAt, browser: root, entryOwner: ipv6.pin,
                                         entries: [ipv6.endpoint], backends: [
                                            .init(role: "nym", process: ipv6.pin, responsibleAppTokens: [root.token.hex],
                                                  destinations: [peer], listeningEntries: [ipv6.endpoint]),
                                         ])
        let v6Cache = try VerifiedPinCache(pins: [root, ipv6.pin])
        var v6Rules = ScopedRunRules(review: v6Review, mode: .nym)
        try v6Rules.setConnected(sequence: 1, userActionReference: UUID().uuidString, live: v6Cache.isCurrent,
                                 listenerGeneration: v6Cache.listenerGeneration)
        check("owned IPv6 route entry remains allowed",
              v6Rules.decision(sourceApp: root.token, sourceProcess: root.token, endpoint: ipv6.endpoint,
                               live: v6Cache.isCurrent, listenerGeneration: v6Cache.listenerGeneration) == .browserProxyAllow)
        try ipv6.closeListener()
        try ipv6.waitForExit()
        print("Owned child processes reaped; NE_CALLBACK_NOT_TESTED")
        if failures > 0 { exit(1) }
    }
}
