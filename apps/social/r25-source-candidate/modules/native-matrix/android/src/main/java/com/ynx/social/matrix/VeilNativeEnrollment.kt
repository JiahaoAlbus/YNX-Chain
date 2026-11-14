package com.ynx.social.matrix

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.content.Context
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.OverlappingFileLockException
import java.security.MessageDigest
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKeyFactory

/**
 * Explicit native storage-key enrollment candidate, not account/device approval.
 * No production factory, default policy, UI/JS export or implicit missing-key repair.
 * The caller must provide a separately reviewed policy and an admitted device lease.
 * Android authentication and actual hardware policy remain separate acceptance gates.
 */
internal object VeilNativeEnrollment {
  @JvmStatic
  fun validatePolicy(binding: VeilDeviceBinding, policy: KeyGenParameterSpec) {
    require(policy.keystoreAlias == binding.keyAlias) { "VEIL_ENROLLMENT_BINDING_MISMATCH" }
    require(policy.keySize == 256 && policy.isUserAuthenticationRequired &&
      policy.isRandomizedEncryptionRequired &&
      policy.purposes == (KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT) &&
      policy.blockModes.contentEquals(arrayOf(KeyProperties.BLOCK_MODE_GCM)) &&
      policy.encryptionPaddings.contentEquals(arrayOf(KeyProperties.ENCRYPTION_PADDING_NONE))) {
      "VEIL_ENROLLMENT_POLICY_REJECTED"
    }
    // This synchronous sealer cannot complete an asynchronous per-operation prompt.
    // Require a caller-reviewed finite authentication window, never auth-free keys.
    require(policy.userAuthenticationValidityDurationSeconds in 1..120) {
      "VEIL_ENROLLMENT_AUTH_WINDOW_REJECTED"
    }
  }

  fun enroll(context: Context, authority: VeilNativeAuthority, lease: VeilNativeLease, policy: KeyGenParameterSpec) {
    validatePolicy(lease.binding, policy)
    authority.withLease(lease) { scope ->
      scope.checkLive()
      check(context.applicationInfo.uid == android.os.Process.myUid() &&
        context.packageName in setOf("com.ynx.social", "com.ynx.social.veilqa")) {
        "VEIL_ENROLLMENT_CONTEXT_REJECTED"
      }
      withAliasLock(context, lease.binding.keyAlias) {
      scope.checkLive()
      val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      check(!store.containsAlias(lease.binding.keyAlias)) { "VEIL_SOCIAL_KEY_ALREADY_ENROLLED" }
      val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      generator.init(policy)
      scope.checkLive()
      var creationAttempted = false
      try {
        scope.commit {
          scope.checkLive()
          creationAttempted = true
          val key = generator.generateKey()
          val info = SecretKeyFactory.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .getKeySpec(key, KeyInfo::class.java) as KeyInfo
          check(info.keystoreAlias == lease.binding.keyAlias && info.keySize == 256 &&
            info.isUserAuthenticationRequired &&
            info.userAuthenticationValidityDurationSeconds == policy.userAuthenticationValidityDurationSeconds) {
            "VEIL_ENROLLMENT_GENERATED_POLICY_REJECTED"
          }
          scope.checkLive()
          // Opaque key stays in Keystore. No raw key or authentication receipt leaves.
        }
      } catch (failure: Throwable) {
        // Key generation is not a SQLite effect: an unknown result needs reconciliation.
        // Never delete, overwrite, regenerate or declare enrollment complete on failure.
        if (creationAttempted) throw IllegalStateException("VEIL_ENROLLMENT_RECOVERY_REQUIRED", failure)
        throw failure
      }
      }
    }
  }

  private fun <T> withAliasLock(context: Context, alias: String, action: () -> T): T {
    val directory = File(context.noBackupFilesDir, "veil-v2-enrollment")
    check(directory.isDirectory || directory.mkdirs()) { "VEIL_ENROLLMENT_LOCK_UNAVAILABLE" }
    val domain = "YNX/SOCIAL/KEY-ENROLLMENT/LOCK/V1\u0000$alias".toByteArray(Charsets.UTF_8)
    val name = MessageDigest.getInstance("SHA-256").digest(domain)
      .joinToString("") { "%02x".format(it.toInt() and 255) }
    // Lock identity depends on the alias, not an attacker-supplied filesystem path
    // or a different owner/device tuple trying to create the same Keystore alias.
    val file = File(directory, "$name.lock")
    return RandomAccessFile(file, "rw").use { handle ->
      check(file.setReadable(false, false) && file.setWritable(false, false) &&
        file.setReadable(true, true) && file.setWritable(true, true)) {
        "VEIL_ENROLLMENT_LOCK_PERMISSIONS_REJECTED"
      }
      val lock = try { handle.channel.tryLock() }
      catch (busy: OverlappingFileLockException) { throw IllegalStateException("VEIL_ENROLLMENT_BUSY", busy) }
      check(lock != null) { "VEIL_ENROLLMENT_BUSY" }
      lock.use { action() }
    }
  }
}
