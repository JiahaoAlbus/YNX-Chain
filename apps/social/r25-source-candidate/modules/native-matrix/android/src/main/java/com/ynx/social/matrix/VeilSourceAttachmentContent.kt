package com.ynx.social.matrix

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

/** Authenticated application content inside the ordinary new-core ratchet.
 * Never an outer transport envelope, Source proof, key derivation or JS DTO. */
internal object VeilSourceAttachmentContent {
    const val VERSION = "ynx.social.attachment/v1"
    private const val MAGIC = 0x59415431
    private val b64 = Base64.getEncoder()
    fun hash(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun unbase64(value: String, maximum: Int): ByteArray {
        require(value.length <= ((maximum + 2) / 3) * 4)
        val data = Base64.getDecoder().decode(value)
        try { require(data.size <= maximum && b64.encodeToString(data) == value); return data }
        catch (failure: Throwable) { data.fill(0); throw failure }
    }
    fun base64(value: ByteArray): String = b64.encodeToString(value)
    fun uuid(value: String) { val id = UUID.fromString(value); require(id.toString() == value && id.version() == 4 && id.variant() == 2) }
    private fun utf8(value: String, maximum: Int): ByteArray {
        require(value.isNotBlank() && value.length <= maximum && value.none { it.code < 32 || it.code == 127 })
        val bytes = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(value))
        return ByteArray(bytes.remaining()).also { bytes.get(it) }
    }
    class Descriptor(val id: String, val room: String, val sender: String, val recipient: String,
        val name: String, val mime: String, val media: String, val clearSize: Int, val wireSize: Int,
        val clearSha: String, val wireSha: String, private val key: ByteArray) : AutoCloseable {
        init {
            uuid(id); require(clearSize in 1..VeilSourceAttachmentCrypto.MAX_CLEAR &&
                wireSize == 35 + clearSize + ((clearSize + 65535) / 65536) * 21 && key.size == 32)
            require(room.startsWith("!") && sender.startsWith("@") && recipient.startsWith("@") && sender != recipient)
            listOf(room, sender, recipient).forEach { utf8(it, 256).fill(0) }
            utf8(name, 255).fill(0); require('/' !in name && '\\' !in name)
            require(mime.length <= 255 && mime.matches(Regex("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")))
            require(media.isEmpty() || media.length <= 2048 && media.matches(Regex("mxc://[A-Za-z0-9.\\[\\]:-]+/[A-Za-z0-9_-]+")))
            require(clearSha.matches(Regex("[0-9a-f]{64}")) && wireSha.matches(Regex("[0-9a-f]{64}")))
        }
        fun aad(): ByteArray {
            val out = ByteArrayOutputStream()
            DataOutputStream(out).use { data ->
                for (field in listOf("YNX/VEIL/attachment-aad/v2", id, room, sender, recipient, name, mime, clearSha)) {
                    val bytes = utf8(field, 512); data.writeInt(bytes.size); data.write(bytes); bytes.fill(0)
                }
                data.writeInt(clearSize)
            }
            return out.toByteArray().also { require(it.size in 1..4096) }
        }
        fun encoded(requireMedia: Boolean = true): String {
            require(!requireMedia || media.isNotEmpty())
            val out = ByteArrayOutputStream()
            DataOutputStream(out).use { data ->
                data.writeInt(MAGIC)
                for (field in listOf(id, room, sender, recipient, name, mime, media, clearSha, wireSha)) {
                    val bytes = field.toByteArray(Charsets.UTF_8); data.writeInt(bytes.size); data.write(bytes); bytes.fill(0)
                }
                data.writeInt(clearSize); data.writeInt(wireSize); data.write(key)
            }
            val bytes = out.toByteArray()
            try { require(bytes.size <= 8192); return base64(bytes) } finally { bytes.fill(0) }
        }
        fun withWireSha(value: String) = Descriptor(id, room, sender, recipient, name, mime, media, clearSize, wireSize, clearSha, value, key.copyOf())
        fun withMedia(value: String) = Descriptor(id, room, sender, recipient, name, mime, value, clearSize, wireSize, clearSha, wireSha, key.copyOf())
        fun seal(clear: ByteArray, guard: () -> Unit): ByteArray {
            require(clear.size == clearSize && hash(clear) == clearSha)
            val aad = aad()
            try { return VeilSourceAttachmentCrypto.seal(key, aad, clear, guard) } finally { aad.fill(0) }
        }
        fun open(wire: ByteArray, guard: () -> Unit): ByteArray {
            require(wire.size == wireSize && hash(wire) == wireSha)
            val aad = aad()
            try {
                val clear = VeilSourceAttachmentCrypto.open(key, aad, wire, guard)
                try { require(clear.size == clearSize && hash(clear) == clearSha); return clear }
                catch (failure: Throwable) { clear.fill(0); throw failure }
            } finally { aad.fill(0) }
        }
        fun matches(route: VeilMatrixProductBinding.Route, logicalId: String, incoming: Boolean) {
            require(id == logicalId && room == route.roomId && sender == if (incoming) route.remoteSender else route.localSender)
            require(recipient == if (incoming) route.localSender else route.remoteSender)
        }
        override fun close() { key.fill(0) }
    }
    fun decode(value: String, requireMedia: Boolean = true): Descriptor {
        val bytes = unbase64(value, 8192)
        var key: ByteArray? = null
        try {
            val b = ByteBuffer.wrap(bytes); require(b.int == MAGIC)
            val fields = (0 until 9).map { index ->
                val n = b.int; require(n in 0..if (index == 6) 2048 else 1024); require(n <= b.remaining())
                val field = ByteArray(n); b.get(field)
                try { Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(field)).toString() }
                finally { field.fill(0) }
            }
            val clear = b.int; val wire = b.int; require(b.remaining() == 32)
            val secret = ByteArray(32); key = secret; b.get(secret)
            val descriptor = Descriptor(fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], fields[6], clear, wire, fields[7], fields[8], secret)
            require(!requireMedia || descriptor.media.isNotEmpty()); key = null; return descriptor
        } finally { key?.fill(0); bytes.fill(0) }
    }
    fun message(body: String, descriptor: Descriptor): ByteArray {
        require(body.length <= 16000 && body.none { it.code in 0..8 || it.code in 11..12 || it.code in 14..31 || it.code == 127 })
        val text = "{\"version\":" + org.json.JSONObject.quote(VERSION) + ",\"body\":" + org.json.JSONObject.quote(body) +
            ",\"replyToMessageId\":null,\"attachment\":" + org.json.JSONObject.quote(descriptor.encoded()) + "}"
        return text.toByteArray(Charsets.UTF_8).also { require(it.size <= 65536) }
    }
}
