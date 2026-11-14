package com.ynx.social.matrix

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.SecureRandom

/** Local PUBLIC bookkeeping only. No authentication flag, grant, UI or JNI call.
 * Uses the coordinator's ONE store on its ONE worker. No independent journal.
 */
internal class VeilLocalGenesisProducer(private val store: VeilDeviceEnrollmentPendingStore?) {
    internal enum class Phase { PREPARED, SUBMITTED }
    /** Immutable PUBLIC operation16 + incarnation16. Never aliases JNI bytes. */
    internal class NativeIds(ids: ByteArray) {
        private val value: ByteArray
        init { require(ids.size == 32); value = ids.copyOf() }
        fun copyBytes(): ByteArray = value.copyOf()
        override fun equals(other: Any?): Boolean = other is NativeIds && value.contentEquals(other.value)
        override fun hashCode(): Int = value.contentHashCode()
        override fun toString(): String = "NativeIds(PUBLIC_LOCAL_ASSOCIATION)"
    }
    internal data class Record(val slot: String, val intentHex: String, val alias: String,
        val storageGeneration: Long, val authWindowSeconds: Int, val phase: Phase,
        val nativeIds: NativeIds? = null, val initializationProfile: Int = 1) {
        init {
            require(initializationProfile in 1..2)
            require(slot.length in 1..128 && slot.all { it.code in 33..126 })
            require(intentHex.length == 32 && intentHex.all { it in '0'..'9' || it in 'a'..'f' })
            require(alias == ALIAS_PREFIX + intentHex)
            require(storageGeneration == 1L && authWindowSeconds == AUTH_WINDOW_SECONDS)
            require(nativeIds == null || phase == Phase.SUBMITTED)
        }
        fun association(): ByteArray = ByteArrayOutputStream().also { bytes ->
            DataOutputStream(bytes).use { out ->
                fun text(value: String) { val b = value.toByteArray(Charsets.US_ASCII); out.writeInt(b.size); out.write(b) }
                text(if (initializationProfile == 2) "YNX/SOCIAL/LOCAL-GENESIS-INITIAL-PREKEYS-INTENT/V2" else "YNX/SOCIAL/LOCAL-GENESIS-INTENT/V1")
                out.writeInt(initializationProfile); text(slot); text(intentHex); text(alias)
                out.writeLong(storageGeneration); out.writeInt(authWindowSeconds)
            }
        }.toByteArray().also { check(it.size <= 4096) }
    }
    /** Reference identity, NOT a serialized capability or authentication proof. */
    internal class Original internal constructor(internal val record: Record)
    internal data class Snapshot(val record: Record?, val disposition: String)
    private val thread = Thread.currentThread()
    private var original: Original? = null
    private var input: VeilLocalGenesisInput? = null
    private var creationAttempted = false
    private var submissionAttempted = false
    private var bindingAttempted = false
    private var retainedNativeIds: NativeIds? = null
    private var primary: Throwable? = null
    private fun owner() { check(Thread.currentThread() === thread) { "LOCAL_INTENT_WRONG_WORKER" } }
    private fun storage(): VeilDeviceEnrollmentPendingStore {
        owner(); primary?.let { throw it }
        return checkNotNull(store) { "LOCAL_INTENT_DURABLE_STORE_REQUIRED" }
    }
    private fun writable(s: VeilDeviceEnrollmentPendingStore) {
        check(s.status() in setOf(VeilDeviceEnrollmentPendingStore.Status.FRESH,
            VeilDeviceEnrollmentPendingStore.Status.READY)) { "LOCAL_INTENT_RECONCILIATION_REQUIRED" }
    }
    fun prepare(slot: String, next: Long, rows: List<VeilDeviceEnrollmentPendingStore.Entry>): Original {
        val s = storage(); writable(s)
        require(slot.length in 1..128 && slot.all { it.code in 33..126 })
        val existing = s.localIntentRecord()
        if (existing != null) {
            check(existing.slot == slot) { "LOCAL_INTENT_OTHER_SLOT_PRESERVED" }
            check(existing.initializationProfile == 2) { "LOCAL_INTENT_OTHER_PROFILE_PRESERVED" }
            return getOriginal(slot) ?: error("LOCAL_INTENT_RESTORE_REQUIRED")
        }
        check(!creationAttempted) { "LOCAL_INTENT_NO_REKEY" }
        creationAttempted = true
        try {
            val id = ByteArray(16); SecureRandom().nextBytes(id)
            val hex = id.joinToString("") { "%02x".format(it.toInt() and 255) }
            val retained = Original(Record(slot, hex, ALIAS_PREFIX + hex, 1, AUTH_WINDOW_SECONDS, Phase.PREPARED, initializationProfile = 2))
            original = retained // Keep exact candidate even if disk result becomes UNKNOWN.
            check(s.replaceLocalIntent(next, rows, retained.record)) { "LOCAL_INTENT_WRITE_UNKNOWN" }
            return retained
        } catch (failure: Throwable) { primary = failure; throw failure }
    }
    /** Reopen an unsubmitted setup intent only. SUBMITTED and UNKNOWN are not
     * retried, and a persisted public record is never authentication authority. */
    fun resumePrepared(slot: String): Original {
        val s = storage()
        check(original == null && !creationAttempted && !submissionAttempted && !bindingAttempted)
        check(s.status() == VeilDeviceEnrollmentPendingStore.Status.RECONCILIATION_REQUIRED)
        val record = checkNotNull(s.localIntentRecord()) { "LOCAL_INTENT_RESUME_RECORD_REQUIRED" }
        check(record.slot == slot) { "LOCAL_INTENT_OTHER_SLOT_PRESERVED" }
        check(record.phase == Phase.PREPARED && record.nativeIds == null) { "LOCAL_INTENT_ALREADY_SUBMITTED" }
        check(record.initializationProfile == 2) { "LOCAL_INTENT_OTHER_PROFILE_PRESERVED" }
        creationAttempted = true
        try {
            val retained = Original(record)
            original = retained // Retain before validating/opening the writable setup path.
            s.resumePreparedLocalIntent(record)
            return retained
        } catch (failure: Throwable) { primary = failure; throw failure }
    }
    fun getOriginal(slot: String): Original? {
        val s = storage(); writable(s)
        val record = s.localIntentRecord() ?: return null
        check(record.slot == slot) { "LOCAL_INTENT_OTHER_SLOT_PRESERVED" }
        val retained = original ?: error("LOCAL_INTENT_RESTORE_REQUIRED")
        revalidate(retained)
        return retained
    }
    /** Call before AND after system authentication UI; this checks lifecycle,
     * never authentication. Actual AndroidKeyStore must enforce its policy. */
    fun revalidate(value: Original) {
        val s = storage(); writable(s)
        check(original === value && !submissionAttempted && s.localIntentRecord() == value.record &&
            value.record.phase == Phase.PREPARED && value.record.initializationProfile == 2) { "LOCAL_INTENT_ORIGINAL_OR_PHASE" }
    }
    fun markBeforeSubmission(value: Original, next: Long,
        rows: List<VeilDeviceEnrollmentPendingStore.Entry>): VeilLocalGenesisInput {
        revalidate(value)
        submissionAttempted = true // No second construction on allocation/write failure.
        try {
            val r = value.record
            check(storage().replaceLocalIntent(next, rows, r.copy(phase = Phase.SUBMITTED))) { "LOCAL_INTENT_WRITE_UNKNOWN" }
            val association = r.association()
            try {
                val created = VeilLocalGenesisInput.initialPrekeys(r.alias, r.storageGeneration, association, r.authWindowSeconds)
                input = created
                return created
            } finally { association.fill(0) }
        } catch (failure: Throwable) { primary = failure; throw failure }
    }
    fun bindNativeIds(value: Original, ids: ByteArray, next: Long,
        rows: List<VeilDeviceEnrollmentPendingStore.Entry>) {
        val s = storage(); writable(s)
        check(original === value && submissionAttempted && input != null && !bindingAttempted &&
            s.localIntentRecord() == value.record.copy(phase = Phase.SUBMITTED)) { "LOCAL_INTENT_NATIVE_BINDING_LIFECYCLE" }
        bindingAttempted = true // Includes invalid length/allocation/write failures: no retry.
        try {
            val copied = NativeIds(ids)
            retainedNativeIds = copied // Retain independently of UNKNOWN disk publication.
            val bound = value.record.copy(phase = Phase.SUBMITTED, nativeIds = copied)
            check(s.replaceLocalIntent(next, rows, bound)) { "LOCAL_INTENT_NATIVE_IDS_WRITE_UNKNOWN" }
        } catch (failure: Throwable) { primary = failure; throw failure }
    }
    fun observe(): Snapshot {
        owner()
        val s = store ?: return Snapshot(null, "DURABLE_STORE_REQUIRED")
        val r = s.localIntentRecord()
        val disposition = when {
            primary != null || s.status() == VeilDeviceEnrollmentPendingStore.Status.UNKNOWN -> "UNKNOWN_RETAINED"
            s.status() == VeilDeviceEnrollmentPendingStore.Status.RECONCILIATION_REQUIRED -> "REOPENED_RESTORE_REQUIRED"
            s.status() == VeilDeviceEnrollmentPendingStore.Status.CLOSED -> "CLOSED_LOCAL"
            r == null -> "NO_LOCAL_INTENT"
            r.phase == Phase.SUBMITTED -> "SUBMITTED_UNVERIFIED_RESTORE_REQUIRED"
            else -> "PREPARED_LOCAL_UNVERIFIED"
        }
        return Snapshot(r, disposition)
    }
    companion object {
        // New product policy explicitly selected by Main; not an upstream default.
        const val AUTH_WINDOW_SECONDS = 30
        const val ALIAS_PREFIX = "ynx.social.ownkey.v1."
    }
}
