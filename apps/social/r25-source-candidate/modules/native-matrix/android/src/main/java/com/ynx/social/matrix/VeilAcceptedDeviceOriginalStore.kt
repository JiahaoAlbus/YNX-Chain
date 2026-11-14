package com.ynx.social.matrix

import android.content.Context
import android.system.Os
import android.system.OsConstants
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest

/** Bounded PUBLIC original transport, not a device grant or a secret backup.
 * Only the normal accepted-device consumer writes this input cache. Every
 * cold read must still pass the existing Native restore/current/revocation
 * checks. The inner final/current/predecessor/terminal/checkpoint bytes are
 * never parsed, projected or remarshaled by this store.
 * No tokens, keys, ratchets, login cookies or Native success flags live here.
 */
internal class VeilAcceptedDeviceOriginalStore internal constructor(
    private val base: File, private val packageName: String, private val platform: Platform
) {
    internal constructor(context: Context) : this(context.applicationContext.noBackupFilesDir.canonicalFile,
        context.applicationContext.packageName, AndroidPlatform)

    internal class Original internal constructor(val operation: String, private val bytes: ByteArray) {
        fun originalCopy(): ByteArray = bytes.copyOf()
        fun same(operation: String, original: ByteArray): Boolean = this.operation == operation && bytes.contentEquals(original)
        fun erase() { bytes.fill(0) }
        override fun toString() = "AcceptedDeviceOriginal[public unverified input]"
    }
    /** Narrow OS seam for the host filesystem tests; never a trust provider. */
    internal interface Platform {
        fun chmod(file: File, mode: Int)
        fun syncDirectory(directory: File)
        fun publishFirst(staged: File, committed: File)
    }
    private object AndroidPlatform : Platform {
        override fun chmod(file: File, mode: Int) = Os.chmod(file.path, mode)
        override fun syncDirectory(directory: File) {
            val fd = Os.open(directory.path, OsConstants.O_RDONLY, 0)
            var first: Throwable? = null
            try { Os.fsync(fd) } catch (failure: Throwable) { first = failure; throw failure }
            finally {
                try { Os.close(fd) } catch (failure: Throwable) {
                    if (first == null) throw failure else first.addSuppressed(failure)
                }
            }
        }
        override fun publishFirst(staged: File, committed: File) {
            // link(2) atomically refuses an existing destination. Unlike rename,
            // it cannot replace a different already-retained original.
            Os.link(staged.path, committed.path)
        }
    }
    private val root = File(base, DIRECTORY)
    private val committed = File(root, "device.original")
    private val staged = File(root, "device.original.new")
    private val backup = File(root, "device.original.bak")
    init {
        require(packageName.length in 1..255 && packageName.all { it.isLetterOrDigit() && it.code < 128 || it == '.' || it == '_' })
        require(base.canonicalFile == base.absoluteFile)
    }
    fun read(): Original? {
        if (!root.exists()) return null // Observation does not create a store.
        return locked(false) { readLocked() }
    }
    /** Called only after the same normal original has passed Native current.
     * An identical repeat is read-only; different/partial input never replaces
     * the original. A filesystem failure is NOT a Native rollback or a retry.
     */
    fun retainAccepted(operation: String, canonicalOriginal: ByteArray) {
        validateOperation(operation)
        require(canonicalOriginal.size in 1..RAW_LIMIT)
        val encoded = encode(operation, canonicalOriginal)
        try {
            locked(true) {
                val previous = readLocked()
                if (previous != null) {
                    try { check(previous.same(operation, canonicalOriginal)) { "DEVICE_ORIGINAL_DIFFERENT_RETAINED" } }
                    finally { previous.erase() }
                    return@locked
                }
                check(!staged.exists() && !backup.exists()) { "DEVICE_ORIGINAL_PERSISTENCE_UNKNOWN" }
                check(staged.createNewFile()) { "DEVICE_ORIGINAL_ATTEMPT_RETAINED" }
                platform.chmod(staged, 384)
                // On ANY failure keep staged/final bytes. Never failWrite,
                // truncate a retained attempt, remove a marker or invent ABSENT.
                FileOutputStream(staged).use { output -> output.write(encoded); output.fd.sync() }
                platform.publishFirst(staged, committed)
                platform.syncDirectory(root)
                val observed = checkNotNull(readLocked()) { "DEVICE_ORIGINAL_READBACK_UNKNOWN" }
                try { check(observed.same(operation, canonicalOriginal)) { "DEVICE_ORIGINAL_READBACK_CHANGED" } }
                finally { observed.erase() }
                // Keep the bounded first-write staging original as evidence;
                // no delete/replace/repair is performed by observation.
            }
        } finally { encoded.fill(0) }
    }
    private fun <T> locked(create: Boolean, body: () -> T): T {
        check(base.isDirectory && base.canonicalFile == base.absoluteFile) { "DEVICE_ORIGINAL_BASE_INVALID" }
        if (!root.exists()) {
            check(create && root.mkdir()) { "DEVICE_ORIGINAL_DIRECTORY_UNAVAILABLE" }
            platform.chmod(root, 448)
            platform.syncDirectory(base)
        }
        check(root.isDirectory && root.canonicalPath == File(base, DIRECTORY).path) { "DEVICE_ORIGINAL_PATH_INVALID" }
        val lockFile = File(root, "device.lock")
        check(lockFile.canonicalPath == File(root, "device.lock").path) { "DEVICE_ORIGINAL_LOCK_INVALID" }
        return RandomAccessFile(lockFile, "rw").use { file ->
            platform.chmod(lockFile, 384)
            val lease = file.channel.tryLock() ?: error("DEVICE_ORIGINAL_BUSY")
            lease.use { body() }
        }
    }
    private fun readLocked(): Original? {
        check(!backup.exists()) { "DEVICE_ORIGINAL_PERSISTENCE_UNKNOWN" }
        if (!committed.exists()) {
            check(!staged.exists()) { "DEVICE_ORIGINAL_PERSISTENCE_UNKNOWN" }
            return null
        }
        val encoded = readBounded(committed)
        try {
            if (staged.exists()) {
                val first = readBounded(staged)
                try { check(first.contentEquals(encoded)) { "DEVICE_ORIGINAL_PERSISTENCE_UNKNOWN" } }
                finally { first.fill(0) }
            }
            return decode(encoded)
        } finally { encoded.fill(0) }
    }
    private fun readBounded(file: File): ByteArray {
        check(file.isFile && file.canonicalPath == File(root, file.name).path) { "DEVICE_ORIGINAL_FILE_INVALID" }
        check(file.length() in 1..ENCODED_LIMIT.toLong()) { "DEVICE_ORIGINAL_SIZE_INVALID" }
        val bytes = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        try {
            FileInputStream(file).use { input ->
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    check(n > 0 && bytes.size() + n <= ENCODED_LIMIT) { "DEVICE_ORIGINAL_SIZE_INVALID" }
                    bytes.write(buffer, 0, n)
                }
            }
            return bytes.toByteArray()
        } finally { buffer.fill(0) }
    }
    private fun encode(operation: String, canonicalOriginal: ByteArray): ByteArray {
        val prefix = ByteArrayOutputStream().also { bytes -> DataOutputStream(bytes).use { out ->
            out.writeInt(MAGIC); out.writeInt(1); out.writeUTF(packageName); out.writeUTF(ORIGIN)
            out.writeUTF(operation); out.writeInt(canonicalOriginal.size); out.write(canonicalOriginal)
        } }.toByteArray()
        try {
            require(prefix.size + 32 <= ENCODED_LIMIT)
            val digest = MessageDigest.getInstance("SHA-256").digest(prefix)
            try { return prefix + digest } finally { digest.fill(0) }
        } finally { prefix.fill(0) }
    }
    private fun decode(encoded: ByteArray): Original {
        check(encoded.size in 33..ENCODED_LIMIT) { "DEVICE_ORIGINAL_SIZE_INVALID" }
        val prefix = encoded.copyOfRange(0, encoded.size - 32)
        val expected = encoded.copyOfRange(encoded.size - 32, encoded.size)
        val observed = MessageDigest.getInstance("SHA-256").digest(prefix)
        try {
            // Public corruption detection only. This checksum grants NOTHING.
            check(MessageDigest.isEqual(expected, observed)) { "DEVICE_ORIGINAL_INTEGRITY_UNKNOWN" }
            return DataInputStream(ByteArrayInputStream(prefix)).use { input ->
                check(input.readInt() == MAGIC && input.readInt() == 1) { "DEVICE_ORIGINAL_VERSION_INVALID" }
                check(input.readUTF() == packageName && input.readUTF() == ORIGIN) { "DEVICE_ORIGINAL_PROVENANCE_CHANGED" }
                val operation = input.readUTF().also(::validateOperation)
                val size = input.readInt()
                check(size in 1..RAW_LIMIT && input.available() == size) { "DEVICE_ORIGINAL_SIZE_INVALID" }
                val original = ByteArray(size)
                try { input.readFully(original); Original(operation, original) }
                catch (failure: Throwable) { original.fill(0); throw failure }
            }
        } finally { prefix.fill(0); expected.fill(0); observed.fill(0) }
    }
    override fun toString() = "AcceptedDeviceOriginalStore[public input only]"
    companion object {
        const val RAW_LIMIT = 393216 // Exact existing device JNI transport bound.
        private const val ENCODED_LIMIT = RAW_LIMIT + 1024
        private const val MAGIC = 0x59414431
        private const val DIRECTORY = "social-accepted-device-original-v1"
        private const val ORIGIN = "NORMAL_FIRST_DEVICE_ENROLLMENT_OBSERVATION_V4"
        private fun validateOperation(value: String) {
            require(value.length in 1..256 && value.all { it.code in 33..126 })
        }
    }
}
