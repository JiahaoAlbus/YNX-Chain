package com.ynx.social.matrix

import android.net.Uri
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.matrix.rustcomponents.sdk.*
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

class MatrixBindingRecord : Record {
  @Field var account: String = ""
  @Field var homeserverUrl: String = ""
  @Field var userId: String = ""
  @Field var deviceId: String = ""
  @Field var authorityId: String = ""
  @Field var expiresAtMs: Double = 0.0
}

class YNXSocialMatrixModule : Module() {
  private val epoch = AtomicInteger(0)
  private val mutex = Mutex()
  private val cleanupScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var active: Handle? = null
  private val retired = mutableListOf<Handle>()

  private class Handle(val generation: Int, val binding: MatrixBindingRecord, val vault: MatrixVault, val client: Client) {
    var sync: SyncService? = null
    var syncTask: TaskHandle? = null
    var timeline: Timeline? = null
    var roomId: String? = null
    var timelineTask: TaskHandle? = null
    var queueTask: TaskHandle? = null
    var verification: SessionVerificationController? = null
    var sasRevision = 0
    var sasAvailable = false
    @Volatile var verificationPeer: String? = null
    @Volatile var verificationAttempt = 0
    @Volatile var upload: SendAttachmentJoinHandle? = null
    val items = mutableListOf<TimelineItem>()
  }

  private fun current(generation: Int): Handle {
    val h = active ?: error("MATRIX_NATIVE_SESSION_REQUIRED")
    check(generation == epoch.get() && h.generation == generation
      && h.binding.expiresAtMs > System.currentTimeMillis() && !h.vault.persistenceFailed) { "MATRIX_STALE_AUTHORITY" }
    return h
  }

  private fun emit(h: Handle, type: String, fields: Map<String, Any?> = emptyMap()) {
    if (h.generation == epoch.get() && h.binding.expiresAtMs > System.currentTimeMillis())
      sendEvent("onMatrixEvent", mapOf("generation" to h.generation, "type" to type) +
        (if (type == "sas" || type.startsWith("verification-")) mapOf("peerUserId" to h.verificationPeer, "verificationAttempt" to h.verificationAttempt) else emptyMap()) + fields)
  }

  private suspend fun room(h: Handle, id: String): Room {
    current(h.generation)
    val room = h.client.getRoom(id) ?: error("MATRIX_ROOM_MISSING")
    check(room.isEncrypted() && room.membership() == Membership.JOINED) { "MATRIX_PRIVATE_ROOM_POLICY_MISMATCH" }
    current(h.generation)
    return room
  }

  private suspend fun roomDto(h: Handle, room: Room): Map<String, Any?> {
    val members = room.activeHumanMemberIds()
    val encrypted = room.isEncrypted()
    current(h.generation)
    return mapOf("roomId" to room.id(), "name" to (room.displayName() ?: "Private conversation"),
      "encrypted" to encrypted, "joined" to (room.membership() == Membership.JOINED), "members" to members)
  }

  private fun eventDto(item: EventTimelineItem): Map<String, Any?> {
    val id = item.eventOrTransactionId
    val kind = (item.content as? TimelineItemContent.MsgLike)?.content?.kind
    val message = kind as? MsgLikeKind.Message
    return mapOf("eventId" to (id as? EventOrTransactionId.EventId)?.eventId,
      "transactionId" to (id as? EventOrTransactionId.TransactionId)?.transactionId,
      "sender" to item.sender, "own" to item.isOwn, "remote" to item.isRemote,
      "kind" to when (kind) { is MsgLikeKind.Message -> "message"; is MsgLikeKind.UnableToDecrypt -> "unable-to-decrypt"; is MsgLikeKind.Redacted -> "redacted"; else -> "other" },
      "body" to message?.content?.body, "intentId" to originalPacket(item)?.first)
  }

  private fun extraContent(intent: String, kind: String): String = JSONObject().put("org.ynx.social.intent.v1",
    JSONObject().put("id", intent).put("kind", kind)).toString()

  private fun originalPacket(item: EventTimelineItem): Pair<String, String>? {
    if (!item.isOwn || !item.isRemote) return null
    val raw = item.lazyProvider.debugInfo().originalJson ?: return null
    val packet = JSONObject(raw).optJSONObject("content")?.optJSONObject("org.ynx.social.intent.v1") ?: return null
    val id = packet.optString("id"); val kind = packet.optString("kind")
    if (!Regex("native-matrix-[a-f0-9]{32}").matches(id) || kind !in listOf("text", "file")) return null
    return id to kind
  }

  private fun recordSDKEvent(h: Handle, room: String, item: EventTimelineItem) {
    current(h.generation)
    if (item.sender != h.binding.userId || !item.isOwn || !item.isRemote) return
    val packet = originalPacket(item) ?: return
    val eventId = (item.eventOrTransactionId as? EventOrTransactionId.EventId)?.eventId ?: return
    val body = ((item.content as? TimelineItemContent.MsgLike)?.content?.kind as? MsgLikeKind.Message)?.content?.body
    h.vault.observeOriginal(packet.first, room, packet.second, body, eventId)
  }

  private suspend fun closeRoom(h: Handle) {
    h.upload?.cancel(); h.upload = null
    h.roomId?.let { h.client.getRoom(it)?.enableSendQueue(false) }
    h.timelineTask?.cancel(); h.queueTask?.cancel()
    h.timelineTask = null; h.queueTask = null; h.timeline = null; h.roomId = null
    synchronized(h.items) { h.items.clear() }
  }

  override fun definition() = ModuleDefinition {
    Name("YNXSocialMatrix")
    Events("onMatrixEvent")

    // Synchronous fence precedes async SDK cleanup. suspend drains retired
    // handles only; a late cleanup cannot pause a newer restored handle.
    Function("invalidate") {
      epoch.incrementAndGet()
      synchronized(retired) { active?.let { it.upload?.cancel(); retired.add(it) }; active = null }
    }
    OnDestroy {
      epoch.incrementAndGet()
      val handles = synchronized(retired) { active?.let { retired.add(it) }; active = null; retired.toList().also { retired.clear() } }
      handles.forEach { it.upload?.cancel(); it.syncTask?.cancel(); it.timelineTask?.cancel(); it.queueTask?.cancel() }
      cleanupScope.launch { for (h in handles) { h.client.enableAllSendQueues(false); h.sync?.stop(); h.client.pause() } }
    }
    AsyncFunction("suspend") Coroutine { ->
      val handles = synchronized(retired) { retired.toList().also { retired.clear() } }
      for (h in handles) {
        h.client.enableAllSendQueues(false)
        closeRoom(h); h.syncTask?.cancel(); h.sync?.stop(); h.verification?.setDelegate(null)
        h.client.pause()
      }
    }

    AsyncFunction("restore") Coroutine { binding: MatrixBindingRecord -> mutex.withLock {
      withTimeout(30000) {
        require(Regex("ynx1[a-z0-9]+").matches(binding.account) && binding.userId.startsWith("@") && binding.deviceId.isNotBlank())
        val url = Uri.parse(binding.homeserverUrl)
        require(url.scheme == "https" && url.host != null && url.userInfo == null && url.query == null && url.fragment == null
          && (url.path.isNullOrEmpty() || url.path == "/") && binding.expiresAtMs > System.currentTimeMillis())
        check(active == null) { "MATRIX_LOCK_BEFORE_RESTORE" }
        val generation = epoch.get()
        val context = appContext.reactContext ?: error("MATRIX_NATIVE_CONTEXT_REQUIRED")
        val vault = MatrixVault(context, binding.account, binding.homeserverUrl, binding.userId, binding.deviceId)
        // No new device/MXID is generated. Enrollment must already exist in
        // native custody with the matching SDK crypto store.
        val session = vault.retrieveSessionFromKeychain(binding.userId)
        val client = ClientBuilder().homeserverUrl(binding.homeserverUrl)
          .sqliteStore(SqliteStoreBuilder(File(vault.root, "data").path, File(vault.root, "cache").path).passphrase(vault.passphrase()))
          .setSessionDelegate(vault).disableAutomaticTokenRefresh().build()
        client.enableAllSendQueues(false)
        client.restoreSession(session)
        check(client.userId() == binding.userId && client.deviceId() == binding.deviceId && epoch.get() == generation) { "MATRIX_IDENTITY_MISMATCH" }
        val h = Handle(generation, binding, vault, client)
        active = h
        if (session.slidingSyncVersion == SlidingSyncVersion.NATIVE) {
          h.sync = client.syncService().finish()
          h.sync!!.start()
        } else {
          h.syncTask = client.syncV2(SyncSettingsV2(30000uL, false), object : SyncListenerV2 {
            override fun onUpdate(response: SyncResponseV2) { emit(h, "sync-readback") }
          })
        }
        current(generation)
        mapOf("generation" to generation)
      }
    } }

    AsyncFunction("rooms") Coroutine { generation: Int -> mutex.withLock {
      val h = current(generation)
      h.client.rooms().map { roomDto(h, it) }
    } }

    AsyncFunction("directRoom") Coroutine { generation: Int, peer: String -> mutex.withLock {
      val h = current(generation)
      require(peer.startsWith("@") && peer != h.binding.userId)
      val existing = h.client.getDmRoom(peer)
      val target = existing ?: run {
        val id = h.client.createRoom(CreateRoomParameters(name = null, topic = null, isEncrypted = true,
          isDirect = true, visibility = RoomVisibility.Private, preset = RoomPreset.PRIVATE_CHAT,
          invite = listOf(peer), avatar = null, powerLevelContentOverride = null, joinRuleOverride = null,
          historyVisibilityOverride = null, canonicalAlias = null, isSpace = false))
        current(generation)
        h.client.awaitRoomRemoteEcho(id)
      }
      roomDto(h, target)
    } }

    AsyncFunction("observeRoom") Coroutine { generation: Int, id: String -> mutex.withLock {
      val h = current(generation)
      closeRoom(h)
      val target = room(h, id)
      h.roomId = id
      h.queueTask = target.subscribeToSendQueueUpdates(object : SendQueueListener {
        override fun onUpdate(update: RoomSendQueueUpdate) {
          try {
            when (update) {
              is RoomSendQueueUpdate.NewLocalEvent -> emit(h, "sdk-local-echo", mapOf("roomId" to id, "transactionId" to update.transactionId))
              is RoomSendQueueUpdate.SentEvent -> {
                val intent = h.vault.receipt(id, update.transactionId, update.eventId)
                emit(h, "sdk-sent-needs-readback", mapOf("roomId" to id, "intentId" to intent,
                  "transactionId" to update.transactionId, "eventId" to update.eventId))
              }
              is RoomSendQueueUpdate.SendError -> emit(h, "send-unknown", mapOf("roomId" to id, "transactionId" to update.transactionId))
              is RoomSendQueueUpdate.CancelledLocalEvent -> emit(h, "send-cancelled-needs-readback", mapOf("roomId" to id, "transactionId" to update.transactionId))
              else -> Unit
            }
          } catch (_: Throwable) { emit(h, "native-journal-error") }
        }
      })
      val timeline = target.timeline()
      h.timeline = timeline
      h.timelineTask = timeline.addListener(object : TimelineListener {
        override fun onUpdate(diff: List<TimelineDiff>) {
          if (h.generation != epoch.get() || h.roomId != id) return
          try { synchronized(h.items) {
            for (d in diff) when (d) {
              is TimelineDiff.Append -> h.items.addAll(d.values)
              is TimelineDiff.Clear -> h.items.clear()
              is TimelineDiff.PushFront -> h.items.add(0, d.value)
              is TimelineDiff.PushBack -> h.items.add(d.value)
              is TimelineDiff.PopFront -> if (h.items.isNotEmpty()) h.items.removeAt(0)
              is TimelineDiff.PopBack -> if (h.items.isNotEmpty()) h.items.removeAt(h.items.lastIndex)
              is TimelineDiff.Insert -> h.items.add(d.index.toInt(), d.value)
              is TimelineDiff.Set -> h.items[d.index.toInt()] = d.value
              is TimelineDiff.Remove -> h.items.removeAt(d.index.toInt())
              is TimelineDiff.Truncate -> while (h.items.size > d.length.toInt()) h.items.removeAt(h.items.lastIndex)
              is TimelineDiff.Reset -> { h.items.clear(); h.items.addAll(d.values) }
            }
            val events = h.items.mapNotNull { it.asEvent()?.let { event -> recordSDKEvent(h, id, event); eventDto(event) } }
            emit(h, "timeline", mapOf("roomId" to id, "events" to events))
          } } catch (_: Throwable) { emit(h, "timeline-decode-error", mapOf("roomId" to id)) }
        }
      })
      timeline.paginateBackwards(30u)
      current(generation)
    } }

    AsyncFunction("closeRoom") Coroutine { generation: Int -> mutex.withLock { closeRoom(current(generation)) } }

    AsyncFunction("pendingIntents") Coroutine { generation: Int, id: String -> mutex.withLock {
      val h = current(generation)
      room(h, id)
      check(h.roomId == id) { "MATRIX_REVIEWED_ROOM_REQUIRED" }
      val entries = h.vault.pending(id)
      current(generation)
      entries
    } }

    AsyncFunction("sendText") Coroutine { generation: Int, id: String, intent: String, body: String -> mutex.withLock {
      val h = current(generation)
      require(body.isNotBlank() && body.length <= 16000)
      val target = room(h, id)
      check(h.roomId == id && h.timeline != null) { "MATRIX_REVIEWED_ROOM_REQUIRED" }
      h.vault.reserve(intent, id, "text", body)
      target.enableSendQueue(true)
      h.timeline!!.sendWithExtraContent(messageEventContentFromMarkdown(body), extraContent(intent, "text"))
      current(generation)
      mapOf("queued" to true)
    } }

    AsyncFunction("stageFile") Coroutine { generation: Int, source: String -> mutex.withLock {
      val h = current(generation)
      val context = appContext.reactContext ?: error("MATRIX_NATIVE_CONTEXT_REQUIRED")
      require(Uri.parse(source).scheme in listOf("file", "content"))
      check(h.vault.staging.isDirectory || h.vault.staging.mkdirs())
      val file = File(h.vault.staging, UUID.randomUUID().toString())
      withContext(Dispatchers.IO) {
        val input = context.contentResolver.openInputStream(Uri.parse(source)) ?: error("MATRIX_SELECTED_FILE_UNAVAILABLE")
        try { input.use { stream -> file.outputStream().use { output ->
          var total = 0L; val buffer = ByteArray(65536)
          while (true) { val n = stream.read(buffer); if (n < 0) break; total += n; check(total <= 20 * 1024 * 1024) { "MATRIX_MEDIA_SIZE_LIMIT" }; output.write(buffer, 0, n) }
        } } } catch (error: Throwable) { file.delete(); throw error }
      }
      current(generation)
      mapOf("uri" to Uri.fromFile(file).toString())
    } }

    AsyncFunction("sendFile") Coroutine { generation: Int, id: String, intent: String, uri: String, mime: String, caption: String -> mutex.withLock {
      val h = current(generation)
      val target = room(h, id)
      check(h.roomId == id && h.timeline != null)
      val file = File(Uri.parse(uri).path ?: error("MATRIX_PRIVATE_STAGING_REQUIRED")).canonicalFile
      require(file.path.startsWith(h.vault.staging.canonicalPath + File.separator) && file.isFile && file.length() <= 20 * 1024 * 1024)
      h.vault.reserve(intent, id, "file", uri)
      try {
        target.enableSendQueue(true)
        val upload = h.timeline!!.sendFile(UploadParameters(UploadSource.File(file.path), caption, null, null, null, extraContent(intent, "file")),
          FileInfo(mime, file.length().toULong(), null, null))
        h.upload = upload
        upload.join()
        current(generation)
        // Normal join is also possible after cancellation. Not a delivery receipt.
        mapOf("queued" to true)
      } finally { h.upload = null }
    } }

    AsyncFunction("readEvent") Coroutine { generation: Int, id: String, eventId: String -> mutex.withLock {
      val h = current(generation)
      room(h, id)
      check(h.roomId == id && h.timeline != null)
      h.timeline!!.fetchDetailsForEvent(eventId)
      val event = h.timeline!!.getEventTimelineItemByEventId(eventId)
      current(generation)
      recordSDKEvent(h, id, event)
      eventDto(event)
    } }

    AsyncFunction("requestVerification") Coroutine { generation: Int, peer: String -> mutex.withLock {
      val h = current(generation)
      require(peer.startsWith("@") && peer != h.binding.userId)
      val attempt = synchronized(h) {
        check(h.verificationPeer == null) { "MATRIX_VERIFICATION_FLOW_ALREADY_ACTIVE" }
        h.verificationPeer = peer; h.sasAvailable = false; ++h.verificationAttempt
      }
      val controller = try { h.client.getSessionVerificationController() } catch (error: Throwable) { h.verificationPeer = null; throw error }
      h.verification = controller
      controller.setDelegate(object : SessionVerificationControllerDelegate {
        private fun activeFlow() = h.generation == epoch.get() && h.verificationAttempt == attempt && h.verificationPeer == peer
        override fun didReceiveVerificationRequest(details: SessionVerificationRequestDetails) {
          if (!activeFlow()) return
          synchronized(h) { h.sasRevision++; h.sasAvailable = false }
          if (details.senderProfile.userId != h.verificationPeer) {
            emit(h, "verification-peer-mismatch", mapOf("peerUserId" to details.senderProfile.userId)); return
          }
          emit(h, "verification-request")
        }
        override fun didAcceptVerificationRequest() { if (activeFlow()) emit(h, "verification-accepted") }
        override fun didStartSasVerification() { if (activeFlow()) emit(h, "verification-started") }
        override fun didReceiveVerificationData(data: SessionVerificationData) {
          val revision = synchronized(h) {
            if (!activeFlow()) return
            h.sasRevision++; h.sasAvailable = true; h.sasRevision
          }
          val values = when (data) { is SessionVerificationData.Emojis -> data.emojis.map { it.symbol() + " " + it.description() }; is SessionVerificationData.Decimals -> data.values.map { it.toString() } }
          emit(h, "sas", mapOf("revision" to revision, "values" to values, "peerUserId" to peer, "verificationAttempt" to attempt))
        }
        override fun didFail() { if (activeFlow()) { h.sasAvailable = false; emit(h, "verification-failed"); h.verificationPeer = null } }
        override fun didCancel() { if (activeFlow()) { h.sasAvailable = false; emit(h, "verification-cancelled"); h.verificationPeer = null } }
        override fun didFinish() { if (activeFlow()) { h.sasAvailable = false; emit(h, "verification-finished"); h.verificationPeer = null } }
      })
      try { controller.requestUserVerification(peer) } catch (error: Throwable) { h.verificationPeer = null; throw error }
      current(generation)
      mapOf("attempt" to attempt)
    } }

    AsyncFunction("verificationAction") Coroutine { generation: Int, action: String, revision: Int -> mutex.withLock {
      val h = current(generation)
      val controller = h.verification ?: error("MATRIX_VERIFICATION_FLOW_REQUIRED")
      when (action) {
        "accept" -> controller.acceptVerificationRequest()
        "start" -> controller.startSasVerification()
        "approve" -> { synchronized(h) { check(h.sasAvailable && h.sasRevision == revision); h.sasAvailable = false }; controller.approveVerification() }
        "reject" -> { h.sasAvailable = false; controller.declineVerification() }
        "cancel" -> { h.sasAvailable = false; controller.cancelVerification() }
        else -> error("MATRIX_VERIFICATION_ACTION_INVALID")
      }
      current(generation)
    } }

    AsyncFunction("logout") Coroutine { generation: Int -> mutex.withLock {
      val h = current(generation)
      h.client.enableAllSendQueues(false)
      closeRoom(h); h.syncTask?.cancel(); h.sync?.stop()
      h.client.logout()
      current(generation)
      // No cross-device revocation and no key/store deletion is inferred.
    } }
  }
}
