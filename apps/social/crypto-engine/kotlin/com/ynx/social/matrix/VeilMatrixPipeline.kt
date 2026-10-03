package com.ynx.social.matrix

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.matrix.rustcomponents.sdk.Client
import org.matrix.rustcomponents.sdk.EventTimelineItem
import org.matrix.rustcomponents.sdk.Room
import org.signal.libsignal.protocol.IdentityKey
import java.security.MessageDigest
import java.util.UUID

/** Dormant native composition. No production enrollment/authority/bridge factory.
 * Protocol activation and real independent directory/anchor remain separate. */
internal class VeilMatrixPipeline(
  private val store: VeilNativeStore,
  private val own: IdentityKey,
  private val local: VeilSignalAddress,
  private val authority: VeilContextAuthority,
  private val routes: NativeRoutes,
  private val media: BoundedCipherDownload
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
  internal fun interface BoundedCipherDownload {
    // Original native SDK transport with an enforced streaming/resource limit.
    // No eager unbounded getMediaContent masquerading as a bounded download.
    suspend fun download(client: Client, media: String, maximum: Int, recheck: () -> Unit): ByteArray
  }
  internal data class SendResult(val phase: VeilMatrixJournal.Phase, val originalEventHint: String?)
  private data class Current(val reviewed: Reviewed, val grant: VeilContextAuthority.Grant)
  private val sends = Mutex()

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
