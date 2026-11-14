package com.ynx.social.matrix

import android.content.Context
import com.ynx.social.veil.VeilNativeProductControllerBridge
import java.util.ArrayDeque
import java.util.IdentityHashMap
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit

/** Normal internal Android owning lifecycle, NOT native admission or an Expo API.
 * The fixed ABI2 native controller is loaded/opened on this same worker.
 * Its current root refusal is NOT admission or message readiness. No synthetic
 * lease, fallback actor or UI-controlled native entry is supplied here.
 */
internal class VeilCryptoEngineOwner private constructor(private val context: Context, private val attachmentUi: VeilAttachmentUi?) {
    internal enum class State { STARTING, LOCAL_PENDING, RECOVERY_PENDING, CLOSING, DRAIN_REQUIRED, CLOSE_UNRESOLVED, CLOSED, INIT_FAILED }
    internal enum class NativeBoundary { REQUIRED }
    /** Result observation only. Neither value constructs device authority. */
    internal enum class ProductStartObservation { NATIVE_SOURCE_REQUIRED, ATTACHED_OBSERVED }
    internal enum class ProductRecoveryObservation { NO_ORIGINAL, DEVICE_CURRENT_SOURCE_REQUIRED, ATTACHED_OBSERVED }
    internal enum class CloseDisposition { CLOSED_LOCAL_ONLY, PENDING_RECONCILIATION_REQUIRED }
    /** Opaque normal prompt handoff, never a Native or device grant. */
    internal class LocalAuthenticationOriginal internal constructor()
    internal data class Snapshot(val state: State, val queued: Int, val originalTickets: Int,
        val reopenedRows: Int, val pendingStatus: VeilDeviceEnrollmentPendingStore.Status?,
        val failureRetained: Boolean, val nativeBoundary: NativeBoundary = NativeBoundary.REQUIRED,
        val localGenesisAttempted: Boolean = false, val localGenesisStatus: Int? = null)
    internal class Receipt<T> internal constructor(private val owner: VeilCryptoEngineOwner,
        private val future: CompletableFuture<T>) {
        fun done(): Boolean = future.isDone
        // Timeout/interruption does NOT cancel work or resolve its ownership.
        fun await(timeoutMillis: Long): T {
            check(Thread.currentThread() !== owner.worker) { "VEIL_OWNER_WAIT_ON_WORKER" }
            require(timeoutMillis in 1..30000)
            try { return future.get(timeoutMillis, TimeUnit.MILLISECONDS) }
            catch (failure: ExecutionException) { throw failure.cause ?: failure }
            catch (failure: InterruptedException) { Thread.currentThread().interrupt(); throw failure }
        }
    }
    private class Work(val action: (PendingScope) -> Unit, val result: CompletableFuture<Unit>,
        val ownedPublicBytes: ByteArray? = null, val ownedPrivateBytes: ByteArray? = null)
    private val gate = Object()
    private val queue = ArrayDeque<Work>()
    private val tickets = IdentityHashMap<VeilDeviceEnrollmentCoordinator.Ticket, Boolean>()
    private val initResult = CompletableFuture<Unit>()
    private var closeResult: CompletableFuture<CloseDisposition>? = null
    private var closeRequested = false
    private var state = State.STARTING
    private var firstFailure: Throwable? = null
    private var pendingStatus: VeilDeviceEnrollmentPendingStore.Status? = null
    private var reopenedRows = 0
    private var ticketCount = 0
    private var lostPending = false
    private var untrackedTicket: VeilDeviceEnrollmentCoordinator.Ticket? = null
    private var coordinator: VeilDeviceEnrollmentCoordinator? = null
    private var activeScope: PendingScope? = null
    private var nativeCustody: VeilNativeWorkerCustody? = null
    private var productPorts: VeilNativeProductPorts? = null
    private var productMessaging: VeilSocialMessagingCoordinator? = null
    private var nativeMessageBusiness: VeilNativeMessageBusiness? = null
    private var nativeMessageBindingAttempt: VeilNativeMessageBusiness.Binding? = null
    private var nativeMessageAttached = false
    private var nativeMessageAttachFailure: Throwable? = null
    private var nativeMatrixBinding: VeilMatrixProductBinding? = null
    private var nativeMatrixSource: VeilNativeMatrixSource? = null
    private var nativeInitialPrekeys: VeilInitialPrekeyHttp? = null
    private var nativeInitialPrekeyOperation: String? = null
    private var nativeInitialPrekeyFailure: Throwable? = null
    // Routing hint only; every use still requires the original native current check.
    private var nativeMatrixSourceEligible = false
    private val acceptedDeviceOriginalStore = VeilAcceptedDeviceOriginalStore(context)
    private var acceptedDeviceOriginalPersistenceFailure: Throwable? = null
    private var acceptedDeviceOriginalRestoreAttempted = false
    private var acceptedDeviceOriginalRestoreResult: ProductRecoveryObservation? = null
    private var acceptedDeviceOriginalRestoreFailure: Throwable? = null
    // Worker-owned originals survive timeout, callback failure and UNKNOWN.
    // Neither a local pair nor its numeric status grants device authority.
    private var resumedPreparedLocalIntent: VeilLocalGenesisProducer.Original? = null
    private var localGenesisInput: VeilLocalGenesisInput? = null
    private var localGenesisCommand: VeilOwnKeyPrivateCommand? = null
    private var localGenesisJournalBinding: VeilLocalGenesisJournalBinding? = null
    private var localGenesisStatus: Int? = null
    private var retainedRecoveryInput: VeilLocalRecoveryInput? = null
    private var recoveryReadAttempted = false
    private var recoveryReadStatus: Int? = null
    private var authenticatedPublicProjection: ByteArray? = null
    private var firstDeviceIntent: FirstDeviceIntent? = null
    private var coldRecoveryLease: VeilOwnKeyColdRecoveryLease? = null
    private var coldBeginAttempted = false
    private var coldBeginStatus: Int? = null
    private var coldReadAttempted = false
    private var coldReadStatus: Int? = null
    private var authenticatedColdRecoveryLease: VeilOwnKeyColdRecoveryLease? = null
    private var localAuthenticationOriginal: LocalAuthenticationOriginal? = null
    private var localAuthenticationWarmInput: VeilLocalRecoveryInput? = null
    private var localAuthenticationColdLease: VeilOwnKeyColdRecoveryLease? = null

    /** Process-local original. Only this owner can supply its actual retained
     * projection/input; neither a status DTO nor a public byte tuple can do so.
     * Public material is linkable. No first-trust or YPA1 evidence is created. */
    internal inner class FirstDeviceIntent internal constructor(
        private val original: VeilLocalRecoveryInput?,
        private val coldOriginal: VeilOwnKeyColdRecoveryLease?,
        projection: ByteArray
    ) {
        private val request: VeilFirstDeviceChallengeWire.Request
        private var canceled = false
        private var productOwnsFinalClose = false
        private fun hasOriginalBinding(): Boolean = if (coldOriginal != null) {
            original == null && authenticatedColdRecoveryLease === coldOriginal && coldRecoveryLease === coldOriginal
        } else original != null && retainedRecoveryInput === original && authenticatedColdRecoveryLease == null
        private fun requireOriginalCurrent() {
            check(hasOriginalBinding()) { "FIRST_DEVICE_ORIGINAL_CHANGED" }
            if (coldOriginal != null) coldOriginal.requireAuthenticatedPairCurrent(checkNotNull(authenticatedPublicProjection))
            else checkNotNull(original).revalidateOriginal(checkNotNull(localGenesisCommand))
        }
        init {
            check(Thread.currentThread() === worker && activeScope?.live == true)
            check(hasOriginalBinding() && projection === authenticatedPublicProjection)
            check(!closeRequested && !lostPending && firstDeviceIntent == null)
            requireOriginalCurrent()
            request = VeilFirstDeviceChallengeWire.Request.fromProjection(projection)
        }
        internal fun requestForOriginal(): VeilFirstDeviceChallengeWire.Request = synchronized(gate) {
            check(firstDeviceIntent === this && hasOriginalBinding() && !canceled)
            check(!closeRequested && !lostPending && state !in setOf(State.CLOSING, State.CLOSED, State.CLOSE_UNRESOLVED, State.INIT_FAILED))
            request
        }
        private var sourcePrepared: VeilFirstDeviceEnrollmentWire.Prepared? = null
        private var sourceBeginStatus: Int? = null
        private var sourceCancelAttempted = false
        private var sourceCancelStatus: Int? = null
        private var sourceCancelFailure: Throwable? = null
        private var accountChannelBorrow: VeilSocialLoginClient.AccountChannelBorrow? = null
        private var signatureObservationAttempted = false
        private var signatureCleanupStatus: Int? = null
        private var nativeAccountRetiring = false
        private var signatureCleanupAttempted = false
        private var signatureCleanupFailure: Throwable? = null
        private var runtimeCoreAttempted = false
        private var runtimeCoreCloseAttempted = false
        private var runtimeCoreCloseStatus: Int? = null
        private var runtimeCorePrepareStatus: Int? = null
        @Volatile private var deviceProvisioningAttempted = false
        @Volatile private var deviceProvisioningUi: VeilDeviceProvisioningConfirmation? = null
        @Volatile private var deviceProvisioningCoordinator: VeilDeviceProvisioningNativeCoordinator? = null
        private var deviceProvisioningRequest: VeilDeviceProvisioningConfirmation.Request? = null
        private var deviceProvisioningFailure: Throwable? = null
        internal fun requestDeviceProvisioningReview(activity: android.app.Activity,
            prepared: VeilFirstDeviceEnrollmentWire.Prepared,
            borrow: VeilSocialLoginClient.AccountChannelBorrow,
            originalCurrent: () -> Boolean,
            queryWallet: () -> Unit): CompletableFuture<VeilDeviceProvisioningConfirmation.Outcome> = onOriginalWorker {
            requestForOriginal()
            check(sourcePrepared === prepared && accountChannelBorrow === borrow && !nativeAccountRetiring)
            // DEVICE bootstrap must precede Runtime Core / existing-device guards.
            // This is only an original-account refuse gate; Native open still
            // acquires and checks its genuine provisioning Source independently.
            check(sourceBeginStatus == 71 && !sourceCancelAttempted)
            borrow.requireSourceRefresh()
            deviceProvisioningRequest?.let { return@onOriginalWorker it.result }
            deviceProvisioningFailure?.let { throw it }
            check(!deviceProvisioningAttempted) { "DEVICE_PROVISIONING_ORIGINAL_REVIEW_RETAINED" }
            deviceProvisioningAttempted = true
            try {
                val coordinator = VeilDeviceProvisioningNativeCoordinator(context, original, coldOriginal, borrow, activity, originalCurrent)
                // UI calls enqueue onto this same owner; Native callbacks below
                // execute directly, never nested blocking onOriginalWorker.
                val confirmation = VeilDeviceProvisioningConfirmation(java.util.concurrent.Executor { task ->
                    dispatch {
                        check(firstDeviceIntent === this && hasOriginalBinding())
                        task.run()
                    }
                })
                deviceProvisioningCoordinator = coordinator; deviceProvisioningUi = confirmation
                val request = confirmation.request(activity, coordinator, queryWallet)
                deviceProvisioningRequest = request
                request.result
            } catch (failure: Throwable) { deviceProvisioningFailure = failure; throw failure }
        }
        internal fun selectOriginalDeviceGuardedContinuation(
            prepared: VeilFirstDeviceEnrollmentWire.Prepared,
            borrow: VeilSocialLoginClient.AccountChannelBorrow,
        ): Boolean = onOriginalWorker {
            requestForOriginal()
            check(sourcePrepared === prepared && accountChannelBorrow === borrow && !nativeAccountRetiring)
            check(sourceBeginStatus == 71 && !sourceCancelAttempted)
            val request = deviceProvisioningRequest ?: return@onOriginalWorker false
            val outcome = request.result.getNow(null)
            if (outcome != VeilDeviceProvisioningConfirmation.Outcome.RECEIPT_OBSERVED &&
                outcome != VeilDeviceProvisioningConfirmation.Outcome.WALLET_PENDING &&
                outcome != VeilDeviceProvisioningConfirmation.Outcome.WALLET_UNKNOWN)
                return@onOriginalWorker false
            val selected = deviceProvisioningCoordinator?.selectGuardedContinuationOnWorker() == true
            if (selected) request.dismissRetainedReview()
            selected
        }
        internal fun deviceProvisioningSelected(): Boolean = deviceProvisioningAttempted
        internal fun deviceProvisioningRetainsNativeOriginal(): Boolean =
            deviceProvisioningCoordinator?.retainsNativeOriginal() == true
        internal fun invalidateDeviceProvisioningReview() { deviceProvisioningUi?.invalidate() }
        internal fun observeDeviceProvisioningOriginal(afterReceipt: String?): String {
            var observed = "DEVICE_PROVISIONING_UNKNOWN_RETAINED"
            // Read/cleanup needs the same immutable owner, not renewed account
            // authentication or a new Source/nonce/prompt after window loss.
            val receipt = dispatchOwnedPublic(null) {
                check(firstDeviceIntent === this && hasOriginalBinding())
                val request = deviceProvisioningRequest
                if (request == null) return@dispatchOwnedPublic
                if (!request.result.isDone) { observed = "DEVICE_PROVISIONING_REVIEW_PENDING"; return@dispatchOwnedPublic }
                val outcome = request.result.getNow(VeilDeviceProvisioningConfirmation.Outcome.SUBMISSION_UNRESOLVED)
                observed = checkNotNull(deviceProvisioningCoordinator).observeStatusOnWorker(outcome, afterReceipt)
                if (observed == "DEVICE_PROVISIONING_WALLET_DENIED") request.dismissRetainedReview()
            }
            while (true) { try { receipt.await(30000); break } catch (_: java.util.concurrent.TimeoutException) { /* same read */ } }
            return observed
        }
        private fun stopDeviceProvisioningOnOwnerThread() {
            check(Thread.currentThread() === worker)
            deviceProvisioningUi?.invalidate()
            deviceProvisioningCoordinator?.stopOriginalOnWorker()
        }
        private fun <T> onOriginalWorker(ownedPublicBytes: ByteArray? = null,
            ownedPrivateBytes: ByteArray? = null, body: () -> T): T {
            var value: T? = null
            val receipt = dispatchOwnedBytes(ownedPublicBytes, ownedPrivateBytes) {
                check(firstDeviceIntent === this && hasOriginalBinding())
                requireOriginalCurrent()
                value = body()
            }
            while (true) {
                try { receipt.await(30000); break }
                catch (_: java.util.concurrent.TimeoutException) { /* same receipt, not another dispatch */ }
            }
            @Suppress("UNCHECKED_CAST")
            return value as T
        }
        internal fun beginSourceCurrent(prepared: VeilFirstDeviceEnrollmentWire.Prepared,
            selection: VeilFirstDeviceSourceWire.Selection): VeilFirstDeviceSourceWire.Start = onOriginalWorker {
            requestForOriginal()
            check(authenticatedPublicProjection != null && sourcePrepared == null)
            check(prepared.original.operation == request.operation)
            sourcePrepared = prepared
            val nonce = ByteArray(32)
            val scope = selection.scopeCopy(); val head = selection.headCopy(); val catalog = selection.catalogCopy()
            val issuer = prepared.issuerMessageCopy(); val target = prepared.targetMessageCopy()
            try {
                val code = if (coldOriginal != null) coldOriginal.beginSourceCurrent(scope, head, catalog, issuer, target, nonce)
                    else checkNotNull(localGenesisCommand).beginSourceCurrent(checkNotNull(original), scope, head, catalog, issuer, target, nonce)
                sourceBeginStatus = code
                VeilFirstDeviceSourceWire.Start(code, if (code == 71) nonce else null)
            } finally { nonce.fill(0); scope.fill(0); head.fill(0); catalog.fill(0); issuer.fill(0); target.fill(0) }
        }
        internal fun initialStorageAssociation(prepared: VeilFirstDeviceEnrollmentWire.Prepared): VeilFirstDeviceStorageWire.Association = onOriginalWorker {
            requestForOriginal()
            check(sourcePrepared === prepared && sourceBeginStatus == 71 && !sourceCancelAttempted)
            val bytes = if (coldOriginal != null)
                coldOriginal.copyInitialCoreStorageAssociation(checkNotNull(authenticatedPublicProjection))
            else checkNotNull(localGenesisCommand).copyInitialCoreStorageAssociation(checkNotNull(original))
            try {
                val result = VeilFirstDeviceStorageWire.Association.decode(bytes)
                requestForOriginal()
                check(sourcePrepared === prepared && sourceBeginStatus == 71 && !sourceCancelAttempted)
                requireOriginalCurrent()
                result
            } finally { bytes.fill(0) }
        }
        internal fun acceptSourceCurrent(prepared: VeilFirstDeviceEnrollmentWire.Prepared, evidence: ByteArray): Int {
            // IO may stop waiting without cancelling the queued receipt. The
            // worker must not borrow an array the IO finally block will wipe.
            val retained = evidence.copyOf()
            return onOriginalWorker(retained) {
                requestForOriginal()
                check(sourcePrepared === prepared && sourceBeginStatus == 71 && !sourceCancelAttempted)
                if (coldOriginal != null) coldOriginal.acceptSourceCurrent(retained)
                else checkNotNull(localGenesisCommand).acceptSourceCurrent(checkNotNull(original), retained)
            }
        }
        internal fun prepareNativeAccountChannel(prepared: VeilFirstDeviceEnrollmentWire.Prepared,
            borrow: VeilSocialLoginClient.AccountChannelBorrow): Int = onOriginalWorker {
            requestForOriginal()
            check(!nativeAccountRetiring) { "NATIVE_ACCOUNT_RETIRING" }
            check(sourcePrepared === prepared && sourceBeginStatus == 71 && !sourceCancelAttempted)
            check(accountChannelBorrow == null || accountChannelBorrow === borrow)
            accountChannelBorrow = borrow // retained before crossing the native boundary
            if (coldOriginal != null) VeilNativeAccountChannel.prepare(context, coldOriginal, borrow)
            else VeilNativeAccountChannel.prepare(context, checkNotNull(original), borrow)
        }
        internal fun prepareNativeRuntimeCore(prepared: VeilFirstDeviceEnrollmentWire.Prepared,
            borrow: VeilSocialLoginClient.AccountChannelBorrow, originals: ByteArray): Int {
            val retained = originals.copyOf()
            return onOriginalWorker(retained) {
                requestForOriginal()
            check(!nativeAccountRetiring) { "NATIVE_ACCOUNT_RETIRING" }
                check(sourcePrepared === prepared && sourceBeginStatus == 71 && !sourceCancelAttempted)
                check(accountChannelBorrow === borrow && !signatureObservationAttempted && !runtimeCoreAttempted)
                runtimeCoreAttempted = true // prior to JNI; exceptions/UNKNOWN keep the original attempt
                runtimeCorePrepareStatus = 8
                val code = if (coldOriginal != null) VeilNativeAccountChannel.prepareRuntimeCore(context, coldOriginal, borrow, retained)
                    else VeilNativeAccountChannel.prepareRuntimeCore(context, checkNotNull(original), borrow, retained)
                runtimeCorePrepareStatus = code
                code
            }
        }
        internal fun currentNativeRuntimeCore(prepared: VeilFirstDeviceEnrollmentWire.Prepared,
            borrow: VeilSocialLoginClient.AccountChannelBorrow): Int = onOriginalWorker {
            requestForOriginal()
            check(!nativeAccountRetiring) { "NATIVE_ACCOUNT_RETIRING" }
            check(sourcePrepared === prepared && !sourceCancelAttempted && accountChannelBorrow === borrow)
            check(runtimeCoreAttempted && !runtimeCoreCloseAttempted && !signatureObservationAttempted)
            if (coldOriginal != null) VeilNativeAccountChannel.runtimeCoreCurrent(context, coldOriginal, borrow)
            else VeilNativeAccountChannel.runtimeCoreCurrent(context, checkNotNull(original), borrow)
        }
        private fun closeRuntimeCoreOnOwnerThread(): Int? {
            var code: Int? = null
            check(firstDeviceIntent === this && hasOriginalBinding() && Thread.currentThread() === worker)
            if (runtimeCoreAttempted) {
                check(accountChannelBorrow == null || signatureCleanupStatus == VeilNativeAccountChannel.SIGNATURE_RAM_CLOSED) {
                    "CORE_STARTUP_CHILD_DEBT_RETAINED"
                }
                if (!runtimeCoreCloseAttempted) {
                    runtimeCoreCloseAttempted = true
                    runtimeCoreCloseStatus = 8 // an exception retains UNKNOWN and never starts another close
                    val borrow = checkNotNull(accountChannelBorrow)
                    runtimeCoreCloseStatus = if (coldOriginal != null) VeilNativeAccountChannel.closeRuntimeCore(context, coldOriginal, borrow)
                        else VeilNativeAccountChannel.closeRuntimeCore(context, checkNotNull(original), borrow)
                }
                code = runtimeCoreCloseStatus
            }
            return code
        }
        internal fun closeNativeRuntimeCore(): Int? {
            var code: Int? = null
            val receipt = dispatchOwnedPublic(null) { code = closeRuntimeCoreOnOwnerThread() }
            while (true) {
                try { receipt.await(30000); break }
                catch (_: java.util.concurrent.TimeoutException) { /* same original cleanup receipt */ }
            }
            return code
        }
        internal fun observeNativeSignatures(prepared: VeilFirstDeviceEnrollmentWire.Prepared,
            borrow: VeilSocialLoginClient.AccountChannelBorrow): VeilNativeAccountChannel.ObservedSignatures? = onOriginalWorker {
            requestForOriginal()
            check(!nativeAccountRetiring) { "NATIVE_ACCOUNT_RETIRING" }
            check(sourcePrepared === prepared && sourceBeginStatus == 71 && !sourceCancelAttempted)
            check(accountChannelBorrow === borrow && !signatureObservationAttempted)
            signatureObservationAttempted = true // null/partial/late failure never re-observes or signs
            val observed = if (coldOriginal != null) VeilNativeAccountChannel.observe(context, coldOriginal, borrow, prepared)
                else VeilNativeAccountChannel.observe(context, checkNotNull(original), borrow, prepared)
            try {
                requestForOriginal()
                borrow.requireSourceRefresh()
                observed
            } catch (primary: Throwable) { observed?.close(); throw primary }
        }

        internal fun acceptCommittedDeviceRecords(prepared: VeilFirstDeviceEnrollmentWire.Prepared,
            records: ByteArray, courierRecord: ByteArray? = null): ProductStartObservation {
            val retained = records.copyOf()
            val courier = courierRecord?.copyOf()
            return onOriginalWorker(retained, courier) {
                requestForOriginal()
                check(sourcePrepared === prepared && sourceBeginStatus == 71 && !sourceCancelAttempted)
                check(signatureObservationAttempted && accountChannelBorrow != null)
                // The same original worker owns native acquire/current and any
                // partial failure. HTTP records and result observations do not
                // supply the separate genuine source/store/courier owner.
                // Missing companion DATA is unavailable, never a grant or a
                // reason to poison the Source with a premature metadata read.
                if (courier == null) return@onOriginalWorker ProductStartObservation.NATIVE_SOURCE_REQUIRED
                require(courier.size in 1..VeilFirstDeviceEnrollmentWire.COURIER_RECORD_LIMIT)
                val scope = checkNotNull(activeScope)
                scope.acceptDeviceRecords(retained, false)
                // Native current succeeded for this exact normal HTTP original.
                // Store success is separate from Native consumption; a storage
                // failure retains its first cause and never claims cold recovery.
                scope.retainAcceptedDeviceOriginal(request.operation, retained)
                requestForOriginal()
                val result = scope.startOriginalAcceptedProduct(courier)
                requestForOriginal()
                if (result == ProductStartObservation.ATTACHED_OBSERVED) synchronized(gate) {
                    check(nativeMessageAttached && nativeMatrixSource != null && nativeMessageBusiness != null)
                    productOwnsFinalClose = true // cleanup ownership only, never a grant or replay permission
                }
                result
            }
        }

        /** Cleanup deliberately uses immutable identity, not the expired authorization predicate.
         * It never clears the retained request, journal, attempts or UNKNOWN. */
        private fun closeSignaturesOnOwnerThread(): Int? {
            var code: Int? = null
            check(firstDeviceIntent === this && hasOriginalBinding())
            check(Thread.currentThread() === worker)
            nativeAccountRetiring = true // freeze new business actions before child cleanup
            val borrowed = accountChannelBorrow
            if (borrowed != null) {
                if (!signatureCleanupAttempted) {
                    signatureCleanupAttempted = true
                    signatureCleanupStatus = 16 // preserve unresolved child debt across Throwable/late cleanup
                    try {
                        signatureCleanupStatus = if (coldOriginal != null) VeilNativeAccountChannel.closeSignatures(context, coldOriginal, borrowed)
                        else VeilNativeAccountChannel.closeSignatures(context, checkNotNull(original), borrowed)
                    } catch (failure: Throwable) {
                        signatureCleanupFailure = failure
                        throw failure
                    }
                }
                signatureCleanupFailure?.let { throw it }
                code = signatureCleanupStatus
                check(code == VeilNativeAccountChannel.SIGNATURE_RAM_CLOSED) {
                    "FIRST_DEVICE_SIGNATURE_CLEANUP_UNRESOLVED"
                }
            }
            return code
        }
        internal fun closeNativeSignatures(): Int? {
            var code: Int? = null
            val receipt = dispatchOwnedPublic(null) { code = closeSignaturesOnOwnerThread() }
            while (true) {
                try { receipt.await(30000); break }
                catch (_: java.util.concurrent.TimeoutException) { /* same original cleanup receipt */ }
            }
            return code
        }
        /** Called directly by the original worker at its close barrier, never
         * re-dispatched into the closing queue or inferred from Core0. */
        internal fun closeAccountForOwner() {
            check(Thread.currentThread() === worker)
            // The normal barrier has already drained live message/device loans.
            // Original cancel75 retires this Source request, not committed device authority.
            cancelSourceOnOwnerThread()
            val child = closeSignaturesOnOwnerThread()
            check(child == null || child == VeilNativeAccountChannel.SIGNATURE_RAM_CLOSED) {
                "FIRST_DEVICE_SIGNATURE_CLEANUP_UNRESOLVED"
            }
            val parent = closeRuntimeCoreOnOwnerThread()
            check(parent == null || parent == 0) { "CORE_STARTUP_CLEANUP_UNKNOWN_RETAINED" }
        }
        internal fun productOwnerHandlesFinalClose(): Boolean = synchronized(gate) { productOwnsFinalClose }

        private fun cancelSourceOnOwnerThread() {
            check(Thread.currentThread() === worker && firstDeviceIntent === this && hasOriginalBinding())
            stopDeviceProvisioningOnOwnerThread() // must observe original stop BEFORE Source/Core retirement
            nativeAccountRetiring = true
            if (sourcePrepared != null) {
                if (!sourceCancelAttempted) {
                    sourceCancelAttempted = true // original cancellation only, never a replacement operation
                    sourceCancelStatus = 16
                    try {
                        sourceCancelStatus = if (coldOriginal != null) coldOriginal.cancelSourceCurrent()
                            else checkNotNull(localGenesisCommand).cancelSourceCurrent(checkNotNull(original))
                    } catch (failure: Throwable) { sourceCancelFailure = failure; throw failure }
                }
                sourceCancelFailure?.let { throw it }
                check(sourceCancelStatus == 75) { "SOURCE_CANCEL_UNKNOWN_RETAINED" }
            }
        }
        internal fun cancelSourceCurrent() = onOriginalWorker { cancelSourceOnOwnerThread() }
        internal fun acknowledgeCancellation() = synchronized(gate) {
            check(firstDeviceIntent === this)
            canceled = true
        }
        internal fun unresolved(): Boolean = synchronized(gate) { !canceled && !productOwnsFinalClose }
        override fun toString() = "FirstDeviceIntent[owner retained; unverified]"
    }
    private val worker = Thread({ runWorker() }, "YNX-Social-CryptoEngine-Owner").apply {
        // Process death is not reconciliation. The pending journal survives;
        // no native private owner has been admitted by this component.
        isDaemon = true
    }

    fun initialized(): Receipt<Unit> = Receipt(this, initResult)
    /** Prompt routing DATA only; Native revalidates the original on use. */
    fun hasInspectedColdOriginal(): Boolean = synchronized(gate) {
        coldReadStatus == 61 && coldRecoveryLease != null
    }
    fun firstDeviceProofOriginAvailable(): Boolean = synchronized(gate) {
        authenticatedPublicProjection != null && (
            (authenticatedColdRecoveryLease != null && authenticatedColdRecoveryLease === coldRecoveryLease &&
                retainedRecoveryInput == null && localGenesisCommand == null) ||
            (authenticatedColdRecoveryLease == null && retainedRecoveryInput != null && localGenesisCommand != null))
    }
    fun read(): Snapshot = synchronized(gate) {
        Snapshot(state, queue.size, ticketCount, reopenedRows, pendingStatus, firstFailure != null,
            localGenesisAttempted = localGenesisInput != null, localGenesisStatus = localGenesisStatus)
    }
    fun dispatch(action: (PendingScope) -> Unit): Receipt<Unit> = dispatchOwnedPublic(null, action)
    private fun dispatchOwnedPublic(ownedPublicBytes: ByteArray?, action: (PendingScope) -> Unit): Receipt<Unit> =
        dispatchOwnedBytes(ownedPublicBytes, null, action)
    private fun dispatchOwnedBytes(ownedPublicBytes: ByteArray?, ownedPrivateBytes: ByteArray?,
        action: (PendingScope) -> Unit): Receipt<Unit> {
        var accepted = false
        try {
            check(Thread.currentThread() !== worker) { "VEIL_OWNER_REENTRANT_DISPATCH" }
            val result = CompletableFuture<Unit>()
            synchronized(gate) {
                check(state !in setOf(State.CLOSING, State.CLOSED, State.INIT_FAILED, State.CLOSE_UNRESOLVED) && !closeRequested) {
                    "VEIL_OWNER_NOT_ACCEPTING_WORK"
                }
                check(queue.size < MAX_QUEUED) { "VEIL_OWNER_QUEUE_FULL" }
                queue.addLast(Work(action, result, ownedPublicBytes, ownedPrivateBytes))
                accepted = true
                gate.notifyAll()
            }
            return Receipt(this, result)
        } catch (primary: Throwable) {
            if (!accepted) { ownedPublicBytes?.fill(0); ownedPrivateBytes?.fill(0) }
            throw primary
        }
    }
    internal fun invalidateDeviceProvisioningReview() {
        val original = synchronized(gate) { firstDeviceIntent }
        original?.invalidateDeviceProvisioningReview()
    }
    fun close(): Receipt<CloseDisposition> {
        // Reject BEFORE changing queue/close flags; a callback cannot destroy
        // its enclosing coordinator or synchronously close another scope.
        check(Thread.currentThread() !== worker) { "VEIL_OWNER_CLOSE_INSIDE_WORKER" }
        invalidateDeviceProvisioningReview()
        synchronized(gate) {
            val old = closeResult
            if (old != null && (!old.isDone || state in setOf(State.CLOSED, State.INIT_FAILED, State.CLOSE_UNRESOLVED))) {
                return Receipt(this, old)
            }
            val result = CompletableFuture<CloseDisposition>()
            closeResult = result; closeRequested = true; gate.notifyAll()
            return Receipt(this, result)
        }
    }
    private fun retainFailure(failure: Throwable): Throwable = synchronized(gate) {
        val first = firstFailure
        if (first == null) firstFailure = failure
        else if (first !== failure) try { first.addSuppressed(failure) } catch (_: Throwable) { }
        firstFailure!!
    }
    private fun refresh() {
        val status = coordinator!!.durableStatus()
        synchronized(gate) { pendingStatus = status; ticketCount = tickets.size + if (untrackedTicket == null) 0 else 1 }
    }
    private fun runWorker() {
        var localOpened = false
        try {
            coordinator = VeilDeviceEnrollmentCoordinator.openAppPrivate(context)
            coordinator!!.withReopenedRecords { rows -> reopenedRows = rows.size }
            refresh()
            localOpened = true
            val localRecord = coordinator!!.localGenesisStatus().record
            if (reopenedRows == 0 && pendingStatus == VeilDeviceEnrollmentPendingStore.Status.RECONCILIATION_REQUIRED &&
                localRecord?.phase == VeilLocalGenesisProducer.Phase.PREPARED && localRecord.nativeIds == null) {
                val resumed = coordinator!!.resumePreparedLocalGenesis("installation-local-v1")
                check(resumed.record === localRecord)
                resumedPreparedLocalIntent = resumed
                refresh()
            }
            // Store the custody object BEFORE any native/linkage operation.
            // A failure must retain its exact primary and this local owner.
            nativeCustody = VeilNativeWorkerCustody()
            nativeCustody!!.open()
            // The local-key intent is stored separately from enrollment rows.
            // Read only retained metadata, outside the owner publication gate.
            val retainedLocalIntent = pendingStatus == VeilDeviceEnrollmentPendingStore.Status.UNKNOWN ||
                (coordinator!!.localGenesisStatus().record != null && resumedPreparedLocalIntent == null)
            synchronized(gate) { state = VeilLocalDeviceRouting.initialOwnerState(
                reopenedRows, pendingStatus, retainedLocalIntent) }
            initResult.complete(Unit)
        } catch (primary: Throwable) {
            retainFailure(primary)
            var cleanupFailed = localOpened
            if (!localOpened) try { coordinator?.close() }
            catch (secondary: Throwable) { cleanupFailed = true; retainFailure(secondary) }
            synchronized(gate) {
                state = if (localOpened) State.RECOVERY_PENDING
                    else if (cleanupFailed) State.CLOSE_UNRESOLVED else State.INIT_FAILED
                while (queue.isNotEmpty()) queue.removeFirst().result.completeExceptionally(primary)
                val result = closeResult ?: CompletableFuture<CloseDisposition>().also { closeResult = it }
                result.completeExceptionally(primary); closeRequested = false
            }
            initResult.completeExceptionally(primary)
            if (!cleanupFailed) { coordinator = null; return }
            // Retain failed cleanup owner on THIS worker; no forced release.
        }
        while (true) {
            val work = synchronized(gate) {
                while (queue.isEmpty() && !closeRequested) {
                    try { gate.wait() } catch (failure: InterruptedException) {
                        retainFailure(failure) // not permission to drop ownership
                    }
                }
                if (queue.isNotEmpty()) queue.removeFirst() else {
                    // Atomically select the close barrier while admission is
                    // still closed. Keep it closed through actual release.
                    state = State.CLOSING
                    null
                }
            }
            if (work != null) {
                executeWork(work)
            } else {
                val result = synchronized(gate) { closeResult!! }
                try { refresh() }
                catch (failure: Throwable) {
                    val primary = retainFailure(failure)
                    synchronized(gate) {
                        state = State.DRAIN_REQUIRED; closeRequested = false
                        result.completeExceptionally(primary)
                    }
                    // Status failure is not release permission. Keep this exact
                    // worker/coordinator and permit only explicit recovery work;
                    // a later close rechecks the actual status, not a cached OK.
                    continue
                }
                val originalWorkRetained = try {
                    productWorkBlocksOwnerClose(nativeMatrixSource, nativeMatrixBinding,
                        nativeMessageBusiness, productMessaging, nativeMessageAttachFailure, nativeInitialPrekeys) ||
                        productPorts?.hasRetainedMessages() == true ||
                        ((coldRecoveryLease == null || coldRecoveryLease?.isRetired() == true) &&
                            coordinator?.hasColdJournalBorrow() == true) ||
                        firstDeviceIntent?.unresolved() == true || tickets.isNotEmpty() ||
                        untrackedTicket != null || lostPending || reopenedRows > 0 ||
                        pendingStatus == VeilDeviceEnrollmentPendingStore.Status.UNKNOWN
                } catch (failure: Throwable) {
                    val primary = retainFailure(failure)
                    synchronized(gate) {
                        state = State.DRAIN_REQUIRED
                        closeRequested = false
                        result.completeExceptionally(primary)
                    }
                    // A failed ownership observation is not a cleanup grant.
                    // Keep this worker and every original; finish the receipt
                    // rather than letting an exception terminate the thread.
                    continue
                }
                if (originalWorkRetained) {
                    synchronized(gate) {
                        state = State.DRAIN_REQUIRED; closeRequested = false
                        result.complete(CloseDisposition.PENDING_RECONCILIATION_REQUIRED)
                    }
                    continue // same worker/coordinator retained; exact original cleanup can be queued
                }
                try {
                    // A failed command construction is not evidence that native
                    // effects are absent. Retain the original worker and input.
                    if (localGenesisInput != null && localGenesisCommand == null) {
                        synchronized(gate) {
                            state = State.DRAIN_REQUIRED; closeRequested = false
                            result.complete(CloseDisposition.PENDING_RECONCILIATION_REQUIRED)
                        }
                        continue
                    }
                    closeProductChildrenForOwner()
                    // The owner is already CLOSING and accepts no business work.
                    // Keep original cleanup admission until Source cancel75 and
                    // all Native children have definitively drained.
                    localGenesisJournalBinding?.closeAdmission()
                    localGenesisCommand?.closeAdmission()
                    // Children are actually closed before the parent disposes its pair/reader.
                    if (coldRecoveryLease?.closeForOwner() == false || coordinator?.hasColdJournalBorrow() == true) {
                        synchronized(gate) {
                            state = State.DRAIN_REQUIRED; closeRequested = false
                            result.complete(CloseDisposition.PENDING_RECONCILIATION_REQUIRED)
                        }
                        continue
                    }
                    if (nativeCustody?.releaseForThreadExit() != true) {
                        synchronized(gate) {
                            state = State.DRAIN_REQUIRED; closeRequested = false
                            result.complete(CloseDisposition.PENDING_RECONCILIATION_REQUIRED)
                        }
                        continue
                    }
                    coordinator!!.close()
                    coordinator = null
                    synchronized(gate) {
                        state = State.CLOSED; closeRequested = false
                        pendingStatus = VeilDeviceEnrollmentPendingStore.Status.CLOSED
                        result.complete(CloseDisposition.CLOSED_LOCAL_ONLY)
                    }
                    return
                } catch (failure: Throwable) {
                    val primary = retainFailure(failure)
                    synchronized(gate) {
                        state = State.CLOSE_UNRESOLVED; closeRequested = false
                        result.completeExceptionally(primary)
                    }
                    // No release retry/clearing fiction if the current close port
                    // cannot establish resolution; keep reference and worker.
                }
            }
        }
    }
    /** Original close barrier only. A failed child stops the parent path and
     * retains its original state; no current/admission is inferred here. */
    private fun closeProductChildrenForOwner() {
        check(Thread.currentThread() === worker)
        productPorts?.stopWatching()
        nativeMatrixSource?.closeForOwner()
        productPorts?.closeMessageSessionForClose() // actual nativeCloseMessageSession releases its loan
        productPorts?.releaseAcceptedDeviceForClose()
        firstDeviceIntent?.closeAccountForOwner() // signature child, then Core parent, on this worker
    }

    private fun executeWork(work: Work) {
        var scope: PendingScope? = null
        var failure: Throwable? = null
        try {
            scope = PendingScope(this)
            activeScope = scope
            work.action(scope)
        } catch (primary: Throwable) {
            failure = primary
            retainFailure(primary)
            synchronized(gate) { state = State.RECOVERY_PENDING }
        } finally {
            work.ownedPublicBytes?.fill(0)
            work.ownedPrivateBytes?.fill(0)
            scope?.live = false
            activeScope = null
        }
        // Publish the original receipt only after owned-copy/scope cleanup.
        if (failure == null) work.result.complete(Unit)
        else work.result.completeExceptionally(failure)
    }
    internal class PendingScope internal constructor(private val owner: VeilCryptoEngineOwner) {
        internal var live = true
        private fun checked(): VeilDeviceEnrollmentCoordinator {
            check(Thread.currentThread() === owner.worker && live && owner.activeScope === this) { "VEIL_OWNER_SCOPE_INACTIVE_OR_WRONG_THREAD" }
            return owner.coordinator!!
        }
fun readProductInventory(watch: Boolean): Map<String, Any> {
    checked()
    val ports = owner.productPorts ?: VeilNativeProductPorts().also { owner.productPorts = it }
    return ports.read(watch)
}
/** Authenticated producer transport only, on this original live worker.
 * The caller must supply original signed records, never a login status DTO. */
fun acceptDeviceRecords(originalRecords: ByteArray, restore: Boolean) {
    checked()
    synchronized(owner.gate) {
        check(!owner.closeRequested && !owner.lostPending)
        val ports = owner.productPorts ?: VeilNativeProductPorts().also { owner.productPorts = it }
        ports.acceptDeviceRecords(originalRecords, restore, owner.authenticatedColdRecoveryLease)
        owner.nativeMatrixSourceEligible = true
    }
}
/** PUBLIC original persistence follows the actual normal Native consumer.
 * Neither this cache nor its source label grants authority or replays JNI. */
internal fun retainAcceptedDeviceOriginal(operation: String, records: ByteArray) {
    checked()
    synchronized(owner.gate) {
        check(!owner.closeRequested && !owner.lostPending)
        owner.acceptedDeviceOriginalPersistenceFailure?.let { throw it }
        checkNotNull(owner.productPorts).requireAcceptedDeviceCurrent()
        try {
            owner.acceptedDeviceOriginalStore.retainAccepted(operation, records)
            check(owner.nativeInitialPrekeyOperation == null || owner.nativeInitialPrekeyOperation == operation)
            owner.nativeInitialPrekeyOperation = operation // SAME verified FirstDeviceIntent, not a digest-derived substitute
        }
        catch (failure: Throwable) { owner.acceptedDeviceOriginalPersistenceFailure = failure; throw failure }
    }
}
/** Normal screen-lock-authenticated cold path. Only exact public originals are
 * read; the existing Native restore independently validates source, identity,
 * current, floor, expiry and revocation before any product attachment.
 * A retained/UNKNOWN Native attempt is never acquired again by this method. */
fun restoreAcceptedProductOriginal(): ProductRecoveryObservation {
    checked()
    synchronized(owner.gate) {
        check(!owner.closeRequested && !owner.lostPending)
        checkNotNull(owner.authenticatedPublicProjection)
        requireAuthenticatedLocalOrigin()
        if (owner.acceptedDeviceOriginalRestoreAttempted) {
            owner.acceptedDeviceOriginalRestoreFailure?.let { throw it }
            return checkNotNull(owner.acceptedDeviceOriginalRestoreResult)
        }
        owner.acceptedDeviceOriginalRestoreAttempted = true
        try {
            val original = owner.acceptedDeviceOriginalStore.read()
            val result = if (original == null) ProductRecoveryObservation.NO_ORIGINAL else {
                val records = original.originalCopy()
                try {
                    acceptDeviceRecords(records, true)
                    // Cache remains PUBLIC unverified transport. Native independently
                    // validates records; the server still checks exact enrollment fd2.
                    check(owner.nativeInitialPrekeyOperation == null || owner.nativeInitialPrekeyOperation == original.operation)
                    owner.nativeInitialPrekeyOperation = original.operation
                    when (startOriginalAcceptedProduct()) {
                        ProductStartObservation.NATIVE_SOURCE_REQUIRED -> ProductRecoveryObservation.DEVICE_CURRENT_SOURCE_REQUIRED
                        ProductStartObservation.ATTACHED_OBSERVED -> ProductRecoveryObservation.ATTACHED_OBSERVED
                    }
                } finally { records.fill(0); original.erase() }
            }
            owner.acceptedDeviceOriginalRestoreResult = result
            return result
        } catch (failure: Throwable) {
            owner.acceptedDeviceOriginalRestoreFailure = failure
            throw failure
        }
    }
}
/** Actual normal worker handoff; the callback below can ONLY refuse a close,
 * never grant Source/identity/device rights or fabricate an HTTP provider. */
private fun originalInitialPrekeyHttp(): VeilInitialPrekeyHttp {
    checked()
    val source = checkNotNull(owner.nativeMatrixSource)
    synchronized(owner.gate) { check(!owner.closeRequested && !owner.lostPending) }
    source.checkCurrent()
    owner.nativeInitialPrekeys?.let { check(it.uses(source)); return it }
    val original = VeilInitialPrekeyHttp.create(source, owner.context.applicationContext.packageName) {
        checked()
        synchronized(owner.gate) { check(!owner.closeRequested && !owner.lostPending) }
    }
    owner.nativeInitialPrekeys = original
    return original
}
/** Called by the normal private route worker after it has real PUBLIC locator
 * DATA. Not exposed as a JS algorithm/init action or a caller-created grant. */
internal fun establishInitialConversation(command: Map<String, Any?>, context: Map<String, Any?>,
    peerDevice: String, logical: String): Map<String, Any?> {
    checked()
    val actor = originalInitialPrekeyHttp()
    actor.ensureOwnPublished(checkNotNull(owner.nativeInitialPrekeyOperation))
    val business = checkNotNull(owner.nativeMessageBusiness)
    return actor.claimAndEstablish(business, command, context, peerDevice, logical)
}

/** Normal product calls share the actual worker queue and close fence. */
fun observeOwnDirectoryForUi(action: String): Map<String, Any?> {
    checked()
    synchronized(owner.gate) { check(!owner.closeRequested && !owner.lostPending) }
    // Existing accepted Source only. Opening a page cannot create a Source.
    return owner.nativeMatrixSource?.observeOwnDirectoryForUi(action) ?: VeilOwnDirectoryUi.unavailable()
}

fun processProductRequest(request: VeilSocialMessagingCoordinator.Request): Map<String, Any?> {
    checked()
    synchronized(owner.gate) { check(!owner.closeRequested && !owner.lostPending) }
    val product = owner.productMessaging ?: VeilSocialMessagingCoordinator().also { owner.productMessaging = it }
    return product.process(request) {
        if (owner.nativeMatrixSourceEligible && !owner.nativeMessageAttached) startOriginalAcceptedProduct()
        // These existing local product actions do not publish/claim prekeys or send.
        // Original accepted-Source attachment, current/revoke/view/store checks and
        // retained/UNKNOWN refusals remain inside the unchanged business layer.
        // A normal inbox read (null command) can process incoming work, so it keeps
        // the existing publication policy, as do send/contact/session commands.
        val prekeyIndependent = when (request.command?.get("type")) {
            "reviewRecovery", "openConversation", "viewStoredMessage",
            "searchLocalMessages", "markConversationRead", "loadDraft", "saveDraft" -> true
            else -> false
        }
        if (!prekeyIndependent && owner.nativeMatrixSource != null && owner.nativeMessageAttached) {
            try {
                originalInitialPrekeyHttp().ensureOwnPublished(checkNotNull(owner.nativeInitialPrekeyOperation))
            } catch (failure: Throwable) {
                if (owner.nativeInitialPrekeyFailure == null) owner.nativeInitialPrekeyFailure = failure
                // Device authorization already succeeded independently. Do not
                // relabel it, clear its data, or call ordinary sends before setup.
                return@process if (owner.nativeInitialPrekeys?.hasRetainedWork() == true) "REVIEW_REQUIRED" else "UNAVAILABLE"
            }
        }
        null
    }
}
/** Genuine producer handoff only; there is no JS or observation-to-grant path. */
fun attachMessageProduct(original: VeilSocialMessagingCoordinator.Business) {
    checked()
    synchronized(owner.gate) {
        check(!owner.closeRequested && !owner.lostPending)
        val product = owner.productMessaging ?: VeilSocialMessagingCoordinator().also { owner.productMessaging = it }
        product.attach(original)
    }
}
/** Original Native producer handoff. No JS setter or default source. */
fun attachNativeMessageProduct(original: VeilNativeMessageBusiness.Binding) {
    checked()
    synchronized(owner.gate) {
        check(!owner.closeRequested && !owner.lostPending)
        owner.nativeMessageAttachFailure?.let { throw it }
        owner.nativeMessageBindingAttempt?.let {
            check(it === original) { "VEIL_PRODUCT_ORIGINAL_BINDING_RETAINED" }
            check(owner.nativeMessageAttached && owner.nativeMessageBusiness?.uses(original) == true) {
                "VEIL_PRODUCT_ORIGINAL_ATTACHMENT_UNRESOLVED" }
            return
        }
        // Capture the original before constructor/current/attach callbacks.
        // Failed construction or publication is not permission to substitute
        // another business or retry the original installation.
        owner.nativeMessageBindingAttempt = original
        try {
            val ports = checkNotNull(owner.productPorts)
            val business = VeilNativeMessageBusiness.owned(ports, original)
            owner.nativeMessageBusiness = business
            attachMessageProduct(business)
            owner.nativeMessageAttached = true
        } catch (failure: Throwable) {
            owner.nativeMessageAttachFailure = failure
            throw failure
        }
    }
}
/** Normal enrollment consumption uses this actual factory result on the same
 * worker. A must first supply genuine original resources through the existing
 * attachNativeMatrixProduct path; no empty/default installer is constructed. */
fun startOriginalAcceptedProduct(): ProductStartObservation = startOriginalAcceptedProduct(null)
fun startOriginalAcceptedProduct(courierRecord: ByteArray?): ProductStartObservation {
    checked()
    synchronized(owner.gate) {
        check(!owner.closeRequested && !owner.lostPending)
        owner.nativeMessageAttachFailure?.let { throw it }
        checkNotNull(owner.productPorts).requireAcceptedDeviceCurrent()
        if (owner.nativeMatrixBinding == null) {
            val ports = checkNotNull(owner.productPorts)
            val retained = owner.nativeMatrixSource
            if (retained == null && !VeilNativeMatrixSource.available()) return ProductStartObservation.NATIVE_SOURCE_REQUIRED
            val source = retained?.also { it.initialize(courierRecord) } ?: VeilNativeMatrixSource.capture(ports, courierRecord) {
                owner.nativeMatrixSource = it // retained before JNI acquisition/metadata callbacks
            }
            attachNativeMatrixProduct(source)
        }
        val original = checkNotNull(owner.nativeMatrixBinding)
        attachNativeMessageProduct(original)
        check(owner.nativeMessageAttached)
        checkNotNull(owner.nativeMessageBusiness).requireStartupProjection()
        checkNotNull(owner.productPorts).requireAcceptedDeviceCurrent()
        return ProductStartObservation.ATTACHED_OBSERVED
    }
}
/** The production path obtains source, protected store and credentials from
 * the same native owner. No JS/source-descriptor or legacy lease factory. */
private fun attachNativeMatrixProduct(source: VeilNativeMatrixSource) {
    checked()
    synchronized(owner.gate) {
        check(!owner.closeRequested && !owner.lostPending)
        check(owner.nativeMatrixSource === source)
        val courier = source.originalCourier()
        val existing = owner.nativeMatrixBinding
        if (existing != null) {
            check(existing.uses(source, courier)) { "VEIL_PRODUCT_ORIGINAL_BINDING_RETAINED" }
            attachNativeMessageProduct(existing)
            return
        }
        checkNotNull(owner.productPorts).requireAcceptedDeviceCurrent()
        source.checkCurrent()
        val binding = VeilMatrixProductBinding.owned(source, courier, owner.attachmentUi)
        owner.nativeMatrixBinding = binding
        attachNativeMessageProduct(binding)
    }
}
/** Same normal worker installation from actual supplied Native custody/store.
 * This does not create a lease, enroll keys or infer authority from login/UI. */
fun attachNativeMatrixProduct(source: VeilMatrixProductBinding.NativeSource,
                              store: VeilNativeStore,
                              courier: VeilMatrixCiphertextHttpTransport) {
    checked()
    synchronized(owner.gate) {
        check(!owner.closeRequested && !owner.lostPending)
        val existing = owner.nativeMatrixBinding
        if (existing != null) {
            check(existing.uses(source, store, courier)) { "VEIL_PRODUCT_ORIGINAL_BINDING_RETAINED" }
            attachNativeMessageProduct(existing)
            return
        }
        checkNotNull(owner.productPorts).requireAcceptedDeviceCurrent()
        source.checkCurrent()
        val binding = VeilMatrixProductBinding.owned(source, store, courier)
        owner.nativeMatrixBinding = binding
        attachNativeMessageProduct(binding)
    }
}
/** Authenticated normal sync caller, never an Expo event-to-authority setter. */
fun receiveMatrixCiphertext(conversationId: String, eventId: String, sender: String, contentJson: String) {
    checked()
    synchronized(owner.gate) { check(!owner.closeRequested && !owner.lostPending) }
    val binding = checkNotNull(owner.nativeMatrixBinding)
    var original: VeilNativeMessageBusiness.Message? = null
    binding.incoming(conversationId, eventId, sender,
        VeilMatrixCiphertextHttpTransport.parseContent(contentJson)) {
        check(original == null); original = it
    }
    receiveNativeMessage(checkNotNull(original))
}
fun receiveNativeMessage(original: VeilNativeMessageBusiness.Message) {
    checked()
    synchronized(owner.gate) { check(!owner.closeRequested && !owner.lostPending) }
    checkNotNull(owner.nativeMessageBusiness).receive(original)
}
fun stopProductInvalidation() {
    checked()
    owner.productPorts?.stopWatching()
}
fun supportsDurableLocalGenesis(): Boolean {

            checked()
            return try { VeilNativeProductControllerBridge.nativeLocalGenesisBindingAbiVersion() == 1 }
            catch (_: UnsatisfiedLinkError) { false }
        }
        fun prepareLocalGenesis(): VeilLocalGenesisProducer.Original {
            val c = checked()
            synchronized(owner.gate) {
                check(owner.state == State.LOCAL_PENDING && !owner.closeRequested && !owner.lostPending)
                check(owner.localGenesisInput == null && owner.localGenesisCommand == null)
            }
            check(supportsDurableLocalGenesis()) { "VEIL_LOCAL_GENESIS_BINDING_ABI_REQUIRED" }
            val original = c.prepareLocalGenesis("installation-local-v1")
            check(c.getOriginalLocalGenesis("installation-local-v1") === original)
            c.revalidateLocalGenesis(original)
            owner.refresh()
            return original
        }
        fun revalidateLocalGenesis(original: VeilLocalGenesisProducer.Original) {
            checked().revalidateLocalGenesis(original)
        }
        fun beginPreparedLocalGenesis(original: VeilLocalGenesisProducer.Original): Int {
            val c = checked()
            // Serialize final owner admission and close with the write-ahead
            // handoff. No await or UI callback between mark, install and JNI.
            synchronized(owner.gate) {
                check(owner.state == State.LOCAL_PENDING && !owner.closeRequested && !owner.lostPending)
                check(owner.localGenesisInput == null && owner.localGenesisCommand == null)
                check(supportsDurableLocalGenesis()) { "VEIL_LOCAL_GENESIS_BINDING_ABI_REQUIRED" }
                c.revalidateLocalGenesis(original)
                val input = c.markLocalGenesisBeforeSubmission(original)
                // Retain before callback installation can fail. SUBMITTED and
                // the original input must survive every subsequent exception.
                owner.localGenesisInput = input
                owner.localGenesisJournalBinding = VeilLocalGenesisJournalBinding.install(input) { ids ->
                    check(checked() === c)
                    c.bindLocalGenesisNativeIds(original, ids)
                }
                val command = VeilOwnKeyPrivateCommand(owner.context)
                owner.localGenesisCommand = command
                val status = command.beginLocalGenesis(input)
                owner.localGenesisStatus = status
                owner.refresh()
                return status
            }
        }
        // Internal producer port only: construct the original input on this
        // same worker from the product's retained local intent. No Expo/JS
        // factory accepts aliases, generations, account claims or auth windows.
        fun beginLocalGenesis(original: VeilLocalGenesisInput): Int {
            checked()
            synchronized(owner.gate) {
                check(owner.state == State.LOCAL_PENDING && !owner.closeRequested && !owner.lostPending) {
                    "VEIL_OWNER_LOCAL_GENESIS_NOT_ADMITTED"
                }
                check(owner.localGenesisInput == null && owner.localGenesisCommand == null) {
                    "VEIL_OWNER_ORIGINAL_LOCAL_GENESIS_RETAINED"
                }
                owner.localGenesisInput = original
            }
            val command = VeilOwnKeyPrivateCommand(owner.context)
            owner.localGenesisCommand = command
            val status = command.beginLocalGenesis(original)
            synchronized(owner.gate) { owner.localGenesisStatus = status }
            return status
        }
        fun readLocalGenesisStatus(): Int {
            checked()
            val command = owner.localGenesisCommand ?: error("VEIL_OWNER_LOCAL_GENESIS_NOT_REQUESTED")
            synchronized(owner.gate) { owner.localGenesisStatus = null }
            val status = command.readLocalStatus()
            synchronized(owner.gate) { owner.localGenesisStatus = status }
            return status
        }
        /** Read-only metadata capture on the original failed command. No JNI,
         * new Original, journal transition, native IDs or recovery authority. */
        /** Same-worker inspection: absence is not a recovery error or authority.
         * Only an untouched fresh journal can return null; all retained cases
         * still use the original command and existing refusal/UNKNOWN path. */
        fun beginColdRecovery(): Int {
            val c = checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                check(owner.localGenesisInput == null && owner.localGenesisCommand == null)
                if (owner.coldBeginAttempted) return checkNotNull(owner.coldBeginStatus) {
                    "VEIL_COLD_ORIGINAL_BEGIN_UNRESOLVED"
                }
                owner.coldBeginAttempted = true // Capture/begin failure never recreates an original.
                val borrow = c.retainedColdJournalBorrow() ?: c.acquireColdJournalBorrow()
                val lease = VeilOwnKeyColdRecoveryLease(owner.context, borrow)
                owner.coldRecoveryLease = lease
                lease.initializeOriginal()
                val status = lease.begin()
                owner.coldBeginStatus = status
                return status
            }
        }
        fun observeColdRecovery(): Int { checked(); return checkNotNull(owner.coldRecoveryLease).observe() }
        fun reconcileColdRecovery(): Int { checked(); return checkNotNull(owner.coldRecoveryLease).reconcile() }
        fun dischargeColdRecovery(): Int { checked(); return checkNotNull(owner.coldRecoveryLease).discharge() }
        fun cleanupColdRecovery(): Int { checked(); return checkNotNull(owner.coldRecoveryLease).cleanup() }
        fun releaseColdRecovery(): Int { checked(); return checkNotNull(owner.coldRecoveryLease).release() }
        fun retainedColdJournalBorrow(): VeilDeviceEnrollmentPendingStore.ColdBorrow? = checked().retainedColdJournalBorrow()
        fun acquireColdJournalBorrow(): VeilDeviceEnrollmentPendingStore.ColdBorrow {
            val c = checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                check(owner.localGenesisInput == null && owner.localGenesisCommand == null)
                return c.acquireColdJournalBorrow()
            }
        }
        private fun readColdLocalPairOriginal(): Int {
            checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                val begun = beginColdRecovery()
                if (begun !in 180..184) return begun // Not a ciphertext or authentication receipt.
                if (owner.coldReadAttempted) return checkNotNull(owner.coldReadStatus) {
                    "VEIL_COLD_ORIGINAL_READ_UNRESOLVED"
                }
                owner.coldReadAttempted = true
                val result = checkNotNull(owner.coldRecoveryLease).readExistingLocalPair()
                owner.coldReadStatus = result
                return result
            }
        }
        fun prepareLocalAuthenticationOriginal(): LocalAuthenticationOriginal {
            checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                owner.localAuthenticationOriginal?.let { original ->
                    val warm = owner.localAuthenticationWarmInput
                    if (warm != null) warm.revalidateOriginal(checkNotNull(owner.localGenesisCommand))
                    else checkNotNull(owner.localAuthenticationColdLease).requireReadOriginal()
                    return original
                }
                if (owner.localGenesisCommand != null) {
                    owner.localAuthenticationWarmInput = prepareExistingLocalRecovery()
                } else {
                    check(owner.coldReadStatus == 61) { "VEIL_COLD_CIPHERTEXT_ORIGINAL_REQUIRED" }
                    val lease = checkNotNull(owner.coldRecoveryLease)
                    lease.requireReadOriginal()
                    owner.localAuthenticationColdLease = lease
                }
                return LocalAuthenticationOriginal().also { owner.localAuthenticationOriginal = it }
            }
        }
        fun authenticatePreparedLocalAuthentication(original: LocalAuthenticationOriginal) {
            checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                check(owner.localAuthenticationOriginal === original)
                val warm = owner.localAuthenticationWarmInput
                if (warm != null) {
                    authenticatePreparedExistingLocalRecovery(warm)
                    return
                }
                check(owner.authenticatedPublicProjection == null)
                val lease = checkNotNull(owner.localAuthenticationColdLease)
                check(owner.coldRecoveryLease === lease && owner.coldReadStatus == 61)
                val projection = lease.authenticateExistingLocalPair()
                try {
                    check(projection.size == 2657 && projection[0] == 5.toByte())
                    check(!owner.closeRequested && !owner.lostPending && owner.localAuthenticationOriginal === original)
                    owner.authenticatedColdRecoveryLease = lease
                    owner.authenticatedPublicProjection = projection
                } catch (failure: Throwable) { projection.fill(0); throw failure }
            }
        }
        private fun requireAuthenticatedLocalOrigin() {
            checked()
            val cold = owner.authenticatedColdRecoveryLease
            if (cold != null) {
                check(owner.coldRecoveryLease === cold)
                cold.requireAuthenticatedPairCurrent(checkNotNull(owner.authenticatedPublicProjection))
            } else checkNotNull(owner.retainedRecoveryInput).revalidateOriginal(checkNotNull(owner.localGenesisCommand))
        }
        fun inspectExistingLocalRecovery(): Int? {
            val c = checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                val original = c.localGenesisStatus()
                if (owner.state == State.LOCAL_PENDING && owner.firstFailure == null &&
                    owner.localGenesisInput == null && owner.localGenesisCommand == null &&
                    owner.retainedRecoveryInput == null && !owner.recoveryReadAttempted &&
                    owner.ticketCount == 0 && owner.reopenedRows == 0) {
                    if (c.durableStatus() == VeilDeviceEnrollmentPendingStore.Status.FRESH &&
                        original.record == null && original.disposition == "NO_LOCAL_INTENT") return null
                    val resumed = owner.resumedPreparedLocalIntent
                    if (resumed != null) {
                        check(c.durableStatus() == VeilDeviceEnrollmentPendingStore.Status.READY &&
                            original.record === resumed.record && original.disposition == "PREPARED_LOCAL_UNVERIFIED")
                        c.revalidateLocalGenesis(resumed)
                        return null // Normal setup resumes; there is no ciphertext to restore yet.
                    }
                }
            }
            if (owner.localGenesisCommand == null && owner.localGenesisInput == null) {
                val current = c.localGenesisStatus()
                val record = checkNotNull(current.record) { "VEIL_COLD_ORIGINAL_RECORD_REQUIRED" }
                check(record.phase == VeilLocalGenesisProducer.Phase.SUBMITTED && record.nativeIds != null) {
                    "VEIL_COLD_SUBMITTED_ORIGINAL_REQUIRED"
                }
                return readColdLocalPairOriginal()
            }
            val input = prepareExistingLocalRecovery()
            return readPreparedExistingLocalRecovery(input)
        }
        fun prepareExistingLocalRecovery(): VeilLocalRecoveryInput {
            val c = checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                val command = owner.localGenesisCommand ?: error("VEIL_RECOVERY_ORIGINAL_COMMAND_REQUIRED")
                owner.retainedRecoveryInput?.let {
                    it.revalidateOriginal(command)
                    return it
                }
                val observed = c.localGenesisStatus()
                check(observed.disposition == "SUBMITTED_UNVERIFIED_RESTORE_REQUIRED")
                val record = checkNotNull(observed.record)
                check(record.phase == VeilLocalGenesisProducer.Phase.SUBMITTED)
                val ids = checkNotNull(record.nativeIds).copyBytes()
                val association = record.association()
                try {
                    val captured = command.captureExistingRecoveryInput(record.alias, record.storageGeneration, association, ids) {
                        check(Thread.currentThread() === owner.worker && owner.activeScope?.live == true)
                        check(owner.coordinator === c && owner.localGenesisCommand === command &&
                            !owner.closeRequested && !owner.lostPending)
                        val current = c.localGenesisStatus()
                        check(current.record === record && current.disposition == "SUBMITTED_UNVERIFIED_RESTORE_REQUIRED")
                    }
                    owner.retainedRecoveryInput = captured
                    return captured
                } finally { association.fill(0); ids.fill(0) }
            }
        }
        /** Same-worker readback of the retained original operation only.
         * A returned ciphertext-held status does not authorize a device or
         * replace the original genesis failure with a successful state. */
        /** R62 local public material, not device authority or UI readiness.
         * Keep the original worker/command and serialize against owner close.
         */
        fun authenticatePreparedExistingLocalRecovery(original: VeilLocalRecoveryInput) {
            checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                val command = owner.localGenesisCommand
                    ?: error("VEIL_RECOVERY_ORIGINAL_COMMAND_REQUIRED")
                check(owner.retainedRecoveryInput === original && owner.recoveryReadStatus == 61)
                check(owner.authenticatedPublicProjection == null)
                original.revalidateOriginal(command)
                val projection = command.authenticateExistingLocalPair(original)
                try {
                    check(projection.size == 2657 && projection[0] == 5.toByte())
                    original.revalidateOriginal(command)
                    // Owned public bytes only. No JS projection or grant conversion.
                    owner.authenticatedPublicProjection = projection
                } catch (failure: Throwable) {
                    projection.fill(0)
                    throw failure
                }
            }
        }

        fun readPreparedExistingLocalRecovery(original: VeilLocalRecoveryInput): Int {
            val c = checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                check(owner.coordinator === c)
                val command = owner.localGenesisCommand
                    ?: error("VEIL_RECOVERY_ORIGINAL_COMMAND_REQUIRED")
                original.revalidateOriginal(command)
                check(owner.retainedRecoveryInput === original)
                if (owner.recoveryReadAttempted) return checkNotNull(owner.recoveryReadStatus) {
                    "VEIL_RECOVERY_ORIGINAL_READ_UNRESOLVED"
                }
                owner.recoveryReadAttempted = true
                val status = command.readExistingLocalPair(original)
                owner.recoveryReadStatus = status
                return status
            }
        }

        fun originalFirstDeviceIntent(): FirstDeviceIntent {
            checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                requireAuthenticatedLocalOrigin()
                owner.firstDeviceIntent?.let { it.requestForOriginal(); return it }
                val cold = owner.authenticatedColdRecoveryLease
                val original = if (cold == null) checkNotNull(owner.retainedRecoveryInput) else null
                val projection = checkNotNull(owner.authenticatedPublicProjection)
                return owner.FirstDeviceIntent(original, cold, projection).also { owner.firstDeviceIntent = it }
            }
        }

        /** Internal same-worker normal-message calls, never raw Expo selectors
         * or a constructor for accepted contact/session authority. */
        fun openMessageSession(originalRecords: ByteArray) {
            checked()
            synchronized(owner.gate) {
                check(!owner.closeRequested && !owner.lostPending)
                checkNotNull(owner.productPorts).openMessageSession(originalRecords)
            }
        }
        fun acquireMessageOperation(expectedEpoch: Long, originalFrame: ByteArray): VeilNativeProductPorts.Operation {
            checked()
            return checkNotNull(owner.productPorts).acquire(expectedEpoch, originalFrame)
        }
        fun executeMessageOperation(original: VeilNativeProductPorts.Operation, expectedEpoch: Long,
            action: Int, frame: ByteArray): Long {
            checked()
            return checkNotNull(owner.productPorts).execute(original, expectedEpoch, action, frame)
        }
        fun withOriginalMessageOutput(original: VeilNativeProductPorts.Operation, expectedEpoch: Long,
            consume: (VeilNativeMessageOutput) -> Unit) {
            checked()
            checkNotNull(owner.productPorts).withOriginalOutput(original, expectedEpoch, consume)
        }
        fun retireOriginalMessageOutput(original: VeilNativeProductPorts.Operation, expectedEpoch: Long) {
            checked()
            checkNotNull(owner.productPorts).retireOriginalOutput(original, expectedEpoch)
        }

        fun request(association: VeilDeviceEnrollmentCoordinator.Association, approval: VeilDeviceApproval,
            ttlMillis: Long = VeilDeviceEnrollmentCoordinator.MAX_LIFETIME_MILLIS): VeilDeviceEnrollmentCoordinator.Ticket? {
            val c = checked()
            synchronized(owner.gate) { check(owner.state == State.LOCAL_PENDING && !owner.lostPending) { "VEIL_OWNER_RECOVERY_ONLY" } }
            try {
                val ticket = c.request(association, approval, ttlMillis) ?: return null
                owner.untrackedTicket = ticket
                owner.tickets[ticket] = true; owner.untrackedTicket = null
                owner.refresh(); return ticket
            } catch (failure: Throwable) { owner.lostPending = true; throw failure }
        }
        fun inspect(ticket: VeilDeviceEnrollmentCoordinator.Ticket) = checked().inspect(ticket)
        fun reject(ticket: VeilDeviceEnrollmentCoordinator.Ticket) = checked().reject(ticket)
        fun recoverInterrupted(ticket: VeilDeviceEnrollmentCoordinator.Ticket) = checked().recoverInterrupted(ticket)
        fun expire(): Int = checked().expire()
        fun takeOutcome(ticket: VeilDeviceEnrollmentCoordinator.Ticket): VeilDeviceEnrollmentCoordinator.Outcome {
            val outcome = checked().takeOutcome(ticket)
            if (outcome.decision == VeilDeviceEnrollmentCoordinator.Decision.TERMINAL) owner.tickets.remove(ticket)
            owner.refresh(); return outcome
        }
        fun withReopenedRecords(body: (List<VeilDeviceEnrollmentPendingStore.Entry>) -> Unit) = checked().withReopenedRecords(body)
    }
    internal companion object {
        const val MAX_QUEUED = 16
        fun open(context: Context, attachmentUi: VeilAttachmentUi? = null): VeilCryptoEngineOwner {
            val owner = VeilCryptoEngineOwner(context, attachmentUi)
            owner.worker.start()
            return owner
        }
    }
}

/** Private worker-bound bookkeeping, not a native authority constructor.
 * Only the frozen Java carrier declares JNI symbols. Unknown/error outcomes
 * retain custody; 24 is never thread-exit permission. No reopen after failure.
 */
internal class VeilNativeWorkerCustody {
    private val thread = Thread.currentThread()
    private var attempted = false
    private var released = false
    private var primary: Throwable? = null
    private fun owner() { check(Thread.currentThread() === thread) { "VEIL_NATIVE_WRONG_WORKER" } }
    private fun fail(code: Int): Nothing = throw IllegalStateException("VEIL_NATIVE_LIFECYCLE_$code")
    private fun <T> preserving(body: () -> T): T {
        owner()
        primary?.let { throw it }
        try { return body() } catch (failure: Throwable) { primary = failure; throw failure }
    }
    fun open() = preserving {
        check(!attempted) { "VEIL_NATIVE_OPEN_ALREADY_ATTEMPTED" }
        attempted = true
        System.loadLibrary("ynx_native_operation")
        val abi = VeilNativeProductControllerBridge.nativeAbiVersion()
        check(abi == 2) { "VEIL_NATIVE_ABI_MISMATCH" }
        val opened = VeilNativeProductControllerBridge.nativeOpen()
        if (opened !in setOf(0, 1, 20)) fail(opened)
        val status = VeilNativeProductControllerBridge.nativeStatus()
        // Initialization observes the exact original owning outcome, not a
        // later integer that might mask panic, unknown or accidental release.
        check(status == opened) { "VEIL_NATIVE_OPEN_STATUS_MISMATCH" }
    }
    fun releaseForThreadExit(): Boolean = preserving {
        check(attempted) { "VEIL_NATIVE_NOT_OPENED" }
        if (released) return@preserving true // no second TLS close/reopen
        val status = VeilNativeProductControllerBridge.nativeStatus()
        if (status !in setOf(0, 1, 20, 24)) fail(status)
        val closed = VeilNativeProductControllerBridge.nativeClose()
        if (closed == 8) return@preserving false
        if (closed != 24) fail(closed)
        val disposition = VeilNativeProductControllerBridge.nativeReleaseNoEffectForThreadExit()
        if (disposition == 8) return@preserving false
        if (disposition != 36) fail(disposition)
        released = true
        true
    }
}

/** Same-worker product custody only; no current/grant, replacement worker,
 * successful business result or deletion of saved originals is implied. */
internal fun productWorkBlocksOwnerClose(source: VeilNativeMatrixSource?, binding: VeilMatrixProductBinding?,
    business: VeilNativeMessageBusiness?, coordinator: VeilSocialMessagingCoordinator?, attachmentFailure: Throwable?,
    initialPrekeys: VeilInitialPrekeyHttp? = null): Boolean {
    if (initialPrekeys?.hasRetainedWork() == true) return true
    if (source == null) return attachmentFailure != null || binding != null || business != null ||
        coordinator?.hasWorkBlockingOwnerClose() == true
    if (binding != null && !binding.usesSourceForOwnerClose(source)) return true
    if (business != null && (binding == null || !business.uses(binding))) return true
    if (coordinator?.hasAttachedBusinessForOwnerClose() == true &&
        (business == null || !coordinator.usesBusinessForOwnerClose(business))) return true
    return source.hasWorkBlockingOwnerClose() || binding?.hasWorkBlockingOwnerClose() == true ||
        business?.hasWorkBlockingOwnerClose() == true || coordinator?.hasWorkBlockingOwnerClose() == true
}
