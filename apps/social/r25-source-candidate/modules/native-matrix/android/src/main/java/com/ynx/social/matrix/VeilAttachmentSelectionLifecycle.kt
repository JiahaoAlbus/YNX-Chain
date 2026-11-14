package com.ynx.social.matrix

import org.json.JSONArray
import org.json.JSONObject

/** Protected-record bookkeeping only. Callers supply the real Source
 * transaction and independently proven terminal; this creates no authority.
 * Outgoing original bytes/keys and message descriptors are never erased here. */
internal object VeilAttachmentSelectionLifecycle {
    const val MAX_ACTIVE = 8
    const val MAX_ACTIVE_BYTES = 64L * 1024 * 1024
    fun key(id: String, part: String) = "attachment-v5:$id:$part"
    private fun state(records: VeilMatrixProductBinding.Records, account: String): JSONObject =
        checkNotNull(records.state()).also { require(it.getString("account") == account) }
    fun active(records: VeilMatrixProductBinding.Records, account: String): List<JSONObject> {
        val current = records.state() ?: return emptyList()
        require(current.getString("account") == account)
        val index = current.optJSONArray("attachmentSelections") ?: JSONArray()
        require(index.length() <= MAX_ACTIVE)
        val rows = (0 until index.length()).map { index.getJSONObject(it) }
        require(rows.map { it.getString("id") }.distinct().size == rows.size)
        rows.forEach {
            VeilSourceAttachmentContent.uuid(it.getString("id"))
            val value = it.get("bytes")
            require((value is Int || value is Long) && (value as Number).toLong() in 57..VeilSourceAttachmentCrypto.MAX_WIRE.toLong())
        }
        require(rows.sumOf { it.getLong("bytes") } <= MAX_ACTIVE_BYTES)
        return rows
    }
    fun canAdmit(records: VeilMatrixProductBinding.Records, account: String, bytes: Long = 1): Boolean {
        val retained = active(records, account)
        return bytes in 1..MAX_ACTIVE_BYTES && retained.size < MAX_ACTIVE && retained.sumOf { it.getLong("bytes") } + bytes <= MAX_ACTIVE_BYTES
    }
    fun register(records: VeilMatrixProductBinding.Records, account: String, id: String, bytes: Long) {
        VeilSourceAttachmentContent.uuid(id)
        require(bytes in 57..VeilSourceAttachmentCrypto.MAX_WIRE.toLong())
        val current = active(records, account)
        require(current.none { it.getString("id") == id } && canAdmit(records, account, bytes))
        val index = JSONArray(); current.forEach(index::put); index.put(JSONObject().put("id", id).put("bytes", bytes))
        records.state(state(records, account).put("attachmentSelections", index))
    }
    fun isOutgoingAttachment(saved: JSONObject): Boolean = saved.optString("type") == "message" &&
        saved.optString("direction") == "outgoing" && saved.optJSONObject("originalCommand")?.optString("type") == "sendAttachment"
    /** Must be inside the SAME WRITE4 that saves CLOSED, AFTER the actual
     * same-original Native terminal/close proof. A JSON status is not that proof. */
    fun releaseConfirmed(records: VeilMatrixProductBinding.Records, account: String, saved: JSONObject) {
        if (!isOutgoingAttachment(saved)) return
        require(saved.get("version") == 1 && saved.getString("status") == "CLOSED" && saved.getString("account") == account &&
            saved.getJSONObject("originalContext").getString("accountViewRef") == account)
        val id = saved.getString("reference")
        require(saved.getString("logicalId") == id && saved.getJSONObject("originalCommand").getString("selectionReference") == id)
        val meta = checkNotNull(records.history(key(id, "meta")))
        require(meta.getString("account") == account && meta.getString("id") == id && meta.getString("conversation") == saved.getString("conversationId"))
        require(meta.getString("phase") in setOf("MEDIA_OBSERVED", "UNKNOWN"))
        VeilSourceAttachmentContent.decode(saved.getString("attachmentDescriptor")).use { confirmed ->
            confirmed.withMedia("").use { original -> require(original.encoded(false) == meta.getString("descriptor")) }
            active(records, account).firstOrNull { it.getString("id") == id }?.let { require(it.getLong("bytes") == confirmed.wireSize.toLong()) }
            val chunks = (confirmed.wireSize + 65535) / 65536
            require(meta.getInt("chunks") == chunks)
            val hash = java.security.MessageDigest.getInstance("SHA-256")
            for (i in 0 until chunks) {
                val part = VeilSourceAttachmentContent.unbase64(checkNotNull(records.history(key(id, i.toString()))).getString("bytes"), 65536)
                try { require(part.size == minOf(65536, confirmed.wireSize - i * 65536)); hash.update(part) }
                finally { part.fill(0) }
            }
            require(hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) } == confirmed.wireSha)
        }
        val index = JSONArray()
        active(records, account).filterNot { it.getString("id") == id }.forEach(index::put)
        records.state(state(records, account).put("attachmentSelections", index))
        // Preserve the entire original selection metadata, including phase,
        // UNKNOWN, descriptor/key, receipt and all ciphertext chunks. Only the
        // temporary index changes. Existing CLOSED + actual terminal is finality.
    }
}
