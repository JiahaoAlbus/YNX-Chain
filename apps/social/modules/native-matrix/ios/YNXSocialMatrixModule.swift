import Foundation
import ExpoModulesCore
import MatrixRustSDK

struct MatrixBindingRecord: Record {
  @Field var account: String = ""
  @Field var homeserverUrl: String = ""
  @Field var userId: String = ""
  @Field var deviceId: String = ""
  @Field var authorityId: String = ""
  @Field var expiresAtMs: Double = 0
}

private final class MatrixGeneration: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0
  func current() -> Int { lock.lock(); defer { lock.unlock() }; return value }
  func invalidate() { lock.lock(); value += 1; lock.unlock() }
}

private final class TimelineObserver: TimelineListener, @unchecked Sendable {
  let update: @Sendable ([TimelineDiff]) -> Void
  init(_ update: @escaping @Sendable ([TimelineDiff]) -> Void) { self.update = update }
  func onUpdate(diff: [TimelineDiff]) { update(diff) }
}
private final class QueueObserver: SendQueueListener, @unchecked Sendable {
  let update: @Sendable (RoomSendQueueUpdate) -> Void
  init(_ update: @escaping @Sendable (RoomSendQueueUpdate) -> Void) { self.update = update }
  func onUpdate(update: RoomSendQueueUpdate) { self.update(update) }
}
private final class V2Observer: SyncListenerV2, @unchecked Sendable {
  let update: @Sendable () -> Void
  init(_ update: @escaping @Sendable () -> Void) { self.update = update }
  func onUpdate(response: SyncResponseV2) { update() }
}
private final class SASObserver: SessionVerificationControllerDelegate, @unchecked Sendable {
  let update: @Sendable (String, [String], String?) -> Void
  init(_ update: @escaping @Sendable (String, [String], String?) -> Void) { self.update = update }
  func didReceiveVerificationRequest(details: SessionVerificationRequestDetails) { update("verification-request", [], details.senderProfile.userId) }
  func didAcceptVerificationRequest() { update("verification-accepted", [], nil) }
  func didStartSasVerification() { update("verification-started", [], nil) }
  func didReceiveVerificationData(data: SessionVerificationData) {
    switch data {
    case let .emojis(emojis, _): update("sas", emojis.map { $0.symbol() + " " + $0.description() }, nil)
    case let .decimals(values): update("sas", values.map { String($0) }, nil)
    }
  }
  func didFail() { update("verification-failed", [], nil) }
  func didCancel() { update("verification-cancelled", [], nil) }
  func didFinish() { update("verification-finished", [], nil) }
}

private actor MatrixEngine {
  private final class Handle {
    let generation: Int
    let binding: MatrixBindingRecord
    let vault: MatrixVault
    let client: Client
    var sync: SyncService?
    var syncTask: TaskHandle?
    var timeline: Timeline?
    var timelineTask: TaskHandle?
    var queueTask: TaskHandle?
    var roomId: String?
    var items: [TimelineItem] = []
    var verification: SessionVerificationController?
    var sasRevision = 0
    var sasAvailable = false
    var verificationPeer: String?
    var verificationAttempt = 0
    var upload: SendAttachmentJoinHandle?
    var sending = false
    init(_ generation: Int, _ binding: MatrixBindingRecord, _ vault: MatrixVault, _ client: Client) {
      self.generation = generation; self.binding = binding; self.vault = vault; self.client = client
    }
  }
  let gate: MatrixGeneration
  let publish: @Sendable ([String: Any]) -> Void
  private var active: Handle?
  private var restoring = false

  init(gate: MatrixGeneration, publish: @escaping @Sendable ([String: Any]) -> Void) { self.gate = gate; self.publish = publish }
  private func current(_ generation: Int) throws -> Handle {
    guard let h = active, h.generation == generation, generation == gate.current(),
      h.binding.expiresAtMs > Date().timeIntervalSince1970 * 1000, !h.vault.persistenceFailed else { throw MatrixBridgeFailure.denied("MATRIX_STALE_AUTHORITY") }
    return h
  }
  private func emit(_ h: Handle, _ type: String, _ fields: [String: Any] = [:]) {
    guard h.generation == gate.current(), h.binding.expiresAtMs > Date().timeIntervalSince1970 * 1000 else { return }
    publish(fields.merging(["generation": h.generation, "type": type]) { _, new in new })
  }
  private func close(_ h: Handle) async {
    h.upload?.cancel(); h.upload = nil
    if let id = h.roomId, let room = try? h.client.getRoom(roomId: id) { room.enableSendQueue(enable: false) }
    h.timelineTask?.cancel(); h.queueTask?.cancel()
    h.timelineTask = nil; h.queueTask = nil; h.timeline = nil; h.roomId = nil; h.items.removeAll()
  }
  func suspend() async {
    guard let h = active, h.generation != gate.current() else { return }
    active = nil
    await h.client.enableAllSendQueues(enable: false)
    await close(h); h.syncTask?.cancel(); await h.sync?.stop()
    h.verification?.setDelegate(delegate: nil)
    try? await h.client.pause()
  }

  func restore(_ binding: MatrixBindingRecord) async throws -> [String: Any] {
    guard !restoring else { throw MatrixBridgeFailure.denied("MATRIX_RESTORE_ALREADY_PENDING") }
    restoring = true; defer { restoring = false }
    await suspend()
    guard active == nil, binding.account.hasPrefix("ynx1"), binding.userId.hasPrefix("@"), !binding.deviceId.isEmpty,
      let url = URLComponents(string: binding.homeserverUrl), url.scheme == "https", url.host != nil,
      url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
      (url.path.isEmpty || url.path == "/"), binding.expiresAtMs > Date().timeIntervalSince1970 * 1000 else {
      throw MatrixBridgeFailure.denied("MATRIX_CURRENT_AUTHORITY_REQUIRED")
    }
    let generation = gate.current()
    let vault = try MatrixVault(account: binding.account, homeserver: binding.homeserverUrl, userId: binding.userId, deviceId: binding.deviceId)
    let session = try vault.retrieveSessionFromKeychain(userId: binding.userId)
    let store = SqliteStoreBuilder(dataPath: vault.root.appendingPathComponent("data").path, cachePath: vault.root.appendingPathComponent("cache").path)
      .passphrase(passphrase: try vault.passphrase())
    let client = try await ClientBuilder().homeserverUrl(url: binding.homeserverUrl).sqliteStore(config: store)
      .setSessionDelegate(sessionDelegate: vault).disableAutomaticTokenRefresh().build()
    await client.enableAllSendQueues(enable: false)
    try await client.restoreSession(session: session)
    guard try client.userId() == binding.userId, try client.deviceId() == binding.deviceId, generation == gate.current() else {
      try? await client.pause()
      throw MatrixBridgeFailure.denied("MATRIX_IDENTITY_MISMATCH")
    }
    var excluded = URLResourceValues(); excluded.isExcludedFromBackup = true
    var root = vault.root; try root.setResourceValues(excluded)
    let h = Handle(generation, binding, vault, client)
    active = h
    if session.slidingSyncVersion == .native {
      h.sync = try await client.syncService().finish()
      await h.sync?.start()
    } else {
      h.syncTask = client.syncV2(settings: SyncSettingsV2(timeoutMs: 30000, fullState: false), listener: V2Observer { [weak self] in
        Task { await self?.syncUpdate(h) }
      })
    }
    _ = try current(generation)
    return ["generation": generation]
  }
  private func syncUpdate(_ h: Handle) { emit(h, "sync-readback") }
  private func room(_ h: Handle, _ id: String) async throws -> Room {
    _ = try current(h.generation)
    guard let room = try h.client.getRoom(roomId: id), await room.isEncrypted(), room.membership() == .joined else {
      throw MatrixBridgeFailure.denied("MATRIX_PRIVATE_ROOM_POLICY_MISMATCH")
    }
    _ = try current(h.generation)
    return room
  }
  private func dto(_ h: Handle, _ room: Room) async throws -> [String: Any] {
    let members = try await room.activeHumanMemberIds()
    let encrypted = await room.isEncrypted()
    _ = try current(h.generation)
    return ["roomId": room.id(), "name": room.displayName() ?? "Private conversation",
      "encrypted": encrypted, "joined": room.membership() == .joined, "members": members]
  }
  func rooms(_ generation: Int) async throws -> [[String: Any]] {
    let h = try current(generation)
    var values: [[String: Any]] = []
    for room in h.client.rooms() { values.append(try await dto(h, room)) }
    return values
  }
  func directRoom(_ generation: Int, _ peer: String) async throws -> [String: Any] {
    let h = try current(generation)
    guard peer.hasPrefix("@"), peer != h.binding.userId else { throw MatrixBridgeFailure.denied("MATRIX_ACCEPTED_PEER_REQUIRED") }
    if let existing = try h.client.getDmRoom(userId: peer) { return try await dto(h, existing) }
    let id = try await h.client.createRoom(request: CreateRoomParameters(name: nil, isEncrypted: true, isDirect: true,
      visibility: .private, preset: .privateChat, invite: [peer]))
    _ = try current(generation)
    return try await dto(h, h.client.awaitRoomRemoteEcho(roomId: id))
  }
  private func eventDto(_ item: EventTimelineItem) -> [String: Any] {
    var event: Any = NSNull(); var transaction: Any = NSNull()
    switch item.eventOrTransactionId {
    case let .eventId(id): event = id
    case let .transactionId(id): transaction = id
    }
    var kind = "other"; var body: Any = NSNull()
    if case let .msgLike(content) = item.content {
      switch content.kind {
      case let .message(message): kind = "message"; body = message.body
      case .unableToDecrypt: kind = "unable-to-decrypt"
      case .redacted: kind = "redacted"
      default: break
      }
    }
    return ["eventId": event, "transactionId": transaction, "sender": item.sender, "own": item.isOwn,
      "remote": item.isRemote, "kind": kind, "body": body, "intentId": originalPacket(item)?.id as Any? ?? NSNull()]
  }
  private func extraContent(_ intent: String, _ kind: String) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: ["org.ynx.social.intent.v1": ["id": intent, "kind": kind]]), as: UTF8.self)
  }
  private func originalPacket(_ item: EventTimelineItem) -> (id: String, kind: String)? {
    guard item.isOwn, item.isRemote, let raw = item.lazyProvider.debugInfo().originalJson,
      let event = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
      let content = event["content"] as? [String: Any], let packet = content["org.ynx.social.intent.v1"] as? [String: String],
      let id = packet["id"], id.range(of: "^native-matrix-[a-f0-9]{32}$", options: .regularExpression) != nil,
      let kind = packet["kind"], ["text", "file"].contains(kind) else { return nil }
    return (id, kind)
  }
  private func recordSDKEvent(_ h: Handle, _ room: String, _ item: EventTimelineItem) throws {
    _ = try current(h.generation)
    guard item.sender == h.binding.userId, item.isOwn, item.isRemote, let packet = originalPacket(item),
      case let .eventId(eventId) = item.eventOrTransactionId else { return }
    var body: String?
    if case let .msgLike(content) = item.content, case let .message(message) = content.kind { body = message.body }
    _ = try h.vault.observeOriginal(intent: packet.id, room: room, kind: packet.kind, body: body, event: eventId)
  }
  func observeRoom(_ generation: Int, _ id: String) async throws {
    let h = try current(generation)
    await close(h)
    let target = try await room(h, id)
    h.roomId = id
    h.queueTask = try await target.subscribeToSendQueueUpdates(listener: QueueObserver { [weak self] update in
      Task { await self?.queueUpdate(h, id, update) }
    })
    let timeline = try await target.timeline()
    _ = try current(generation)
    h.timeline = timeline
    h.timelineTask = await timeline.addListener(listener: TimelineObserver { [weak self] diffs in
      Task { await self?.timelineUpdate(h, id, diffs) }
    })
    _ = try await timeline.paginateBackwards(numEvents: 30)
    _ = try current(generation)
  }
  private func timelineUpdate(_ h: Handle, _ id: String, _ diffs: [TimelineDiff]) {
    guard h.generation == gate.current(), h.roomId == id else { return }
    for diff in diffs {
      switch diff {
      case let .append(values): h.items.append(contentsOf: values)
      case .clear: h.items.removeAll()
      case let .pushFront(value): h.items.insert(value, at: 0)
      case let .pushBack(value): h.items.append(value)
      case .popFront: if !h.items.isEmpty { h.items.removeFirst() }
      case .popBack: if !h.items.isEmpty { h.items.removeLast() }
      case let .insert(index, value): guard Int(index) <= h.items.count else { emit(h, "timeline-decode-error"); return }; h.items.insert(value, at: Int(index))
      case let .set(index, value): guard Int(index) < h.items.count else { emit(h, "timeline-decode-error"); return }; h.items[Int(index)] = value
      case let .remove(index): guard Int(index) < h.items.count else { emit(h, "timeline-decode-error"); return }; h.items.remove(at: Int(index))
      case let .truncate(length): guard Int(length) <= h.items.count else { emit(h, "timeline-decode-error"); return }; h.items = Array(h.items.prefix(Int(length)))
      case let .reset(values): h.items = values
      }
    }
    do {
      let events = try h.items.compactMap { item -> [String: Any]? in
        guard let event = item.asEvent() else { return nil }
        try recordSDKEvent(h, id, event)
        return eventDto(event)
      }
      emit(h, "timeline", ["roomId": id, "events": events])
    } catch { emit(h, "native-journal-error") }
  }
  private func queueUpdate(_ h: Handle, _ id: String, _ update: RoomSendQueueUpdate) {
    do {
      switch update {
      case let .newLocalEvent(transaction): emit(h, "sdk-local-echo", ["roomId": id, "transactionId": transaction])
      case let .sentEvent(transaction, event):
        let intent = try h.vault.receipt(room: id, transaction: transaction, event: event)
        emit(h, "sdk-sent-needs-readback", ["roomId": id, "transactionId": transaction, "eventId": event, "intentId": intent as Any? ?? NSNull()])
      case let .sendError(transaction, _, _): emit(h, "send-unknown", ["roomId": id, "transactionId": transaction])
      case let .cancelledLocalEvent(transaction): emit(h, "send-cancelled-needs-readback", ["roomId": id, "transactionId": transaction])
      default: break
      }
    } catch { emit(h, "native-journal-error") }
  }
  func closeRoom(_ generation: Int) async throws { await close(try current(generation)) }
  func pendingIntents(_ generation: Int, _ id: String) async throws -> [[String: Any]] {
    let h = try current(generation)
    _ = try await room(h, id)
    guard h.roomId == id else { throw MatrixBridgeFailure.denied("MATRIX_REVIEWED_ROOM_REQUIRED") }
    let entries = try h.vault.pending(room: id)
    _ = try current(generation)
    return entries
  }
  func sendText(_ generation: Int, _ id: String, _ intent: String, _ body: String) async throws -> [String: Any] {
    let h = try current(generation)
    guard !h.sending, h.roomId == id, let timeline = h.timeline, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, body.count <= 16000 else { throw MatrixBridgeFailure.denied("MATRIX_REVIEWED_SEND_REQUIRED") }
    h.sending = true; defer { h.sending = false }
    let target = try await room(h, id)
    try h.vault.reserve(intent: intent, room: id, kind: "text", body: body)
    target.enableSendQueue(enable: true)
    _ = try await timeline.sendWithExtraContent(msg: messageEventContentFromMarkdown(md: body), extraContentJson: extraContent(intent, "text"))
    _ = try current(generation)
    return ["queued": true]
  }
  func stageFile(_ generation: Int, _ source: String) throws -> [String: Any] {
    let h = try current(generation)
    guard let url = URL(string: source), url.isFileURL,
      url.standardizedFileURL.path.hasPrefix(NSHomeDirectory() + "/"),
      let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 20 * 1024 * 1024 else { throw MatrixBridgeFailure.denied("MATRIX_SELECTED_FILE_REQUIRED") }
    try FileManager.default.createDirectory(at: h.vault.staging, withIntermediateDirectories: true)
    let target = h.vault.staging.appendingPathComponent(UUID().uuidString)
    try FileManager.default.copyItem(at: url, to: target)
    return ["uri": target.absoluteString]
  }
  func sendFile(_ generation: Int, _ id: String, _ intent: String, _ uri: String, _ mime: String, _ caption: String) async throws -> [String: Any] {
    let h = try current(generation)
    guard !h.sending, h.roomId == id, let timeline = h.timeline, let file = URL(string: uri), file.isFileURL,
      file.resolvingSymlinksInPath().path.hasPrefix(h.vault.staging.resolvingSymlinksInPath().path + "/"),
      let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 20 * 1024 * 1024 else { throw MatrixBridgeFailure.denied("MATRIX_PRIVATE_STAGING_REQUIRED") }
    h.sending = true; defer { h.sending = false; h.upload = nil }
    let target = try await room(h, id)
    try h.vault.reserve(intent: intent, room: id, kind: "file", body: uri)
    target.enableSendQueue(enable: true)
    let upload = try timeline.sendFile(params: UploadParameters(source: .file(filename: file.path), caption: caption,
      formattedCaption: nil, mentions: nil, inReplyTo: nil, extraContentJson: extraContent(intent, "file")), fileInfo: FileInfo(mimetype: mime, size: UInt64(size), thumbnailInfo: nil, thumbnailSource: nil))
    h.upload = upload
    try await upload.join()
    _ = try current(generation)
    return ["queued": true] // join/cancel is NOT SentEvent or audience readback.
  }
  func readEvent(_ generation: Int, _ id: String, _ eventId: String) async throws -> [String: Any] {
    let h = try current(generation)
    _ = try await room(h, id)
    guard h.roomId == id, let timeline = h.timeline else { throw MatrixBridgeFailure.denied("MATRIX_REVIEWED_ROOM_REQUIRED") }
    try await timeline.fetchDetailsForEvent(eventId: eventId)
    let event = try await timeline.getEventTimelineItemByEventId(eventId: eventId)
    _ = try current(generation)
    try recordSDKEvent(h, id, event)
    return eventDto(event)
  }
  func requestVerification(_ generation: Int, _ peer: String) async throws -> [String: Any] {
    let h = try current(generation)
    guard peer.hasPrefix("@"), peer != h.binding.userId, h.verificationPeer == nil else { throw MatrixBridgeFailure.denied("MATRIX_VERIFICATION_FLOW_ALREADY_ACTIVE") }
    h.verificationPeer = peer
    h.sasAvailable = false
    h.verificationAttempt += 1
    let attempt = h.verificationAttempt
    do {
    let controller = try await h.client.getSessionVerificationController()
    h.verification = controller
    controller.setDelegate(delegate: SASObserver { [weak self] type, values, sender in Task { await self?.verificationUpdate(h, type, values, sender, attempt) } })
    try await controller.requestUserVerification(userId: peer)
    _ = try current(generation)
    return ["attempt": attempt]
    } catch { h.verificationPeer = nil; throw error }
  }
  private func verificationUpdate(_ h: Handle, _ type: String, _ values: [String], _ sender: String?, _ attempt: Int) {
    guard h.generation == gate.current(), h.verificationAttempt == attempt, let peer = h.verificationPeer else { return }
    if type == "verification-request" {
      h.sasRevision += 1; h.sasAvailable = false
      if sender != peer { emit(h, "verification-peer-mismatch", ["peerUserId": sender as Any? ?? NSNull()]); return }
    }
    if type == "sas" { h.sasRevision += 1; h.sasAvailable = true }
    if ["verification-finished", "verification-failed", "verification-cancelled"].contains(type) { h.sasAvailable = false }
    emit(h, type, ["revision": h.sasRevision, "values": values, "peerUserId": peer, "verificationAttempt": attempt])
    if ["verification-finished", "verification-failed", "verification-cancelled"].contains(type) { h.verificationPeer = nil }
  }
  func verificationAction(_ generation: Int, _ action: String, _ revision: Int) async throws {
    let h = try current(generation)
    guard let controller = h.verification else { throw MatrixBridgeFailure.denied("MATRIX_VERIFICATION_FLOW_REQUIRED") }
    switch action {
    case "accept": try await controller.acceptVerificationRequest()
    case "start": try await controller.startSasVerification()
    case "approve": guard h.sasAvailable, revision == h.sasRevision else { throw MatrixBridgeFailure.denied("MATRIX_CURRENT_SAS_REQUIRED") }; h.sasAvailable = false; try await controller.approveVerification()
    case "reject": h.sasAvailable = false; try await controller.declineVerification()
    case "cancel": h.sasAvailable = false; try await controller.cancelVerification()
    default: throw MatrixBridgeFailure.denied("MATRIX_VERIFICATION_ACTION_INVALID")
    }
    _ = try current(generation)
  }
  func logout(_ generation: Int) async throws {
    let h = try current(generation)
    await h.client.enableAllSendQueues(enable: false)
    await close(h); h.syncTask?.cancel(); await h.sync?.stop()
    try await h.client.logout()
    _ = try current(generation)
  }
}

public final class YNXSocialMatrixModule: Module, @unchecked Sendable {
  private let gate = MatrixGeneration()
  private lazy var engine = MatrixEngine(gate: gate) { [weak self] event in self?.sendEvent("onMatrixEvent", event) }
  public func definition() -> ModuleDefinition {
    Name("YNXSocialMatrix")
    Events("onMatrixEvent")
    Function("invalidate") { self.gate.invalidate() }
    AsyncFunction("suspend") { await self.engine.suspend() }
    AsyncFunction("restore") { (binding: MatrixBindingRecord) async throws -> [String: Any] in try await self.engine.restore(binding) }
    AsyncFunction("rooms") { (generation: Int) async throws -> [[String: Any]] in try await self.engine.rooms(generation) }
    AsyncFunction("directRoom") { (generation: Int, peer: String) async throws -> [String: Any] in try await self.engine.directRoom(generation, peer) }
    AsyncFunction("observeRoom") { (generation: Int, id: String) async throws in try await self.engine.observeRoom(generation, id) }
    AsyncFunction("closeRoom") { (generation: Int) async throws in try await self.engine.closeRoom(generation) }
    AsyncFunction("pendingIntents") { (generation: Int, id: String) async throws -> [[String: Any]] in try await self.engine.pendingIntents(generation, id) }
    AsyncFunction("sendText") { (generation: Int, id: String, intent: String, body: String) async throws -> [String: Any] in try await self.engine.sendText(generation, id, intent, body) }
    AsyncFunction("stageFile") { (generation: Int, source: String) async throws -> [String: Any] in try await self.engine.stageFile(generation, source) }
    AsyncFunction("sendFile") { (generation: Int, id: String, intent: String, uri: String, mime: String, caption: String) async throws -> [String: Any] in try await self.engine.sendFile(generation, id, intent, uri, mime, caption) }
    AsyncFunction("readEvent") { (generation: Int, id: String, event: String) async throws -> [String: Any] in try await self.engine.readEvent(generation, id, event) }
    AsyncFunction("requestVerification") { (generation: Int, peer: String) async throws -> [String: Any] in try await self.engine.requestVerification(generation, peer) }
    AsyncFunction("verificationAction") { (generation: Int, action: String, revision: Int) async throws in try await self.engine.verificationAction(generation, action, revision) }
    AsyncFunction("logout") { (generation: Int) async throws in try await self.engine.logout(generation) }
    OnDestroy { self.gate.invalidate(); Task { await self.engine.suspend() } }
  }
}
