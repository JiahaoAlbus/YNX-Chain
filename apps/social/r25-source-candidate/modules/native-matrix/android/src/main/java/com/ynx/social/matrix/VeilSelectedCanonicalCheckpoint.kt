package com.ynx.social.matrix

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest

// Ciphertext custody/math only: not an authority, codec, source lease or CAS proof.
internal data class VeilCanonicalCiphertextInput(val kind: VeilRecordKind, val id: String, val sealed: ByteArray)

internal class VeilCanonicalInventoryOwner private constructor(
    private val binding: VeilDeviceBinding, private val revision: Long,
    private val rows: List<VeilCanonicalCiphertextInput>,
) : AutoCloseable {
    private val thread = Thread.currentThread()
    private var closed = false
    private var active: Borrow? = null
    internal class Borrow internal constructor(private val owner: VeilCanonicalInventoryOwner) {
        internal fun checkpoint(): VeilStorageCheckpoint = owner.checkpoint(this)
    }
    private fun requireOwner() {
        check(Thread.currentThread() === thread) { "CANONICAL_WRONG_THREAD" }
        check(!closed) { "CANONICAL_CLOSED" }
    }
    fun <T> borrow(body: (Borrow) -> T): T {
        requireOwner()
        check(active == null) { "CANONICAL_NESTED_BORROW" }
        val view = Borrow(this)
        active = view
        try { return body(view) } finally { active = null }
    }
    private fun checkpoint(view: Borrow): VeilStorageCheckpoint {
        requireOwner()
        check(active === view) { "CANONICAL_EXPIRED_BORROW" }
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(aad(binding, VeilRecordKind.SESSION, "checkpoint-domain"))
        digest.update(ByteBuffer.allocate(8).putLong(revision).array())
        for (row in rows) {
            val recordAAD = aad(binding, row.kind, row.id)
            digest.update(ByteBuffer.allocate(4).putInt(recordAAD.size).array())
            digest.update(recordAAD)
            digest.update(ByteBuffer.allocate(4).putInt(row.sealed.size).array())
            digest.update(row.sealed)
        }
        return VeilStorageCheckpoint(revision,
            digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) })
    }
    override fun close() {
        check(Thread.currentThread() === thread) { "CANONICAL_WRONG_THREAD" }
        if (closed) return
        check(active == null) { "CANONICAL_ACTIVE_BORROW" }
        closed = true
        for (row in rows) row.sealed.fill(0)
    }
    companion object {
        // Caller exclusively owns input during this synchronous call. This is
        // mathematical shape validation, never a substitute for genuine custody.
        fun freeze(binding: VeilDeviceBinding, revision: Long,
                   input: List<VeilCanonicalCiphertextInput>): VeilCanonicalInventoryOwner {
            require(revision >= 0)
            require(input.size <= 4096)
            var total = 0L
            var previous: VeilCanonicalCiphertextInput? = null
            for (row in input) {
                require(row.id.length in 1..1024 && row.id.all { it.code in 33..126 })
                require(row.sealed.size in 29..VeilRecordBudget.MAX_SEALED_BYTES)
                total += row.sealed.size.toLong()
                require(total <= 64L * 1024 * 1024)
                previous?.let {
                    val order = it.kind.name.compareTo(row.kind.name)
                    require(order < 0 || (order == 0 && it.id < row.id))
                }
                previous = row
            }
            VeilRecordBudget.validate(input.size.toLong(), total,
                input.maxOfOrNull { it.sealed.size.toLong() } ?: 0L,
                input.maxOfOrNull { it.kind.name.length.toLong() } ?: 0L,
                input.maxOfOrNull { it.id.length.toLong() } ?: 0L, 0)
            val copies = ArrayList<VeilCanonicalCiphertextInput>(input.size)
            try {
                for (row in input) copies.add(row.copy(sealed = row.sealed.copyOf()))
                return VeilCanonicalInventoryOwner(binding, revision, copies)
            } catch (failure: Throwable) {
                for (row in copies) row.sealed.fill(0)
                throw failure
            }
        }
        private fun aad(binding: VeilDeviceBinding, kind: VeilRecordKind, id: String): ByteArray {
            val output = ByteArrayOutputStream()
            DataOutputStream(output).use { stream ->
                for (value in listOf("ynx-social-veil-native-store-v2", binding.owner,
                    binding.device, binding.socialIdentityFingerprint, binding.keyAlias, kind.name, id)) {
                    val bytes = value.toByteArray(Charsets.UTF_8)
                    stream.writeInt(bytes.size)
                    stream.write(bytes)
                }
            }
            return output.toByteArray()
        }
    }
}
internal object VeilSelectedCanonicalCheckpoint {
    fun hash(view: VeilCanonicalInventoryOwner.Borrow): VeilStorageCheckpoint = view.checkpoint()
}
