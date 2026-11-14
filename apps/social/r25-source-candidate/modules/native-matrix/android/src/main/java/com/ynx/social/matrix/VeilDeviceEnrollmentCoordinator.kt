package com.ynx.social.matrix

import android.os.SystemClock
import android.content.Context
import java.io.ByteArrayInputStream
import java.io.DataInputStream
import java.util.IdentityHashMap

/** Product-owned local enrollment coordination, NOT device authorization.
 * An intent, SSO, string pin, request bytes or queue state cannot issue a lease.
 * Existing VeilVerifiedDeviceGrant lacks a genuine source/store/restore owner
 * port here. Approval therefore fails closed, without invoking a fake verifier,
 * issuing a challenge, consuming a cryptographic approval or enrolling a key.
 */
internal class VeilDeviceEnrollmentCoordinator(
    private val elapsedMillis: () -> Long = { SystemClock.elapsedRealtime() },
    private val pendingStore: VeilDeviceEnrollmentPendingStore? = null,
) : AutoCloseable {
    internal data class Association(
        val device: VeilDeviceBinding,
        val sourceIdentity: String,
        val storeIdentity: String,
        val restoreIdentity: String,
        val minimumGeneration: Long,
    ) {
        init {
            for (value in listOf(sourceIdentity, storeIdentity, restoreIdentity)) {
                require(value.length in 1..512 && value.all { it.code in 33..126 })
            }
            require(minimumGeneration >= 0)
        }
    }
    internal enum class Phase {
        PENDING, CHALLENGE_STAGED_UNTRUSTED, APPROVAL_STAGED_UNTRUSTED,
        REJECTED, EXPIRED, REVOKED, RECOVERY_REQUIRED, UNAVAILABLE,
    }
    internal enum class Reason {
        LOCAL_INTENT_ONLY, PUBLIC_CHALLENGE_ONLY, PUBLIC_PROOF_ONLY,
        USER_REJECTED, LOCAL_REVOCATION, DEADLINE,
        INTERRUPTED_OR_UNKNOWN, INVALID_REQUEST, INVALID_PROOF,
        GENUINE_SOURCE_STORE_RESTORE_GRANT_CONTEXT_REQUIRED,
    }
    internal enum class Decision { PENDING, TERMINAL, UNKNOWN_OR_CONSUMED, CAPACITY }
    // Ticket identity is matched against the original identity map. Its number
    // is not an authority/capability and constructing another ticket cannot join.
    internal class Ticket internal constructor(val sequence: Long)
    internal data class Snapshot(
        val schemaVersion: Int,
        val sequence: Long,
        val association: Association,
        val intendedApproval: VeilDeviceApproval,
        val phase: Phase,
        val reason: Reason,
        val createdAtElapsedMillis: Long,
        val expiresAtElapsedMillis: Long,
    )
    internal data class Outcome(val decision: Decision, val snapshot: Snapshot? = null)
    private class Pending(
        val ticket: Ticket, val association: Association,
        val approval: VeilDeviceApproval, val created: Long, val expires: Long,
    ) {
        var phase = Phase.PENDING
        var reason = Reason.LOCAL_INTENT_ONLY
        var request: ByteArray? = null
        var proof: ByteArray? = null
        fun wipePublicCopies() { request?.fill(0); proof?.fill(0); request = null; proof = null }
    }
    private val thread = Thread.currentThread()
    private val records = IdentityHashMap<Ticket, Pending>()
    private var nextSequence = pendingStore?.nextSequence() ?: 1L
    private var lastElapsed = -1L
    private var closed = false
    private var dirty = false
    private var storageUnknown = false
    private var recoveryBorrowed = false
    private val localGenesisProducer = VeilLocalGenesisProducer(pendingStore)

    private fun localGenesisImage(): List<VeilDeviceEnrollmentPendingStore.Entry> {
        owner(); persistIfDirty()
        check(!storageUnknown) { "LOCAL_INTENT_STORAGE_UNKNOWN" }
        check(records.values.none { !terminal(it.phase) }) { "LOCAL_INTENT_ENROLLMENT_PENDING" }
        return records.values.sortedBy { it.ticket.sequence }.map {
            VeilDeviceEnrollmentPendingStore.Entry(snapshot(it), it.request, it.proof)
        }
    }
    /** Internal product slot only, NEVER UI account/device authorization. */
    fun prepareLocalGenesis(slot: String): VeilLocalGenesisProducer.Original =
        localGenesisProducer.prepare(slot, nextSequence, localGenesisImage())
    /** Only an unsubmitted local setup with no enrollment records may resume.
     * This does not restore an old Ticket, Native operation or device approval. */
    fun resumePreparedLocalGenesis(slot: String): VeilLocalGenesisProducer.Original {
        owner(); check(records.isEmpty() && !dirty && !storageUnknown)
        localGenesisImage()
        return localGenesisProducer.resumePrepared(slot)
    }
    fun getOriginalLocalGenesis(slot: String): VeilLocalGenesisProducer.Original? {
        localGenesisImage(); return localGenesisProducer.getOriginal(slot)
    }
    fun revalidateLocalGenesis(original: VeilLocalGenesisProducer.Original) {
        localGenesisImage(); localGenesisProducer.revalidate(original)
    }
    /** Must follow normal system authentication, but does NOT accept a Boolean
     * claiming authentication. Actual provider policy still enforces it. */
    fun markLocalGenesisBeforeSubmission(original: VeilLocalGenesisProducer.Original): VeilLocalGenesisInput {
        val rows = localGenesisImage()
        return localGenesisProducer.markBeforeSubmission(original, nextSequence, rows)
    }
    fun localGenesisStatus(): VeilLocalGenesisProducer.Snapshot {
        owner(); return localGenesisProducer.observe()
    }
    /** Private synchronous Main journal callback. Unit ONLY after durable write;
     * public native IDs are association, never trust or a restored Original. */
    fun bindLocalGenesisNativeIds(original: VeilLocalGenesisProducer.Original, ids: ByteArray) {
        val rows = localGenesisImage()
        localGenesisProducer.bindNativeIds(original, ids, nextSequence, rows)
    }

    private fun owner() {
        check(Thread.currentThread() === thread) { "VEIL_ENROLLMENT_COORDINATOR_WRONG_THREAD" }
        check(!closed) { "VEIL_ENROLLMENT_COORDINATOR_CLOSED" }
        check(!recoveryBorrowed) { "VEIL_ENROLLMENT_COORDINATOR_RECOVERY_BORROW_ACTIVE" }
    }
    private fun terminal(phase: Phase) = phase == Phase.REJECTED || phase == Phase.EXPIRED ||
        phase == Phase.REVOKED || phase == Phase.RECOVERY_REQUIRED || phase == Phase.UNAVAILABLE
    private fun finish(p: Pending, phase: Phase, reason: Reason) {
        p.phase = phase; p.reason = reason; p.wipePublicCopies()
        dirty = true
    }
    private fun persistIfDirty() {
        if (!dirty) return
        val store = pendingStore
        if (store == null) { dirty = false; return }
        try {
            val image = records.values.sortedBy { it.ticket.sequence }.map {
                VeilDeviceEnrollmentPendingStore.Entry(snapshot(it), it.request, it.proof)
            }
            if (!storageUnknown && store.replace(nextSequence, image)) { dirty = false; return }
        } catch (failure: Throwable) {
            storageUnknown = true
            for (p in records.values) finish(p, Phase.RECOVERY_REQUIRED, Reason.INTERRUPTED_OR_UNKNOWN)
            dirty = false
            throw failure
        }
        storageUnknown = true
        for (p in records.values) finish(p, Phase.RECOVERY_REQUIRED, Reason.INTERRUPTED_OR_UNKNOWN)
        dirty = false // sticky UNKNOWN, no automatic write retry
    }
    private fun persistPreserving(primary: Throwable) {
        try { persistIfDirty() } catch (secondary: Throwable) {
            if (secondary !== primary) primary.addSuppressed(secondary)
        }
    }
    private fun now(): Long {
        owner()
        val value = try { elapsedMillis() } catch (failure: Throwable) {
            for (p in records.values) if (!terminal(p.phase)) {
                finish(p, Phase.RECOVERY_REQUIRED, Reason.INTERRUPTED_OR_UNKNOWN)
            }
            persistPreserving(failure); throw failure
        }
        if (value < 0 || value < lastElapsed) {
            for (p in records.values) if (!terminal(p.phase)) {
                finish(p, Phase.RECOVERY_REQUIRED, Reason.INTERRUPTED_OR_UNKNOWN)
            }
            val failure = IllegalStateException("VEIL_ENROLLMENT_COORDINATOR_CLOCK_ROLLBACK")
            persistPreserving(failure); throw failure
        }
        lastElapsed = value
        return value
    }
    private fun snapshot(p: Pending) = Snapshot(1, p.ticket.sequence, p.association,
        p.approval, p.phase, p.reason, p.created, p.expires)
    private fun outcome(p: Pending): Outcome {
        persistIfDirty()
        return Outcome(if (terminal(p.phase)) Decision.TERMINAL else Decision.PENDING, snapshot(p))
    }
    private fun expireAt(time: Long): Int {
        var count = 0
        for (p in records.values) if (!terminal(p.phase) && time >= p.expires) {
            finish(p, Phase.EXPIRED, Reason.DEADLINE); count++
        }
        return count
    }
    private fun lookup(ticket: Ticket): Pending? {
        expireAt(now()); persistIfDirty(); return records[ticket]
    }

    /** Pure local intent only. Intended role is not a verified approval. */
    fun request(association: Association, intendedApproval: VeilDeviceApproval,
                ttlMillis: Long = MAX_LIFETIME_MILLIS): Ticket? {
        val time = now(); expireAt(time)
        persistIfDirty()
        require(ttlMillis in 1..MAX_LIFETIME_MILLIS)
        if (storageUnknown || pendingStore?.status() in setOf(
                VeilDeviceEnrollmentPendingStore.Status.UNKNOWN,
                VeilDeviceEnrollmentPendingStore.Status.RECONCILIATION_REQUIRED)) return null
        if (records.size >= MAX_OWNED_RECORDS) return null
        check(nextSequence < Long.MAX_VALUE) { "VEIL_ENROLLMENT_COORDINATOR_ID_EXHAUSTED" }
        val expires = Math.addExact(time, ttlMillis)
        val ticket = Ticket(nextSequence++)
        records[ticket] = Pending(ticket, association, intendedApproval, time, expires)
        dirty = true; persistIfDirty()
        return ticket
    }
    fun inspect(ticket: Ticket): Outcome = lookup(ticket)?.let(::outcome)
        ?: Outcome(Decision.UNKNOWN_OR_CONSUMED)
    fun expire(): Int { val count = expireAt(now()); persistIfDirty(); return count }
    fun acquireColdJournalBorrow(): VeilDeviceEnrollmentPendingStore.ColdBorrow {
        owner(); check(!dirty && !storageUnknown && records.isEmpty())
        return checkNotNull(pendingStore).acquireColdBorrow()
    }
    fun retainedColdJournalBorrow(): VeilDeviceEnrollmentPendingStore.ColdBorrow? {
        owner(); return pendingStore?.retainedColdBorrow()
    }
    fun hasColdJournalBorrow(): Boolean { owner(); return pendingStore?.hasColdBorrow() == true }
    fun durableStatus(): VeilDeviceEnrollmentPendingStore.Status? { owner(); return pendingStore?.status() }
    fun withReopenedRecords(body: (List<VeilDeviceEnrollmentPendingStore.Entry>) -> Unit) {
        owner(); recoveryBorrowed = true
        try { pendingStore?.withRecoveryRecords(body) } finally { recoveryBorrowed = false }
    }

    /** Actual typed integration entry remains unavailable: Request has only a
     * copying bytes() getter, not a genuine source-bound bounded borrow. Do not
     * materialize an arbitrary Request before obtaining that missing context.
     */
    @Suppress("UNUSED_PARAMETER")
    fun stageExistingChallenge(ticket: Ticket, request: VeilSignedDeviceGrantVerifier.Request): Outcome = approve(ticket)

    /** Bounded public software candidate only, using the EXACT existing Request
     * framing. Never proves original verifier issuance or trusted provenance.
     */
    fun stagePublicChallengeCandidate(ticket: Ticket, requestBytes: ByteArray): Outcome {
        val p = lookup(ticket) ?: return Outcome(Decision.UNKNOWN_OR_CONSUMED)
        if (terminal(p.phase)) return outcome(p)
        if (p.phase != Phase.PENDING) {
            finish(p, Phase.REJECTED, Reason.INVALID_REQUEST); return outcome(p)
        }
        if (requestBytes.size !in 1..MAX_REQUEST_BYTES) {
            finish(p, Phase.REJECTED, Reason.INVALID_REQUEST); return outcome(p)
        }
        val copy = try { requestBytes.copyOf() } catch (failure: Throwable) {
            finish(p, Phase.RECOVERY_REQUIRED, Reason.INTERRUPTED_OR_UNKNOWN); persistPreserving(failure); throw failure
        }
        var retained = false
        try {
            if (!matchesExistingRequest(copy, p.association)) {
                finish(p, Phase.REJECTED, Reason.INVALID_REQUEST); return outcome(p)
            }
            p.request = copy; retained = true
            p.phase = Phase.CHALLENGE_STAGED_UNTRUSTED; p.reason = Reason.PUBLIC_CHALLENGE_ONLY
            dirty = true
            return outcome(p)
        } finally { if (!retained) copy.fill(0) }
    }
    /** Only the existing YDV2 proof size budget; NOT cryptographic verification. */
    fun stagePublicApproval(ticket: Ticket, publicProof: ByteArray): Outcome {
        val p = lookup(ticket) ?: return Outcome(Decision.UNKNOWN_OR_CONSUMED)
        if (terminal(p.phase)) return outcome(p)
        if (p.phase != Phase.CHALLENGE_STAGED_UNTRUSTED || publicProof.size !in 1..MAX_PROOF_BYTES) {
            finish(p, Phase.REJECTED, Reason.INVALID_PROOF); return outcome(p)
        }
        val copy = try { publicProof.copyOf() } catch (failure: Throwable) {
            finish(p, Phase.RECOVERY_REQUIRED, Reason.INTERRUPTED_OR_UNKNOWN); persistPreserving(failure); throw failure
        }
        p.proof = copy; p.phase = Phase.APPROVAL_STAGED_UNTRUSTED; p.reason = Reason.PUBLIC_PROOF_ONLY
        dirty = true
        return outcome(p)
    }
    /** Explicitly unavailable until original genuine owner supplies a reviewed
     * port binding source/store/restore to this SAME challenge/device/generation.
     * Never accepts VeilDeviceGrantVerifier callbacks or constructed grants.
     * No signature format, verifier parameters or native permit is changed.
     */
    fun approve(ticket: Ticket): Outcome {
        val p = lookup(ticket) ?: return Outcome(Decision.UNKNOWN_OR_CONSUMED)
        if (terminal(p.phase)) return outcome(p)
        finish(p, Phase.UNAVAILABLE, Reason.GENUINE_SOURCE_STORE_RESTORE_GRANT_CONTEXT_REQUIRED)
        return outcome(p)
    }
    fun reject(ticket: Ticket): Outcome = deny(ticket, Phase.REJECTED, Reason.USER_REJECTED)
    // LOCAL pending denial only, NOT global native-authority revocation.
    fun revokePending(ticket: Ticket): Outcome = deny(ticket, Phase.REVOKED, Reason.LOCAL_REVOCATION)
    fun recoverInterrupted(ticket: Ticket): Outcome = deny(ticket, Phase.RECOVERY_REQUIRED, Reason.INTERRUPTED_OR_UNKNOWN)
    private fun deny(ticket: Ticket, phase: Phase, reason: Reason): Outcome {
        val p = lookup(ticket) ?: return Outcome(Decision.UNKNOWN_OR_CONSUMED)
        if (!terminal(p.phase)) finish(p, phase, reason)
        return outcome(p)
    }
    /** Terminal local outcome is retained until its ONE original consumption.
     * No outcome ever carries a grant/lease or resets a pending crypto challenge.
     */
    fun takeOutcome(ticket: Ticket): Outcome {
        val p = lookup(ticket) ?: return Outcome(Decision.UNKNOWN_OR_CONSUMED)
        if (!terminal(p.phase)) return outcome(p)
        records.remove(ticket); p.wipePublicCopies()
        dirty = true; persistIfDirty()
        if (storageUnknown) return Outcome(Decision.TERMINAL,
            snapshot(p).copy(phase = Phase.RECOVERY_REQUIRED, reason = Reason.INTERRUPTED_OR_UNKNOWN))
        return outcome(p)
    }
    override fun close() {
        check(Thread.currentThread() === thread) { "VEIL_ENROLLMENT_COORDINATOR_WRONG_THREAD" }
        check(!recoveryBorrowed) { "VEIL_ENROLLMENT_COORDINATOR_RECOVERY_BORROW_ACTIVE" }
        if (closed) return
        check(pendingStore?.hasColdBorrow() != true) { "VEIL_PENDING_COLD_BORROW_ACTIVE" }
        for (p in records.values) p.wipePublicCopies()
        records.clear()
        try { pendingStore?.close() } finally { closed = true }
    }
    private fun matchesExistingRequest(bytes: ByteArray, a: Association): Boolean {
        if (bytes.size !in 1..MAX_REQUEST_BYTES) return false
        // Existing DEVICE-GRANT/V2 Request framing, not a new signature schema.
        return try {
            DataInputStream(ByteArrayInputStream(bytes)).use { input ->
                val domain = "YNX/SOCIAL/DEVICE-GRANT/V2\u0000".toByteArray(Charsets.US_ASCII)
                val received = ByteArray(domain.size).also { input.readFully(it) }
                if (!received.contentEquals(domain) || input.readUnsignedByte() != 1) return false
                for (value in listOf(a.device.owner, a.device.device,
                    a.device.socialIdentityFingerprint, a.device.keyAlias)) {
                    val length = input.readUnsignedShort()
                    if (length !in 1..512 || input.available() < length) return false
                    val text = ByteArray(length).also { input.readFully(it) }
                    if (!text.contentEquals(value.toByteArray(Charsets.US_ASCII))) return false
                }
                if (input.readLong() != a.minimumGeneration || input.available() != 32) return false
                true
            }
        } catch (_: java.io.IOException) { false }
    }
    companion object {
        fun openAppPrivate(context: Context): VeilDeviceEnrollmentCoordinator {
            val store = VeilDeviceEnrollmentPendingStore.openAppPrivate(context)
            return adoptOpenedStore(store)
        }
        // Private ownership transfer, not a grant or a new external path port.
        private fun adoptOpenedStore(store: VeilDeviceEnrollmentPendingStore): VeilDeviceEnrollmentCoordinator {
            try { return VeilDeviceEnrollmentCoordinator(pendingStore = store) }
            catch (primary: Throwable) {
                try { store.close() } catch (secondary: Throwable) {
                    if (secondary !== primary) try { primary.addSuppressed(secondary) } catch (_: Throwable) { }
                }
                throw primary
            }
        }
        const val LOCAL_SCHEMA_VERSION = 1
        const val MAX_OWNED_RECORDS = 32
        const val MAX_LIFETIME_MILLIS = 120000L
        const val MAX_REQUEST_BYTES = 4096
        const val MAX_PROOF_BYTES = 8192
        // All terminal/live records count against32; at most one request+proof
        // per record. Borrowed copies during submission add one bounded payload.
        const val MAX_RETAINED_PUBLIC_BYTES = MAX_OWNED_RECORDS * (MAX_REQUEST_BYTES + MAX_PROOF_BYTES)
    }
}
