package com.ynx.social.matrix

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyInfo
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * Dormant native-only storage for the future official libsignal bridge.
 * Not exposed through Expo, not instantiated by Matrix, and not a crypto engine.
 * The native enrollment/authority owner must supply an already enrolled Social
 * key and check its current owner/device/revocation lease on every callback.
 * No key generation, SSO-derived key, wallet key, backup restore or fallback here.
 */
internal class VeilNativeStore(
  private val context: Context,
  private val authority: VeilNativeAuthority,
  private val lease: VeilNativeLease,
  private val checkpoints: VeilCheckpointProtector,
) : AutoCloseable {
  private val lock = Any()
  private val binding = lease.binding
  private val owner = binding.owner
  private var closed = false
  private val sealer by lazy { AndroidVeilRecordSealer(binding.keyAlias) }
  private val helperDelegate = lazy {
    val directory = File(context.noBackupFilesDir, "veil-v2")
    check(directory.isDirectory || directory.mkdirs()) { "VEIL_STORAGE_UNAVAILABLE" }
    val digest = MessageDigest.getInstance("SHA-256").digest(bindingAAD(binding))
    val name = digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    object : SQLiteOpenHelper(context.applicationContext, File(directory, "$name.sqlite").absolutePath, null, 1) {
      override fun onConfigure(db: SQLiteDatabase) {
        db.execSQL("PRAGMA synchronous=FULL")
      }
      override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, sealed BLOB NOT NULL, PRIMARY KEY(kind,id))")
        db.execSQL("CREATE TABLE checkpoint (slot INTEGER PRIMARY KEY CHECK(slot=1), revision INTEGER NOT NULL CHECK(revision>=0))")
        db.execSQL("INSERT INTO checkpoint VALUES (1,0)")
      }
      override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        error("VEIL_STORAGE_MIGRATION_REQUIRED")
      }
    }
  }
  private val helper: SQLiteOpenHelper by helperDelegate

  /** JNI store callbacks must stay on this thread; suspend/network work is forbidden. */
  fun <T> transaction(block: (VeilNativeTransaction) -> T): T = authority.withLease(lease) { scope -> synchronized(lock) {
    check(!closed) { "VEIL_STORAGE_CLOSED" }
    scope.checkLive()
    val db = helper.writableDatabase
    check(!db.inTransaction()) { "VEIL_NESTED_TRANSACTION_REJECTED" }
    val recordSealer = sealer
    scope.checkLive()
    db.beginTransaction()
    var ended = false
    val tx = VeilNativeTransaction(db, binding, recordSealer) { scope.checkLive() }
    try {
      val before = storageCheckpoint(db, binding)
      val trusted = checkpoints.load(binding) ?: error("VEIL_CHECKPOINT_NOT_ENROLLED")
      check(before == trusted) { "VEIL_ROLLBACK_OR_COMMIT_RECOVERY_REQUIRED" }
      val result = block(tx)
      tx.checkLive()
      val mutated = tx.mutated
      tx.finish()
      val next = if (mutated) {
        val revision = Math.addExact(before.revision, 1L)
        db.execSQL("UPDATE checkpoint SET revision=? WHERE slot=1", arrayOf(revision))
        storageCheckpoint(db, binding)
      } else before
      scope.commit {
        // Advancing the external anchor first deliberately fails closed on a
        // subsequent crash/commit failure. Never silently accept an older DB.
        if (mutated) checkpoints.advance(binding, before, next)
        scope.checkLive()
        db.setTransactionSuccessful()
        db.endTransaction()
        ended = true
      }
      result
    } finally {
      tx.finish()
      if (!ended) db.endTransaction()
    }
  } }

  override fun close() = synchronized(lock) {
    if (!closed) {
      closed = true
      // Do not instantiate storage or enroll keys merely to close an unused component.
      if (helperDelegate.isInitialized()) helper.close()
    }
  }

}

internal enum class VeilRecordKind {
  SESSION, IDENTITY_PIN, PREKEY, SIGNED_PREKEY, KEM_PREKEY, USED_KEM, OUTBOX, INBOX_RECEIPT,
}

internal class VeilNativeTransaction(
  private val db: SQLiteDatabase,
  private val binding: VeilDeviceBinding,
  private val sealer: VeilRecordSealer,
  private val authorize: () -> Unit,
) {
  private val thread = Thread.currentThread()
  private var live = true
  internal var mutated = false
    private set

  internal fun checkLive() {
    check(live && Thread.currentThread() === thread && db.inTransaction()) { "VEIL_TRANSACTION_INACTIVE" }
    authorize()
  }
  internal fun finish() { live = false }

  fun read(kind: VeilRecordKind, id: String): ByteArray? {
    checkLive()
    requireIdentifier(id, 1024)
    val present = db.query("records", arrayOf("length(sealed)", "typeof(sealed)"), "kind=? AND id=?", arrayOf(kind.name, id), null, null, null).use {
      if (it.moveToFirst()) {
        require(it.getLong(0) in 29..VeilRecordBudget.MAX_SEALED_BYTES.toLong() && it.getString(1) == "blob")
        true
      } else false
    }
    if (!present) return null
    val sealed = db.query("records", arrayOf("sealed"), "kind=? AND id=?", arrayOf(kind.name, id), null, null, null).use {
      check(it.moveToFirst())
      it.getBlob(0)
    }
    val clear = sealer.open(sealed, recordAAD(binding, kind, id))
    try {
      checkLive()
      return clear
    } catch (error: Throwable) {
      clear.fill(0)
      throw error
    }
  }

  /** Serialized native SDK records only. Never pass keys or plaintext across JS. */
  fun write(kind: VeilRecordKind, id: String, bytes: ByteArray) {
    checkLive()
    requireIdentifier(id, 1024)
    require(bytes.size in 1..MAX_RECORD_BYTES)
    val sealed = sealer.seal(bytes, recordAAD(binding, kind, id))
    checkLive()
    val values = ContentValues().apply {
      put("kind", kind.name)
      put("id", id)
      put("sealed", sealed)
    }
    check(db.insertWithOnConflict("records", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L) { "VEIL_STORAGE_WRITE_FAILED" }
    mutated = true
  }

  /** Persist the exact SDK-produced wire ciphertext once, alongside ratchet updates. */
  fun insertOutbox(intentId: String, nativeWireEnvelope: ByteArray) {
    checkLive()
    requireIdentifier(intentId, 128)
    require(nativeWireEnvelope.size in 1..MAX_RECORD_BYTES)
    check(read(VeilRecordKind.OUTBOX, intentId) == null) { "VEIL_OUTBOX_ID_ALREADY_COMMITTED" }
    write(VeilRecordKind.OUTBOX, intentId, nativeWireEnvelope)
  }

  fun remove(kind: VeilRecordKind, id: String) {
    checkLive()
    requireIdentifier(id, 1024)
    db.delete("records", "kind=? AND id=?", arrayOf(kind.name, id))
    mutated = true
  }
}

internal interface VeilRecordSealer {
  fun seal(clear: ByteArray, aad: ByteArray): ByteArray
  fun open(sealed: ByteArray, aad: ByteArray): ByteArray
}

/** Mature platform AES-GCM for storage wrapping, NOT the libsignal wire cipher. */
private class AndroidVeilRecordSealer(alias: String) : VeilRecordSealer {
  private val key: SecretKey
  init {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    key = (store.getKey(alias, null) as? SecretKey) ?: error("VEIL_SOCIAL_KEY_NOT_ENROLLED")
    check(key.algorithm == "AES") { "VEIL_STORAGE_KEY_TYPE_REJECTED" }
    val info = SecretKeyFactory.getInstance("AES", "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java) as KeyInfo
    check(info.keySize == 256 && info.isUserAuthenticationRequired) { "VEIL_STORAGE_KEY_POLICY_REJECTED" }
    // Hardware-backed status must be separately measured; never infer it here.
  }

  override fun seal(clear: ByteArray, aad: ByteArray): ByteArray {
    require(clear.size in 1..MAX_RECORD_BYTES)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    cipher.updateAAD(aad)
    val iv = cipher.iv // Provider-generated nonce; never derive it from counters.
    check(iv.size == NONCE_BYTES) { "VEIL_STORAGE_NONCE_REJECTED" }
    return iv + cipher.doFinal(clear)
  }

  override fun open(sealed: ByteArray, aad: ByteArray): ByteArray {
    require(sealed.size in (NONCE_BYTES + TAG_BYTES + 1)..(MAX_RECORD_BYTES + NONCE_BYTES + TAG_BYTES))
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, NONCE_BYTES)))
    cipher.updateAAD(aad)
    return cipher.doFinal(sealed, NONCE_BYTES, sealed.size - NONCE_BYTES)
  }
}

private const val MAX_RECORD_BYTES = 8 * 1024 * 1024
private const val NONCE_BYTES = 12
private const val TAG_BYTES = 16

private fun requireIdentifier(value: String, maximum: Int) {
  require(value.length in 1..maximum && value.all { it.code in 33..126 })
}

private fun recordAAD(binding: VeilDeviceBinding, kind: VeilRecordKind, id: String): ByteArray {
  // Unambiguous local storage framing, not a new protocol/KDF/wire format.
  val output = ByteArrayOutputStream()
  DataOutputStream(output).use { stream ->
    for (value in listOf("ynx-social-veil-native-store-v2", binding.owner, binding.device, binding.socialIdentityFingerprint, binding.keyAlias, kind.name, id)) {
      val bytes = value.toByteArray(Charsets.UTF_8)
      stream.writeInt(bytes.size)
      stream.write(bytes)
    }
  }
  return output.toByteArray()
}

private fun bindingAAD(binding: VeilDeviceBinding): ByteArray =
  recordAAD(binding, VeilRecordKind.SESSION, "checkpoint-domain")

private fun storageCheckpoint(db: SQLiteDatabase, binding: VeilDeviceBinding): VeilStorageCheckpoint {
  db.rawQuery("SELECT COUNT(*), COALESCE(SUM(length(sealed)),0), COALESCE(MAX(length(sealed)),0), COALESCE(MAX(length(kind)),0), COALESCE(MAX(length(id)),0), COALESCE(SUM(CASE WHEN typeof(sealed)!='blob' OR length(sealed)<29 OR typeof(kind)!='text' OR typeof(id)!='text' THEN 1 ELSE 0 END),0) FROM records", null).use {
    check(it.moveToFirst())
    VeilRecordBudget.validate(it.getLong(0), it.getLong(1), it.getLong(2), it.getLong(3), it.getLong(4), it.getLong(5))
  }
  val revision = db.rawQuery("SELECT slot,revision FROM checkpoint", null).use {
    check(it.count == 1 && it.moveToFirst() && it.getLong(0) == 1L)
    it.getLong(1).also { value -> require(value >= 0) }
  }
  val digest = MessageDigest.getInstance("SHA-256")
  digest.update(bindingAAD(binding))
  digest.update(java.nio.ByteBuffer.allocate(8).putLong(revision).array())
  db.query("records", arrayOf("kind", "id", "sealed"), null, null, null, null, "kind,id").use { rows ->
    while (rows.moveToNext()) {
      val kind = VeilRecordKind.valueOf(rows.getString(0))
      val id = rows.getString(1)
      requireIdentifier(id, 1024)
      val aad = recordAAD(binding, kind, id)
      val sealed = rows.getBlob(2)
      require(sealed.size in 29..VeilRecordBudget.MAX_SEALED_BYTES)
      digest.update(java.nio.ByteBuffer.allocate(4).putInt(aad.size).array())
      digest.update(aad)
      digest.update(java.nio.ByteBuffer.allocate(4).putInt(sealed.size).array())
      digest.update(sealed)
    }
  }
  return VeilStorageCheckpoint(revision, digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) })
}
