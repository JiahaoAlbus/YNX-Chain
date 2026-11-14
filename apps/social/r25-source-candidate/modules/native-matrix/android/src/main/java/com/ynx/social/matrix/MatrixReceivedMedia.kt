package com.ynx.social.matrix

import android.net.Uri
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject
import org.matrix.rustcomponents.sdk.Client
import org.matrix.rustcomponents.sdk.EventOrTransactionId
import org.matrix.rustcomponents.sdk.MediaFileHandle
import org.matrix.rustcomponents.sdk.MediaSource
import org.matrix.rustcomponents.sdk.MessageType
import org.matrix.rustcomponents.sdk.MsgLikeKind
import org.matrix.rustcomponents.sdk.Timeline
import org.matrix.rustcomponents.sdk.TimelineItemContent

/** Native-only adapter, awaiting current-handle module registration.
 * The required reviewer must check canonical authority, encrypted direct-room
 * membership and the accepted original sender against the current native handle.
 * A caller-supplied URI or JS media descriptor is never accepted.
 */
internal class MatrixReceivedMedia(
    private val client: Client,
    private val cacheRoot: File,
    private val review: suspend (roomId: String, sender: String?) -> Unit,
    private val maximumBytes: Long = 32L * 1024 * 1024
) : AutoCloseable {
    private val epoch = AtomicLong(0)
    private val handles = mutableMapOf<String, MediaFileHandle>()

    suspend fun open(timeline: Timeline, roomId: String, eventId: String): Map<String, Any> {
        require(roomId.startsWith("!") && eventId.startsWith("$")) { "MATRIX_MEDIA_EVENT_REQUIRED" }
        require(maximumBytes > 0) { "MATRIX_MEDIA_LIMIT_REQUIRED" }
        val attempt = epoch.get()
        review(roomId, null)
        val item = timeline.getEventTimelineItemByEventId(eventId)
        require(item.isRemote && (item.eventOrTransactionId as? EventOrTransactionId.EventId)?.eventId == eventId) {
            "MATRIX_MEDIA_REMOTE_EVENT_REQUIRED"
        }
        review(roomId, item.sender)
        require(epoch.get() == attempt) { "MATRIX_MEDIA_RETIRED" }
        val message = ((item.content as? TimelineItemContent.MsgLike)?.content?.kind as? MsgLikeKind.Message)?.content
            ?: error("MATRIX_MEDIA_MESSAGE_REQUIRED")
        require(!message.isEdited) { "MATRIX_MEDIA_EDIT_REVIEW_REQUIRED" }
        val source: MediaSource
        val filename: String
        val mime: String
        val declared: ULong?
        when (val type = message.msgType) {
            is MessageType.Image -> {
                source = type.content.source; filename = type.content.filename
                mime = type.content.info?.mimetype ?: "application/octet-stream"
                declared = type.content.info?.size
            }
            is MessageType.File -> {
                source = type.content.source; filename = type.content.filename
                mime = type.content.info?.mimetype ?: "application/octet-stream"
                declared = type.content.info?.size
            }
            else -> error("MATRIX_MEDIA_TYPE_NOT_SUPPORTED")
        }
        require(mime.matches(Regex("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+"))) { "MATRIX_MEDIA_MIME_INVALID" }
        require(declared == null || (declared > 0uL && declared <= maximumBytes.toULong())) { "MATRIX_MEDIA_TOO_LARGE" }
        val raw = JSONObject(item.lazyProvider.debugInfo().originalJson ?: error("MATRIX_MEDIA_ORIGINAL_REQUIRED"))
        require(raw.optString("event_id") == eventId && raw.optString("sender") == item.sender) { "MATRIX_MEDIA_EVENT_MISMATCH" }
        val original = raw.getJSONObject("content")
        require(!original.has("url")) { "MATRIX_MEDIA_ENCRYPTED_FILE_REQUIRED" }
        val encrypted = original.getJSONObject("file")
        val serialized = JSONObject(source.toJson())
        val sdkFile = serialized.optJSONObject("file") ?: serialized
        require(encrypted.optString("v") == "v2" && encrypted.optString("url").startsWith("mxc://")) {
            "MATRIX_MEDIA_ENCRYPTED_FILE_REQUIRED"
        }
        require(MatrixMediaDescriptor.matches(encrypted, sdkFile) && source.url() == encrypted.getString("url")) {
            "MATRIX_MEDIA_DESCRIPTOR_MISMATCH"
        }
        require(!filename.contains('\u0000')) { "MATRIX_MEDIA_FILENAME_INVALID" }
        review(roomId, item.sender)
        require(epoch.get() == attempt) { "MATRIX_MEDIA_RETIRED" }
        val root = cacheRoot.canonicalFile
        check(root.mkdirs() || root.isDirectory) { "MATRIX_MEDIA_CACHE_UNAVAILABLE" }
        // No original filename is ever used as a filesystem path. Do not persist
        // the SDK handle, copy plaintext, use the SDK cache, or launch another app.
        val handle = client.getMediaFile(source, null, mime, false, root.path)
        var retained = false
        try {
            review(roomId, item.sender)
            val file = File(handle.path()).canonicalFile
            require(file.parentFile == root && file.isFile && file.length() in 1..maximumBytes) { "MATRIX_MEDIA_FILE_INVALID" }
            require(declared == null || file.length().toULong() == declared) { "MATRIX_MEDIA_SIZE_MISMATCH" }
            ImagePreviewBounds.validate(file, mime)
            val token = UUID.randomUUID().toString()
            synchronized(handles) {
                require(epoch.get() == attempt) { "MATRIX_MEDIA_RETIRED" }
                handles[token] = handle
                retained = true
            }
            return mapOf("leaseId" to token, "eventId" to eventId, "roomId" to roomId,
                "filename" to filename, "mimeType" to mime, "bytes" to file.length(),
                "uri" to Uri.fromFile(file).toString(), "imagePreview" to (mime in IMAGE_MIMES))
        } finally {
            if (!retained) handle.close()
        }
    }

    fun release(leaseId: String) {
        synchronized(handles) { handles.remove(leaseId) }?.close()
    }

    override fun close() {
        val old = synchronized(handles) {
            epoch.incrementAndGet()
            handles.values.toList().also { handles.clear() }
        }
        old.forEach { it.close() }
    }

    companion object {
        private val IMAGE_MIMES = setOf("image/png", "image/jpeg", "image/webp", "image/gif")
    }
}
