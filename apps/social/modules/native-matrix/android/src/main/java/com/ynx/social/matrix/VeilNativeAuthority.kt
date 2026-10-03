package com.ynx.social.matrix

import java.util.IdentityHashMap
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

internal data class VeilDeviceBinding(
  val owner: String,
  val device: String,
  val socialIdentityFingerprint: String,
  val keyAlias: String,
) {
  init {
    for (value in listOf(owner, device, socialIdentityFingerprint, keyAlias)) {
      require(value.length in 1..512 && value.all { it.code in 33..126 })
    }
    require(keyAlias.startsWith("ynx.social.veil.v2.") && keyAlias.length <= 200)
  }
}

internal enum class VeilDeviceApproval { TRUSTED_DEVICE, USER_HELD_RECOVERY }

/** Only a trusted native proof verifier may return this; never accept JS/SSO metadata. */
internal data class VeilVerifiedDeviceGrant(
  val binding: VeilDeviceBinding,
  val revocationGeneration: Long,
  val expiresAtElapsedMillis: Long,
  val approval: VeilDeviceApproval,
)

/**
 * Provider must cryptographically bind the complete tuple, approval and current
 * revocation state using the admitted native protocol. No production provider
 * is supplied by this component; absence is a hard hold, not a metadata bypass.
 */
internal fun interface VeilDeviceGrantVerifier {
  fun verify(publicProof: ByteArray, expected: VeilDeviceBinding, minimumGeneration: Long): VeilVerifiedDeviceGrant
}

internal class VeilNativeLease private constructor(internal val binding: VeilDeviceBinding) {
  internal companion object {
    fun issue(binding: VeilDeviceBinding) = VeilNativeLease(binding)
  }
}

internal class VeilNativeAuthority(
  private val binding: VeilDeviceBinding,
  private val verifier: VeilDeviceGrantVerifier,
  private val elapsedMillis: () -> Long,
) {
  private val lock = ReentrantLock(true)
  private val leases = IdentityHashMap<VeilNativeLease, VeilVerifiedDeviceGrant>()
  private var revokedThrough = -1L
  private var highestGeneration = -1L
  private var activeScopes = 0
  private var lastElapsed = -1L

  private fun monotonicNow(): Long {
    val now = elapsedMillis()
    check(now >= 0 && now >= lastElapsed) { "VEIL_MONOTONIC_CLOCK_ROLLBACK" }
    lastElapsed = now
    return now
  }

  fun admit(publicProof: ByteArray): VeilNativeLease = lock.withLock {
    check(activeScopes == 0) { "VEIL_REENTRANT_ADMISSION_REJECTED" }
    require(publicProof.size in 1..32768)
    val copy = publicProof.copyOf()
    val grant = try {
      verifier.verify(copy, binding, Math.addExact(revokedThrough, 1L))
    } finally { copy.fill(0) }
    require(grant.binding == binding) { "VEIL_DEVICE_BINDING_MISMATCH" }
    require(grant.revocationGeneration >= 0 && grant.revocationGeneration > revokedThrough)
    require(grant.revocationGeneration >= highestGeneration) { "VEIL_GENERATION_ROLLBACK" }
    val now = monotonicNow()
    require(now >= 0 && grant.expiresAtElapsedMillis > now && grant.expiresAtElapsedMillis - now <= 120000)
    // A newer verified revocation generation invalidates all older leases.
    if (grant.revocationGeneration > highestGeneration) leases.clear()
    highestGeneration = grant.revocationGeneration
    VeilNativeLease.issue(binding).also { leases[it] = grant }
  }

  /** Completion of revoke is ordered against the entire protected synchronous effect. */
  fun revoke() = lock.withLock {
    check(activeScopes == 0) { "VEIL_REENTRANT_REVOCATION_REJECTED" }
    revokedThrough = maxOf(revokedThrough, highestGeneration)
    leases.clear()
  }

  fun <T> withLease(lease: VeilNativeLease, action: (VeilLeaseScope) -> T): T = lock.withLock {
    check(activeScopes == 0) { "VEIL_NESTED_AUTHORITY_SCOPE_REJECTED" }
    val grant = leases[lease] ?: error("VEIL_LEASE_REVOKED_OR_FOREIGN")
    val thread = Thread.currentThread()
    val scope = VeilLeaseScope {
      check(lock.isHeldByCurrentThread && Thread.currentThread() === thread)
      check(leases[lease] === grant && grant.binding == binding)
      check(grant.revocationGeneration == highestGeneration && grant.revocationGeneration > revokedThrough)
      check(monotonicNow() < grant.expiresAtElapsedMillis) { "VEIL_LEASE_EXPIRED" }
    }
    scope.checkLive()
    activeScopes++
    try { action(scope) }
    finally {
      scope.finish()
      activeScopes--
    }
  }
}

internal class VeilLeaseScope(private val guard: () -> Unit) {
  private var live = true
  private var committed = false
  private var committing = false
  fun checkLive() {
    check(live && !committed) { "VEIL_LEASE_SCOPE_INACTIVE" }
    guard()
  }
  /** Same authority exclusion is held through the actual platform commit call. */
  fun <T> commit(effect: () -> T): T {
    check(!committing) { "VEIL_REENTRANT_COMMIT_REJECTED" }
    checkLive()
    committing = true
    try { return effect().also { committed = true } }
    finally { committing = false }
  }
  internal fun finish() { live = false }
}

internal data class VeilStorageCheckpoint(val revision: Long, val ciphertextStateSha256: String) {
  init {
    require(revision >= 0)
    require(ciphertextStateSha256.length == 64 && ciphertextStateSha256.all { it in '0'..'9' || it in 'a'..'f' })
  }
}

/**
 * Must be authenticated, durable, monotonic and outside this SQLite database.
 * Android Keystore alone is NOT assumed to provide a monotonic rollback counter.
 * No production implementation or automatic genesis/reset is provided here.
 */
internal interface VeilCheckpointProtector {
  fun load(binding: VeilDeviceBinding): VeilStorageCheckpoint?
  fun advance(binding: VeilDeviceBinding, expected: VeilStorageCheckpoint, next: VeilStorageCheckpoint)
}

internal object VeilRecordBudget {
  const val MAX_RECORD_BYTES = 8 * 1024 * 1024
  const val MAX_SEALED_BYTES = MAX_RECORD_BYTES + 28
  fun validate(rows: Long, totalBytes: Long, maxBlobBytes: Long, maxKindChars: Long, maxIdChars: Long, invalidTypes: Long) {
    require(rows in 0..4096 && totalBytes in 0..(64L * 1024 * 1024))
    require(maxBlobBytes in 0..MAX_SEALED_BYTES.toLong() && invalidTypes == 0L)
    require(maxKindChars in 0..32 && maxIdChars in 0..1024)
  }
}
