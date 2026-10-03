package com.ynx.social.matrix

import org.json.JSONObject
import org.matrix.rustcomponents.sdk.EventTimelineItem
import java.util.UUID

/** Snapshots original SDK data only; none of these fields grant crypto trust. */
internal data class VeilMatrixOriginalEvent(
  val event: String, val roomHint: String?, val sender: String,
  val senderMessage: UUID, val media: String, val sha256: String, val size: Int,
  val cipherType: Int, val transactionHint: String?
) {
  fun requireRoute(scope: VeilMatrixJournal.Scope, receiving: Boolean) {
    check(roomHint == null || roomHint == scope.room) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
    check(sender == if (receiving) scope.peer else scope.self) { "VEIL_AUTHENTICATED_CONTEXT_MISMATCH" }
  }

  companion object {
    private const val TYPE = "com.ynx.social.veil.encrypted.v2"
    private fun string(json: JSONObject, key: String, limit: Int): String {
      val value = json.opt(key) as? String ?: error("VEIL_MATRIX_EVENT_INVALID")
      VeilAuthenticatedEnvelope.text(value, limit)
      return value
    }
    private fun json(raw: String): JSONObject {
      check(raw.length <= 65536 && raw.toByteArray(Charsets.UTF_8).size <= 65536) { "VEIL_MATRIX_EVENT_INVALID" }
      return JSONObject(raw)
    }
    private fun fields(json: JSONObject, allowed: Set<String>) {
      val keys = json.keys().asSequence().toSet()
      check(keys == allowed) { "VEIL_MATRIX_EVENT_INVALID" }
    }
    fun fromSdk(item: EventTimelineItem): VeilMatrixOriginalEvent {
      val sdkSender = item.sender
      val provider = item.lazyProvider
      val debug = provider.debugInfo()
      // Never accept a latest edit as the original pending-send observation.
      check(debug.latestEditJson == null) { "VEIL_MATRIX_ORIGINAL_READBACK_REQUIRED" }
      val raw = debug.originalJson ?: error("VEIL_MATRIX_ORIGINAL_READBACK_REQUIRED")
      val original = json(raw)
      val event = string(original, "event_id", 255)
      val sender = string(original, "sender", 255)
      check(event.startsWith("$") && sender == sdkSender) { "VEIL_MATRIX_EVENT_INVALID" }
      val candidate = if (original.opt("type") == TYPE) original else {
        check(original.opt("type") == "m.room.encrypted") { "VEIL_ENVELOPE_VERSION_UNSUPPORTED" }
        // Original Matrix transport may wrap opaque Signal bytes. SDK-decoded
        // JSON is only a descriptor source, never a replacement crypto proof.
        json(provider.latestJson() ?: error("VEIL_MATRIX_ORIGINAL_READBACK_REQUIRED"))
      }
      check(candidate.opt("type") == TYPE && candidate.opt("event_id") == event
        && candidate.opt("sender") == sender) { "VEIL_MATRIX_EVENT_INVALID" }
      val content = candidate.opt("content") as? JSONObject ?: error("VEIL_MATRIX_EVENT_INVALID")
      fields(content, setOf("version", "suite", "ciphertext_type", "sender_message_id", "ciphertext"))
      check(content.opt("version") == 2) { "VEIL_ENVELOPE_VERSION_UNSUPPORTED" }
      check(content.opt("suite") == "signal-session-0.104.0") { "VEIL_ENVELOPE_SUITE_UNSUPPORTED" }
      val type = content.opt("ciphertext_type") as? Int ?: error("VEIL_MATRIX_EVENT_INVALID")
      check(type == 2 || type == 3) { "VEIL_MATRIX_EVENT_INVALID" }
      val senderId = string(content, "sender_message_id", 36)
      val message = UUID.fromString(senderId)
      VeilAuthenticatedEnvelope.validateId(message)
      check(message.toString() == senderId) { "VEIL_MATRIX_EVENT_INVALID" }
      val cipher = content.opt("ciphertext") as? JSONObject ?: error("VEIL_MATRIX_EVENT_INVALID")
      fields(cipher, setOf("url", "sha256", "size"))
      val media = string(cipher, "url", 1024)
      val sha = string(cipher, "sha256", 64)
      val size = cipher.opt("size") as? Int ?: error("VEIL_MATRIX_EVENT_INVALID")
      check(Regex("mxc://[A-Za-z0-9.\\[\\]:-]+/[A-Za-z0-9_-]+").matches(media)
        && Regex("[a-f0-9]{64}").matches(sha) && size in 1..(2 * 1024 * 1024)) { "VEIL_MATRIX_EVENT_INVALID" }
      val roomHint = if (original.has("room_id")) string(original, "room_id", 255) else null
      val unsigned = original.opt("unsigned") as? JSONObject
      val transaction = if (unsigned?.has("transaction_id") == true) string(unsigned, "transaction_id", 255) else null
      return VeilMatrixOriginalEvent(event, roomHint, sender, message, media, sha, size, type, transaction)
    }
  }
}
