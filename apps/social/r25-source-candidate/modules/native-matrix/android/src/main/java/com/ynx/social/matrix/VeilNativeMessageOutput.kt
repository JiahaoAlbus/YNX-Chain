package com.ynx.social.matrix

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest

/** An owned YNXO1 copy, never device, route, permission or delivery authority. */
internal class VeilNativeMessageOutput private constructor(
    private val bytes: ByteArray, val direction: Int, val kind: Int
) : AutoCloseable {
    private var closed = false
    fun logicalId(): ByteArray { check(!closed); return bytes.copyOfRange(8, 24) }
    fun body(): ByteArray { check(!closed); return bytes.copyOfRange(HEADER, bytes.size) }
    fun duplicate(): VeilNativeMessageOutput {
        check(!closed)
        return VeilNativeMessageOutput(bytes.copyOf(), direction, kind)
    }
    fun sameOriginal(other: VeilNativeMessageOutput): Boolean {
        check(!closed && !other.closed)
        return MessageDigest.isEqual(bytes, other.bytes)
    }
    override fun close() { if (!closed) { bytes.fill(0); closed = true } }
    override fun toString() = "VeilNativeMessageOutput[owned; no delivery claim]"
    companion object {
        const val HEADER = 28
        const val MAX_OUTPUT = HEADER + 1048576
        /** Ordinary incoming text stays UTF-8/kind1; no control fallback. */
        fun decode(buffer: ByteArray, written: Long, expectedLogical: ByteArray,
                   expectedDirection: Int): VeilNativeMessageOutput =
            decodeOwned(buffer, written, expectedLogical, expectedDirection, 1)
        /** Only the actual held YNXM kind5 operation uses this path. Shape
         * decoding is DATA; caller must still require native committed output. */
        fun decodeInitialControl(buffer: ByteArray, written: Long,
                                 expectedLogical: ByteArray): VeilNativeMessageOutput =
            decodeOwned(buffer, written, expectedLogical, 2, 4)
        private fun decodeOwned(buffer: ByteArray, written: Long, expectedLogical: ByteArray,
                                expectedDirection: Int, incomingKind: Int): VeilNativeMessageOutput {
            require(buffer.size <= MAX_OUTPUT && written in (HEADER + 1).toLong()..MAX_OUTPUT.toLong())
            require(written <= buffer.size.toLong() && expectedLogical.size == 16 &&
                expectedLogical.any { it != 0.toByte() } && expectedDirection in 1..2)
            val owned = buffer.copyOfRange(0, written.toInt())
            var accepted = false
            try {
                require(owned[0] == 89.toByte() && owned[1] == 78.toByte() &&
                    owned[2] == 88.toByte() && owned[3] == 79.toByte() &&
                    owned[4] == 1.toByte() && owned[7] == 0.toByte())
                val direction = owned[5].toInt(); val kind = owned[6].toInt()
                require(direction == expectedDirection)
                require(if (direction == 1) kind in 2..3 && incomingKind == 1 else kind == incomingKind)
                for (i in 0 until 16) require(owned[8 + i] == expectedLogical[i])
                val length = ByteBuffer.wrap(owned, 24, 4).int
                require(length > 0 && length <= if (direction == 1) 1048576 else 65536)
                require(owned.size == HEADER + length)
                if (direction == 2 && kind == 1) {
                    val decoded = Charsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(owned, HEADER, length))
                    if (decoded.hasArray()) decoded.array().fill('\u0000')
                }
                val result = VeilNativeMessageOutput(owned, direction, kind)
                accepted = true
                return result
            } finally { if (!accepted) owned.fill(0) }
        }
    }
}
