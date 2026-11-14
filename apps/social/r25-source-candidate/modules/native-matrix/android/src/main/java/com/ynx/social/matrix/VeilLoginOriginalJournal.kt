package com.ynx.social.matrix

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.Os
import android.system.OsConstants
import android.util.AtomicFile
import android.util.Base64
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Private request custody only, not identity or device authority. No JS API. */
internal interface VeilLoginOriginalJournal {
    fun read(): VeilLoginOriginalRecord?
    fun begin(intent: VeilSocialLoginClient.Intent): VeilLoginOriginalRecord
    fun retainCookie(originalKey: String, intent: VeilSocialLoginClient.Intent, cookie: String)
    fun cancel(originalKey: String, intent: VeilSocialLoginClient.Intent)
}

internal class VeilLoginOriginalRecord(
    val intent: VeilSocialLoginClient.Intent,
    val key: String,
    val cookie: String?,
    val cancelled: Boolean
) {
    init { require(Regex("[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]").matches(key)) }
    override fun toString() = "VeilLoginOriginalRecord[private]"
}

/** One AndroidKeyStore AES-GCM original, app-private and excluded from backup.
 * Missing keys, corrupt records and uncertain initial writes never mean ABSENT.
 * This does not restore account authority, device grants or ratchet state.
 * Old process-only attempts cannot be reconstructed by generating a new key. */
internal class VeilAndroidLoginOriginalJournal(
    context: Context, private val profile: VeilSocialLoginProfile
) : VeilLoginOriginalJournal {
    private val app = context.applicationContext
    private val base = app.noBackupFilesDir.canonicalFile
    private val root = File(base, "social-login-original-v1")
    private val file = File(root, "original.sealed")
    private val alias = "ynx.social.login.original.v1." + profile.name
    private val aad = ("YNX-SOCIAL-LOGIN-ORIGINAL-V1\n" + profile.packageName + "\n" +
        profile.clientId + "\n" + profile.callback + "\n" + profile.apiOrigin + profile.apiMount).toByteArray(Charsets.UTF_8)

    init { require(app.packageName == profile.packageName) }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun key(create: Boolean): SecretKey {
        val store = keyStore()
        val old = store.getKey(alias, null)
        if (old != null) return (old as? SecretKey ?: error("LOGIN_ORIGINAL_KEY_INVALID"))
            .also { check(it.algorithm == "AES") }
        check(create && !artifactsPresent()) { "LOGIN_ORIGINAL_KEY_MISSING_PRESERVE_STATE" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    private fun artifactsPresent() = file.exists() || File(root, "original.sealed.bak").exists() ||
        File(root, "original.sealed.new").exists()

    private fun <T> locked(action: () -> T): T {
        check(root.isDirectory || root.mkdirs()) { "LOGIN_ORIGINAL_DIRECTORY_FAILED" }
        check(root.canonicalPath == File(base, "social-login-original-v1").path) { "LOGIN_ORIGINAL_PATH_INVALID" }
        Os.chmod(root.path, 448)
        val lockFile = File(root, "original.lock")
        check(lockFile.canonicalPath == File(root, "original.lock").path)
        return RandomAccessFile(lockFile, "rw").use { raf ->
            Os.chmod(lockFile.path, 384)
            val lock = raf.channel.tryLock() ?: error("LOGIN_ORIGINAL_BUSY")
            lock.use { action() }
        }
    }

    override fun read(): VeilLoginOriginalRecord? = locked { readLocked() }
    override fun begin(intent: VeilSocialLoginClient.Intent): VeilLoginOriginalRecord = locked {
        check(readLocked() == null) { "LOGIN_ORIGINAL_ALREADY_RETAINED" }
        val random = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val original = try {
            VeilLoginOriginalRecord(intent, Base64.encodeToString(random,
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), null, false)
        } finally { random.fill(0) }
        // A failed initial commit retains the alias/partial artifact as UNKNOWN.
        saveLocked(original, key(true))
        original
    }
    override fun retainCookie(originalKey: String, intent: VeilSocialLoginClient.Intent, cookie: String) = locked {
        validateCookie(cookie)
        val old = checkNotNull(readLocked()) { "LOGIN_ORIGINAL_REQUIRED" }
        check(old.key == originalKey && old.intent == intent && (old.cookie == null || old.cookie == cookie)) {
            "LOGIN_ORIGINAL_ASSOCIATION_CHANGED"
        }
        if (old.cookie == null) saveLocked(VeilLoginOriginalRecord(old.intent, old.key, cookie, old.cancelled), key(false))
    }
    override fun cancel(originalKey: String, intent: VeilSocialLoginClient.Intent) = locked {
        val old = checkNotNull(readLocked()) { "LOGIN_ORIGINAL_REQUIRED" }
        check(old.key == originalKey && old.intent == intent) { "LOGIN_ORIGINAL_ASSOCIATION_CHANGED" }
        if (!old.cancelled) saveLocked(VeilLoginOriginalRecord(old.intent, old.key, old.cookie, true), key(false))
    }

    private fun validateCookie(value: String) {
        val token = "[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]"
        require(Regex(Regex.escape(profile.cookieIdName) + "=" + token + "; " +
            Regex.escape(profile.cookieBindingName) + "=" + token).matches(value))
    }
    private fun readLocked(): VeilLoginOriginalRecord? {
        if (!file.exists() && !File(root, "original.sealed.bak").exists()) {
            check(!artifactsPresent() && !keyStore().containsAlias(alias)) { "LOGIN_ORIGINAL_PERSISTENCE_UNKNOWN" }
            return null
        }
        val encoded = AtomicFile(file).openRead().use { input ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(1024)
            try {
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    check(n > 0 && out.size() + n <= 12288) { "LOGIN_ORIGINAL_SIZE_INVALID" }
                    out.write(buf, 0, n)
                }
                out.toByteArray()
            } finally { buf.fill(0) }
        }
        var clear: ByteArray? = null
        try {
            DataInputStream(ByteArrayInputStream(encoded)).use { input ->
                check(input.readInt() == 0x594c4f31)
                val ivSize = input.readUnsignedByte()
                val count = input.readInt()
                check(ivSize == 12 && count in 16..11000 && input.available() == ivSize + count)
                val iv = ByteArray(ivSize).also { input.readFully(it) }
                val ciphertext = ByteArray(count).also { input.readFully(it) }
                try {
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, iv))
                    cipher.updateAAD(aad)
                    clear = cipher.doFinal(ciphertext)
                } finally { iv.fill(0); ciphertext.fill(0) }
            }
            return DataInputStream(ByteArrayInputStream(checkNotNull(clear))).use { input ->
                check(input.readInt() == 1)
                val selectedName = input.readUTF()
                val selected = VeilSocialLoginClient.Intent.entries.single { it.name == selectedName }
                val privateKey = input.readUTF()
                val cookie = input.readUTF().ifEmpty { null }
                val stopped = input.readUnsignedByte()
                check(stopped in 0..1 && input.available() == 0)
                cookie?.let(::validateCookie)
                VeilLoginOriginalRecord(selected, privateKey, cookie, stopped == 1)
            }
        } finally { encoded.fill(0); clear?.fill(0) }
    }

    private fun saveLocked(record: VeilLoginOriginalRecord, secret: SecretKey) {
        val clear = ByteArrayOutputStream().also { out -> DataOutputStream(out).use {
            it.writeInt(1); it.writeUTF(record.intent.name); it.writeUTF(record.key)
            it.writeUTF(record.cookie ?: ""); it.writeByte(if (record.cancelled) 1 else 0)
        } }.toByteArray()
        val encoded: ByteArray
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secret)
            cipher.updateAAD(aad)
            val sealed = cipher.doFinal(clear)
            try {
                check(cipher.iv.size == 12)
                encoded = ByteArrayOutputStream().also { out -> DataOutputStream(out).use {
                    it.writeInt(0x594c4f31); it.writeByte(cipher.iv.size); it.writeInt(sealed.size)
                    it.write(cipher.iv); it.write(sealed)
                } }.toByteArray()
            } finally { sealed.fill(0) }
        } finally { clear.fill(0) }
        val atomic = AtomicFile(file)
        val stream = atomic.startWrite()
        try {
            stream.write(encoded); stream.fd.sync()
            atomic.finishWrite(stream)
        } catch (failure: Throwable) {
            try { atomic.failWrite(stream) } catch (closeFailure: Throwable) { failure.addSuppressed(closeFailure) }
            throw failure
        } finally { encoded.fill(0) }
        Os.chmod(file.path, 384)
        val dir = Os.open(root.path, OsConstants.O_RDONLY, 0)
        try { Os.fsync(dir) } finally { Os.close(dir) }
        val observed = checkNotNull(readLocked())
        check(observed.intent == record.intent && observed.key == record.key &&
            observed.cookie == record.cookie && observed.cancelled == record.cancelled) { "LOGIN_ORIGINAL_COMMIT_UNKNOWN" }
    }
    override fun toString() = "VeilAndroidLoginOriginalJournal[private]"
}
