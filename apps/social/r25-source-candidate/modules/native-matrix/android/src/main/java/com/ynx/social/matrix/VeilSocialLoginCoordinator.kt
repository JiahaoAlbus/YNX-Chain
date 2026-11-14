package com.ynx.social.matrix

import android.app.Activity
import java.util.Collections
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.FutureTask
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * One original native login flow. Normal startup restores only its sealed
 * request association, not an authenticated account or device. Returned futures are immutable
 * safe OBSERVATIONS, not the retained worker future. No credential/subject DTO.
 */
class VeilSocialLoginCoordinator private constructor(
    private val client: VeilSocialLoginClient,
    private val browser: VeilLoginBrowserAccess
) : AutoCloseable {
    constructor(browserPort: VeilSocialLoginBrowserPort, context: android.content.Context) :
        this(VeilSocialLoginClient(context, browserPort.loginProfile), browserPort)
    private val gate = Any()
    internal fun returnLinkDiagnostic(): Map<String, Any> = browser.diagnostic()
    private val failures = VeilLoginFailureDiagnostic()
    internal fun loginFailureDiagnostic(): Map<String, Any> = failures.snapshot()
    private val worker = ThreadPoolExecutor(1, 1, 30, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(1),
        { task -> Thread(task, "YNX-login-owned-io").apply { isDaemon = true } }).apply { allowCoreThreadTimeOut(true) }
    private var selected: VeilSocialLoginClient.Intent? = client.retainedIntent()
    private var needsOriginalRecovery = selected != null && client.hasOriginalKey()
    private var browserReserved = false
    private var status = if (selected == null) "UNAVAILABLE" else "REVIEW_REQUIRED"
    private var closed = false
    private var closeAttempted = false
    private var closeActionsFinished = false
    private var closeFailure: Throwable? = null
    private var cancelled = client.retainedCancelled()
    private var running = false
    private var startedAt = 0L
    private var originalFuture: FutureTask<Unit>? = null
    private var pendingCallback: (() -> Pair<VeilSocialLoginClient.BrowserHandoff, String>?)? = null
    private var callbackSeen = false
    private var accountObserved = false
    private var firstDeviceOriginal: VeilCryptoEngineOwner.FirstDeviceIntent? = null
    private var firstDeviceStatus = "CHALLENGE_REQUIRED"
    private var enrollmentStarted = false
    private var sourceAttempted = false
    private var sourceStatus: String? = null
    private var walletContinuation: (() -> String)? = null
    private var enrollmentReadbackArmed = false
    private var sourceCancellationFailure: Throwable? = null
    private var sourceCancellationSelected = false
    private var sourceFailure: Throwable? = null
    private fun retainSourceFailure(failure: Throwable) = synchronized(gate) {
        val first = sourceFailure
        if (first == null) sourceFailure = failure
        else if (first !== failure) first.addSuppressed(failure)
    }
    private fun sourceAllowed(original: VeilCryptoEngineOwner.FirstDeviceIntent, epoch: Long): Boolean = synchronized(gate) {
        !closed && !cancelled && !firstDeviceCancelRequested && !firstDeviceCancelAttempted &&
            publicationEpoch == epoch && firstDeviceOriginal === original
    }
    /** Child drain is mandatory before attempting parent close. No current
     * authorization is reconstructed by cleanup; each original owns its debt. */
    private fun closeSourceChildrenThenCore(original: VeilCryptoEngineOwner.FirstDeviceIntent,
        closeCore: Boolean): Throwable? {
        if (original.deviceProvisioningRetainsNativeOriginal()) return IllegalStateException("DEVICE_PROVISIONING_ORIGINAL_RETAINED")

        return try {
            val child = original.closeNativeSignatures()
            check(child == null || child == VeilNativeAccountChannel.SIGNATURE_RAM_CLOSED) {
                "FIRST_DEVICE_SIGNATURE_CLEANUP_UNRESOLVED"
            }
            if (closeCore) {
                val parent = original.closeNativeRuntimeCore()
                check(parent == null || parent == 0) { "CORE_STARTUP_CLEANUP_UNKNOWN_RETAINED" }
            }
            null
        } catch (failure: Throwable) { failure }
    }
    /** A successful native product retains the same account/Core until its
     * message-session loans drain on the CryptoEngine owner. Login close only
     * closes transport/publication in that case; explicit cancel is unchanged. */
    private fun retireSourceForLoginClose(original: VeilCryptoEngineOwner.FirstDeviceIntent) {
        if (original.productOwnerHandlesFinalClose()) return
        cancelSourceOriginal(original)
    }
    private fun cancelSourceOriginal(original: VeilCryptoEngineOwner.FirstDeviceIntent) {
        synchronized(gate) {
            if (sourceCancellationSelected) return
            sourceCancellationSelected = true
        }
        try { original.cancelSourceCurrent() }
        catch (failure: Throwable) { synchronized(gate) {
            if (sourceCancellationFailure == null) sourceCancellationFailure = failure
        } }
        finally {
            closeSourceChildrenThenCore(original, closeCore = true)?.let { failure -> synchronized(gate) {
                val first = sourceCancellationFailure
                if (first == null) sourceCancellationFailure = failure
                else if (first !== failure) first.addSuppressed(failure)
            } }
        }
    }
    // Original login IO worker; no monitor across HTTP or permanent owner receipt.
    private fun sourceRoundTrip(original: VeilCryptoEngineOwner.FirstDeviceIntent, epoch: Long, activity: Activity): String {
        synchronized(gate) {
            if (sourceAttempted) return sourceStatus ?: "SOURCE_UNKNOWN_RETAINED"
            sourceAttempted = true
            sourceStatus = "SOURCE_CHECK_PENDING"
        }
        var nativeAccountEntered = false
        var deviceProvisioningKeep = false
        var visible = "SOURCE_UNKNOWN_RETAINED"
        fun perform(): String {
            check(sourceAllowed(original, epoch))
            val prepared = checkNotNull(client.retainedPreparation(original))
            val selected = client.selectFirstDeviceSource(original, prepared) as? VeilSocialLoginClient.Outcome.SourceSelection
                ?: return "SOURCE_UNKNOWN_RETAINED"
            check(sourceAllowed(original, epoch))
            val started = original.beginSourceCurrent(prepared, selected.value)
            if (started.status != 71) return VeilFirstDeviceSourceWire.status(started.status)
            check(sourceAllowed(original, epoch))
            val nonce = started.nonceCopy()
            val fetched = try {
                val association = original.initialStorageAssociation(prepared)
                check(sourceAllowed(original, epoch))
                val registered = client.registerFirstDeviceStorage(original, prepared, nonce, association)
                if (registered !is VeilSocialLoginClient.Outcome.StorageRegistered)
                    return "STORAGE_REGISTRATION_UNKNOWN_RETAINED"
                check(sourceAllowed(original, epoch))
                client.fetchFirstDeviceSource(original, prepared, nonce)
            } finally { nonce.fill(0) }
            val evidence = (fetched as? VeilSocialLoginClient.Outcome.SourceEvidence)?.bytes
                ?: return "SOURCE_UNKNOWN_RETAINED"
            try {
                check(sourceAllowed(original, epoch))
                val sourceCode = original.acceptSourceCurrent(prepared, evidence)
                if (sourceCode != 72) return VeilFirstDeviceSourceWire.status(sourceCode)
                val borrowed = client.borrowAccountChannel(original, prepared)
                nativeAccountEntered = true
                val accountCode = original.prepareNativeAccountChannel(prepared, borrowed)
                if (accountCode == VeilNativeAccountChannel.INSTANCE_REQUIRED) return "ACCOUNT_SERVICE_INSTANCE_REQUIRED"
                if (accountCode != VeilNativeAccountChannel.FACTS_UNADMITTED) return "ACCOUNT_CHANNEL_UNKNOWN_RETAINED"
                check(sourceAllowed(original, epoch))
                // Exactly the original one refresh: no new request, nonce, grant or budget.
                val refreshNonce = started.nonceCopy()
                val refreshed = try { client.fetchFirstDeviceSource(original, prepared, refreshNonce) }
                    finally { refreshNonce.fill(0) }
                val pending = (refreshed as? VeilSocialLoginClient.Outcome.SourceEvidence)?.bytes
                    ?: return "SOURCE_UNKNOWN_RETAINED"
                try {
                    check(sourceAllowed(original, epoch))
                    val refreshedCode = original.acceptSourceCurrent(prepared, pending)
                    if (refreshedCode != 72) return VeilFirstDeviceSourceWire.status(refreshedCode)
                    // Bootstrap the genuine DEVICE review BEFORE Runtime Core.
                    // Source72/account204/local authentication are NOT approval;
                    // nativeOpen still obtains its actual independent Source.
                    deviceProvisioningKeep = true
                    synchronized(gate) {
                        if (sourceAllowed(original, epoch)) {
                            firstDeviceStatus = "DEVICE_PROVISIONING_REVIEW_PENDING"
                            sourceStatus = firstDeviceStatus
                        }
                    }
                    val review = original.requestDeviceProvisioningReview(
                        activity, prepared, borrowed, originalCurrent = { sourceAllowed(original, epoch) },
                    ) { observeFirstDeviceEnrollment() }
                    var disposition: VeilDeviceProvisioningConfirmation.Outcome? = null
                    while (disposition == null) {
                        try { disposition = review.get(30, TimeUnit.SECONDS) }
                        catch (_: java.util.concurrent.TimeoutException) {
                            if (!sourceAllowed(original, epoch)) original.invalidateDeviceProvisioningReview()
                        }
                    }
                    deviceProvisioningKeep = original.deviceProvisioningRetainsNativeOriginal()
                    val continueAfterDevice = disposition == VeilDeviceProvisioningConfirmation.Outcome.RECEIPT_OBSERVED &&
                        sourceAllowed(original, epoch) && original.selectOriginalDeviceGuardedContinuation(prepared, borrowed)
                    // A successful child-only close preserves the original parent
                    // Source/account for Core; all other retirement remains unchanged.
                    if (!deviceProvisioningKeep && !continueAfterDevice) original.cancelSourceCurrent()
                    // A receipt alone is never qualification or permission.
                    return when (disposition) {
                        VeilDeviceProvisioningConfirmation.Outcome.ORIGINAL_PENDING_RESTORED -> "DEVICE_PROVISIONING_ORIGINAL_PENDING_RESTORED"
                        VeilDeviceProvisioningConfirmation.Outcome.RECEIPT_OBSERVED -> {
                            check(sourceAllowed(original, epoch))
                            if (!continueAfterDevice)
                                "DEVICE_PROVISIONING_RECEIPT_OBSERVED"
                            else continueOriginalRuntimeAfterDeviceQualification(original, prepared, borrowed, started, epoch)
                        }
                        VeilDeviceProvisioningConfirmation.Outcome.WALLET_UNKNOWN,
                        VeilDeviceProvisioningConfirmation.Outcome.WALLET_PENDING -> {
                            synchronized(gate) {
                                if (sourceAllowed(original, epoch)) {
                                    walletContinuation = {
                                        if (sourceAllowed(original, epoch) &&
                                            original.selectOriginalDeviceGuardedContinuation(prepared, borrowed)
                                        ) continueOriginalRuntimeAfterDeviceQualification(original, prepared, borrowed, started, epoch)
                                        else "DEVICE_PROVISIONING_UNKNOWN_RETAINED"
                                    }
                                }
                            }
                            if (disposition == VeilDeviceProvisioningConfirmation.Outcome.WALLET_PENDING)
                                "DEVICE_PROVISIONING_WALLET_PENDING" else "DEVICE_PROVISIONING_UNKNOWN_RETAINED"
                        }
                        VeilDeviceProvisioningConfirmation.Outcome.WALLET_DENIED -> "DEVICE_PROVISIONING_WALLET_DENIED"
                        VeilDeviceProvisioningConfirmation.Outcome.CANCELLED -> "DEVICE_PROVISIONING_CANCELLED"
                        VeilDeviceProvisioningConfirmation.Outcome.EXPIRED -> "DEVICE_PROVISIONING_REVIEW_EXPIRED"
                        VeilDeviceProvisioningConfirmation.Outcome.UNAVAILABLE -> "DEVICE_PROVISIONING_REVIEW_UNAVAILABLE"
                        else -> "DEVICE_PROVISIONING_UNKNOWN_RETAINED"
                    }

                } finally { pending.fill(0) }
            } finally { evidence.fill(0) }
        }
        try { visible = perform() }
        catch (failure: LinkageError) { retainSourceFailure(failure); visible = "SOURCE_NATIVE_INTERFACE_REQUIRED" }
        catch (failure: Throwable) { retainSourceFailure(failure); visible = "SOURCE_UNKNOWN_RETAINED" }
        finally {
            if (!sourceAllowed(original, epoch)) {
                if (synchronized(gate) { closeAttempted && closed }) retireSourceForLoginClose(original)
                else cancelSourceOriginal(original)
            }
            if (nativeAccountEntered && !deviceProvisioningKeep) {
                closeSourceChildrenThenCore(original, closeCore = false)?.let { failure ->
                    retainSourceFailure(failure); visible = "SOURCE_UNKNOWN_RETAINED"
                }
            }
            // Publication follows cleanup, not a return expression evaluated before finally.
            synchronized(gate) {
                if (!sourceAllowed(original, epoch)) visible = "SOURCE_UNKNOWN_RETAINED"
                sourceStatus = visible
            }
        }
        return visible
    }

    /** Original guarded runtime/sign path, attempted once only after Native's
     * independent registered-current/OS readback on the original actor/window.
     * Every existing Core, Source and signing check remains independently required. */
    private fun continueOriginalRuntimeAfterDeviceQualification(
        original: VeilCryptoEngineOwner.FirstDeviceIntent,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared,
        borrowed: VeilSocialLoginClient.AccountChannelBorrow,
        started: VeilFirstDeviceSourceWire.Start, epoch: Long,
    ): String {
        var runtimeCoreEntered = false
        var runtimeCoreKeep = false
        var readbackRequired = false
        var visible = "CORE_STARTUP_UNKNOWN_RETAINED"
        fun perform(): String {
                    // Fetch exact opaque originals only after the second SourceCurrent.
                    // This route and zero Native result supply no device/chat grant.
                    val coreNonce = started.nonceCopy()
                    val core = try { client.fetchRuntimeCoreOriginals(original, prepared, coreNonce) }
                        finally { coreNonce.fill(0) }
                    if (core !is VeilSocialLoginClient.Outcome.RuntimeCoreOriginals)
                        return "CORE_STARTUP_UNKNOWN_RETAINED"
                    check(core.original === original && core.prepared === prepared && sourceAllowed(original, epoch))
                    val coreBytes = core.originalCopy()
                    runtimeCoreEntered = true // before JNI, including a missing symbol or partial failure
                    val coreCode = try { original.prepareNativeRuntimeCore(prepared, borrowed, coreBytes) }
                        finally { coreBytes.fill(0) }
                    if (coreCode != 0) return VeilNativeAccountChannel.runtimeCoreStatus(coreCode)
                    check(sourceAllowed(original, epoch))
                    val coreCurrent = original.currentNativeRuntimeCore(prepared, borrowed)
                    if (coreCurrent != 0) return VeilNativeAccountChannel.runtimeCoreStatus(coreCurrent)
                    // This normal call reaches A's same-owner signing path; 204 is still NOT success.
                    check(sourceAllowed(original, epoch))
                    val signedCode = original.prepareNativeAccountChannel(prepared, borrowed)
                    if (signedCode == VeilNativeAccountChannel.INSTANCE_REQUIRED) return "ACCOUNT_SERVICE_INSTANCE_REQUIRED"
                    if (signedCode != VeilNativeAccountChannel.FACTS_UNADMITTED) return "ACCOUNT_CHANNEL_UNKNOWN_RETAINED"
                    check(sourceAllowed(original, epoch))
                    val signatures = original.observeNativeSignatures(prepared, borrowed)
                        ?: return "SOURCE_UNKNOWN_RETAINED"
                    signatures.use {
                        check(sourceAllowed(original, epoch))
                        val outcome = it.finalizeOriginal(client, original, borrowed)
                        readbackRequired = enrollmentNeedsOriginalReadback(outcome)
                        runtimeCoreKeep = outcome is VeilSocialLoginClient.Outcome.EnrollmentRecords || readbackRequired
                        val consumed = consumeEnrollmentOutcome(original, epoch, outcome)
                        return consumed
                    }
        }
        try { visible = perform() }
        catch (failure: Throwable) { retainSourceFailure(failure) }
        finally {
            if (runtimeCoreEntered) {
                val failure = closeSourceChildrenThenCore(original, closeCore = !runtimeCoreKeep)
                if (failure != null) {
                    retainSourceFailure(failure)
                    visible = "CORE_STARTUP_UNKNOWN_RETAINED"
                } else if (readbackRequired) synchronized(gate) {
                    if (sourceAllowed(original, epoch)) enrollmentReadbackArmed = true
                }
            }
        }
        return visible
    }

    private fun consumeEnrollmentOutcome(original: VeilCryptoEngineOwner.FirstDeviceIntent,
        epoch: Long, outcome: VeilSocialLoginClient.Outcome): String {
        if (outcome !is VeilSocialLoginClient.Outcome.EnrollmentRecords)
            return (outcome as? VeilSocialLoginClient.Outcome.ChallengeState)?.status ?: "ENROLLMENT_UNKNOWN_RETAINED"
        check(sourceAllowed(original, epoch) && outcome.original === original)
        val bytes = outcome.originalCopy()
        var courier: ByteArray? = null
        try {
            courier = outcome.courierRecordCopy()
            return consumeProductStartObservation(
                publicationCurrent = { sourceAllowed(original, epoch) },
                originalStart = { original.acceptCommittedDeviceRecords(outcome.prepared, bytes, courier) }
            )
        } finally { bytes.fill(0); courier?.fill(0) }
    }

    internal fun prepareFirstDeviceEnrollment(activity: Activity): CompletableFuture<Map<String, String>> = enrollmentOperation(false, activity)
    internal fun observeFirstDeviceEnrollment(): CompletableFuture<Map<String, String>> = enrollmentOperation(true)

    private fun enrollmentOperation(observe: Boolean, activity: Activity? = null): CompletableFuture<Map<String, String>> = synchronized(gate) {
        fun result() = CompletableFuture.completedFuture(mapOf("status" to firstDeviceObservationLocked(), "deviceAuthorization" to "REQUIRED"))
        val original = firstDeviceOriginal ?: return@synchronized result()
        if (closed || cancelled || running || firstDeviceCancelRequested || firstDeviceCancelAttempted) return@synchronized result()
        if (observe && !enrollmentStarted) return@synchronized result()
        if (!observe && (enrollmentStarted || firstDeviceStatus != "CHALLENGE_ISSUED_UNVERIFIED")) return@synchronized result()
        original.requestForOriginal()
        enrollmentStarted = true // sticky across timeout/failure, never another prepare or intent
        // Observe returns the retained completed/UNKNOWN snapshot while a bounded
        // refresh runs. Masking it with PENDING here makes every UI poll hide
        // the previous completion. Only the first prepare selects PENDING.
        if (!observe) firstDeviceStatus = "ENROLLMENT_PENDING"
        val originalClient = client
        val coordinatorEpoch = publicationEpoch
        val clientEpoch = originalClient.challengePublicationEpoch()
        launchLocked(loginOperation = false) {
            var observed = "ENROLLMENT_UNKNOWN_RETAINED"
            try {
                if (observe && synchronized(gate) { enrollmentReadbackArmed }) {
                    val retained = synchronized(gate) { sourceStatus } ?: observed
                    observed = readOriginalEnrollment(
                        retained,
                        current = { sourceAllowed(original, coordinatorEpoch) },
                        read = { originalClient.observeFirstDevice(original) },
                        beforeConsume = { synchronized(gate) {
                            enrollmentReadbackArmed = false
                            sourceStatus = "ENROLLMENT_UNKNOWN_RETAINED"
                        } },
                        consume = { consumeEnrollmentOutcome(original, coordinatorEpoch, it) }
                    )
                    synchronized(gate) { if (sourceAllowed(original, coordinatorEpoch)) sourceStatus = observed }
                } else if (observe && original.deviceProvisioningSelected()) {
                    // Once the original receipt has been observed, keep the result
                    // of its guarded Core continuation across subsequent UI polls.
                    val afterReceipt = synchronized(gate) {
                        if (walletContinuation == null) sourceStatus else null
                    }
                    observed = original.observeDeviceProvisioningOriginal(afterReceipt)
                    if (observed == "DEVICE_PROVISIONING_RECEIPT_OBSERVED") {
                        val continuation = synchronized(gate) {
                            walletContinuation.also { walletContinuation = null }
                        }
                        if (continuation != null) {
                            observed = continuation()
                            synchronized(gate) { if (sourceAllowed(original, coordinatorEpoch)) sourceStatus = observed }
                        }
                    }
                    if (observed == "DEVICE_PROVISIONING_WALLET_DENIED")
                        synchronized(gate) { walletContinuation = null }
                    return@launchLocked observed
                } else {
                    val outcome = if (observe) originalClient.observeFirstDevice(original) else originalClient.prepareFirstDevice(original)
                    observed = consumeEnrollmentOutcome(original, coordinatorEpoch, outcome)
                    if (!observe && observed == "NATIVE_PROOF_AUTHORIZATION_REQUIRED")
                        observed = sourceRoundTrip(original, coordinatorEpoch, checkNotNull(activity))
                    else if (observe && observed == "NATIVE_PROOF_AUTHORIZATION_REQUIRED")
                        observed = synchronized(gate) { sourceStatus ?: observed }
                }
                observed
            } catch (failure: LinkageError) {
                retainSourceFailure(failure)
                observed
            } catch (failure: Exception) {
                retainSourceFailure(failure)
                observed
            } finally {
                publishFirstDevice(original, originalClient, coordinatorEpoch, clientEpoch, observed, false)
            }
        }
        result()
    }
    private var firstDeviceCancelRequested = false
    private var firstDeviceCancelAttempted = false
    private var publicationEpoch = 0L

    private fun firstDeviceObservationLocked(): String = when {
        !closed && !cancelled -> firstDeviceStatus
        firstDeviceOriginal == null -> "UNAVAILABLE"
        firstDeviceCancelAttempted -> "CHALLENGE_CANCEL_UNKNOWN_RETAINED"
        else -> "CHALLENGE_UNKNOWN_RETAINED"
    }

    private fun publishFirstDevice(original: VeilCryptoEngineOwner.FirstDeviceIntent,
        originalClient: VeilSocialLoginClient, coordinatorEpoch: Long, clientEpoch: Long,
        observed: String, cancellation: Boolean) = synchronized(gate) {
        val current = !closed && !cancelled && (cancellation || !firstDeviceCancelRequested) && publicationEpoch == coordinatorEpoch &&
            client === originalClient && firstDeviceOriginal === original &&
            originalClient.challengePublicationCurrent(original, clientEpoch)
        firstDeviceStatus = if (current) observed
            else if (cancellation) "CHALLENGE_CANCEL_UNKNOWN_RETAINED" else "CHALLENGE_UNKNOWN_RETAINED"
        // Never undo a cancel acknowledgment already performed by the client.
        // This fence controls observation only, not the original private custody.
    }

    internal fun firstDeviceEligibility(): String = synchronized(gate) {
        when {
            closed || cancelled -> "UNAVAILABLE"
            selected != VeilSocialLoginClient.Intent.A || !accountObserved -> "ORIGINAL_A_LOGIN_REQUIRED"
            running -> "OBSERVATION_PENDING"
            else -> "ORIGINAL_A_LOGIN_OBSERVED"
        }
    }
    internal fun issueFirstDeviceChallenge(original: VeilCryptoEngineOwner.FirstDeviceIntent): CompletableFuture<Map<String, String>> = synchronized(gate) {
        firstDeviceOriginal?.let {
            return@synchronized if (it === original) safe(firstDeviceObservationLocked()) else safe("ORIGINAL_INTENT_REQUIRED")
        }
        val eligibility = firstDeviceEligibility()
        if (eligibility != "ORIGINAL_A_LOGIN_OBSERVED") return@synchronized safe(eligibility)
        original.requestForOriginal() // no factory accepting a status or UI tuple
        firstDeviceOriginal = original
        firstDeviceStatus = "CHALLENGE_PENDING"
        val originalClient = client
        val originalEpoch = publicationEpoch
        val clientEpoch = originalClient.challengePublicationEpoch()
        launchLocked(loginOperation = false) {
            var observed = "CHALLENGE_UNKNOWN_RETAINED"
            try {
                val result = originalClient.issueFirstDevice(original)
                if (result is VeilSocialLoginClient.Outcome.ChallengeState) observed = result.status
            } finally { publishFirstDevice(original, originalClient, originalEpoch, clientEpoch, observed, false) }
            ""
        }
        safe(firstDeviceObservationLocked())
    }
    internal fun observeFirstDeviceChallenge(): CompletableFuture<Map<String, String>> = synchronized(gate) {
        safe(firstDeviceObservationLocked()) // an observation never restarts physical IO
    }
    internal fun cancelFirstDeviceChallenge(): CompletableFuture<Map<String, String>> = synchronized(gate) {
        if (closed) return@synchronized safe(firstDeviceObservationLocked())
        if (firstDeviceOriginal == null) return@synchronized safe("CHALLENGE_REQUIRED")
        firstDeviceCancelRequested = true
        walletContinuation = null
        if (!running) scheduleFirstDeviceCancelLocked()
        safe(firstDeviceObservationLocked())
    }
    private fun scheduleFirstDeviceCancelLocked() {
        if (firstDeviceCancelAttempted || closed) return
        val original = firstDeviceOriginal ?: return
        firstDeviceCancelAttempted = true
        firstDeviceStatus = "CHALLENGE_CANCEL_PENDING"
        val originalClient = client
        val originalEpoch = publicationEpoch
        val clientEpoch = originalClient.challengePublicationEpoch()
        launchLocked(loginOperation = false) {
            var observed = "CHALLENGE_CANCEL_UNKNOWN_RETAINED"
            try {
                cancelSourceOriginal(original)
                val result = originalClient.cancelFirstDevice(original)
                if (result is VeilSocialLoginClient.Outcome.ChallengeState) observed = result.status
            } finally { publishFirstDevice(original, originalClient, originalEpoch, clientEpoch, observed, true) }
            ""
        }
    }

    fun begin(selected: String, activity: Activity): CompletableFuture<Map<String, String>> = beginOwned(selected, activity)
    fun observeOriginal(): CompletableFuture<Map<String, String>> = synchronized(gate) {
        if (!closed && !cancelled && !running && needsOriginalRecovery) launchLocked {
            when (val recovered = client.recoverOriginalStart()) {
                is VeilSocialLoginClient.Outcome.Authorization -> {
                    synchronized(gate) { needsOriginalRecovery = false }
                    "AWAIT_CALLBACK" // no browser launch, account or device grant
                }
                else -> project(recovered, VeilLoginFailureDiagnostic.Operation.LOGIN_WORKER)
            }
        }
        snapshot()
    }
    /** Read only the existing process owner. No worker, browser or HTTP action. */
    internal fun observeOriginalSelection(): Map<String, Any?> = synchronized(gate) {
        originalSelection(visibleStatusLocked(), selected, if (selected == null) "ABSENT" else "RETAINED", client.originalScope())
    }

    private fun beginOwned(value: String, activity: Activity?): CompletableFuture<Map<String, String>> = synchronized(gate) {
        if (closed) return@synchronized safe("CLOSED")
        val wanted = VeilSocialLoginClient.Intent.entries.firstOrNull { it.name == value } ?: return@synchronized safe("REFUSED")
        if (selected != null) {
            if (selected != wanted) return@synchronized safe("REFUSED")
            if (cancelled) return@synchronized safe("CANCELLED")
            if (!running && client.hasOriginalKey()) launchLocked {
                if (!browserReserved) {
                    if (!browser.reserve(activity, ::acceptCallback)) return@launchLocked "VERIFIED_CALLBACK_REQUIRED"
                    browserReserved = true
                }
                if (!allowed()) return@launchLocked "CANCELLED"
                when (val recovered = client.recoverOriginalStart()) {
                    is VeilSocialLoginClient.Outcome.Authorization -> {
                        synchronized(gate) { needsOriginalRecovery = false }
                        if (allowed() && browser.open(activity, recovered.browser)) "AUTHORIZATION_OPENED"
                        else if (allowed()) "REVIEW_REQUIRED" else "CANCELLED"
                    }
                    else -> project(recovered, VeilLoginFailureDiagnostic.Operation.LOGIN_WORKER)
                }
            }
            return@synchronized snapshot()
        }
        selected = wanted
        launchLocked {
            if (!browser.reserve(activity, ::acceptCallback)) return@launchLocked "VERIFIED_CALLBACK_REQUIRED"
            browserReserved = true
            if (!allowed()) { browser.retire(); return@launchLocked "CANCELLED" }
            when (val result = client.start(wanted)) {
                is VeilSocialLoginClient.Outcome.Authorization ->
                    if (allowed() && browser.open(activity, result.browser)) "AUTHORIZATION_OPENED" else if (allowed()) "REVIEW_REQUIRED" else "CANCELLED"
                else -> {
                    synchronized(gate) { needsOriginalRecovery = client.hasOriginalKey() }
                    project(result, VeilLoginFailureDiagnostic.Operation.START)
                }
            }
        }
        snapshot()
    }

    /** Local fence first. Remote cancellation is attempted only when physical IO
     * is free; a busy cancel remains local and never advertises remote revoke. */
    fun cancelOriginal(): CompletableFuture<Map<String, String>> {
        synchronized(gate) {
            if (closed) return safe("CLOSED")
            if (!cancelled) publicationEpoch++
            cancelled = true; status = "CANCELLED"; pendingCallback = null
        }
        client.cancelLocal()
        browser.retire()
        synchronized(gate) {
            if (!running && selected != null) launchLocked {
                firstDeviceOriginal?.let { cancelSourceOriginal(it) }
                project(client.cancelRemote(), VeilLoginFailureDiagnostic.Operation.CANCEL); "CANCELLED"
            }
            return safe("CANCELLED")
        }
    }

    override fun close() {
        synchronized(gate) {
            if (closeAttempted) {
                check(closeActionsFinished) { "VEIL_LOGIN_CLOSE_PENDING" }
                closeFailure?.let { throw it }
                return
            }
            closeAttempted = true
            if (!closed) publicationEpoch++
            closed = true; cancelled = true; status = "CLOSED"; pendingCallback = null; walletContinuation = null
        }
        fun retain(failure: Throwable) = synchronized(gate) {
            val original = closeFailure
            if (original == null) closeFailure = failure
            else if (original !== failure) original.addSuppressed(failure)
        }
        // Each physical close is selected only once. A failing browser or HTTP
        // cancellation must not skip the remaining local cleanup, nor make a
        // later close retry an uncertain original effect.
        try {
            try { browser.retire() } catch (failure: Throwable) { retain(failure) }
            try { client.close() } catch (failure: Throwable) { retain(failure) }
            // Running/queued original work keeps its executor until its own
            // finally exits. Never interrupt it or release Native custody here.
            synchronized(gate) {
                if (!running) {
                    // The original finally may have selected cancellation and
                    // shut down this executor while browser/client close ran.
                    // Selection is not success: retain its original failure.
                    if (!sourceCancellationSelected) {
                        firstDeviceOriginal?.let { original ->
                            try { worker.execute { retireSourceForLoginClose(original) } }
                            catch (failure: Throwable) {
                                if (sourceCancellationFailure == null) sourceCancellationFailure = failure
                                retain(failure)
                            }
                        }
                    }
                    try { worker.shutdown() } catch (failure: Throwable) { retain(failure) }
                }
            }
        } finally {
            synchronized(gate) { closeActionsFinished = true }
        }
        synchronized(gate) { closeFailure?.let { throw it } }
    }

    private fun allowed() = synchronized(gate) { !closed && !cancelled }

    private fun acceptCallback(validate: () -> Pair<VeilSocialLoginClient.BrowserHandoff, String>?) {
        synchronized(gate) {
            if (closed || cancelled || callbackSeen || selected == null || pendingCallback != null) return
            // At most one original callback retained during browser-launch exit.
            pendingCallback = validate
            if (!running) scheduleCallbackLocked()
        }
    }

    private fun scheduleCallbackLocked() {
        val validate = pendingCallback ?: return
        pendingCallback = null
        launchLocked {
            if (!allowed()) return@launchLocked "CANCELLED"
            val original = validate() ?: return@launchLocked "REVIEW_REQUIRED"
            synchronized(gate) {
                if (closed || cancelled || callbackSeen) return@launchLocked "CANCELLED"
                callbackSeen = true
                pendingCallback = null
            }
            val bound = client.bindCallback(original.first, original.second)
            if (bound !== VeilSocialLoginClient.Outcome.CallbackBound) return@launchLocked project(bound, VeilLoginFailureDiagnostic.Operation.CALLBACK)
            if (!allowed()) return@launchLocked "CANCELLED"
            val redeemed = client.redeem()
            if (redeemed !is VeilSocialLoginClient.Outcome.State || redeemed.phase != "FAMILY_RESPONSE_CAPTURED_UNVERIFIED") return@launchLocked project(redeemed, VeilLoginFailureDiagnostic.Operation.REDEEM)
            if (!allowed()) return@launchLocked "CANCELLED"
            project(client.observeAccount(), VeilLoginFailureDiagnostic.Operation.ACCOUNT_OBSERVE)
        }
    }

    private fun launchLocked(loginOperation: Boolean = true, action: () -> String) {
        if (running) return
        running = true; startedAt = System.nanoTime()
        if (loginOperation) status = "OBSERVATION_PENDING"
        val task = FutureTask<Unit> {
            var next = "REVIEW_REQUIRED"
            try { next = action() } catch (failure: Exception) { if (loginOperation) failures.exception(failure); next = "REVIEW_REQUIRED" }
            finally {
                val retiredOriginal = synchronized(gate) {
                    status = when { closed -> "CLOSED"; cancelled -> "CANCELLED"; loginOperation -> next; else -> status }
                    running = false
                    if (!closed && firstDeviceCancelRequested && !firstDeviceCancelAttempted) scheduleFirstDeviceCancelLocked()
                    else if (!closed && !cancelled && pendingCallback != null) scheduleCallbackLocked()
                    if (closed || cancelled) firstDeviceOriginal else null
                }
                retiredOriginal?.let { cancelSourceOriginal(it) }
                synchronized(gate) { if (closed) worker.shutdown() }
            }
        }
        originalFuture = task // private actual task, never exposed/cancelled by JS
        try { worker.execute(task) }
        catch (failure: java.util.concurrent.RejectedExecutionException) {
            if (loginOperation) failures.exception(failure)
            running = false
            if (loginOperation) status = if (closed) "CLOSED" else "REVIEW_REQUIRED"
            else firstDeviceStatus = "CHALLENGE_UNKNOWN_RETAINED"
        }
    }

    private fun visibleStatusLocked(): String = when {
            closed -> "CLOSED"
            cancelled -> "CANCELLED"
            running -> "OBSERVATION_PENDING" // elapsed observation is NOT IO exit
            status == "AUTHORIZATION_OPENED" -> "AWAIT_CALLBACK"
            else -> status
        }
    private fun snapshot(): CompletableFuture<Map<String, String>> = safe(visibleStatusLocked())

    private fun project(result: VeilSocialLoginClient.Outcome, operation: VeilLoginFailureDiagnostic.Operation): String {
        if (result is VeilSocialLoginClient.Outcome.Refused) failures.refused(result, operation)
        return when (result) {
        is VeilSocialLoginClient.Outcome.AccountObserved -> {
            synchronized(gate) { accountObserved = true }
            "ACCOUNT_OBSERVED"
        }
        is VeilSocialLoginClient.Outcome.Refused -> when (result.reason) {
            VeilSocialLoginClient.Failure.BUSY -> "BUSY"
            VeilSocialLoginClient.Failure.CLOSED -> "CLOSED"
            VeilSocialLoginClient.Failure.CANCELLED -> "CANCELLED"
            else -> "REVIEW_REQUIRED"
        }
        is VeilSocialLoginClient.Outcome.State -> when (result.phase) {
            "AWAIT_CALLBACK" -> "AWAIT_CALLBACK"
            "CANCELLED" -> "CANCELLED"
            else -> "REVIEW_REQUIRED"
        }
        VeilSocialLoginClient.Outcome.LocallyCancelledRemoteNotAsserted -> "CANCELLED"
        else -> "REVIEW_REQUIRED"
    }

    }

    override fun toString() = "VeilSocialLoginCoordinator[private original]"
    companion object {
        private fun originalSelection(status: String, selected: VeilSocialLoginClient.Intent?, state: String, scope: String = "PROCESS"): Map<String, Any?> =
            Collections.unmodifiableMap(linkedMapOf("version" to 1, "scope" to scope,
                "originalState" to state, "originalCase" to selected?.name,
                "status" to status, "deviceAuthorization" to "REQUIRED"))
        internal fun noOriginalSelection(closed: Boolean): Map<String, Any?> =
            originalSelection(if (closed) "CLOSED" else "UNAVAILABLE", null,
                if (closed) "UNAVAILABLE" else "ABSENT")
        internal fun unavailableStoredOriginal(): Map<String, Any?> =
            originalSelection("REVIEW_REQUIRED", null, "UNAVAILABLE", "NATIVE_STORAGE")
        /** Publication fence only, never a Native approval or rollback. A late
         * close keeps the already-consumed original at its real owner. */
        internal fun consumeProductStartObservation(
            publicationCurrent: () -> Boolean,
            originalStart: () -> VeilCryptoEngineOwner.ProductStartObservation
        ): String {
            check(publicationCurrent()) { "VEIL_LOGIN_PUBLICATION_NOT_CURRENT" }
            val result = originalStart()
            check(publicationCurrent()) { "VEIL_LOGIN_PUBLICATION_NOT_CURRENT" }
            return when (result) {
                VeilCryptoEngineOwner.ProductStartObservation.NATIVE_SOURCE_REQUIRED ->
                    "ENROLLMENT_ACCEPTED_PRODUCT_SOURCE_REQUIRED"
                VeilCryptoEngineOwner.ProductStartObservation.ATTACHED_OBSERVED ->
                    "NATIVE_PRODUCT_ATTACHED_OBSERVED"
            }
        }
        internal fun enrollmentNeedsOriginalReadback(outcome: VeilSocialLoginClient.Outcome): Boolean =
            when (outcome) {
                is VeilSocialLoginClient.Outcome.EnrollmentRecords -> !outcome.hasCourierRecord()
                is VeilSocialLoginClient.Outcome.ChallengeState -> outcome.status == "ENROLLMENT_COMMITTED_UNVERIFIED"
                is VeilSocialLoginClient.Outcome.Refused -> outcome.remoteOutcomeUnknown
                else -> false
            }

        internal fun readOriginalEnrollment(
            retainedStatus: String,
            current: () -> Boolean,
            read: () -> VeilSocialLoginClient.Outcome,
            beforeConsume: () -> Unit,
            consume: (VeilSocialLoginClient.Outcome.EnrollmentRecords) -> String
        ): String {
            check(current()) { "VEIL_LOGIN_PUBLICATION_NOT_CURRENT" }
            val outcome = read()
            check(current()) { "VEIL_LOGIN_PUBLICATION_NOT_CURRENT" }
            if (outcome !is VeilSocialLoginClient.Outcome.EnrollmentRecords) return retainedStatus
            if (!outcome.hasCourierRecord()) return "ENROLLMENT_ACCEPTED_PRODUCT_SOURCE_REQUIRED"
            beforeConsume()
            return consume(outcome)
        }
        private fun safe(status: String): CompletableFuture<Map<String, String>> =
            CompletableFuture.completedFuture(Collections.unmodifiableMap(linkedMapOf("status" to status, "deviceAuthorization" to "REQUIRED")))
        internal fun publicFixture(client: VeilSocialLoginClient, browser: VeilLoginBrowserAccess) = VeilSocialLoginCoordinator(client, browser)
    }
    internal fun beginPublicControl(selected: String): CompletableFuture<Map<String, String>> = beginOwned(selected, null)
}
