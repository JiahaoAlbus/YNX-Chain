package com.ynx.social.matrix

import org.json.JSONObject
import org.matrix.rustcomponents.sdk.Client
import org.matrix.rustcomponents.sdk.Room

/** Dormant original-SDK primitives. No token/parallel HTTP client or JS bridge.
 * Caller must compose native device/context admission, reviewed Matrix handle
 * and durable journal before entry; recheck must not mint trust from metadata.
 * Cancellation/failure after network entry leaves native journal UNKNOWN.
 */
internal object VeilMatrixSdkCalls {
  suspend fun uploadCipher(client: Client, ciphertext: ByteArray, recheck: () -> Unit): String {
    require(ciphertext.isNotEmpty() && ciphertext.size <= 2 * 1024 * 1024) { "VEIL_ENVELOPE_INVALID" }
    val snapshot = ciphertext.copyOf()
    try {
      recheck()
      val url = client.uploadMedia("application/octet-stream", snapshot, null)
      recheck()
      check(Regex("mxc://[A-Za-z0-9.\\[\\]:-]+/[A-Za-z0-9_-]+").matches(url)) { "VEIL_MATRIX_EVENT_INVALID" }
      return url
    } finally { snapshot.fill(0) }
  }

  suspend fun sendCipherDescriptor(room: Room, entry: VeilMatrixJournal.Entry, recheck: () -> Unit): String {
    check(entry.phase == VeilMatrixJournal.Phase.UNKNOWN && entry.mediaUrl != null) {
      "VEIL_MATRIX_ORIGINAL_READBACK_REQUIRED"
    }
    // No plaintext/key/context in this opaque media descriptor. Native receiver
    // still authenticates the independent inner Signal envelope and message ID.
    val content = JSONObject()
      .put("version", 2)
      .put("suite", "signal-session-0.104.0")
      .put("ciphertext_type", entry.type)
      .put("sender_message_id", entry.senderMessage.toString())
      .put("ciphertext", JSONObject().put("url", entry.mediaUrl)
        .put("sha256", entry.cipherSha256()).put("size", entry.size))
      .toString()
    recheck()
    // Named arguments are checked against pinned SDK Kotlin metadata; never
    // infer parameter order from javap's two String types.
    val event = room.sendRaw(content = content, eventType = "com.ynx.social.veil.encrypted.v2")
    recheck()
    check(event.startsWith("$") && event.length <= 255) { "VEIL_MATRIX_EVENT_INVALID" }
    return event // Original caller journals/reconciles this; not a read receipt.
  }
}
