package com.ynx.social.matrix

import okhttp3.Authenticator
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONObject
import org.json.JSONTokener
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.IdentityHashMap
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Matrix is only a ciphertext courier. It never creates Social device trust,
 * encrypts, decrypts, verifies an inner envelope, or reports peer delivery.
 * Endpoints follow https://spec.matrix.org/latest/client-server-api/.
 * Production callers must supply their SAME original protected-journal guard.
 */
internal class VeilMatrixCiphertextHttpTransport private constructor(
    private val base: HttpUrl,
    private val token: CharArray,
    private val http: OkHttpClient
) {
    internal enum class Phase { PREPARED, UPLOAD_ATTEMPTED, MEDIA_OBSERVED, EVENT_ATTEMPTED, EVENT_RETURNED, OBSERVED, UNKNOWN }
    internal interface Guard {
        /** Genuine original device/session/current/revocation checks. */
        fun checkCurrent()
        /** Durable same-operation transition. Must throw unless committed.
         * Native ratchet/ciphertext persistence must already precede transport.
         * This is a store callback, NOT a success callback granting authority. */
        fun persistOriginal(snapshot: Snapshot)
    }
    internal data class Snapshot(
        val logicalId: String, val roomId: String, val sender: String,
        val transactionId: String, val ciphertextType: Int,
        val ciphertextSha256: String, val ciphertextBytes: Int,
        val phase: Phase, val media: String?, val eventId: String?,
        val purpose: String? = null, val recipientBundleSha256: String? = null
    ) {
        init { if (purpose == null) require(recipientBundleSha256 == null)
            else require(purpose == INITIAL_SESSION_PURPOSE && ciphertextType == 3 &&
                recipientBundleSha256 != null && Regex("[0-9a-f]{64}").matches(recipientBundleSha256)) }
    }
    internal data class Content(val logicalId: String, val kind: Int, val media: String, val sha256: String, val bytes: Int,
                                val purpose: String? = null, val recipientBundleSha256: String? = null) {
        val initialSession: Boolean get() = purpose != null
        init {
            if (purpose == null) require(recipientBundleSha256 == null)
            else require(purpose == INITIAL_SESSION_PURPOSE && kind == 3 &&
                recipientBundleSha256 != null && Regex("[0-9a-f]{64}").matches(recipientBundleSha256))
        }
    }
    internal inner class Original internal constructor(
        val logicalId: String, val roomId: String, val sender: String, val transactionId: String,
        val kind: Int, private val ciphertext: ByteArray, private val guard: Guard,
        private val deadlineNS: Long,
        private val initialPurpose: String? = null, private val recipientBundleSha256: String? = null
    ) {
        private var locallyAcknowledged = false
        private var phase = Phase.PREPARED
        private var media: String? = null
        private var eventId: String? = null
        private var failure: Throwable? = null
        private val digest = sha256(ciphertext)
        private fun current() {
            checked()
            check(owned.containsKey(this)) { "VEIL_MATRIX_ORIGINAL_NOT_OWNED" }
            check(System.nanoTime() - deadlineNS < 0) { "VEIL_MATRIX_ORIGINAL_DEADLINE" }
            guard.checkCurrent()
            check(System.nanoTime() - deadlineNS < 0) { "VEIL_MATRIX_ORIGINAL_DEADLINE" }
        }
        fun snapshot(): Snapshot {
            checked()
            return Snapshot(logicalId, roomId, sender, transactionId, kind,
                digest, ciphertext.size, phase, media, eventId, initialPurpose, recipientBundleSha256)
        }
        private fun persist(next: Phase) {
            phase = next // Install the local fence before any callback can fail.
            guard.persistOriginal(snapshot())
            current()
        }
        private fun retain(primary: Throwable): Nothing {
            if (failure == null) failure = primary
            else if (failure !== primary) failure!!.addSuppressed(primary)
            phase = Phase.UNKNOWN
            try { guard.persistOriginal(snapshot()) }
            catch (secondary: Throwable) { if (secondary !== failure) failure!!.addSuppressed(secondary) }
            throw Failure(this, checkNotNull(failure))
        }
        fun retainedFailure(): Throwable? { checked(); return failure }
        /** One original POST + one original PUT. A retry never recreates either. */
        fun send(): Snapshot {
            current()
            check(phase == Phase.PREPARED && failure == null) { "VEIL_MATRIX_ORIGINAL_READBACK_ONLY" }
            try {
                // This durable attempted marker is mandatory BEFORE HTTP.
                persist(Phase.UPLOAD_ATTEMPTED)
                val upload = request(url("_matrix", "media", "v3", "upload"))
                    .post(oneShot(ciphertext, OCTETS)).build()
                val response = json(upload, this)
                val address = response.getString("content_uri")
                mxc(address)
                media = address
                persist(Phase.MEDIA_OBSERVED)
                val payload = content().toByteArray(Charsets.UTF_8)
                try {
                    persist(Phase.EVENT_ATTEMPTED)
                    val send = request(url("_matrix", "client", "v3", "rooms", roomId, "send", EVENT, transactionId))
                        .put(oneShot(payload, JSON)).build()
                    val received = json(send, this).getString("event_id")
                    identifier(received, '$')
                    eventId = received
                    persist(Phase.EVENT_RETURNED)
                } finally { payload.fill(0) }
                return readback()
            } catch (original: Failure) {
                if (original.original === this) throw original
                retain(original)
            } catch (primary: Throwable) { retain(primary) }
        }
        /** GET only. Unknown send is never retried, even with a Matrix txn ID. */
        fun readback(): Snapshot {
            current()
            val id = eventId ?: error("VEIL_MATRIX_ORIGINAL_EVENT_ID_REQUIRED")
            check(phase in setOf(Phase.EVENT_RETURNED, Phase.OBSERVED, Phase.UNKNOWN))
            try {
                val read = request(url("_matrix", "client", "v3", "rooms", roomId, "event", id)).get().build()
                val event = json(read, this)
                require(event.getString("event_id") == id && event.getString("type") == EVENT &&
                    event.getString("sender") == sender)
                if (event.has("room_id")) require(event.getString("room_id") == roomId)
                require(exactContent(event.getJSONObject("content"), parseContent(content())))
                current()
                // This only records a matching Matrix event, not Native commit.
                persist(Phase.OBSERVED)
                return snapshot()
            } catch (primary: Throwable) { retain(primary) }
        }
        private fun content(): String = wireContent(logicalId, kind, checkNotNull(media), digest,
            ciphertext.size, initialPurpose, recipientBundleSha256).toString()
        /** No HTTP, deadline extension, send or native retirement. */
        internal fun acknowledgeFinalizedLocal(source: VeilNativeMatrixSource, account: String, reference: String) {
            checked()
            source.requireFinalizedLocalAck(null, this@VeilMatrixCiphertextHttpTransport,
                account, reference, 1, 1, committedOnly = true)
            require(logicalId == reference && transactionId == reference)
            if (locallyAcknowledged) { check(!owned.containsKey(this)); return }
            check(owned.containsKey(this) && phase == Phase.OBSERVED) { "VEIL_MATRIX_ORIGINAL_NOT_OBSERVED" }
            owned.remove(this); locallyAcknowledged = true; ciphertext.fill(0)
            // Preserve phase/failure and the original immutable correlation.
        }
        internal fun beforeResponse(): Long { current(); return deadlineNS - System.nanoTime() }
        /** Caller verifies its actual Native terminal before retiring. No
         * transport observation itself retires the message/ratchet owner. */
        fun retireAfterNativeCommit(checkVerifiedOriginalCommit: () -> Unit) {
            current()
            check(phase == Phase.OBSERVED) { "VEIL_MATRIX_ORIGINAL_NOT_OBSERVED" }
            checkVerifiedOriginalCommit()
            current()
            owned.remove(this)
            locallyAcknowledged = true
            ciphertext.fill(0)
        }

    }
    internal class Failure(val original: Original, cause: Throwable) :
        IllegalStateException("VEIL_MATRIX_ORIGINAL_UNKNOWN", cause)
    private val worker = Thread.currentThread()
    private val owned = IdentityHashMap<Original, Boolean>()
    private var closed = false
    private fun checked() {
        check(Thread.currentThread() === worker && !closed) { "VEIL_MATRIX_WRONG_WORKER_OR_CLOSED" }
    }
    fun capture(output: VeilNativeMessageOutput, roomId: String, sender: String,
                transactionId: String, guard: Guard, budgetMS: Long = 15000): Original =
        captureOriginal(output, roomId, sender, transactionId, guard, budgetMS, null, null)

    /** Only an explicitly typed same original, after genuine committed output,
     * emits v3. An ordinary PreKey3 or matching byte prefix cannot opt in. */
    internal fun captureInitial(output: VeilNativeMessageOutput, initial: VeilNativeMessageBusiness.InitialSessionSend,
                                roomId: String, sender: String, transactionId: String, guard: Guard,
                                budgetMS: Long = 15000): Original {
        checked(); initial.checkCurrent()
        require(output.direction == 1 && output.kind == 3 && transactionId == initial.reference)
        val frame = initial.frame(); val peer = initial.canonicalPeerBundle()
        try {
            VeilNativeProductPorts.validateInitialSessionFrame(frame)
            require(peer.size in 1..8192)
            val prefix = "YNX/SOCIAL/SESSION-ESTABLISH/V1\u0000".toByteArray(Charsets.US_ASCII)
            val logical = output.logicalId()
            val digest = MessageDigest.getInstance("SHA-256").digest(peer)
            try {
                require(frame.size == 28 + prefix.size + 16 + 32 &&
                    frame.copyOfRange(28, 28 + prefix.size).contentEquals(prefix) &&
                    frame.copyOfRange(8, 24).contentEquals(logical) &&
                    frame.copyOfRange(28 + prefix.size, 44 + prefix.size).contentEquals(logical) &&
                    frame.copyOfRange(frame.size - 32, frame.size).contentEquals(digest))
                val b = ByteBuffer.wrap(logical)
                require(UUID(b.long, b.long).toString() == initial.reference)
                val authority = initial.controlAuthority()
                authority.checkCurrent(); authority.requireCommittedOutput(output); authority.checkCurrent()
                initial.checkCurrent()
                return captureOriginal(output, roomId, sender, transactionId, guard, budgetMS,
                    INITIAL_SESSION_PURPOSE, sha256(peer))
            } finally { logical.fill(0); digest.fill(0); prefix.fill(0) }
        } finally { frame.fill(0); peer.fill(0) }
    }

    private fun captureOriginal(output: VeilNativeMessageOutput, roomId: String, sender: String,
                transactionId: String, guard: Guard, budgetMS: Long, purpose: String?, recipientBundleSha256: String?): Original {
        checked()
        require(output.direction == 1 && output.kind in 2..3)
        identifier(roomId, '!'); identifier(sender, '@'); text(transactionId, 128)
        require(roomId.contains(':') && sender.contains(':') && budgetMS in 1..30000)
        check(owned.size < 32) { "VEIL_MATRIX_RETAINED_CAPACITY" }
        guard.checkCurrent()
        val logical = output.logicalId()
        val bytes = output.body()
        try {
            val b = ByteBuffer.wrap(logical)
            val id = UUID(b.long, b.long)
            require(id.version() == 4 && id.variant() == 2 && bytes.size in 1..MAX_CIPHER)
            check(owned.keys.none { it.logicalId == id.toString() || it.transactionId == transactionId }) {
                "VEIL_MATRIX_ORIGINAL_ALREADY_RETAINED"
            }
            val original = Original(id.toString(), roomId, sender, transactionId, output.kind,
                bytes, guard, System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMS), purpose, recipientBundleSha256)
            owned[original] = true
            return original
        } catch (failure: Throwable) { bytes.fill(0); throw failure }
        finally { logical.fill(0) }
    }
    /** Independent read of a saved event, after the caller checks its SAME
     * genuine Native terminal/account. A fresh GET budget does not renew an
     * old send owner. No upload, PUT, journal transition or local retirement. */
    internal fun observeSavedEvent(saved: Snapshot, checkCurrent: () -> Unit, budgetMS: Long = 15000) {
        checked(); require(budgetMS in 1..30000)
        val logical = UUID.fromString(saved.logicalId)
        require(logical.toString() == saved.logicalId && logical.version() == 4 && logical.variant() == 2 &&
            saved.transactionId == saved.logicalId)
        identifier(saved.roomId, '!'); identifier(saved.sender, '@')
        val eventId = checkNotNull(saved.eventId); identifier(eventId, '$')
        require(saved.phase in setOf(Phase.EVENT_RETURNED, Phase.OBSERVED, Phase.UNKNOWN))
        val content = wireContent(saved.logicalId, saved.ciphertextType, checkNotNull(saved.media),
            saved.ciphertextSha256, saved.ciphertextBytes, saved.purpose, saved.recipientBundleSha256)
        val expected = parseContent(content)
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMS)
        val read = request(url("_matrix", "client", "v3", "rooms", saved.roomId, "event", eventId)).get().build()
        val bytes = exchange(read, 8192) { checkCurrent(); deadline - System.nanoTime() }
        try {
            val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
            val event = objectJson(text)
            require(event.getString("event_id") == eventId && event.getString("type") == EVENT &&
                event.getString("sender") == saved.sender)
            if (event.has("room_id")) require(event.getString("room_id") == saved.roomId)
            require(exactContent(event.getJSONObject("content"), expected))
            checked(); checkCurrent(); check(System.nanoTime() - deadline < 0)
        } finally { bytes.fill(0) }
    }

    /** Attachment bytes are already sealed by the existing Native attachment
     * core. This courier never sees its key, descriptor or plaintext and never
     * creates an identity/session/permission. Native owns both callbacks. */
    internal data class AttachmentSnapshot(
        val logicalId: String, val ciphertextSha256: String, val ciphertextBytes: Int,
        val phase: Phase, val media: String?
    )
    internal interface AttachmentGuard {
        fun checkCurrent()
        /** Same protected original, durably committed before network I/O. */
        fun persistOriginal(snapshot: AttachmentSnapshot)
    }
    internal inner class AttachmentOriginal internal constructor(
        val logicalId: String, private val ciphertext: ByteArray,
        private val guard: AttachmentGuard, private val deadlineNS: Long
    ) {
        private val digest = sha256(ciphertext)
        private var phase = Phase.PREPARED
        private var media: String? = null
        private var failure: Throwable? = null
        private var retired = false
        private fun current(): Long {
            checked()
            check(!retired && attachmentOwned.containsKey(this)) { "VEIL_MATRIX_ATTACHMENT_NOT_OWNED" }
            check(System.nanoTime() - deadlineNS < 0) { "VEIL_MATRIX_ORIGINAL_DEADLINE" }
            guard.checkCurrent()
            val remaining = deadlineNS - System.nanoTime()
            check(remaining > 0) { "VEIL_MATRIX_ORIGINAL_DEADLINE" }
            return remaining
        }
        fun snapshot(): AttachmentSnapshot {
            checked()
            return AttachmentSnapshot(logicalId, digest, ciphertext.size, phase, media)
        }
        fun retainedFailure(): Throwable? { checked(); return failure }
        private fun persist(next: Phase) {
            phase = next
            guard.persistOriginal(snapshot())
            current()
        }
        private fun retain(primary: Throwable): Nothing {
            if (failure == null) failure = primary
            else if (failure !== primary) failure!!.addSuppressed(primary)
            phase = Phase.UNKNOWN
            try { guard.persistOriginal(snapshot()) }
            catch (secondary: Throwable) { if (secondary !== failure) failure!!.addSuppressed(secondary) }
            throw AttachmentFailure(this, checkNotNull(failure))
        }
        /** A duplicate call is a refusal outside the mutation/UNKNOWN path.
         * Neither failed persistence nor an uncertain POST is ever retried. */
        fun upload(): AttachmentSnapshot {
            current()
            check(phase == Phase.PREPARED && failure == null) { "VEIL_MATRIX_ATTACHMENT_READBACK_ONLY" }
            try {
                persist(Phase.UPLOAD_ATTEMPTED)
                val post = request(url("_matrix", "media", "v3", "upload"))
                    .post(oneShot(ciphertext, OCTETS)).build()
                val raw = exchange(post, 8192, ::current)
                try {
                    val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(raw)).toString()
                    val address = objectJson(text).getString("content_uri")
                    mxc(address)
                    media = address
                    persist(Phase.MEDIA_OBSERVED)
                    return snapshot()
                } finally { raw.fill(0) }
            } catch (primary: Throwable) { retain(primary) }
        }
        /** GET only under the same original deadline. It cannot repeat upload,
         * mint a new ratchet or decide that the message itself committed. */
        fun readback(): AttachmentSnapshot {
            current()
            val address = checkNotNull(media) { "VEIL_MATRIX_ATTACHMENT_MEDIA_REQUIRED" }
            check(phase in setOf(Phase.MEDIA_OBSERVED, Phase.UNKNOWN))
            try {
                val raw = readAttachmentCiphertext(address, digest, ciphertext.size, ::current)
                try { persist(Phase.MEDIA_OBSERVED); return snapshot() }
                finally { raw.fill(0) }
            } catch (primary: Throwable) { retain(primary) }
        }
        /** Only the caller's genuine same-original Native terminal can release
         * this owner. HTTP 200, a locator or this snapshot is not that proof. */
        fun retireAfterNativeCommit(checkVerifiedOriginalCommit: () -> Unit) {
            current()
            check(phase == Phase.MEDIA_OBSERVED) { "VEIL_MATRIX_ATTACHMENT_NOT_OBSERVED" }
            checkVerifiedOriginalCommit()
            current()
            attachmentOwned.remove(this)
            retired = true
            ciphertext.fill(0)
        }
    }
    internal class AttachmentFailure(val original: AttachmentOriginal, cause: Throwable) :
        IllegalStateException("VEIL_MATRIX_ATTACHMENT_UNKNOWN", cause)
    private val attachmentOwned = IdentityHashMap<AttachmentOriginal, Boolean>()

    fun captureAttachment(logicalId: String, sealedCiphertext: ByteArray,
                          expectedSha256: String, guard: AttachmentGuard,
                          budgetMS: Long = 15000): AttachmentOriginal {
        checked()
        val id = UUID.fromString(logicalId)
        require(id.toString() == logicalId && id.version() == 4 && id.variant() == 2 && budgetMS in 1..30000)
        require(sealedCiphertext.size in 57..VeilAttachmentNative.MAX_WIRE &&
            Regex("[0-9a-f]{64}").matches(expectedSha256))
        check(attachmentOwned.size < 1 && attachmentOwned.keys.none { it.logicalId == logicalId }) {
            "VEIL_MATRIX_ATTACHMENT_ORIGINAL_RETAINED"
        }
        guard.checkCurrent()
        val ownedBytes = sealedCiphertext.copyOf()
        try {
            require(sha256(ownedBytes) == expectedSha256) { "VEIL_MATRIX_ATTACHMENT_CIPHERTEXT_CHANGED" }
            guard.checkCurrent()
            val original = AttachmentOriginal(logicalId, ownedBytes, guard,
                System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMS))
            attachmentOwned[original] = true
            return original
        } catch (primary: Throwable) { ownedBytes.fill(0); throw primary }
    }
    private fun readAttachmentCiphertext(media: String, expectedSha256: String, size: Int,
                                        current: () -> Long): ByteArray {
        checked()
        require(size in 57..VeilAttachmentNative.MAX_WIRE && Regex("[0-9a-f]{64}").matches(expectedSha256))
        val parts = mxc(media)
        val read = request(url("_matrix", "client", "v1", "media", "download", parts.first, parts.second)).get().build()
        val bytes = exchange(read, size, current)
        try {
            require(bytes.size == size && sha256(bytes) == expectedSha256) { "VEIL_MATRIX_ATTACHMENT_CIPHERTEXT_CHANGED" }
            check(current() > 0)
            return bytes
        } catch (primary: Throwable) { bytes.fill(0); throw primary }
    }
    /** Called only after Native authenticates the protected descriptor and
     * supplies its exact size/hash. The configured homeserver handles MXC; a
     * sender cannot make this client fetch an arbitrary HTTP URL. */
    fun downloadAttachment(media: String, expectedSha256: String, size: Int,
                           checkCurrent: () -> Unit, budgetMS: Long = 15000): ByteArray {
        checked(); require(budgetMS in 1..30000)
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMS)
        return readAttachmentCiphertext(media, expectedSha256, size) {
            checkCurrent()
            deadline - System.nanoTime()
        }
    }

    fun hasRetainedWork(): Boolean { checked(); return owned.isNotEmpty() || attachmentOwned.isNotEmpty() }
    fun close() {
        checked()
        check(owned.isEmpty() && attachmentOwned.isEmpty()) { "VEIL_MATRIX_ORIGINAL_RETAINED" }
        token.fill('\u0000')
        closed = true
    }
    private fun url(vararg segments: String): HttpUrl {
        val builder = base.newBuilder()
        for (part in segments) builder.addPathSegment(part)
        return builder.build()
    }
    private fun request(target: HttpUrl): Request.Builder {
        check(target.scheme == base.scheme && target.host == base.host && target.port == base.port)
        return Request.Builder().url(target).header("Authorization", "Bearer " + String(token))
            .header("Accept-Encoding", "identity").header("Cache-Control", "no-store")
    }
    private fun json(request: Request, original: Original): JSONObject {
        val bytes = exchange(request, 8192, original::beforeResponse)
        try {
            val value = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
            return objectJson(value)
        } finally { bytes.fill(0) }
    }
    private fun exchange(request: Request, limit: Int, checkCurrent: () -> Long): ByteArray {
        checked()
        val remaining = checkCurrent()
        check(remaining > 0)
        val guarded = request.newBuilder().tag(NetworkFence::class.java, NetworkFence(checkCurrent)).build()
        val call = http.newCall(guarded)
        call.timeout().timeout(remaining, TimeUnit.NANOSECONDS)
        var value: ByteArray? = null
        try {
            call.execute().use { response ->
                check(response.request.url == request.url && response.priorResponse == null &&
                    response.code == 200) { "VEIL_MATRIX_HTTP_NOT_OBSERVED" }
                require(response.headers.values("Content-Encoding").all { it.equals("identity", ignoreCase = true) })
                val body = checkNotNull(response.body)
                val declared = body.contentLength()
                require(declared in -1..limit.toLong())
                val buffer = java.io.ByteArrayOutputStream()
                val scratch = ByteArray(8192)
                try {
                    val stream = body.byteStream()
                    var reads = 0
                    while (true) {
                        check(checkCurrent() > 0)
                        check(++reads <= limit + 1) { "VEIL_MATRIX_RESPONSE_READ_LIMIT" }
                        val count = stream.read(scratch, 0, minOf(scratch.size, limit + 1 - buffer.size()))
                        if (count < 0) break
                        check(count > 0 && buffer.size() + count <= limit) { "VEIL_MATRIX_RESPONSE_TOO_LARGE" }
                        buffer.write(scratch, 0, count)
                    }
                    value = buffer.toByteArray()
                    if (declared >= 0) require(declared == value!!.size.toLong())
                    check(checkCurrent() > 0)
                } finally { scratch.fill(0) }
            }
            check(checkCurrent() > 0) // Cancellation/current after response close.
            return checkNotNull(value)
        } catch (failure: Throwable) { value?.fill(0); throw failure }
    }
    /** Remote media always goes through the configured homeserver, never an
     * arbitrary URL from ciphertext metadata. Bytes stay opaque until Native. */
    fun download(content: Content, guard: Guard, budgetMS: Long = 15000): ByteArray {
        checked(); require(budgetMS in 1..30000)
        require(content.bytes in 1..MAX_CIPHER && Regex("[0-9a-f]{64}").matches(content.sha256))
        val parts = mxc(content.media)
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMS)
        val bytes = exchange(request(url("_matrix", "client", "v1", "media", "download", parts.first, parts.second)).get().build(),
            content.bytes) { guard.checkCurrent(); deadline - System.nanoTime() }
        try {
            require(bytes.size == content.bytes && sha256(bytes) == content.sha256)
            guard.checkCurrent()
            check(System.nanoTime() - deadline < 0)
            return bytes
        } catch (failure: Throwable) { bytes.fill(0); throw failure }
    }

    internal data class GapBoundary(val room: String, val previous: String?)
    internal open class SyncWindow(val since: String?, val next: String,
                                   val events: List<SyncEvent>, val boundaries: List<GapBoundary>, code: String) :
        IllegalStateException(code)
    internal class SyncGap(since: String?, next: String, val room: String, val previous: String?,
                           events: List<SyncEvent>, boundaries: List<GapBoundary>) :
        SyncWindow(since, next, events, boundaries, "VEIL_MATRIX_SYNC_HISTORY_REQUIRED")
    /** A complete sync response that needs protected paging, not missing history. */
    internal class SyncBacklog(since: String?, next: String, events: List<SyncEvent>) :
        SyncWindow(since, next, events, emptyList(), "VEIL_MATRIX_SYNC_BACKLOG")
    internal data class SyncEvent(val roomId: String, val eventId: String, val sender: String, val content: String)
    internal data class SyncBatch(val since: String?, val next: String, val events: List<SyncEvent>)
    /** One bounded authenticated GET. No worker loop, token refresh, room join,
     * membership/identity grant or cursor acknowledgement is performed here. */
    fun sync(since: String?, rooms: List<String>, guard: Guard, budgetMS: Long = 15000): SyncBatch {
        checked(); require(budgetMS in 1..30000 && rooms.size in 1..250 && rooms.distinct().size == rooms.size)
        rooms.forEach { identifier(it, '!') }
        since?.let { text(it, 2048) }
        val none = JSONObject().put("types", org.json.JSONArray())
        val filter = JSONObject().put("presence", none).put("account_data", none)
            .put("room", JSONObject().put("rooms", org.json.JSONArray(rooms)).put("include_leave", false)
                .put("state", none).put("ephemeral", none).put("account_data", none)
                .put("timeline", JSONObject().put("types", org.json.JSONArray().put(EVENT)).put("limit", 32)))
        val target = url("_matrix", "client", "v3", "sync").newBuilder()
            .addQueryParameter("timeout", "0").addQueryParameter("set_presence", "offline")
            .addQueryParameter("filter", filter.toString())
        if (since != null) target.addQueryParameter("since", since)
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMS)
        val bytes = exchange(request(target.build()).get().build(), 524288) {
            guard.checkCurrent(); deadline - System.nanoTime()
        }
        try {
            val decoded = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
            val parser = JSONTokener(decoded)
            val raw = parser.nextValue()
            require(raw is JSONObject && parser.nextClean() == '\u0000')
            val next = raw.getString("next_batch"); text(next, 2048)
            val events = mutableListOf<SyncEvent>()
            val gaps = mutableListOf<GapBoundary>()
            val roomData = if (raw.has("rooms")) raw.getJSONObject("rooms") else JSONObject()
            val joined = if (roomData.has("join")) roomData.getJSONObject("join") else JSONObject()
            for (room in joined.keys()) {
                require(room in rooms)
                val value = joined.getJSONObject(room)
                if (!value.has("timeline")) continue
                val timeline = value.getJSONObject("timeline")
                if (timeline.has("limited")) {
                    require(timeline.get("limited") is Boolean)
                    if (timeline.getBoolean("limited")) {
                        val previous = if (timeline.has("prev_batch")) timeline.getString("prev_batch") else null
                        previous?.let { text(it, 2048) }
                        gaps.add(GapBoundary(room, previous))
                    }
                }
                val rows = timeline.getJSONArray("events"); require(rows.length() <= 32)
                for (index in 0 until rows.length()) {
                    val event = rows.getJSONObject(index)
                    if (event.getString("type") != EVENT) continue
                    val eventId = event.getString("event_id"); identifier(eventId, '$')
                    val sender = event.getString("sender"); identifier(sender, '@')
                    if (event.has("room_id")) require(event.getString("room_id") == room)
                    val content = event.getJSONObject("content")
                    parseContent(content) // Only selected new-core wire metadata.
                    events.add(SyncEvent(room, eventId, sender, content.toString()))
                    require(events.size <= rooms.size * 32)
                }
            }
            require(events.map { it.roomId to it.eventId }.distinct().size == events.size)
            check(next != since || (events.isEmpty() && gaps.isEmpty())) { "VEIL_MATRIX_SYNC_CURSOR_CONFLICT" }
            guard.checkCurrent(); check(System.nanoTime() - deadline < 0)
            if (gaps.isNotEmpty()) throw SyncGap(since, next, gaps.first().room, gaps.first().previous,
                events.toList(), gaps.toList())
            // Preserve every event in the already bounded authenticated response.
            // The product persists per-room pages before admitting <=128 at a time.
            if (events.size > 128) throw SyncBacklog(since, next, events.toList())
            return SyncBatch(since, next, events.toList())
        } finally { bytes.fill(0) }
    }


    internal data class HistoryPage(val from: String, val end: String?, val events: List<SyncEvent>,
                                    val responseSha256: String)
    /** One backward page from an original sync/history token. The consumer must
     * join an exact committed event boundary; missing end alone proves no join. */
    fun history(room: String, from: String, guard: Guard, budgetMS: Long = 15000): HistoryPage {
        checked(); identifier(room, '!'); text(from, 2048)
        require(budgetMS in 1..30000)
        val target = url("_matrix", "client", "v3", "rooms", room, "messages").newBuilder()
            .addQueryParameter("dir", "b").addQueryParameter("limit", "32").addQueryParameter("from", from)
            .addQueryParameter("filter", JSONObject().put("types", org.json.JSONArray().put(EVENT)).toString())
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMS)
        val bytes = exchange(request(target.build()).get().build(), 524288) {
            guard.checkCurrent(); deadline - System.nanoTime()
        }
        try {
            val decoded = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
            val parser = JSONTokener(decoded); val raw = parser.nextValue()
            require(raw is JSONObject && parser.nextClean() == '\u0000')
            val start = raw.getString("start"); text(start, 2048)
            require(start == from)
            val end = if (raw.has("end")) raw.getString("end").also { text(it, 2048) } else null
            check(end == null || end != start) { "VEIL_MATRIX_HISTORY_CURSOR_STALLED" }
            val rows = raw.getJSONArray("chunk"); require(rows.length() <= 32)
            val events = mutableListOf<SyncEvent>()
            for (index in 0 until rows.length()) {
                val event = rows.getJSONObject(index)
                require(event.getString("room_id") == room)
                if (event.getString("type") != EVENT) continue
                val id = event.getString("event_id"); identifier(id, '$')
                val sender = event.getString("sender"); identifier(sender, '@')
                val content = event.getJSONObject("content"); parseContent(content)
                events.add(SyncEvent(room, id, sender, content.toString()))
            }
            require(events.map { it.eventId }.distinct().size == events.size)
            guard.checkCurrent(); check(System.nanoTime() - deadline < 0)
            return HistoryPage(from, end, events.toList(), sha256(bytes))
        } finally { bytes.fill(0) }
    }

    private class NetworkFence(private val current: () -> Long) {
        private var entered = false
        @Synchronized fun enter() {
            check(!entered) { "VEIL_MATRIX_AUTOMATIC_RETRY_REJECTED" }
            entered = true
            check(current() > 0) { "VEIL_MATRIX_ORIGINAL_DEADLINE" }
        }
    }
    companion object {
        const val EVENT = "com.ynx.social.veil.encrypted.v2"
        const val SUITE = "signal-session-0.104.0"
        const val INITIAL_SESSION_PURPOSE = "SOCIAL_SESSION_ESTABLISH_ASSOCIATION_AND_FINAL_V1"
        const val MAX_CIPHER = 1048576
        private val OCTETS = "application/octet-stream".toMediaType()
        private val JSON = "application/json".toMediaType()
        private fun oneShot(bytes: ByteArray, type: okhttp3.MediaType): RequestBody = object : RequestBody() {
            override fun contentType() = type
            override fun contentLength() = bytes.size.toLong()
            override fun isOneShot() = true
            override fun writeTo(sink: BufferedSink) { sink.write(bytes) }
        }
        private fun text(value: String, limit: Int = 255) {
            require(value.length in 1..limit && value.all { it.code in 33..126 })
        }
        private fun identifier(value: String, first: Char) { text(value); require(value[0] == first) }
        private fun mxc(value: String): Pair<String, String> {
            require(value.length <= 1024)
            val match = Regex("mxc://([A-Za-z0-9.\\[\\]:-]+)/([A-Za-z0-9_-]+)").matchEntire(value)
                ?: error("VEIL_MATRIX_MEDIA_INVALID")
            return match.groupValues[1] to match.groupValues[2]
        }
        private fun sha256(bytes: ByteArray) =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
        private fun objectJson(value: String): JSONObject {
            require(value.length <= 8192)
            val reader = JSONTokener(value)
            val result = reader.nextValue()
            require(result is JSONObject && reader.nextClean() == '\u0000')
            return result
        }
        private fun wireContent(logicalId: String, kind: Int, media: String, digest: String, bytes: Int,
                                purpose: String?, recipientBundleSha256: String?): JSONObject {
            // Constructor validates the closed pair; no permission is inferred.
            Content(logicalId, kind, media, digest, bytes, purpose, recipientBundleSha256)
            val result = JSONObject().put("version", if (purpose == null) 2 else 3).put("suite", SUITE)
                .put("ciphertext_type", kind).put("sender_message_id", logicalId)
                .put("ciphertext", JSONObject().put("url", media).put("sha256", digest).put("size", bytes))
            if (purpose != null) result.put("purpose", purpose).put("recipient_bundle_sha256", recipientBundleSha256)
            return result
        }
        fun parseContent(value: String): Content = parseContent(objectJson(value))
        private fun parseContent(raw: JSONObject): Content {
            val version = raw.get("version")
            require(version is Int && version in 2..3 && raw.getString("suite") == SUITE)
            val keys = setOf("version", "suite", "ciphertext_type", "sender_message_id", "ciphertext")
            require(raw.keys().asSequence().toSet() == if (version == 2) keys
                else keys + setOf("purpose", "recipient_bundle_sha256"))
            val id = raw.getString("sender_message_id")
            val uuid = UUID.fromString(id)
            require(uuid.toString() == id && uuid.version() == 4 && uuid.variant() == 2)
            val kind = raw.get("ciphertext_type"); require(kind is Int && kind in 2..3)
            val cipher = raw.getJSONObject("ciphertext")
            require(cipher.keys().asSequence().toSet() == setOf("url", "sha256", "size"))
            val media = cipher.getString("url"); mxc(media)
            val digest = cipher.getString("sha256"); require(Regex("[0-9a-f]{64}").matches(digest))
            val count = cipher.get("size"); require(count is Int && count in 1..MAX_CIPHER)
            // A generic v2 PreKey remains ordinary. Only the closed v3 carrier
            // selects the initial consumer; DATA never supplies its authority.
            return if (version == 2) Content(id, kind, media, digest, count)
                else Content(id, kind, media, digest, count, raw.getString("purpose"),
                    raw.getString("recipient_bundle_sha256"))
        }
        private fun exactContent(raw: JSONObject, expected: Content) = parseContent(raw) == expected
        fun create(baseUrl: String, accessToken: CharArray): VeilMatrixCiphertextHttpTransport =
            construct(baseUrl, accessToken, OkHttpClient.Builder().followRedirects(false)
                .followSslRedirects(false).retryOnConnectionFailure(false)
                .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
                .connectTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .addNetworkInterceptor { chain ->
                    checkNotNull(chain.request().tag(NetworkFence::class.java)).enter()
                    chain.proceed(chain.request())
                }.build())
        private fun construct(baseUrl: String, accessToken: CharArray, http: OkHttpClient): VeilMatrixCiphertextHttpTransport {
            val base = baseUrl.toHttpUrl()
            require(base.isHttps && base.username.isEmpty() && base.password.isEmpty() &&
                base.query == null && base.fragment == null && base.encodedPath.endsWith("/"))
            require(accessToken.size in 1..8192 && accessToken.all { it.code in 33..126 })
            check(!http.followRedirects && !http.followSslRedirects && !http.retryOnConnectionFailure)
            return VeilMatrixCiphertextHttpTransport(base, accessToken.copyOf(), http)
        }
        /** PUBLIC interceptor controls only; not a runtime provider installer. */
        internal fun control(baseUrl: String, token: CharArray, http: OkHttpClient) = construct(baseUrl, token, http)
    }
}

