package com.ynx.social.matrix

import org.json.JSONObject
import java.util.UUID

/** New Source protected records only. No dormant-store lease/callback adapter.
 * All records and file/key bytes stay Native; UI receives opaque reference/name.
 */
internal class VeilSourceAttachmentStore(
    private val source: VeilNativeMatrixSource,
    private val store: VeilMatrixProductBinding.Store,
    private val courier: VeilMatrixCiphertextHttpTransport,
    private val ui: VeilAttachmentUi?
) {
    private val worker = Thread.currentThread()
    private fun current(account: String, route: VeilMatrixProductBinding.Route) {
        check(Thread.currentThread() === worker)
        source.checkCurrent()
        require(source.identity().accountViewRef == account)
        require(source.routes().single { it.id == route.id } == route)
        source.checkCurrent()
    }
    fun available(): Boolean = ui?.available() == true && try { VeilSourceAttachmentCrypto.available() }
        catch (_: UnsatisfiedLinkError) { false }
    private fun key(id: String, part: String) = "attachment-v5:$id:$part"
    private fun selected(records: VeilMatrixProductBinding.Records, id: String, account: String): JSONObject {
        VeilSourceAttachmentContent.uuid(id)
        val saved = checkNotNull(records.history(key(id, "meta")))
        require(saved.getInt("version") == 1 && saved.getString("id") == id && saved.getString("account") == account)
        return saved
    }
    fun select(command: Map<String, Any?>, context: Map<String, Any?>, route: VeilMatrixProductBinding.Route,
        guardView: () -> Unit): Map<String, Any?> {
        val account = context["accountViewRef"] as String
        val guard = { current(account, route); guardView() }
        guard()
        reconcileOneFinalizedQuota(account)
        val capacity = store.transaction(VeilMatrixProductBinding.RecordAccess.READ) { records ->
            VeilAttachmentSelectionLifecycle.canAdmit(records, account)
        }
        if (!capacity) return mapOf("kind" to "error", "code" to "UNAVAILABLE")
        val file = checkNotNull(ui).choose(guard) ?: return mapOf("kind" to "error", "code" to "INPUT_INVALID")
        var secret: ByteArray? = null
        var sealed: ByteArray? = null
        try {
            guard()
            val id = UUID.randomUUID().toString()
            val contentKey = VeilSourceAttachmentCrypto.key(guard); secret = contentKey
            val clearSize = file.clear.size
            VeilSourceAttachmentContent.Descriptor(id, route.roomId, route.localSender, route.remoteSender,
                file.name, file.mime, "", clearSize, 35 + clearSize + ((clearSize + 65535) / 65536) * 21,
                VeilSourceAttachmentContent.hash(file.clear), "0".repeat(64), contentKey).use { draft ->
                secret = null // Descriptor now owns the actual independent key.
                val wire = draft.seal(file.clear, guard); sealed = wire
                draft.withWireSha(VeilSourceAttachmentContent.hash(wire)).use { descriptor ->
                    val chunks = (wire.size + CHUNK - 1) / CHUNK
                    guard()
                    if (!store.transaction(VeilMatrixProductBinding.RecordAccess.READ) { VeilAttachmentSelectionLifecycle.canAdmit(it, account, wire.size.toLong()) })
                        return mapOf("kind" to "error", "code" to "UNAVAILABLE")
                    store.transaction(VeilMatrixProductBinding.RecordAccess.WRITE) { records ->
                        check(records.history(key(id, "meta")) == null)
                        VeilAttachmentSelectionLifecycle.register(records, account, id, wire.size.toLong())
                        records.history(key(id, "meta"), JSONObject().put("version", 1).put("id", id).put("account", account)
                            .put("conversation", route.id).put("view", context["viewRevision"]).put("epoch", context["epoch"])
                            .put("phase", "SELECTED").put("descriptor", descriptor.encoded(false)).put("chunks", chunks))
                        for (index in 0 until chunks) {
                            val part = wire.copyOfRange(index * CHUNK, minOf(wire.size, (index + 1) * CHUNK))
                            try { records.history(key(id, index.toString()), JSONObject().put("bytes", VeilSourceAttachmentContent.base64(part))) }
                            finally { part.fill(0) }
                        }
                    }
                    guard()
                    return mapOf("kind" to "attachmentSelection", "selectionReference" to id, "displayName" to descriptor.name)
                }
            }
        } finally { file.clear.fill(0); secret?.fill(0); sealed?.fill(0) }
    }
    class Prepared internal constructor(val descriptor: VeilSourceAttachmentContent.Descriptor, val saved: String, val wire: ByteArray) : AutoCloseable {
        override fun close() { descriptor.close(); wire.fill(0) }
    }
    fun prepare(command: Map<String, Any?>, context: Map<String, Any?>, route: VeilMatrixProductBinding.Route): Prepared {
        val account = context["accountViewRef"] as String
        val id = command["selectionReference"] as String
        current(account, route)
        var wire: ByteArray? = null
        var descriptor: VeilSourceAttachmentContent.Descriptor? = null
        try {
            val result = store.transaction(VeilMatrixProductBinding.RecordAccess.READ) { records ->
                val saved = selected(records, id, account)
                require(saved.getString("conversation") == route.id && saved.getString("view") == context["viewRevision"] &&
                    saved.getLong("epoch") == (context["epoch"] as Number).toLong() && saved.getString("phase") == "SELECTED")
                val content = VeilSourceAttachmentContent.decode(saved.getString("descriptor"), false); descriptor = content
                content.matches(route, id, false)
                val body = ByteArray(content.wireSize); wire = body
                val chunks = (body.size + CHUNK - 1) / CHUNK
                require(saved.getInt("chunks") == chunks)
                for (index in 0 until chunks) {
                    val part = VeilSourceAttachmentContent.unbase64(checkNotNull(records.history(key(id, index.toString()))).getString("bytes"), CHUNK)
                    try {
                        require(part.size == minOf(CHUNK, body.size - index * CHUNK)); part.copyInto(body, index * CHUNK)
                    } finally { part.fill(0) }
                }
                require(VeilSourceAttachmentContent.hash(body) == content.wireSha)
                Prepared(content, saved.toString(), body)
            }
            current(account, route); descriptor = null; wire = null; return result
        } finally { descriptor?.close(); wire?.fill(0) }
    }
    /** Original product operation is captured and persisted BEFORE this call.
     * A failed or partial claim/upload can only be reviewed, never POSTed again. */
    fun upload(original: Prepared, account: String, route: VeilMatrixProductBinding.Route,
        persist: (VeilMatrixCiphertextHttpTransport.AttachmentSnapshot) -> Unit,
        capture: (VeilMatrixCiphertextHttpTransport.AttachmentOriginal) -> Unit): VeilSourceAttachmentContent.Descriptor {
        val id = original.descriptor.id
        val guard = { current(account, route) }
        guard()
        store.transaction(VeilMatrixProductBinding.RecordAccess.WRITE) { records ->
            val saved = selected(records, id, account)
            require(saved.toString() == original.saved && saved.getString("phase") == "SELECTED")
            saved.put("phase", "CLAIMED"); records.history(key(id, "meta"), saved)
        }
        guard()
        val held = courier.captureAttachment(id, original.wire, original.descriptor.wireSha,
            object : VeilMatrixCiphertextHttpTransport.AttachmentGuard {
                override fun checkCurrent() = guard()
                override fun persistOriginal(snapshot: VeilMatrixCiphertextHttpTransport.AttachmentSnapshot) {
                    require(snapshot.logicalId == id && snapshot.ciphertextSha256 == original.descriptor.wireSha && snapshot.ciphertextBytes == original.wire.size)
                    guard()
                    store.transaction(VeilMatrixProductBinding.RecordAccess.WRITE) { records ->
                        val saved = selected(records, id, account)
                        require(saved.getString("phase") != "SELECTED")
                        saved.put("phase", snapshot.phase.name).put("media", snapshot.media ?: JSONObject.NULL)
                        records.history(key(id, "meta"), saved)
                    }
                    persist(snapshot)
                    guard()
                }
            })
        capture(held) // retain before upload, including uncertain persistence/I/O
        held.upload()
        val receipt = held.readback()
        guard()
        return original.descriptor.withMedia(checkNotNull(receipt.media))
    }
    fun open(saved: JSONObject, account: String, route: VeilMatrixProductBinding.Route, attachment: String) {
        current(account, route)
        require(saved.getString("account") == account && saved.getString("conversationId") == route.id &&
            saved.getString("type") == "message" && saved.getString("status") in setOf("COMMITTED", "CLOSED") && saved.getString("logicalId") == attachment)
        VeilSourceAttachmentContent.decode(saved.getString("attachmentDescriptor")).use { descriptor ->
            descriptor.matches(route, attachment, saved.getString("direction") == "incoming")
            val guard = { current(account, route) }
            val cached = store.transaction(VeilMatrixProductBinding.RecordAccess.READ) { records ->
                readCached(records, descriptor, account)
            }
            val wire = cached ?: courier.downloadAttachment(descriptor.media, descriptor.wireSha, descriptor.wireSize, guard)
            try {
                val clear = descriptor.open(wire, guard)
                try {
                    guard()
                    if (cached == null) store.transaction(VeilMatrixProductBinding.RecordAccess.WRITE) { records ->
                        // Cache ciphertext only AFTER full stream authentication. No plaintext file/key outside protected records.
                        val existing = records.history(key(descriptor.id, "meta"))
                        check(existing == null)
                        val chunks = (wire.size + CHUNK - 1) / CHUNK
                        records.history(key(descriptor.id, "meta"), JSONObject().put("version", 1).put("id", descriptor.id)
                            .put("account", account).put("phase", "RECEIVED").put("descriptor", descriptor.encoded()).put("chunks", chunks))
                        for (i in 0 until chunks) {
                            val part = wire.copyOfRange(i * CHUNK, minOf(wire.size, (i + 1) * CHUNK))
                            try { records.history(key(descriptor.id, i.toString()), JSONObject().put("bytes", VeilSourceAttachmentContent.base64(part))) }
                            finally { part.fill(0) }
                        }
                    }
                    guard(); checkNotNull(ui).show(descriptor.name, descriptor.mime, clear, guard)
                }
                finally { clear.fill(0) }
            } finally { wire.fill(0) }
        }
    }
    /** Repairs at most one old CLOSED quota on this same protected store.
     * JSON CLOSED is only a candidate: actual Native terminal COMMITTED is
     * independently queried before WRITE4. No retry/POST or history rewriting. */
    fun reconcileOneFinalizedQuota(account: String): Boolean {
        check(Thread.currentThread() === worker); source.checkCurrent()
        require(source.identity().accountViewRef == account)
        val candidate = store.transaction(VeilMatrixProductBinding.RecordAccess.READ) { records ->
            val state = records.state() ?: return@transaction null
            require(state.getString("account") == account)
            val row = VeilAttachmentSelectionLifecycle.active(records, account).firstOrNull { entry ->
                val operation = records.operation(entry.getString("id"))
                operation != null && operation.optString("account") == account && operation.optString("status") == "CLOSED" &&
                    VeilAttachmentSelectionLifecycle.isOutgoingAttachment(operation)
            } ?: return@transaction null
            val id = row.getString("id")
            val operation = checkNotNull(records.operation(id))
            require(operation.get("version") == 1 && operation.getString("reference") == id && operation.getString("logicalId") == id)
            listOf(id, operation.toString(), state.toString(), checkNotNull(records.history(key(id, "meta"))).toString())
        } ?: return false
        if (source.observeTerminal(candidate[0], 1) != VeilNativeMessageBusiness.Completion.COMMITTED) return false
        source.checkCurrent()
        store.transaction(VeilMatrixProductBinding.RecordAccess.WRITE) { records ->
            require(records.state()?.toString() == candidate[2] && records.operation(candidate[0])?.toString() == candidate[1] &&
                records.history(key(candidate[0], "meta"))?.toString() == candidate[3])
            VeilAttachmentSelectionLifecycle.releaseConfirmed(records, account, JSONObject(candidate[1]))
        }
        source.checkCurrent()
        store.transaction(VeilMatrixProductBinding.RecordAccess.READ) { records ->
            require(records.operation(candidate[0])?.toString() == candidate[1] &&
                VeilAttachmentSelectionLifecycle.active(records, account).none { it.getString("id") == candidate[0] })
        }
        source.checkCurrent(); return true
    }
    internal fun readCached(records: VeilMatrixProductBinding.Records, descriptor: VeilSourceAttachmentContent.Descriptor, account: String): ByteArray? {
        val saved = records.history(key(descriptor.id, "meta")) ?: return null
        require(saved.getString("account") == account && saved.getString("id") == descriptor.id)
        VeilSourceAttachmentContent.decode(saved.getString("descriptor"), false).use { original ->
            require(original.id == descriptor.id && original.room == descriptor.room && original.sender == descriptor.sender &&
                original.recipient == descriptor.recipient && original.wireSha == descriptor.wireSha && original.wireSize == descriptor.wireSize)
        }
        // This version never evicts attachment history/ciphertext. PRESENT
        // requires all exact chunks; missing/corrupt chunks fail, not a silent
        // cache miss or an excuse to recreate an outgoing original.
        require(saved.optString("cacheState", "PRESENT") == "PRESENT")
        val wire = ByteArray(descriptor.wireSize)
        try {
            val chunks = (wire.size + CHUNK - 1) / CHUNK
            require(saved.getInt("chunks") == chunks)
            for (i in 0 until chunks) {
                val part = VeilSourceAttachmentContent.unbase64(checkNotNull(records.history(key(descriptor.id, i.toString()))).getString("bytes"), CHUNK)
                try { require(part.size == minOf(CHUNK, wire.size - i * CHUNK)); part.copyInto(wire, i * CHUNK) }
                finally { part.fill(0) }
            }
            require(VeilSourceAttachmentContent.hash(wire) == descriptor.wireSha)
            return wire
        } catch (failure: Throwable) { wire.fill(0); throw failure }
    }
    companion object { private const val CHUNK = 65536 }
}
