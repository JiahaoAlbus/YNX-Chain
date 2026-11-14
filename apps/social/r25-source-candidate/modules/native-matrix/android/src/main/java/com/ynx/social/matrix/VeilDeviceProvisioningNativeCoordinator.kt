package com.ynx.social.matrix

import android.app.Activity
import android.app.AlertDialog
import android.content.Context

/** Same-worker adapter for the frozen Main JNI. The private marker carries only
 * correlation; open returns it only after actual Native display admission.
 * No fallback Source, purpose approval, generic provider or signer exists here.
 */
internal class VeilDeviceProvisioningNativeCoordinator(
    private val context: Context,
    private val warm: VeilLocalRecoveryInput?,
    private val cold: VeilOwnKeyColdRecoveryLease?,
    private val borrow: VeilSocialLoginClient.AccountChannelBorrow,
    private val activity: Activity,
    private val originalCurrent: () -> Boolean = { true },
) : VeilDeviceProvisioningConfirmation.Coordinator {
    private class Review : VeilDeviceProvisioningConfirmation.HeldReview {
        @Volatile private var invalidated = false

        // Main JNI reads this exact held Review while the window is still visible.
        public fun isOriginalWindowInvalidated(): Boolean = invalidated

        fun invalidate() {
            invalidated = true
        }
    }
    private val worker = Thread.currentThread()
    private val held = Review()
    private var dialog: AlertDialog? = null

    override fun invalidateWindow() {
        held.invalidate()
    }

    private fun walletWindowCurrent(dialog: AlertDialog): Boolean =
        !held.isOriginalWindowInvalidated() && originalCurrent() && dialog.isShowing &&
            !activity.isFinishing && !activity.isDestroyed
    @Volatile private var openAttempted = false
    private var openObserved = false
    private var originalPendingRestored = false
    private var originalReceipt: VeilDeviceProvisioningConfirmation.Receipt? = null
    private val wallet by lazy { VeilWalletDeviceApprovalClient(context) }
    private var walletOriginal: VeilWalletDeviceApprovalClient.Original? = null
    private var walletPrepared = false
    private var walletDenied = false
    private var walletAcceptanceAttempted = false
    private var guardedContinuationObserved = false
    private var guardedContinuationSelected = false
    private var stopAttempted = false
    @Volatile private var stopObserved = false
    private var stopFailure: Exception? = null
    var firstFailure: Exception? = null
        private set
    init { require((warm == null) != (cold == null)) }
    private fun worker() { check(Thread.currentThread() === worker) { "DEVICE_PROVISIONING_ORIGINAL_WORKER_REQUIRED" } }
    private fun remember(error: Exception) { if (firstFailure == null) firstFailure = error }
    private class NativeRefusal(val code: Int) : IllegalStateException("DEVICE_PROVISIONING_NATIVE_REFUSAL_$code")
    private fun <T> native(body: () -> T): T {
        worker()
        try { return body() }
        catch (failure: LinkageError) {
            val retained = IllegalStateException("DEVICE_PROVISIONING_NATIVE_INTERFACE_REQUIRED", failure)
            remember(retained); throw retained
        } catch (failure: Exception) { remember(failure); throw failure }
    }
    private fun same(review: VeilDeviceProvisioningConfirmation.HeldReview?, actual: AlertDialog?) {
        worker(); check(review == null || review === held)
        check(actual == null || actual === dialog)
    }
    override fun open(dialog: AlertDialog): VeilDeviceProvisioningConfirmation.HeldReview {
        worker(); check(!openAttempted) { "DEVICE_PROVISIONING_ORIGINAL_OPEN_RETAINED" }
        openAttempted = true; this.dialog = dialog // adopt before any Native partial/exception
        val code = native {
            if (cold != null) VeilDeviceProvisioningNativeBridge.nativeOpenCold(context, cold, borrow, activity, held, dialog)
            else VeilDeviceProvisioningNativeBridge.nativeOpenWarm(context, checkNotNull(warm), borrow, activity, held, dialog)
        }
        if (code == 901) {
            originalPendingRestored = true
            throw VeilDeviceProvisioningConfirmation.OriginalPendingRestored(held)
        }
        if (code != 0) throw NativeRefusal(code).also(::remember)
        openObserved = true
        return held // display admission only; genuine purpose remains Native-owned
    }
    override fun current(review: VeilDeviceProvisioningConfirmation.HeldReview, dialog: AlertDialog): VeilDeviceProvisioningConfirmation.Current {
        same(review, dialog); check(openObserved && !stopAttempted)
        return native { VeilDeviceProvisioningNativeBridge.nativeCurrent(held, dialog) }
    }
    override fun confirmed(review: VeilDeviceProvisioningConfirmation.HeldReview, dialog: AlertDialog,
        receipt: VeilDeviceProvisioningConfirmation.Receipt): VeilDeviceProvisioningConfirmation.ReceiptObservation {
        same(review, dialog); check(openObserved && !stopAttempted)
        check(receipt.review === held && receipt.dialog === dialog)
        check(originalReceipt == null) { "DEVICE_PROVISIONING_ORIGINAL_RECEIPT_RETAINED" }
        originalReceipt = receipt // retain before Native checks or lost acknowledgment
        if (!walletWindowCurrent(dialog)) return VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_RETAINED
        return prepareWalletReview(dialog, receipt, allowDispatch = true)
    }

    private fun prepareWalletReview(
        dialog: AlertDialog,
        receipt: VeilDeviceProvisioningConfirmation.Receipt?,
        allowDispatch: Boolean,
    ): VeilDeviceProvisioningConfirmation.ReceiptObservation {
        check(!walletPrepared)
        walletPrepared = true
        val bytes = native {
            VeilDeviceProvisioningNativeBridge.nativePrepareWalletReview(held, dialog, receipt)
        } ?: return VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_RETAINED
        val prepared = try { VeilWalletDeviceApprovalClient.Prepared.fromNative(bytes) }
        finally { bytes.fill(0) }
        prepared.use {
            walletOriginal = it.original
            val result = wallet.review(it) {
                if (allowDispatch && !walletWindowCurrent(dialog)) return@review 0
                val selection = native {
                    VeilDeviceProvisioningNativeBridge.nativeSelectWalletDispatch(held, dialog)
                }
                if (selection == 1 && (!allowDispatch || !walletWindowCurrent(dialog))) 0 else selection
            }
            return acceptWalletResult(dialog, result)
        }
    }

    private fun acceptWalletResult(
        dialog: AlertDialog,
        result: VeilWalletDeviceApprovalClient.Result,
    ): VeilDeviceProvisioningConfirmation.ReceiptObservation = when (result) {
        VeilWalletDeviceApprovalClient.Result.Unknown ->
            VeilDeviceProvisioningConfirmation.ReceiptObservation.WALLET_UNKNOWN
        VeilWalletDeviceApprovalClient.Result.Pending ->
            VeilDeviceProvisioningConfirmation.ReceiptObservation.WALLET_PENDING
        VeilWalletDeviceApprovalClient.Result.Denied -> {
            walletDenied = true
            VeilDeviceProvisioningConfirmation.ReceiptObservation.WALLET_DENIED
        }
        is VeilWalletDeviceApprovalClient.Result.Approved -> result.use {
            if (walletAcceptanceAttempted || !walletWindowCurrent(dialog))
                return@use VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_RETAINED
            walletAcceptanceAttempted = true
            val code = native {
                VeilDeviceProvisioningNativeBridge.nativeAcceptWalletReviewResult(held, dialog, it)
            }
            if (code != 0) {
                remember(NativeRefusal(code))
                return@use VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_RETAINED
            }
            if (!walletWindowCurrent(dialog))
                return@use VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_RETAINED
            val current = native { VeilDeviceProvisioningNativeBridge.nativeRegisteredCurrent(held, dialog) }
            if (current != 0) {
                remember(NativeRefusal(current))
                return@use VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_RETAINED
            }
            stopOriginalOnWorker()
            guardedContinuationObserved = true
            VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_OBSERVED
        }
    }

    override fun stopped(review: VeilDeviceProvisioningConfirmation.HeldReview?, dialog: AlertDialog?, outcome: VeilDeviceProvisioningConfirmation.Outcome) {
        // Cancellation can win before the queued open reaches this worker.
        // Its UI dialog is not a Native-held original; no Source/stop exists.
        worker()
        if (!openAttempted) { check(review == null); return }
        same(review, dialog)
        // A window-loss callback queued while Native was restoring must not
        // cancel the authenticated older pending operation automatically.
        if (originalPendingRestored && outcome != VeilDeviceProvisioningConfirmation.Outcome.CANCELLED) return
        stopOriginalOnWorker()
    }
    /** Cleanup never opens a Source or repeats an unconfirmed stop. */
    fun stopOriginalOnWorker() {
        worker(); if (!openAttempted || stopObserved) return
        stopFailure?.let { throw it }
        check(!stopAttempted) { "DEVICE_PROVISIONING_ORIGINAL_STOP_UNRESOLVED" }
        stopAttempted = true
        try {
            val code = native { VeilDeviceProvisioningNativeBridge.nativeStop(held, checkNotNull(dialog)) }
            if (code != 0) throw NativeRefusal(code).also(::remember)
            stopObserved = true
        } catch (failure: Exception) { stopFailure = failure; throw failure }
    }
    override fun observeRetainedOriginal(review: VeilDeviceProvisioningConfirmation.HeldReview?, dialog: AlertDialog?,
        receipt: VeilDeviceProvisioningConfirmation.Receipt?): VeilDeviceProvisioningConfirmation.ReceiptObservation {
        same(review, dialog); check(receipt === originalReceipt)
        if (!openAttempted) return VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_OBSERVED
        val code = native { VeilDeviceProvisioningNativeBridge.nativeObserveRetainedOriginal(held, checkNotNull(this.dialog), originalReceipt) }
        if (code != 0) remember(NativeRefusal(code))
        // This is readonly disposition, not a device/current/registration grant.
        return if (code == 0) VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_OBSERVED
            else VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_RETAINED
    }
    /** One local scheduling decision for this coordinator, never a device/chat grant. */
    fun selectGuardedContinuationOnWorker(): Boolean {
        worker()
        if (held.isOriginalWindowInvalidated() || !originalCurrent() ||
            !guardedContinuationObserved || guardedContinuationSelected || !stopObserved ||
            originalPendingRestored || originalReceipt == null) return false
        guardedContinuationSelected = true
        return true
    }
    fun retainsNativeOriginal(): Boolean = openAttempted && !stopObserved
    fun hasActualReceiptOnWorker(): Boolean { worker(); return originalReceipt != null }
    fun hasRestoredPendingOnWorker(): Boolean { worker(); return originalPendingRestored }
    fun observeStatusOnWorker(
        outcome: VeilDeviceProvisioningConfirmation.Outcome,
        afterReceipt: String?,
    ): String {
        worker()
        if (walletDenied) return "DEVICE_PROVISIONING_WALLET_DENIED"
        if (guardedContinuationObserved) return afterReceipt ?: "DEVICE_PROVISIONING_RECEIPT_OBSERVED"
        val actual = dialog
        if (actual != null && retainsNativeOriginal() && !stopAttempted &&
            (walletOriginal != null || originalPendingRestored && !walletPrepared)
        ) {
            val status = try {
                val original = walletOriginal
                if (original == null) prepareWalletReview(actual, null, allowDispatch = false)
                else acceptWalletResult(actual, wallet.observe(original))
            } catch (error: Exception) {
                remember(error)
                VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_RETAINED
            }
            return when (status) {
                VeilDeviceProvisioningConfirmation.ReceiptObservation.WALLET_PENDING -> "DEVICE_PROVISIONING_WALLET_PENDING"
                VeilDeviceProvisioningConfirmation.ReceiptObservation.WALLET_DENIED -> "DEVICE_PROVISIONING_WALLET_DENIED"
                VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_OBSERVED -> "DEVICE_PROVISIONING_RECEIPT_OBSERVED"
                else -> "DEVICE_PROVISIONING_UNKNOWN_RETAINED"
            }
        }
        if (retainsNativeOriginal()) {
            val observation = try { observeOriginalOnWorker() }
            catch (_: Exception) { return "DEVICE_PROVISIONING_UNKNOWN_RETAINED" }
            if (observation == VeilDeviceProvisioningConfirmation.ReceiptObservation.ORIGINAL_RETAINED ||
                stopFailure != null ||
                outcome == VeilDeviceProvisioningConfirmation.Outcome.SUBMISSION_UNRESOLVED
            ) return "DEVICE_PROVISIONING_UNKNOWN_RETAINED"
        }
        return when (outcome) {
            VeilDeviceProvisioningConfirmation.Outcome.ORIGINAL_PENDING_RESTORED ->
                "DEVICE_PROVISIONING_ORIGINAL_PENDING_RESTORED"
            VeilDeviceProvisioningConfirmation.Outcome.RECEIPT_OBSERVED ->
                afterReceipt ?: "DEVICE_PROVISIONING_RECEIPT_OBSERVED"
            VeilDeviceProvisioningConfirmation.Outcome.WALLET_UNKNOWN -> "DEVICE_PROVISIONING_UNKNOWN_RETAINED"
            VeilDeviceProvisioningConfirmation.Outcome.WALLET_PENDING -> "DEVICE_PROVISIONING_WALLET_PENDING"
            VeilDeviceProvisioningConfirmation.Outcome.WALLET_DENIED -> "DEVICE_PROVISIONING_WALLET_DENIED"
            VeilDeviceProvisioningConfirmation.Outcome.CANCELLED -> "DEVICE_PROVISIONING_CANCELLED"
            VeilDeviceProvisioningConfirmation.Outcome.EXPIRED -> "DEVICE_PROVISIONING_REVIEW_EXPIRED"
            VeilDeviceProvisioningConfirmation.Outcome.SUBMISSION_UNRESOLVED ->
                "DEVICE_PROVISIONING_UNKNOWN_RETAINED"
            else -> if (retainsNativeOriginal()) "DEVICE_PROVISIONING_ORIGINAL_OBSERVED"
                else "DEVICE_PROVISIONING_REVIEW_UNAVAILABLE"
        }
    }

    fun observeOriginalOnWorker(): VeilDeviceProvisioningConfirmation.ReceiptObservation =
        observeRetainedOriginal(if (openAttempted) held else null, dialog, originalReceipt)
}
