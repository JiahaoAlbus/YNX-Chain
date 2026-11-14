package com.ynx.social.matrix

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import org.matrix.rustcomponents.sdk.ClientSessionDelegate
import org.matrix.rustcomponents.sdk.Session
import org.matrix.rustcomponents.sdk.SlidingSyncVersion
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Tokens and the SDK store passphrase are sealed with AndroidKeyStore. Nothing
// here touches the old Social keys, outbox or custom-envelope database.
class MatrixVault(context: Context, val account: String, val hs: String, val mxid: String, val device: String) : ClientSessionDelegate {
  val namespace: String = MessageDigest.getInstance("SHA-256")
    .digest(JSONObject().put("account", account).put("hs", hs).put("mxid", mxid).put("device", device).toString().toByteArray())
    .joinToString("") { "%02x".format(it) }
  val root = File(context.noBackupFilesDir, "matrix-rust-v1/$namespace")
  val staging = File(context.cacheDir, "matrix-staging/$namespace")
  @Volatile var persistenceFailed = false
    private set
  private val alias = "ynx.social.matrix.$namespace"

  private fun key(create: Boolean): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = store.getKey(alias, null)
    if (existing != null) return existing as SecretKey
    check(create && !root.exists()) { "MATRIX_NATIVE_KEY_MISSING_PRESERVE_STORE" }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }

  private fun read(name: String): JSONObject? {
    val file = File(root, name)
    if (!file.exists() && !File(root, name + ".bak").exists()) return null
    val sealed = JSONObject(AtomicFile(file).openRead().bufferedReader().use { it.readText() })
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, Base64.decode(sealed.getString("iv"), Base64.NO_WRAP)))
    cipher.updateAAD((namespace + ":" + name).toByteArray())
    return JSONObject(String(cipher.doFinal(Base64.decode(sealed.getString("data"), Base64.NO_WRAP)), Charsets.UTF_8))
  }

  private fun write(name: String, value: JSONObject, secret: SecretKey = key(false)) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secret)
    cipher.updateAAD((namespace + ":" + name).toByteArray())
    val data = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put("data", Base64.encodeToString(cipher.doFinal(value.toString().toByteArray()), Base64.NO_WRAP)).toString().toByteArray()
    check(root.isDirectory || root.mkdirs()) { "MATRIX_STORE_DIRECTORY_FAILED" }
    val file = AtomicFile(File(root, name))
    val stream = file.startWrite()
    try { stream.write(data); file.finishWrite(stream) } catch (error: Throwable) { file.failWrite(stream); throw error }
  }

  @Synchronized fun passphrase(): String {
    read("store-key.sealed")?.let { return it.getString("value") }
    check(!root.exists()) { "MATRIX_NATIVE_KEY_MISSING_PRESERVE_STORE" }
    val secret = key(true)
    val value = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.NO_WRAP)
    write("store-key.sealed", JSONObject().put("value", value), secret)
    return value
  }

  // Native A-owned auth integration calls this after actual HS/MXID/device
  // verification. It is intentionally NOT an Expo/JS bearer-token setter.
  @Synchronized fun installOriginalSession(session: Session) {
    require(session.userId == mxid && session.deviceId == device && session.homeserverUrl.trimEnd('/') == hs.trimEnd('/'))
    requireOriginalCryptoStore()
    passphrase()
    write("session.sealed", JSONObject().put("accessToken", session.accessToken)
      .put("refreshToken", session.refreshToken ?: JSONObject.NULL).put("userId", session.userId)
      .put("deviceId", session.deviceId).put("homeserverUrl", session.homeserverUrl)
      .put("oauthData", session.oauthData ?: JSONObject.NULL)
      .put("nativeSync", session.slidingSyncVersion == SlidingSyncVersion.NATIVE))
  }

  @Synchronized override fun retrieveSessionFromKeychain(userId: String): Session {
    check(userId == mxid) { "MATRIX_IDENTITY_MISMATCH" }
    requireOriginalCryptoStore()
    val data = read("session.sealed") ?: error("MATRIX_NATIVE_CANONICAL_ENROLLMENT_REQUIRED")
    check(data.getString("userId") == mxid && data.getString("deviceId") == device
      && data.getString("homeserverUrl").trimEnd('/') == hs.trimEnd('/')) { "MATRIX_IDENTITY_MISMATCH" }
    fun optional(key: String) = if (data.isNull(key)) null else data.getString(key)
    return Session(data.getString("accessToken"), optional("refreshToken"), mxid, device,
      data.getString("homeserverUrl"), optional("oauthData"),
      if (data.getBoolean("nativeSync")) SlidingSyncVersion.NATIVE else SlidingSyncVersion.NONE)
  }

  override fun saveSessionInKeychain(session: Session) {
    try { installOriginalSession(session) } catch (_: Throwable) { persistenceFailed = true }
  }

  private fun requireOriginalCryptoStore() {
    // Exact filename/schema from both admitted matrix-sdk-sqlite revisions.
    // OPEN_READONLY never creates a replacement database. The official SDK
    // subsequently unpickles with the original passphrase and checks its store.
    val file = File(root, "data/matrix-sdk-crypto.sqlite3")
    check(file.isFile && file.length() > 0) { "MATRIX_ORIGINAL_CRYPTO_STORE_REQUIRED" }
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      db.rawQuery("SELECT length(value) FROM kv WHERE key = ?", arrayOf("account")).use { cursor ->
        check(cursor.moveToFirst() && cursor.getLong(0) > 0) { "MATRIX_ORIGINAL_CRYPTO_ACCOUNT_REQUIRED" }
      }
    }
  }

  @Synchronized fun reserve(intent: String, room: String, kind: String, body: String) {
    require(Regex("native-matrix-[a-f0-9]{32}").matches(intent))
    val journal = read("send-journal.sealed") ?: JSONObject()
    check(!journal.has(intent)) { "MATRIX_ORIGINAL_SEND_NEEDS_RECONCILIATION" }
    journal.put(intent, JSONObject().put("roomId", room).put("kind", kind).put("body", body).put("state", "unknown"))
    write("send-journal.sealed", journal)
  }

  @Synchronized fun correlate(intent: String, transaction: String) {
    val journal = read("send-journal.sealed") ?: error("MATRIX_ORIGINAL_INTENT_MISSING")
    val entry = journal.getJSONObject(intent)
    check(!entry.has("transactionId") || entry.getString("transactionId") == transaction) { "MATRIX_QUEUE_CORRELATION_CONFLICT" }
    entry.put("transactionId", transaction).put("state", "queued")
    write("send-journal.sealed", journal)
  }

  @Synchronized fun receipt(room: String, transaction: String, event: String): String? {
    val journal = read("send-journal.sealed") ?: return null
    val id = journal.keys().asSequence().firstOrNull {
      val item = journal.getJSONObject(it)
      item.getString("roomId") == room && item.optString("transactionId") == transaction
    } ?: return null
    journal.getJSONObject(id).put("eventId", event).put("state", "sdk-sent-needs-readback")
    write("send-journal.sealed", journal)
    return id
  }

  @Synchronized fun pending(room: String): List<Map<String, Any?>> {
    val journal = read("send-journal.sealed") ?: return emptyList()
    return journal.keys().asSequence().sorted().mapNotNull { id ->
      val entry = journal.getJSONObject(id)
      if (entry.getString("roomId") != room) null else mapOf("intentId" to id, "roomId" to room,
        "kind" to entry.getString("kind"), "body" to if (entry.getString("kind") == "text") entry.getString("body") else null,
        "state" to entry.getString("state"), "eventId" to if (entry.has("eventId")) entry.getString("eventId") else null)
    }.toList()
  }

  // Only an own, SDK-decoded event carrying the original encrypted nonce may
  // identify this entry. SDK callbacks alone cannot identify an original send.
  @Synchronized fun observeOriginal(intent: String, room: String, kind: String, body: String?, event: String): Boolean {
    val journal = read("send-journal.sealed") ?: return false
    if (!journal.has(intent)) return false
    val entry = journal.getJSONObject(intent)
    check(entry.getString("roomId") == room && entry.getString("kind") == kind
      && (kind != "text" || entry.getString("body") == body)
      && (!entry.has("eventId") || entry.getString("eventId") == event)) { "MATRIX_ORIGINAL_EVENT_CONFLICT" }
    entry.put("eventId", event).put("state", "sdk-observed-needs-authenticated-readback")
    write("send-journal.sealed", journal)
    return true // Not a fresh server readback, audience receipt, or settlement.
  }
}
