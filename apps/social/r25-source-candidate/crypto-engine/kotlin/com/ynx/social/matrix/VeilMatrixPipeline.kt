package com.ynx.social.matrix

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import org.matrix.rustcomponents.sdk.Client
import org.matrix.rustcomponents.sdk.EventTimelineItem
import org.matrix.rustcomponents.sdk.Room
import org.signal.libsignal.protocol.IdentityKey
import java.security.MessageDigest
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Dormant native composition. No production enrollment/authority/bridge factory.
 * Protocol activation and real independent directory/anchor remain separate. */
internal class VeilMatrixPipeline(
  private val store: VeilNativeStore,
  private val own: IdentityKey,
  private val local: VeilSignalAddress,
  private val authority: VeilContextAuthority,
  private val routes: NativeRoutes,
  private val media: BoundedCipherDownload,
  private val attachments: BoundedAttachmentDownload? = null,
  private val protection: ProtectedAdmission? = null
) {
  internal data class Reviewed(
    val client: Client, val room: Room, val scope: VeilMatrixJournal.Scope,
    // Independently authenticated durable routing generation, never process
    // epoch/JS data. Scope.recheck must invalidate this exact original binding.
    val nativeGeneration: Long
  ) {
    fun same(other: Reviewed) = client === other.client && nativeGeneration == other.nativeGeneration && scope.same(other.scope)
  }
  internal fun interface NativeRoutes {
    // Must use original native session/accepted route and independent context.
    // Never construct admission from JS/Matrix/SSO fields. Missing -> unavailable.
    fun review(tx: VeilRecordTransaction, context: VeilApplicationContext, hint: String): Reviewed
  }
  internal fun interface ProtectedAdmission {
    // Original CryptoEngine producer ONLY: independently establish the pinned
    // source/protocol provenance and actual negotiated protection/key mixture of
    // this exact device session/context and native route generation. A Grant,
    // library name, hasSenderChain or nonempty PQ record is not this evidence.
    // Return a source-bound live guard usable after tx freezes; no JS/SSO/Matrix
    // bool, synthetic production factory, or reconstruction from metadata.
    fun requireProtected(tx: VeilRecordTransaction, context: VeilApplicationContext, route: Reviewed): Runnable
  }
  internal fun interface BoundedCipherDownload {
    // Original native SDK transport with an enforced streaming/resource limit.
    // No eager unbounded getMediaContent masquerading as a bounded download.
    suspend fun download(client: Client, media: String, maximum: Int, recheck: () -> Unit): ByteArray
  }
  internal fun interface BoundedAttachmentDownload {
    // Original admitted SDK streaming producer only. Enforce maximum upstream,
    // finite socket timeout/cancellation and VeilMatrixAttachmentRead.readExact.
    // No getMediaContent, copied-token client, or metadata-derived admission.
    suspend fun download(client: Client, media: String, maximum: Int, recheck: () -> Unit): ByteArray
  }
  internal class ReceivedAttachment(
    val attachmentId: UUID, val senderMessageId: UUID, val originalOperation: UUID,
    private var content: ByteArray?
  ) : AutoCloseable {
    @Synchronized fun bytes(): ByteArray = content?.copyOf() ?: error("VEIL_ATTACHMENT_CLOSED")
    @Synchronized override fun close() { content?.fill(0); content = null }
  }
  internal data class SendResult(val phase: VeilMatrixJournal.Phase, val originalEventHint: String?)
  private data class Current(val reviewed: Reviewed, val grant: VeilContextAuthority.Grant)
  private val sends = Mutex()
  private val attachmentPreparations = Mutex()

  // Protected equality binding only. Its inputs must come from current(), not
  // the attachment/Matrix descriptor. Separate from the existing Signal journal
  // because attachment upload precedes creation of the inner Signal ciphertext.
  private fun attachmentBinding(tx: VeilRecordTransaction, operation: UUID, checked: Current,
      preparing: Boolean, incoming: ByteArray? = null) {
    val context = VeilAuthenticatedEnvelope.contextBytes(checked.grant.context, incoming == null)
    val generation = ByteBuffer.allocate(8).putLong(checked.reviewed.nativeGeneration).array()
    val fields = arrayOf(context, generation,
      VeilAuthenticatedEnvelope.text(checked.reviewed.scope.homeserver, 2048),
      VeilAuthenticatedEnvelope.text(checked.reviewed.scope.self, 255),
      VeilAuthenticatedEnvelope.text(checked.reviewed.scope.peer, 255),
      VeilAuthenticatedEnvelope.text(checked.reviewed.scope.room, 255), incoming ?: byteArrayOf(0))
    val fingerprint = VeilAuthenticatedEnvelope.digest(*fields)
    val key = (if (incoming == null) "matrix-attachment-send:" else "matrix-attachment-receive:") + operation
    var previous: ByteArray? = null
    try {
      tx.checkLive()
      when (tx) {
        is VeilNativeTransaction -> tx.guardCommit { checked.reviewed.scope.recheck.run() }
        is VeilContextAuthority.CommitGuardPort -> tx.guardCommit(checked.reviewed.scope.recheck)
        else -> error("VEIL_APPLICATION_CONTEXT_UNAVAILABLE")
      }
      previous = tx.read(VeilRecordKind.OUTBOX, key)
      if (previous == null) {
        check(preparing) { "VEIL_NATIVE_RECOVERY_REQUIRED" }
        if (incoming == null) {
          // Never adopt an orphan attachment or an existing text operation.
          for (existing in arrayOf("attachment-v2:$operation:meta", "attachment-v2:$operation:key",
              "attachment-v2:$operation:0", "signal:$operation", "matrix-v2:$operation",
              "matrix-v2-context:$operation")) {
            val raw = tx.read(VeilRecordKind.OUTBOX, existing)
            try { check(raw == null) { "VEIL_NATIVE_RECOVERY_REQUIRED" } }
            finally { raw?.fill(0) }
          }
        }
        tx.write(VeilRecordKind.OUTBOX, key, fingerprint)
      } else {
        check(MessageDigest.isEqual(previous, fingerprint)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
      }
      checked.grant.recheck.run(); checked.reviewed.scope.recheck.run(); tx.checkLive()
    } finally {
      previous?.fill(0); fingerprint.fill(0)
      fields.forEach { if (it !== incoming) it.fill(0) }
    }
  }

  // Atomic native attachment preparation -> SDK upload -> atomic original Signal
  // descriptor and journal. Retry reuses ciphertext/key/locator; no new ratchet
  // advance. No network or suspension occurs while a native transaction is live.
  suspend fun prepareAttachment(operation: UUID, hint: String, peer: VeilSignalAddress,
      plaintext: ByteArray): VeilMatrixJournal.Entry = attachmentPreparations.withLock {
    validate(operation, hint)
    require(plaintext.isNotEmpty() && plaintext.size <= VeilAttachmentNative.MAX_BYTES) {
      "VEIL_ATTACHMENT_INPUT_REJECTED"
    }
    val snapshot = plaintext.copyOf()
    var wire: ByteArray? = null
    try {
      val captured = store.transaction { tx ->
        val checked = current(tx, hint, peer)
        attachmentBinding(tx, operation, checked, true)
        val aad = VeilMatrixAttachmentTransport.aad(checked.grant.context, operation, true)
        try { wire = VeilMatrixAttachmentTransport.prepare(tx, operation, aad, snapshot) }
        finally { aad.fill(0) }
        checked.reviewed
      }
      val recheck = {
        store.transaction { tx ->
          val checked = current(tx, hint, peer)
          check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
          attachmentBinding(tx, operation, checked, false)
        }
        Unit
      }
      val originalMedia = store.transaction { tx ->
        val checked = current(tx, hint, peer)
        check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
        attachmentBinding(tx, operation, checked, false)
        val aad = VeilMatrixAttachmentTransport.aad(checked.grant.context, operation, true)
        try { VeilMatrixAttachmentTransport.originalMedia(tx, operation, aad) }
        finally { aad.fill(0) }
      }
      val locator = originalMedia ?: VeilMatrixSdkCalls.uploadAttachment(captured.client,
        checkNotNull(wire), recheck)
      recheck()
      store.transaction { tx ->
        val checked = current(tx, hint, peer)
        check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
        attachmentBinding(tx, operation, checked, false)
        bind(tx, operation, checked.grant.context, checked.reviewed, true)
        val aad = VeilMatrixAttachmentTransport.aad(checked.grant.context, operation, true)
        var descriptor: ByteArray? = null
        try {
          descriptor = VeilMatrixAttachmentTransport.descriptor(tx, operation, aad, locator)
          val pending = VeilSignalOutbox.encryptInTransaction(tx, authority, own, local.sdk(),
            operation, hint, peer.sdk(), descriptor)
          checked.grant.recheck.run()
          VeilMatrixJournal.prepareInTransaction(tx, checked.reviewed.scope, operation, pending)
        } finally { descriptor?.fill(0); aad.fill(0) }
      }
    } finally { wire?.fill(0); snapshot.fill(0) }
  }

  suspend fun receiveAttachment(operation: UUID, hint: String, peer: VeilSignalAddress,
      sdkEvent: EventTimelineItem): ReceivedAttachment {
    validate(operation, hint)
    // Fail before receiving/ratchet work when original bounded producer is absent.
    val downloader = attachments ?: error("VEIL_MATRIX_ATTACHMENT_STREAM_UNAVAILABLE")
    val received = receive(operation, hint, peer, sdkEvent)
    var signalContent: ByteArray? = null
    var downloaded: ByteArray? = null
    var candidate: ReceivedAttachment? = null
    try {
      val content = received.bytes()
      signalContent = content
      VeilMatrixAttachmentTransport.parse(content).use { descriptor ->
        // Identity comes exclusively from the authenticated Signal inner content.
        val captured = store.transaction { tx ->
          val checked = current(tx, hint, peer)
          attachmentBinding(tx, operation, checked, true, content)
          checked.reviewed
        }
        val recheck = {
          store.transaction { tx ->
            val checked = current(tx, hint, peer)
            check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
            attachmentBinding(tx, operation, checked, false, content)
          }
          Unit
        }
        recheck()
        val wire: ByteArray = withTimeout<ByteArray>(30_000L) {
          downloader.download(captured.client, descriptor.media, descriptor.wireSize, recheck).also {
            downloaded = it // Retain ownership even on prompt timeout cancellation.
          }
        }
        recheck()
        check(wire.size == descriptor.wireSize && wire.size <= VeilAttachmentNative.MAX_WIRE) {
          "VEIL_ATTACHMENT_INPUT_REJECTED"
        }
        return store.transaction { tx ->
          val checked = current(tx, hint, peer)
          check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
          attachmentBinding(tx, operation, checked, false, content)
          val aad = VeilMatrixAttachmentTransport.aad(checked.grant.context, descriptor.id, false)
          var clear: ByteArray? = null
          try {
            clear = descriptor.open(tx, aad, wire)
            val result = ReceivedAttachment(descriptor.id, received.senderMessageId,
              received.originalOperation, clear)
            candidate = result
            clear = null // Ownership remains private; failure below closes candidate.
            checked.grant.recheck.run(); checked.reviewed.scope.recheck.run(); tx.checkLive()
            result
          } finally { clear?.fill(0); aad.fill(0) }
        }
      }
    } catch (failure: Throwable) { candidate?.close(); throw failure }
    finally { received.close(); signalContent?.fill(0); downloaded?.fill(0) }
  }

  private fun validate(operation: UUID, hint: String) {
    VeilAuthenticatedEnvelope.validateId(operation)
    VeilAuthenticatedEnvelope.text(hint, 512)
  }
  private fun current(tx: VeilRecordTransaction, hint: String, peer: VeilSignalAddress): Current {
    val grant = authority.resolve(tx, hint, own, local.sdk(), peer.sdk())
    val reviewed = routes.review(tx, grant.context, hint)
    check(reviewed.nativeGeneration != 0L) { "VEIL_APPLICATION_CONTEXT_UNAVAILABLE" }
    reviewed.scope.recheck.run()
    check(reviewed.room.id() == reviewed.scope.room && reviewed.room.ownUserId() == reviewed.scope.self) {
      "VEIL_AUTHENTICATED_CONTEXT_MISMATCH"
    }
    val producer = protection ?: error("VEIL_PROTOCOL_PROTECTION_UNAVAILABLE")
    val protected = producer.requireProtected(tx, grant.context, reviewed)
    protected.run(); tx.checkLive()
    when (tx) {
      is VeilNativeTransaction -> tx.guardCommit { protected.run() }
      is VeilContextAuthority.CommitGuardPort -> tx.guardCommit(protected)
      else -> error("VEIL_PROTOCOL_PROTECTION_UNAVAILABLE")
    }
    grant.recheck.run(); tx.checkLive()
    return Current(reviewed, grant)
  }
  private fun bind(tx: VeilRecordTransaction, operation: UUID, context: VeilApplicationContext, reviewed: Reviewed, preparing: Boolean) {
    val bytes = VeilAuthenticatedEnvelope.contextBytes(context, true)
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    try { VeilMatrixContextBinding.require(tx, operation, digest, reviewed.nativeGeneration, reviewed.scope, preparing) }
    finally { bytes.fill(0); digest.fill(0) }
  }
  fun prepare(operation: UUID, hint: String, peer: VeilSignalAddress, plaintext: ByteArray): VeilMatrixJournal.Entry {
    validate(operation, hint)
    VeilAuthenticatedEnvelope.validateContent(plaintext)
    val snapshot = plaintext.copyOf()
    try {
      return store.transaction { tx ->
        val checked = current(tx, hint, peer)
        // Bind before any first encryption; all writes commit together. Existing
        // operation/generation mismatch fails before SDK encryption or network.
        bind(tx, operation, checked.grant.context, checked.reviewed, true)
        val pending = VeilSignalOutbox.encryptInTransaction(tx, authority, own, local.sdk(), operation, hint, peer.sdk(), snapshot)
        checked.grant.recheck.run()
        VeilMatrixJournal.prepareInTransaction(tx, checked.reviewed.scope, operation, pending)
      }
    } finally { snapshot.fill(0) }
  }
  private fun outgoing(tx: VeilRecordTransaction, operation: UUID, hint: String, peer: VeilSignalAddress): Current {
    val checked = current(tx, hint, peer)
    bind(tx, operation, checked.grant.context, checked.reviewed, false)
    return checked
  }
  private fun gate(operation: UUID, hint: String, peer: VeilSignalAddress, captured: Reviewed) {
    store.transaction { tx ->
      val checked = outgoing(tx, operation, hint, peer)
      check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
      VeilMatrixJournal.readInTransaction(tx, checked.reviewed.scope, operation)
    }
  }
  suspend fun sendPrepared(operation: UUID, hint: String, peer: VeilSignalAddress): SendResult = sends.withLock {
    validate(operation, hint)
    var view = store.transaction { tx ->
      val checked = outgoing(tx, operation, hint, peer)
      checked.reviewed to VeilMatrixJournal.readInTransaction(tx, checked.reviewed.scope, operation)
    }
    if (view.second.phase == VeilMatrixJournal.Phase.PREPARED) {
      val captured = view.first
      val cipher = store.transaction { tx ->
        val checked = outgoing(tx, operation, hint, peer)
        check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
        VeilMatrixJournal.originalCipherInTransaction(tx, checked.reviewed.scope, operation)
      }
      val url = try { VeilMatrixSdkCalls.uploadCipher(captured.client, cipher) { gate(operation, hint, peer, captured) } }
      finally { cipher.fill(0) }
      view = store.transaction { tx ->
        val checked = outgoing(tx, operation, hint, peer)
        check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
        checked.reviewed to VeilMatrixJournal.uploadedInTransaction(tx, checked.reviewed.scope, operation, url)
      }
    }
    if (view.second.phase != VeilMatrixJournal.Phase.MEDIA_READY) {
      val event = store.transaction { tx ->
        val checked = outgoing(tx, operation, hint, peer)
        VeilMatrixJournal.readInTransaction(tx, checked.reviewed.scope, operation)
        val raw = tx.read(VeilRecordKind.OUTBOX, "matrix-v2-result:" + operation)
        try { raw?.toString(Charsets.UTF_8) } finally { raw?.fill(0) }
      }
      return@withLock SendResult(view.second.phase, view.second.event ?: event)
    }
    val captured = view.first
    val attempted = store.transaction { tx ->
      val checked = outgoing(tx, operation, hint, peer)
      check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
      VeilMatrixJournal.beginSendInTransaction(tx, checked.reviewed.scope, operation, null)
    }
    val event = VeilMatrixSdkCalls.sendCipherDescriptor(captured.room, attempted) { gate(operation, hint, peer, captured) }
    store.transaction { tx ->
      val checked = outgoing(tx, operation, hint, peer)
      check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
      VeilMatrixJournal.readInTransaction(tx, checked.reviewed.scope, operation)
      val key = "matrix-v2-result:" + operation
      val bytes = VeilAuthenticatedEnvelope.text(event, 255)
      val previous = tx.read(VeilRecordKind.OUTBOX, key)
      try {
        check(previous == null || previous.contentEquals(bytes)) { "VEIL_AUTHENTICATED_MESSAGE_REUSE" }
        tx.write(VeilRecordKind.OUTBOX, key, bytes)
      } finally { bytes.fill(0); previous?.fill(0) }
    }
    SendResult(VeilMatrixJournal.Phase.UNKNOWN, event) // Not yet read back/observed.
  }
  fun observeOriginal(operation: UUID, hint: String, peer: VeilSignalAddress, sdkEvent: EventTimelineItem): VeilMatrixJournal.Entry {
    validate(operation, hint)
    return store.transaction { tx ->
      val checked = outgoing(tx, operation, hint, peer)
      val parsed = VeilMatrixOriginalEvent.fromSdk(sdkEvent)
      parsed.requireRoute(checked.reviewed.scope, false)
      val original = VeilMatrixJournal.readInTransaction(tx, checked.reviewed.scope, operation)
      check(parsed.cipherType == original.type && parsed.size == original.size) { "VEIL_AUTHENTICATED_MESSAGE_REUSE" }
      VeilMatrixJournal.observeInTransaction(tx, checked.reviewed.scope, operation, parsed.event,
        parsed.transactionHint, parsed.senderMessage, parsed.media, parsed.sha256)
    }
  }
  suspend fun receive(operation: UUID, hint: String, peer: VeilSignalAddress, sdkEvent: EventTimelineItem): VeilSignalInbox.ReceivedMessage {
    validate(operation, hint)
    val original = store.transaction { tx ->
      val checked = current(tx, hint, peer)
      val parsed = VeilMatrixOriginalEvent.fromSdk(sdkEvent)
      parsed.requireRoute(checked.reviewed.scope, true)
      checked.reviewed to parsed
    }
    val captured = original.first
    val parsed = original.second
    val recheck = {
      store.transaction { tx ->
        val checked = current(tx, hint, peer)
        check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
        parsed.requireRoute(checked.reviewed.scope, true)
        checked.grant.recheck.run()
      }
    }
    recheck()
    val downloaded = media.download(captured.client, parsed.media, parsed.size, recheck)
    var candidate: VeilSignalInbox.ReceivedMessage? = null
    try {
      recheck()
      check(downloaded.size == parsed.size && downloaded.size <= 2 * 1024 * 1024
        && VeilAuthenticatedEnvelope.hex(MessageDigest.getInstance("SHA-256").digest(downloaded)) == parsed.sha256) {
        "VEIL_ENVELOPE_INVALID"
      }
      return store.transaction { tx ->
        val checked = current(tx, hint, peer)
        check(checked.reviewed.same(captured)) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
        parsed.requireRoute(checked.reviewed.scope, true)
        val received = VeilSignalInbox.decryptInTransaction(tx, authority, own, local.sdk(), operation, hint,
          peer.sdk(), parsed.cipherType, downloaded)
        candidate = received
        check(received.senderMessageId == parsed.senderMessage) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
        checked.grant.recheck.run(); tx.checkLive()
        received // Released only after store's atomic commit/final guards succeed.
      }
    } catch (failure: Throwable) { candidate?.close(); throw failure }
    finally { downloaded.fill(0) }
  }
}

/** Dormant composition of the original SDK stream port and exact native reader.
 * No stream producer is supplied or inferred from Matrix fields. */
internal class VeilMatrixAttachmentDownload(
  private val original: VeilMatrixBoundedDownload.OriginalSdkStreams? = null
) : VeilMatrixPipeline.BoundedAttachmentDownload {
  override suspend fun download(client: Client, media: String, maximum: Int, recheck: () -> Unit): ByteArray {
    check(maximum in 1..VeilAttachmentNative.MAX_WIRE &&
      Regex("mxc://[A-Za-z0-9.\\[\\]:-]+/[A-Za-z0-9_-]+").matches(media)) { "VEIL_MATRIX_EVENT_INVALID" }
    val producer = original ?: error("VEIL_MATRIX_ATTACHMENT_STREAM_UNAVAILABLE")
    var candidate: ByteArray? = null
    try {
      recheck()
      val result: ByteArray = withTimeout<ByteArray>(30_000L) {
        withContext<ByteArray>(Dispatchers.IO) {
          recheck()
          val response = producer.open(client, media, maximum, recheck)
          val readerOwns = AtomicBoolean(false)
          try {
            recheck()
            check(response.advertisedLength == null || response.advertisedLength == maximum.toLong()) {
              "VEIL_CIPHER_SIZE_MISMATCH"
            }
            runInterruptible<ByteArray> {
              readerOwns.set(true)
              VeilMatrixAttachmentRead.readExact(response.input, maximum, recheck).also { candidate = it }
            }
          } finally { if (!readerOwns.get()) response.input.close() }
        }
      }
      recheck()
      candidate = null // Transfer only after dispatcher/timeout cancellation gates.
      return result
    } finally { candidate?.fill(0) }
  }
}
