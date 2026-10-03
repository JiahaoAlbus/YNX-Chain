package com.ynx.social.matrix

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

// Synthetic native contract fixtures. NOT cryptographic admission/device evidence.
private fun rejected(action: () -> Unit) {
  var rejected = false
  try { action() } catch (_: IllegalArgumentException) { rejected = true }
  catch (_: IllegalStateException) { rejected = true }
  check(rejected)
}

fun main() {
  var count = 0
  fun test(name: String, action: () -> Unit) {
    action()
    count++
    println("PASS $name")
  }
  try {
    val binding = VeilDeviceBinding("qa-owner", "qa-device", "qa-social-fingerprint", "ynx.social.veil.v2.qa-key")
    var now = 1000L
    var generation = 0L
    val verifier = VeilDeviceGrantVerifier { proof, expected, minimum ->
      check(proof.contentEquals(byteArrayOf(1, 2, 3)))
      check(generation >= minimum)
      VeilVerifiedDeviceGrant(expected, generation, 60000L, VeilDeviceApproval.TRUSTED_DEVICE)
    }
    val authority = VeilNativeAuthority(binding, verifier) { now }
    val lease = authority.admit(byteArrayOf(1, 2, 3))
    test("foreign or fabricated lease cannot enter protected native scope") {
      rejected { authority.withLease(VeilNativeLease.issue(binding)) { error("must not enter") } }
      val foreign = VeilNativeAuthority(binding, verifier) { now }
      rejected { foreign.withLease(lease) { error("must not enter") } }
    }
    test("escaped scope and duplicate commit reject before a second effect") {
      var escaped: VeilLeaseScope? = null
      var effects = 0
      authority.withLease(lease) { scope ->
        escaped = scope
        scope.commit { effects++ }
        rejected { scope.commit { effects++ } }
      }
      rejected { escaped!!.checkLive() }
      check(effects == 1)
    }
    test("cross-thread scope use rejects without native effect") {
      val error = AtomicReference<Throwable?>()
      authority.withLease(lease) { scope ->
        val worker = thread { try { scope.checkLive() } catch (caught: Throwable) { error.set(caught) } }
        worker.join(3000)
        check(!worker.isAlive && error.get() is IllegalStateException)
      }
    }
    test("nested commit callback cannot execute a second protected effect") {
      var effects = 0
      authority.withLease(lease) { scope ->
        scope.commit {
          rejected { scope.commit { effects++ } }
          effects++
        }
      }
      check(effects == 1)
    }
    test("reentrant admission or revocation cannot mutate an active effect lease") {
      authority.withLease(lease) {
        rejected { authority.revoke() }
        rejected { authority.admit(byteArrayOf(1, 2, 3)) }
      }
    }
    test("revoke completion is ordered after protected commit and blocks later effects") {
      val entered = CountDownLatch(1)
      val release = CountDownLatch(1)
      val revokeStarted = CountDownLatch(1)
      val revokeReturned = CountDownLatch(1)
      val errors = AtomicReference<Throwable?>()
      val effects = AtomicInteger()
      val writer = thread {
        try {
          authority.withLease(lease) { scope ->
            entered.countDown()
            check(release.await(3, TimeUnit.SECONDS))
            scope.commit { check(revokeReturned.count == 1L); effects.incrementAndGet() }
          }
        } catch (error: Throwable) { errors.set(error) }
      }
      check(entered.await(3, TimeUnit.SECONDS))
      val revoker = thread {
        try { revokeStarted.countDown(); authority.revoke(); revokeReturned.countDown() }
        catch (error: Throwable) { errors.set(error) }
      }
      check(revokeStarted.await(3, TimeUnit.SECONDS))
      check(revokeReturned.count == 1L)
      release.countDown()
      writer.join(3000); revoker.join(3000)
      check(!writer.isAlive && !revoker.isAlive && errors.get() == null && revokeReturned.count == 0L)
      rejected { authority.withLease(lease) { effects.incrementAndGet() } }
      check(effects.get() == 1)
    }
    test("revoked generation cannot be re-admitted from stale approval fixture") {
      rejected { authority.admit(byteArrayOf(1, 2, 3)) }
      generation = 1
      val next = authority.admit(byteArrayOf(1, 2, 3))
      authority.withLease(next) { it.checkLive() }
    }
    test("verified binding mismatch rejects before a native lease is issued") {
      val wrong = VeilNativeAuthority(binding, VeilDeviceGrantVerifier { _, _, _ ->
        VeilVerifiedDeviceGrant(binding.copy(device = "wrong-device"), 2, 60000, VeilDeviceApproval.USER_HELD_RECOVERY)
      }) { now }
      rejected { wrong.admit(byteArrayOf(1)) }
    }
    test("expiry during work prevents the final commit effect") {
      val live = authority.admit(byteArrayOf(1, 2, 3))
      var effects = 0
      authority.withLease(live) { scope ->
        now = 60000
        rejected { scope.commit { effects++ } }
      }
      check(effects == 0)
    }
    test("monotonic clock rollback cannot revive an expired native lease") {
      now = 1000
      rejected { authority.admit(byteArrayOf(1, 2, 3)) }
    }
    test("record budget admits bounded metadata without reading payloads") {
      VeilRecordBudget.validate(1, 29, 29, 7, 12, 0)
      VeilRecordBudget.validate(0, 0, 0, 0, 0, 0)
    }
    test("oversized single blob and aggregate allocation reject from metadata") {
      rejected { VeilRecordBudget.validate(1, 9000000, 9000000, 7, 12, 0) }
      rejected { VeilRecordBudget.validate(64, 64L * 1024 * 1024 + 1, 1000, 7, 12, 0) }
    }
    test("row count, identifier, negative lengths and non-blob types reject") {
      rejected { VeilRecordBudget.validate(4097, 1000, 29, 7, 12, 0) }
      rejected { VeilRecordBudget.validate(1, 29, 29, 33, 12, 0) }
      rejected { VeilRecordBudget.validate(1, 29, 29, 7, 1025, 0) }
      rejected { VeilRecordBudget.validate(1, -1, 29, 7, 12, 0) }
      rejected { VeilRecordBudget.validate(1, 29, 29, 7, 12, 1) }
    }
    println("PASS $count native lease/budget contract checks; synthetic verifier only")
  } catch (error: Throwable) {
    System.err.println("FAIL ${error.javaClass.simpleName}")
    kotlin.system.exitProcess(1)
  }
}
