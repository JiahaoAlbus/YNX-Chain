package com.ynx.social.matrix

/** Private owning adapter, NOT JNI admission and NOT a source/anchor issuer.
 * Created only after the original authority checks its actual issued lease.
 * Exclusion spans the entire synchronous native effect. No network/await.
 * Immutable source/intent pin is separately owned by the actual native supplier;
 * releasing this lock never releases that pin. Cleanup does not issue a lease.
 */
internal interface VeilProducerLeaseAccess {
  fun checkFresh()
  fun borrowGrant(block: (VeilVerifiedDeviceGrant) -> Unit)
  fun release()
}

internal class VeilNativeProducerAuthority private constructor(
  authority: VeilNativeAuthority,
  lease: VeilNativeLease,
) : AutoCloseable {
  private val access = authority.openProducerLease(lease)
  private val thread = Thread.currentThread()
  private var live = true
  private var cleanupOnly = false
  private var effectAttempted = false
  private var active = false
  private var grantBorrowDepth = 0
  private var unresolved = false

  private fun checkOwner() {
    check(Thread.currentThread() === thread && live) { "VEIL_PRODUCER_SOURCE_OWNER_INACTIVE" }
  }

  /** Only internal provider projection of the actual verifier result. The result
   * is not a C capability or authority for source/restore/CAS; genuine supplier
   * still must establish those associations and enrolled independent anchor.
   * Unit prevents a generic returned permission. Nested projection is rejected;
   * separate borrow depth preserves an enclosing effect's active state. */
  fun borrowVerifiedGrant(block: (VeilVerifiedDeviceGrant) -> Unit) {
    checkOwner(); check(!cleanupOnly)
    check(grantBorrowDepth == 0) { "VEIL_PRODUCER_GRANT_BORROW_REENTRY" }
    grantBorrowDepth++
    try { access.borrowGrant(block) } finally { grantBorrowDepth-- }
  }

  fun <T> effectOnce(effect: () -> T): T {
    checkOwner(); check(!cleanupOnly && !effectAttempted && !active && grantBorrowDepth == 0)
    access.checkFresh(); effectAttempted = true; active = true
    try { return effect() } catch (primary: Throwable) {
      cleanupOnly = true
      unresolved = true
      throw primary
    } finally { active = false }
  }

  /** Rollback/denial only. This intentionally does NOT check grant expiry or
   * create another effect permission. Caller must keep this same owner on any
   * cleanup failure; no close/transfer to another thread or fresh send. */
  fun <T> cleanup(cleanup: () -> T): T {
    checkOwner(); check(!active && grantBorrowDepth == 0); cleanupOnly = true; active = true
    unresolved = true
    try { return cleanup().also { unresolved = false } } finally { active = false }
  }

  /** Original owner must remain held by the engine when cleanupFailure != null.
   * This is error composition, NOT cancel/recovery or durable fence admission.
   * Never drop the owner merely because the primary is returned unchanged. */
  internal data class CleanupOutcome(val primary: Throwable, val cleanupFailure: Throwable?)

  internal fun cleanupAfterFailure(primary: Throwable, cleanup: () -> Unit): CleanupOutcome {
    val incomingInterrupt = Thread.currentThread().isInterrupted
    var secondary: Throwable? = null
    try { this.cleanup(cleanup) } catch (failure: Throwable) { secondary = failure }
    finally {
      if (incomingInterrupt || secondary is InterruptedException) Thread.currentThread().interrupt()
    }
    return recordCleanupFailure(primary, secondary)
  }

  override fun close() {
    checkOwner(); check(!active && !unresolved && grantBorrowDepth == 0) { "VEIL_PRODUCER_SOURCE_EFFECT_ACTIVE_OR_UNRESOLVED" }
    // Native adapter must admit release only after actual SQLite autocommit and
    // durable UNKNOWN registration. This object itself makes NO such assertion.
    access.release(); live = false
  }

  internal companion object {
    /** Public exception mechanics are independently testable without a grant. */
    internal fun recordCleanupFailure(primary: Throwable, secondary: Throwable?): CleanupOutcome {
      if (secondary != null && secondary !== primary) {
        try {
          if (primary.suppressed.none { it === secondary }) primary.addSuppressed(secondary)
        } catch (_: Throwable) { /* Outcome retains secondary even if suppression cannot allocate. */ }
      }
      return CleanupOutcome(primary, secondary)
    }
    /** Not a factory for grants: called only inside original locked authority. */
    internal fun retainActual(
      authority: VeilNativeAuthority,
      lease: VeilNativeLease,
    ) = VeilNativeProducerAuthority(authority, lease)
  }
}
