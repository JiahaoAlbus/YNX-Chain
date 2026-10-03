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
  context: Context,
  private val owner: String,
  keyAlias: String,
  private val authorize: (String) -> Unit,
) : AutoCloseable {
  private val lock = Any()
  private val sealer: VeilRecordSealer
  private val helper: SQLiteOpenHelper
  private var closed = false

  init {
    requireIdentifier(owner, 512)
    require(keyAlias.startsWith("ynx.social.veil.v2.") && keyAlias.length <= 200)
    authorize(owner)
    sealer = AndroidVeilRecordSealer(keyAlias)
    val directory = File(context.noBackupFilesDir, "veil-v2")
    check(directory.isDirectory || directory.mkdirs()) { "VEIL_STORAGE_UNAVAILABLE" }
    val digest = MessageDigest.getInstance("SHA-256").digest(owner.toByteArray(Charsets.UTF_8))
    val name = digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    helper = object : SQLiteOpenHelper(context.applicationContext, File(directory, "$name.sqlite").absolutePath, null, 1) {
      override fun onConfigure(db: SQLiteDatabase) {
        db.execSQL("PRAGMA synchronous=FULL")
      }
      override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, sealed BLOB NOT NULL, PRIMARY KEY(kind,id))")
      }
      override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        error("VEIL_STORAGE_MIGRATION_REQUIRED")
      }
    }
  }

  /** JNI store callbacks must stay on this thread; suspend/network work is forbidden. */
  fun <T> transaction(block: (VeilNativeTransaction) -> T): T = synchronized(lock) {
    check(!closed) { "VEIL_STORAGE_CLOSED" }
    authorize(owner)
    val db = helper.writableDatabase
    check(!db.inTransaction()) { "VEIL_NESTED_TRANSACTION_REJECTED" }
    db.beginTransaction()
    val tx = VeilNativeTransaction(db, owner, sealer) { authorize(owner) }
    try {
      val result = block(tx)
      tx.checkLive()
      // Authority remains required after native crypto and immediately before commit.
      db.setTransactionSuccessful()
      result
    } finally {
      tx.finish()
      db.endTransaction()
    }
  }

  override fun close() = synchronized(lock) {
    if (!closed) {
      closed = true
      helper.close()
    }
  }
}

internal enum class VeilRecordKind {
  SESSION, IDENTITY_PIN, PREKEY, SIGNED_PREKEY, KEM_PREKEY, USED_KEM, OUTBOX, INBOX_RECEIPT,
}

internal class VeilNativeTransaction(
  private val db: SQLiteDatabase,
  private val owner: String,
  private val sealer: VeilRecordSealer,
  private val authorize: () -> Unit,
) {
  private val thread = Thread.currentThread()
  private var live = true

  internal fun checkLive() {
    check(live && Thread.currentThread() === thread && db.inTransaction()) { "VEIL_TRANSACTION_INACTIVE" }
    authorize()
  }
  internal fun finish() { live = false }

  fun read(kind: VeilRecordKind, id: String): ByteArray? {
    checkLive()
    requireIdentifier(id, 1024)
    val sealed = db.query("records", arrayOf("sealed"), "kind=? AND id=?", arrayOf(kind.name, id), null, null, null).use {
      if (it.moveToFirst()) it.getBlob(0) else null
    } ?: return null
    val clear = sealer.open(sealed, recordAAD(owner, kind, id))
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
    val sealed = sealer.seal(bytes, recordAAD(owner, kind, id))
    checkLive()
    val values = ContentValues().apply {
      put("kind", kind.name)
      put("id", id)
      put("sealed", sealed)
    }
    check(db.insertWithOnConflict("records", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L) { "VEIL_STORAGE_WRITE_FAILED" }
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

private fun recordAAD(owner: String, kind: VeilRecordKind, id: String): ByteArray {
  // Unambiguous local storage framing, not a new protocol/KDF/wire format.
  val output = ByteArrayOutputStream()
  DataOutputStream(output).use { stream ->
    for (value in listOf("ynx-social-veil-native-store-v1", owner, kind.name, id)) {
      val bytes = value.toByteArray(Charsets.UTF_8)
      stream.writeInt(bytes.size)
      stream.write(bytes)
    }
  }
  return output.toByteArray()
}
