package com.ynx.social.matrix

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executor

/** Android UI consumer only. Main supplies the actual Native coordinator.
 * No JS approval value, body, receipt constructor, JNI number or signer exists here.
 * All coordinator calls run on the original serial crypto executor, never the UI thread.
 */
internal class VeilDeviceRevocationConfirmation(private val cryptoWorker: Executor) {
    internal interface HeldReview
    internal class Current(
        val sourceOriginal: Any, val viewOriginal: Any, val targetDevice: String,
        val operation: String, val bodySHA256: String, val expiryOriginal: Any,
        // Native remaining-time observation, already converted by its owner.
        // Never compare an Android clock with a Native CLOCK_MONOTONIC timestamp.
        val remainingMillis: Long,
    )
    internal class Binding private constructor(val original: Current) {
        companion object {
            fun capture(value: Current): Binding {
                require(value.targetDevice.length in 1..128 && value.targetDevice.all { it.code in 33..126 })
                require(value.operation.matches(Regex("[0-9a-f]{64}")))
                require(value.bodySHA256.matches(Regex("[0-9a-f]{64}")))
                require(value.remainingMillis > 0)
                return Binding(value)
            }
        }
        fun matches(value: Current): Boolean = value.remainingMillis > 0 &&
            value.sourceOriginal === original.sourceOriginal && value.viewOriginal === original.viewOriginal &&
            value.expiryOriginal === original.expiryOriginal && value.targetDevice == original.targetDevice &&
            value.operation == original.operation && value.bodySHA256 == original.bodySHA256
    }
    internal sealed interface Receipt {
        val review: HeldReview
        val dialog: AlertDialog
        val binding: Binding
    }
    private class DialogReceipt(
        override val review: HeldReview, override val dialog: AlertDialog, override val binding: Binding,
    ) : Receipt

    internal enum class Outcome { RECEIPT_OBSERVED, CANCELLED, STALE, EXPIRED, INVALIDATED, UNAVAILABLE, SUBMISSION_UNRESOLVED }
    internal enum class ReceiptObservation { ORIGINAL_OBSERVED, ORIGINAL_RETAINED }
    internal interface Coordinator {
        /** Actual Native/coordinator constructor only; retain this exact dialog/context. */
        fun open(dialog: AlertDialog): HeldReview
        fun current(review: HeldReview, dialog: AlertDialog): Current
        /** Must verify the same review/dialog/receipt in Native before submitting.
         * ORIGINAL_OBSERVED acknowledges the exact original receipt, never business success.
         * UNKNOWN/absent acknowledgment returns ORIGINAL_RETAINED; no automatic retry.
         */
        fun confirmed(review: HeldReview, dialog: AlertDialog, receipt: Receipt): ReceiptObservation
        /** Runs after any earlier callback on the same worker has completed.
         * Return only after the original cancellation/close has been observed;
         * throw if its disposition is unresolved, retaining the original.
         * SUBMISSION_UNRESOLVED must retain its original journal/review; do not close/recreate it.
         */
        fun stopped(review: HeldReview?, dialog: AlertDialog?, outcome: Outcome)
        /** Read the retained original only. No confirm/sign/recreate/expiry refresh.
         * Return ORIGINAL_OBSERVED only after its exact disposition is observed;
         * ORIGINAL_RETAINED keeps the same dialog/review/receipt and blocks a new prompt.
         */
        fun observeRetainedOriginal(review: HeldReview?, dialog: AlertDialog?, receipt: Receipt?): ReceiptObservation
    }
    private enum class Phase { PREPARING, DISPLAYING, SHOWN, CHECKING, DELIVERING, RETAINED, STOPPING, TERMINAL }
    internal inner class Request internal constructor(internal val activity: Activity, internal val coordinator: Coordinator) {
        internal val result = CompletableFuture<Outcome>()
        internal var firstFailure: Exception? = null
            private set
        private fun remember(failure: Exception) = synchronized(gate) { if (firstFailure == null) firstFailure = failure }
        private var phase = Phase.PREPARING
        private var dialog: AlertDialog? = null
        private var review: HeldReview? = null
        private var binding: Binding? = null
        private var receipt: Receipt? = null
        private var workerThread: Thread? = null
        private var invalidated = false
        private var observingOriginal = false

        private fun onWorker(onUnavailable: () -> Unit = {}, action: () -> Unit) {
            try {
                cryptoWorker.execute {
                    val owner = workerThread
                    if (owner == null) workerThread = Thread.currentThread()
                    if (Thread.currentThread() !== workerThread || Looper.myLooper() === Looper.getMainLooper()) {
                        remember(IllegalStateException("VEIL_CONFIRMATION_ORIGINAL_WORKER_REQUIRED"))
                        finishWithoutCoordinator(Outcome.UNAVAILABLE)
                        onUnavailable()
                        return@execute
                    }
                    action()
                }
            } catch (failure: Exception) { remember(failure); finishWithoutCoordinator(Outcome.UNAVAILABLE); onUnavailable() }
        }
        private fun alive(expected: Phase): Boolean = synchronized(gate) {
            active === this && phase == expected && !invalidated && !activity.isFinishing && !activity.isDestroyed
        }
        private fun finishWithoutCoordinator(outcome: Outcome) {
            // Keep the original on executor rejection/wrong thread. It cannot be
            // safely closed from UI or replaced by a fresh request.
            synchronized(gate) { phase = Phase.RETAINED; result.complete(outcome) }
            ui.post { dialog?.dismiss() }
        }
        internal fun start() {
            ui.post {
                if (!alive(Phase.PREPARING)) { stop(Outcome.INVALIDATED); return@post }
                try {
                    val actual = AlertDialog.Builder(activity).setTitle("Revoke device")
                        .setNegativeButton("Cancel") { _, _ -> stop(Outcome.CANCELLED) }
                        .setPositiveButton("Revoke", null).create()
                    dialog = actual
                    actual.setCanceledOnTouchOutside(false)
                    actual.setOnCancelListener { stop(Outcome.CANCELLED) }
                    actual.setOnDismissListener {
                        if (synchronized(gate) { phase in setOf(Phase.PREPARING, Phase.DISPLAYING, Phase.SHOWN, Phase.CHECKING) })
                            stop(Outcome.CANCELLED)
                    }
                    onWorker {
                        try {
                            review = coordinator.open(actual)
                            if (!alive(Phase.PREPARING)) return@onWorker
                            val current = coordinator.current(requireNotNull(review), actual)
                            if (current.remainingMillis <= 0) { stop(Outcome.EXPIRED); return@onWorker }
                            val captured = Binding.capture(current)
                            synchronized(gate) {
                                if (!alive(Phase.PREPARING)) return@synchronized
                                binding = captured; phase = Phase.DISPLAYING
                            }
                            ui.post {
                              try {
                                if (!alive(Phase.DISPLAYING)) return@post
                                actual.setMessage("Confirm revocation for device ${captured.original.targetDevice}.")
                                actual.show()
                                actual.window?.decorView?.filterTouchesWhenObscured = true
                                actual.getButton(AlertDialog.BUTTON_POSITIVE).filterTouchesWhenObscured = true
                                actual.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { positiveClick() }
                                synchronized(gate) { if (phase == Phase.DISPLAYING) phase = Phase.SHOWN }
                                scheduleRemainingCheck(current.remainingMillis)
                              } catch (failure: Exception) { remember(failure); stop(Outcome.UNAVAILABLE) }
                            }
                        } catch (failure: Exception) { remember(failure); stop(Outcome.UNAVAILABLE) }
                    }
                } catch (failure: Exception) { remember(failure); stop(Outcome.UNAVAILABLE) }
            }
        }
        private fun scheduleRemainingCheck(nativeRemainingMillis: Long) {
            ui.postDelayed({
                if (!alive(Phase.SHOWN)) return@postDelayed
                onWorker {
                    if (!alive(Phase.SHOWN)) return@onWorker
                    try {
                        val current = coordinator.current(requireNotNull(review), requireNotNull(dialog))
                        if (!requireNotNull(binding).matches(current)) stop(if (current.remainingMillis <= 0) Outcome.EXPIRED else Outcome.STALE)
                        else if (alive(Phase.SHOWN)) scheduleRemainingCheck(current.remainingMillis)
                    } catch (failure: Exception) { remember(failure); stop(Outcome.STALE) }
                }
            }, nativeRemainingMillis.coerceIn(1, 1000))
        }
        private fun positiveClick() {
            synchronized(gate) {
                if (!alive(Phase.SHOWN)) return
                phase = Phase.CHECKING
            }
            dialog?.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = false
            // This private path is reachable only from the actual positive
            // listener above. A programmatic JS approval never enters it.
            onWorker {
                try {
                    if (!alive(Phase.CHECKING)) return@onWorker
                    val held = requireNotNull(review); val actual = requireNotNull(dialog); val frozen = requireNotNull(binding)
                    val beforeClick = coordinator.current(held, actual)
                    if (!frozen.matches(beforeClick)) { stop(if (beforeClick.remainingMillis <= 0) Outcome.EXPIRED else Outcome.STALE); return@onWorker }
                    val observation = DialogReceipt(held, actual, frozen)
                    val beforeSubmit = coordinator.current(held, actual)
                    if (!frozen.matches(beforeSubmit)) { stop(if (beforeSubmit.remainingMillis <= 0) Outcome.EXPIRED else Outcome.STALE); return@onWorker }
                    synchronized(gate) {
                        if (!alive(Phase.CHECKING)) return@onWorker
                        receipt = observation; phase = Phase.DELIVERING
                    }
                    // Main's actual Native entry must independently check its
                    // original current fence and this held object again.
                    val observed = coordinator.confirmed(held, actual, observation)
                    synchronized(gate) {
                        if (observed == ReceiptObservation.ORIGINAL_RETAINED || invalidated || phase == Phase.RETAINED) {
                            phase = Phase.RETAINED; result.complete(Outcome.SUBMISSION_UNRESOLVED)
                        } else {
                            phase = Phase.TERMINAL; result.complete(Outcome.RECEIPT_OBSERVED)
                            if (active === this) active = null
                        }
                    }
                    ui.post { actual.dismiss() }
                } catch (failure: Exception) { remember(failure);
                    if (synchronized(gate) { phase == Phase.DELIVERING || phase == Phase.RETAINED }) {
                        synchronized(gate) { phase = Phase.RETAINED; result.complete(Outcome.SUBMISSION_UNRESOLVED) }
                        // Keep request/review/dialog/receipt strong; no second prompt or retry.
                        ui.post { dialog?.dismiss() }
                    } else stop(Outcome.UNAVAILABLE)
                }
            }
        }
        internal fun observeOriginal(): CompletableFuture<ReceiptObservation> {
            val observed = CompletableFuture<ReceiptObservation>()
            synchronized(gate) {
                check(active === this && phase == Phase.RETAINED && !observingOriginal) {
                    "VEIL_REVOCATION_SAME_RETAINED_ORIGINAL_REQUIRED"
                }
                observingOriginal = true
            }
            onWorker(onUnavailable = {
                synchronized(gate) { observingOriginal = false }
                observed.completeExceptionally(IllegalStateException("VEIL_CONFIRMATION_ORIGINAL_WORKER_REQUIRED"))
            }) {
                try {
                    synchronized(gate) {
                        check(active === this && phase == Phase.RETAINED && observingOriginal)
                    }
                    val held = review; val actual = dialog; val originalReceipt = receipt
                    if (originalReceipt != null) {
                        check(originalReceipt.review === held && originalReceipt.dialog === actual && originalReceipt.binding === binding)
                    }
                    val disposition = coordinator.observeRetainedOriginal(held, actual, originalReceipt)
                    synchronized(gate) {
                        check(active === this && phase == Phase.RETAINED)
                        observingOriginal = false
                        if (disposition == ReceiptObservation.ORIGINAL_OBSERVED) {
                            phase = Phase.TERMINAL
                            active = null
                        }
                    }
                    // Do not rewrite the first UNKNOWN/exception result. This is
                    // a separate exact-original readback, never a second confirmation.
                    observed.complete(disposition)
                } catch (failure: Exception) {
                    remember(failure)
                    synchronized(gate) { observingOriginal = false }
                    observed.completeExceptionally(failure)
                }
            }
            return observed
        }
        internal fun stop(outcome: Outcome) {
            synchronized(gate) {
                if (phase in setOf(Phase.TERMINAL, Phase.STOPPING)) return
                if (phase in setOf(Phase.DELIVERING, Phase.RETAINED)) {
                    invalidated = true; phase = Phase.RETAINED; result.complete(Outcome.SUBMISSION_UNRESOLVED)
                    ui.post { dialog?.dismiss() }; return
                }
                phase = Phase.STOPPING
            }
            ui.post { dialog?.dismiss() }
            onWorker {
                try {
                    coordinator.stopped(review, dialog, outcome)
                    synchronized(gate) { phase = Phase.TERMINAL; result.complete(outcome); if (active === this) active = null }
                } catch (failure: Exception) { remember(failure); finishWithoutCoordinator(Outcome.UNAVAILABLE) }
            }
        }
    }
    private val ui = Handler(Looper.getMainLooper())
    private val gate = Any()
    private var active: Request? = null
    private var closed = false
    fun request(activity: Activity, coordinator: Coordinator): Request = synchronized(gate) {
        check(!closed && active == null) { "VEIL_REVOCATION_ORIGINAL_REVIEW_RETAINED" }
        Request(activity, coordinator).also { active = it; it.start() }
    }
    fun observeRetainedOriginal(request: Request): CompletableFuture<ReceiptObservation> {
        synchronized(gate) { check(active === request) { "VEIL_CONFIRMATION_ORIGINAL_OWNER_REQUIRED" } }
        return request.observeOriginal()
    }
    fun onActivityDestroyed(activity: Activity) {
        synchronized(gate) { active?.takeIf { it.activity === activity } }?.stop(Outcome.INVALIDATED)
    }
    fun invalidate() {
        val request = synchronized(gate) { closed = true; active }
        request?.stop(Outcome.INVALIDATED)
    }
}
