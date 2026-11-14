package com.ynx.social.matrix

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

// BEGIN OWNED CLOSE FENCE
/** All calls occur under the Module gate. A close selection is irreversible,
 * including timeout, refused drain or UNKNOWN. No platform work lives here. */
private class VeilModuleCloseFence {
    private var selected = false
    fun isOpen(): Boolean = !selected
    fun select(pending: Boolean, destroying: Boolean = false) {
        check(destroying || !pending) { "VEIL_ORIGINAL_LOCAL_WORK_PENDING" }
        selected = true
    }
}
// END OWNED CLOSE FENCE

// BEGIN OWNED INSPECTION SELECTION
/** Invoked under the Module gate. Existing work always wins; a selected close
 * forbids invoking the new-work factory, including any allocation/dispatch. */
private inline fun <T : Any> selectOriginalInspection(
    existing: T?, start: Boolean, admissionOpen: Boolean, create: () -> T
): T? {
    if (existing != null) return existing
    if (!start || !admissionOpen) return null
    return create()
}
// END OWNED INSPECTION SELECTION

/** Normal owner registration, not a messaging or enrollment permit.
 * The coordinator stays on its original worker. Normal commands and authorized
 * plaintext presentation cross the UI boundary; secret keys, ratchet state,
 * native selectors, proof custody and private handles never do.
 * Genuine native suppliers and per-operation admission remain required.
 */
class VeilCryptoEngineModule : Module() {
    private val gate = Any()
    private val lifecycle = VeilModuleCloseFence()
    private var selectedClose: CompletableFuture<VeilCryptoEngineOwner.Receipt<VeilCryptoEngineOwner.CloseDisposition>>? = null
    private var owner: VeilCryptoEngineOwner? = null
    private class DirectoryInvocation(val owner: VeilCryptoEngineOwner, val action: String) {
        val result = CompletableFuture<Map<String, Any?>>()
        lateinit var receipt: VeilCryptoEngineOwner.Receipt<Unit>
        var publicationReceipt: VeilCryptoEngineOwner.Receipt<Unit>? = null
        val published = CompletableFuture<Map<String, Any?>>()
    }
    private var directoryInvocation: DirectoryInvocation? = null
    private var directoryFirstFailedInvocation: DirectoryInvocation? = null
    private fun observeOwnDeviceDirectory(action: String): Map<String, Any?> {
        require(action in setOf("read", "observe", "close"))
        val selected = synchronized(gate) {
            if (destroyed || !lifecycle.isOpen()) return VeilOwnDirectoryUi.unavailable()
            val current = owner ?: return VeilOwnDirectoryUi.unavailable()
            directoryInvocation?.let {
                check(it.owner === current && (it.action == action || action == "observe")) { "VEIL_DIRECTORY_ORIGINAL_PENDING" }
                return@synchronized it
            }
            DirectoryInvocation(current, action).also { call ->
                // dispatch returns a receipt only after accepting work. A refused
                // enqueue owns no native operation and must not wedge observation.
                call.receipt = current.dispatch { scope ->
                    try { call.result.complete(scope.observeOwnDirectoryForUi(action)) }
                    catch (t: Throwable) { call.result.completeExceptionally(t); throw t }
                }
                directoryInvocation = call
            }
        }
        // Timeout retains this receipt; another observer never dispatches again.
        val result = try {
            selected.receipt.await(30_000)
            selected.result.get() // retain original, including its first failure
            val publication = synchronized(gate) {
                check(!destroyed && lifecycle.isOpen() && owner === selected.owner && directoryInvocation === selected)
                selected.publicationReceipt ?: selected.owner.dispatch { scope ->
                    try { selected.published.complete(scope.observeOwnDirectoryForUi("observe")) }
                    catch (t: Throwable) { selected.published.completeExceptionally(t); throw t }
                }.also { selected.publicationReceipt = it }
            }
            publication.await(30_000)
            selected.published.get()
        } catch (t: Throwable) {
            synchronized(gate) {
                if (selected.receipt.done() && (selected.publicationReceipt?.done() != false) && directoryInvocation === selected) {
                    if (directoryFirstFailedInvocation == null) directoryFirstFailedInvocation = selected
                    directoryInvocation = null // worker finished; next explicit close uses SAME Source
                }
            }
            throw t
        }
        return synchronized(gate) {
            check(!destroyed && lifecycle.isOpen() && owner === selected.owner && directoryInvocation === selected)
            directoryInvocation = null
            result
        }
    }
    private var destroyed = false
    private var productWatch = false
    private var productRead: CompletableFuture<Map<String, Any>>? = null
    private class ProductInvocation(val request: VeilSocialMessagingCoordinator.Request) {
        val future = CompletableFuture<Map<String, Any?>>()
    }
    private var productInvocation: ProductInvocation? = null
    private var login: VeilSocialLoginCoordinator? = null
    private val deviceAuthentication = VeilLocalDeviceAuthentication()
    @Volatile private var attachmentUi: VeilAttachmentUi? = null
    private var localSetup: CompletableFuture<Map<String, String>>? = null
    private var localSetupRetryable = false
    private var localRecovery: CompletableFuture<Map<String, String>>? = null
    private var authenticatedSetup: CompletableFuture<Map<String, String>>? = null
    private var authenticatedSetupRetryable = false
    private var acceptedDeviceRecovery: VeilCryptoEngineOwner.ProductRecoveryObservation? = null
    private var firstDeviceHandoff: CompletableFuture<Unit>? = null
    private var teardown: VeilCryptoEngineOwner.Receipt<VeilCryptoEngineOwner.CloseDisposition>? = null

/** One retained receipt across JS timeouts; publication follows worker completion. */
private fun readProductInventory(watch: Boolean = false): Map<String, Any> {
    val retained = synchronized(gate) {
        if (destroyed || !lifecycle.isOpen()) return mapOf("status" to "CLOSED")
        if (watch) productWatch = true
        productRead?.takeUnless { it.isDone } ?: run {
            val current = currentOwner()
            val original = CompletableFuture<Map<String, Any>>()
            productRead = original
            Thread({
                try {
                    awaitOriginal(current.initialized())
                    var result: Map<String, Any> = mapOf("status" to "CLOSED")
                    awaitOriginal(current.dispatch { scope ->
                        val admitted = synchronized(gate) { !destroyed && lifecycle.isOpen() && owner === current && productRead === original }
                        if (admitted) result = scope.readProductInventory(synchronized(gate) { productWatch })
                    })
                    synchronized(gate) {
                        original.complete(if (!destroyed && lifecycle.isOpen() && owner === current && productRead === original) result else mapOf("status" to "CLOSED"))
                    }
                } catch (_: Throwable) {
                    synchronized(gate) { original.complete(mapOf("status" to if(destroyed || !lifecycle.isOpen()) "CLOSED" else "UNAVAILABLE")) }
                }
            }, "YNX-product-inventory-receipt").apply { isDaemon = true }.start()
            original
        }
    }
    return try { retained.get(30L, TimeUnit.SECONDS) }
    catch (_: TimeoutException) { mapOf("status" to "PENDING") }
}
/** Repeated calls observe one original queue receipt, never a replacement. */
private fun normalProductCall(context: String, command: String? = null): Map<String, Any?> {
    val request = VeilSocialMessagingCoordinator.Request.decode(context, command)
    val retained = synchronized(gate) {
        check(!destroyed && lifecycle.isOpen()) { "VEIL_PRODUCT_ADMISSION_CLOSED" }
        productInvocation?.takeIf { it.request.same(request) } ?: run {
            productInvocation?.let {
                check(it.future.isDone && request.callId > it.request.callId) { "VEIL_PRODUCT_ORIGINAL_RETAINED" }
            }
            val current = currentOwner()
            ProductInvocation(request).also { original ->
                productInvocation = original
                try {
                    Thread({
                        try {
                            awaitOriginal(current.initialized())
                            var result: Map<String, Any?>? = null
                            awaitOriginal(current.dispatch { scope ->
                                synchronized(gate) {
                                    check(!destroyed && lifecycle.isOpen() && owner === current && productInvocation === original)
                                }
                                result = scope.processProductRequest(request)
                            })
                            synchronized(gate) {
                                check(!destroyed && lifecycle.isOpen() && owner === current && productInvocation === original)
                                original.future.complete(checkNotNull(result))
                            }
                        } catch (failure: Throwable) { original.future.completeExceptionally(failure) }
                    }, "YNX-product-original-receipt").apply { isDaemon = true }.start()
                } catch (failure: Throwable) { original.future.completeExceptionally(failure) }
            }
        }
    }
    // Timeout is not definite-not-applied, draft clearance or retry permission.
    val result = retained.future.get(30L, TimeUnit.SECONDS)
    // The original receipt prevents replay, but is not a fresh delivery grant.
    // Every observer returns to the same worker; the coordinator validates its
    // cached result without reading the inbox or executing the operation again.
    val current = synchronized(gate) {
        check(!destroyed && lifecycle.isOpen() && productInvocation === retained) { "VEIL_PRODUCT_PUBLICATION_CLOSED" }
        checkNotNull(owner) { "VEIL_PRODUCT_PUBLICATION_CLOSED" }
    }
    var delivered: Map<String, Any?>? = null
    awaitOriginal(current.dispatch { scope ->
        synchronized(gate) {
            check(!destroyed && lifecycle.isOpen() && owner === current && productInvocation === retained) {
                "VEIL_PRODUCT_PUBLICATION_CLOSED"
            }
        }
        delivered = scope.processProductRequest(retained.request)
        check(delivered === result) { "VEIL_PRODUCT_ORIGINAL_CHANGED" }
    })
    return synchronized(gate) {
        check(!destroyed && lifecycle.isOpen() && owner === current && productInvocation === retained) { "VEIL_PRODUCT_PUBLICATION_CLOSED" }
        result
    }
}
private fun stopProductInventory(): Map<String, Any> {
    val current = synchronized(gate) {
        productWatch = false
        if (destroyed || !lifecycle.isOpen()) return mapOf("status" to "CLOSED")
        owner ?: return mapOf("status" to "NOT_OPENED")
    }
    // Actual subscription is worker-owned. Close also attempts this before native release.
    awaitOriginal(current.dispatch { scope -> scope.stopProductInvalidation() })
    return mapOf("status" to "UNSUBSCRIBED")
}
private fun currentOwner(): VeilCryptoEngineOwner = synchronized(gate) {

        check(!destroyed) { "VEIL_MODULE_DESTROYED" }
        if (owner == null) check(lifecycle.isOpen()) { "VEIL_MODULE_CLOSE_SELECTED" }
        owner ?: run {
            val context = appContext.reactContext?.applicationContext ?: error("VEIL_APP_CONTEXT_REQUIRED")
            val ui = attachmentUi ?: VeilAttachmentUi(context) { appContext.currentActivity }.also { attachmentUi = it }
            VeilCryptoEngineOwner.open(context, ui).also { owner = it }
        }
    }

    private fun projection(value: VeilCryptoEngineOwner.Snapshot): Map<String, Any?> = mapOf(
        "ownerState" to value.state.name,
        "queued" to value.queued,
        "pendingTickets" to value.originalTickets,
        "reopenedPendingRows" to value.reopenedRows,
        "pendingStoreState" to value.pendingStatus?.name,
        "failureRetained" to value.failureRetained,
        "nativeBoundary" to value.nativeBoundary.name,
        "localGenesisAttempted" to value.localGenesisAttempted,
        "localGenesisStatus" to value.localGenesisStatus
    )

    private fun setupProjection(status: String) = mapOf(
        "status" to status, "nativeBoundary" to "REQUIRED", "deviceAuthorization" to "REQUIRED"
    )

    private fun loginProjection(status: String) = mapOf(
        "status" to status, "deviceAuthorization" to "REQUIRED"
    )

    private fun currentLogin(): VeilSocialLoginCoordinator = synchronized(gate) {
        check(!destroyed) { "VEIL_MODULE_DESTROYED" }
        login ?: run {
            val context = appContext.reactContext?.applicationContext
                ?: error("VEIL_APP_CONTEXT_REQUIRED")
            // Signed application resources, never JS, Intent or current signer
            // self-discovery. Empty config deliberately cannot start sign-in.
            val id = context.resources.getIdentifier(VeilSocialLoginProfile.forPackage(context.packageName).signerResource, "array", context.packageName)
            val configured = if (id == 0) emptyList() else context.resources.getStringArray(id).toList()
            require(configured.size <= 4 && configured.all { Regex("[0-9a-fA-F]{64}").matches(it) })
            VeilSocialLoginCoordinator(VeilSocialLoginBrowserPort(context, context.packageName, configured.toSet()), context)
                .also { login = it }
        }
    }

    private fun observeLoginResult(original: CompletableFuture<Map<String, String>>): Map<String, String> {
        val observed = try { original.get(30L, TimeUnit.SECONDS) }
        catch (_: TimeoutException) { loginProjection("OBSERVATION_PENDING") }
        catch (_: Exception) { loginProjection("REVIEW_REQUIRED") }
        return synchronized(gate) { if (destroyed) loginProjection("CLOSED") else observed }
    }

    private fun <T> awaitOriginal(receipt: VeilCryptoEngineOwner.Receipt<T>): T {
        while (true) {
            try { return receipt.await(30_000L) }
            catch (_: TimeoutException) { /* Observe the same work; never dispatch a replacement. */ }
        }
    }

    private fun initializeLocalDevice(locale: String): Map<String, String> {
        require(locale == "en" || locale == "zh")
        val result = synchronized(gate) {
            check(!destroyed)
            check(lifecycle.isOpen()) { "VEIL_MODULE_CLOSE_SELECTED" }
            check(authenticatedSetup == null) { "VEIL_AUTHENTICATED_SETUP_RETAINED" }
            check(localRecovery == null) { "VEIL_ORIGINAL_RECOVERY_RETAINED" }
            val existing = localSetup
            if (existing != null && (!existing.isDone || !localSetupRetryable)) return@synchronized existing
            val current = currentOwner()
            val activity = appContext.currentActivity ?: return setupProjection("UNAVAILABLE")
            val retained = CompletableFuture<Map<String, String>>()
            localSetup = retained
            localSetupRetryable = false
            Thread({
                var request: VeilLocalDeviceAuthentication.Request? = null
                var completedStatus = "RECOVERY_REQUIRED"
                var retryable = false
                fun live() = synchronized(gate) { !destroyed && lifecycle.isOpen() && owner === current && localSetup === retained }
                try {
                    awaitOriginal(current.initialized())
                    var original: VeilLocalGenesisProducer.Original? = null
                    awaitOriginal(current.dispatch { scope ->
                        if (live() && scope.supportsDurableLocalGenesis()) original = scope.prepareLocalGenesis()
                    })
                    val intent = original
                    if (!live() || intent == null) {
                        completedStatus = "UNAVAILABLE"
                    } else {
                        val prompt = deviceAuthentication.request(activity,
                            if (locale == "zh") "\u51c6\u5907\u6b64\u8bbe\u5907" else "Prepare this device",
                            if (locale == "zh") "\u4f7f\u7528\u5c4f\u5e55\u9501\u9a8c\u8bc1\u4f60\u7684\u8eab\u4efd\u3002\u8fd9\u4e0d\u4f1a\u81ea\u52a8\u6279\u51c6\u6b64\u8bbe\u5907\u3002"
                            else "Confirm your screen lock. This does not automatically approve this device.")
                        request = prompt
                        var outcome: VeilLocalDeviceAuthentication.Outcome? = null
                        while (outcome == null) {
                            try { outcome = prompt.await(30_000L) }
                            catch (_: TimeoutException) { /* Retain the original system prompt. */ }
                        }
                        completedStatus = when (outcome) {
                            VeilLocalDeviceAuthentication.Outcome.CONFIRMED -> {
                                var nativeStatus: Int? = null
                                awaitOriginal(current.dispatch { scope ->
                                    if (live()) {
                                        scope.revalidateLocalGenesis(intent)
                                        if (deviceAuthentication.consume(prompt)) {
                                            nativeStatus = scope.beginPreparedLocalGenesis(intent)
                                        }
                                    }
                                })
                                if (nativeStatus == 41) "LOCAL_INITIALIZATION_PENDING" else "RECOVERY_REQUIRED"
                            }
                            VeilLocalDeviceAuthentication.Outcome.CANCELLED -> "AUTHENTICATION_CANCELLED"
                            VeilLocalDeviceAuthentication.Outcome.SCREEN_LOCK_REQUIRED -> "SCREEN_LOCK_REQUIRED"
                            else -> "UNAVAILABLE"
                        }
                        retryable = outcome == VeilLocalDeviceAuthentication.Outcome.CANCELLED ||
                            outcome == VeilLocalDeviceAuthentication.Outcome.SCREEN_LOCK_REQUIRED
                    }
                } catch (_: Throwable) {
                    // Actual worker/input/journal keeps its failure. JS receives
                    // neither secret material nor an invented successful grant.
                    completedStatus = "RECOVERY_REQUIRED"
                    retryable = false
                } finally {
                    try {
                        request?.let { prompt ->
                            check(prompt.result.isDone) { "VEIL_DEVICE_AUTH_RESULT_STILL_PENDING" }
                            deviceAuthentication.releaseObserved(prompt)
                        }
                    } catch (_: Throwable) {
                        completedStatus = "RECOVERY_REQUIRED"
                        retryable = false
                    }
                    synchronized(gate) {
                        // Publish retry permission only AFTER observing and
                        // releasing the completed original system request.
                        // Next prepare returns the SAME live PREPARED intent.
                        if (localSetup === retained) localSetupRetryable = retryable && !destroyed && lifecycle.isOpen()
                        retained.complete(setupProjection(if (!destroyed && lifecycle.isOpen()) completedStatus else "UNAVAILABLE"))
                    }
                }
            }, "YNX-Social-Local-Setup").apply { isDaemon = true }.start()
            retained
        }
        return try { result.get(30_000L, TimeUnit.MILLISECONDS) }
        catch (_: TimeoutException) { setupProjection("LOCAL_INITIALIZATION_PENDING") }
    }

    // Explicit local inspection only. Never call currentOwner here: recovery
    // must retain the original worker, command and submitted journal record.
    private fun localRecoveryCheck(start: Boolean): Map<String, String> {
        val original = synchronized(gate) {
            if (destroyed) return setupProjection("UNAVAILABLE")
            selectOriginalInspection(localRecovery, start, lifecycle.isOpen()) {
                val current = owner ?: return setupProjection("UNAVAILABLE")
                if (localSetup?.isDone == false) return setupProjection("UNAVAILABLE")
                val retained = CompletableFuture<Map<String, String>>()
                localRecovery = retained
                try {
                    Thread({
                        try {
                            var observed: Map<String, String>? = null
                            // No initialized().await: a retained initialization
                            // failure is not grounds to replace its live worker.
                            awaitOriginal(current.dispatch { scope ->
                                synchronized(gate) {
                                    check(!destroyed && lifecycle.isOpen() && owner === current && localRecovery === retained)
                                }
                                val status = scope.inspectExistingLocalRecovery()
                                val label = when (status) {
                                    null -> "NO_ORIGINAL_OPERATION"
                                    61 -> "CIPHERTEXT_HELD_UNVERIFIED"
                                    16, 25 -> "UNKNOWN_RETAINED"
                                    24 -> "REFUSED_RETAINED"
                                    else -> "RECOVERY_REQUIRED"
                                }
                                observed = setupProjection(label)
                            })
                            // Receipt.await establishes completion of this exact
                            // dispatch, not merely completion of its scope body.
                            synchronized(gate) {
                                check(!destroyed && lifecycle.isOpen() && owner === current && localRecovery === retained)
                                retained.complete(checkNotNull(observed))
                            }
                        } catch (_: Throwable) {
                            // Worker/command retains primary and original state.
                            synchronized(gate) {
                                retained.complete(setupProjection(
                                    if (!destroyed && lifecycle.isOpen() && owner === current && localRecovery === retained)
                                        "RECOVERY_REQUIRED" else "UNAVAILABLE"
                                ))
                            }
                        }
                    }, "YNX-Social-Local-Recovery").apply { isDaemon = true }.start()
                } catch (_: Throwable) {
                    retained.complete(setupProjection("UNAVAILABLE"))
                }
                retained
            } ?: return setupProjection("UNAVAILABLE")
        }
        val result = try { original.get(30L, TimeUnit.SECONDS) }
        catch (_: TimeoutException) { setupProjection("OBSERVATION_PENDING") }
        catch (_: Exception) { setupProjection("RECOVERY_REQUIRED") }
        return synchronized(gate) { if (destroyed || !lifecycle.isOpen()) setupProjection("UNAVAILABLE") else result }
    }

    // No worker dispatch, store access, capture, prompt or native effect.
    // Called under gate again at admission; UI preflight is not a capability.
    private fun authenticationEligibility(): String = synchronized(gate) {
        if (destroyed || !lifecycle.isOpen()) return@synchronized "UNAVAILABLE"
        val current = owner ?: return@synchronized "LOCAL_SETUP_REQUIRED"
        val inspection = localRecovery
        val complete = inspection?.isDone == true
        val status = if (complete && inspection != null && !inspection.isCompletedExceptionally && !inspection.isCancelled)
            inspection.getNow(emptyMap())["status"] else null
        VeilLocalDeviceRouting.authenticationEligibility(current.read(),
            localSetup?.isDone == false, complete, status, current.hasInspectedColdOriginal())
    }

    private fun continueLocalDevice(locale: String, start: Boolean): Map<String, String> {
        require(locale == "en" || locale == "zh")
        val original = synchronized(gate) {
            if (destroyed) return setupProjection("UNAVAILABLE")
            val previous = authenticatedSetup
            if (previous != null && (!start || !previous.isDone || !authenticatedSetupRetryable)) {
                return@synchronized previous
            }
            if (!start) return setupProjection("UNAVAILABLE")
            val eligibility = authenticationEligibility()
            if (eligibility != "AUTHENTICATION_ELIGIBLE") return setupProjection(eligibility)
            val current = owner ?: return setupProjection("UNAVAILABLE")
            if (localSetup?.isDone == false) return setupProjection("UNAVAILABLE")
            val activity = appContext.currentActivity ?: return setupProjection("UNAVAILABLE")
            val retained = CompletableFuture<Map<String, String>>()
            authenticatedSetup = retained
            authenticatedSetupRetryable = false
            try {
                Thread({
                    var prompt: VeilLocalDeviceAuthentication.Request? = null
                    var status = "RECOVERY_REQUIRED"
                    var retryable = false
                    var recoveredProduct: VeilCryptoEngineOwner.ProductRecoveryObservation? = null
                    fun live() = synchronized(gate) {
                        !destroyed && lifecycle.isOpen() && owner === current && authenticatedSetup === retained
                    }
                    try {
                        // Only observe completed inspection; authentication
                        // never initiates capture/readback as a side effect.
                        val inspection = localRecoveryCheck(false)
                        check(live() && inspection["status"] == "CIPHERTEXT_HELD_UNVERIFIED")
                        var captured: VeilCryptoEngineOwner.LocalAuthenticationOriginal? = null
                        awaitOriginal(current.dispatch { scope ->
                            check(live())
                            captured = scope.prepareLocalAuthenticationOriginal()
                        })
                        val input = checkNotNull(captured)
                        check(live())
                        val request = deviceAuthentication.request(activity,
                            if (locale == "zh") "验证此设备" else "Verify this device",
                            if (locale == "zh") "使用屏幕锁解封原本机密钥。此操作不授予设备权限。"
                            else "Use your screen lock to unlock the original local keys. This does not authorize the device.")
                        prompt = request
                        var outcome: VeilLocalDeviceAuthentication.Outcome? = null
                        while (outcome == null) {
                            try { outcome = request.await(30_000L) }
                            catch (_: TimeoutException) { /* Retain this exact prompt. */ }
                        }
                        when (outcome) {
                            VeilLocalDeviceAuthentication.Outcome.CONFIRMED -> {
                                awaitOriginal(current.dispatch { scope ->
                                    check(live())
                                    check(scope.prepareLocalAuthenticationOriginal() === input)
                                    check(deviceAuthentication.consume(request)) { "VEIL_DEVICE_AUTH_NOT_CURRENT" }
                                    check(live())
                                    scope.authenticatePreparedLocalAuthentication(input)
                                    check(live())
                                    recoveredProduct = scope.restoreAcceptedProductOriginal()
                                })
                                status = "LOCAL_KEYS_AUTHENTICATED"
                            }
                            VeilLocalDeviceAuthentication.Outcome.CANCELLED -> {
                                status = "AUTHENTICATION_CANCELLED"; retryable = true
                            }
                            VeilLocalDeviceAuthentication.Outcome.SCREEN_LOCK_REQUIRED -> {
                                status = "SCREEN_LOCK_REQUIRED"; retryable = true
                            }
                            else -> status = "UNAVAILABLE"
                        }
                    } catch (_: Throwable) {
                        status = "RECOVERY_REQUIRED"; retryable = false
                    } finally {
                        try { prompt?.let { deviceAuthentication.releaseObserved(it) } }
                        catch (_: Throwable) { status = "RECOVERY_REQUIRED"; retryable = false }
                        synchronized(gate) {
                            val currentOriginal = !destroyed && lifecycle.isOpen() && owner === current && authenticatedSetup === retained
                            authenticatedSetupRetryable = currentOriginal && retryable
                            if (currentOriginal && status == "LOCAL_KEYS_AUTHENTICATED")
                                acceptedDeviceRecovery = recoveredProduct
                            // Keep the existing exact three-field RN contract.
                            // Recovery selection remains private Native-owner DATA.
                            retained.complete(setupProjection(if (currentOriginal) status else "UNAVAILABLE"))
                        }
                        // Same normal verify path, only after receipt and prompt
                        // release. Missing original login stays a prerequisite;
                        // no new login/client, proposal tuple or owner is made.
                        if (status == "LOCAL_KEYS_AUTHENTICATED" &&
                            recoveredProduct == VeilCryptoEngineOwner.ProductRecoveryObservation.NO_ORIGINAL)
                            firstDeviceChallenge(true)
                    }
                }, "YNX-Social-Authenticated-Setup").apply { isDaemon = true }.start()
            } catch (_: Throwable) { retained.complete(setupProjection("UNAVAILABLE")) }
            retained
        }
        val result = try { original.get(30L, TimeUnit.SECONDS) }
        catch (_: TimeoutException) { setupProjection("AUTHENTICATION_PENDING") }
        catch (_: Exception) { setupProjection("RECOVERY_REQUIRED") }
        return synchronized(gate) { if (destroyed || !lifecycle.isOpen()) setupProjection("UNAVAILABLE") else result }
    }

    // Observation only; actual product calls still require the Native owner.
    // A restored device must not accidentally enter first-device issuance again.
    private fun recoveredProductStatusLocked(): String? = when (acceptedDeviceRecovery) {
        VeilCryptoEngineOwner.ProductRecoveryObservation.ATTACHED_OBSERVED -> "NATIVE_PRODUCT_ATTACHED_OBSERVED"
        VeilCryptoEngineOwner.ProductRecoveryObservation.DEVICE_CURRENT_SOURCE_REQUIRED -> "ENROLLMENT_ACCEPTED_PRODUCT_SOURCE_REQUIRED"
        else -> null
    }

    private fun firstDeviceEnrollment(prepare: Boolean): Map<String, String> {
        fun projection(status: String) = mapOf("status" to status, "nativeBoundary" to "REQUIRED", "deviceAuthorization" to "REQUIRED")
        return synchronized(gate) {
            if (destroyed || !lifecycle.isOpen()) return projection("UNAVAILABLE")
            recoveredProductStatusLocked()?.let { return projection(it) }
            val currentLogin = login ?: return projection("ORIGINAL_A_LOGIN_REQUIRED")
            if (owner == null) return projection("LOCAL_KEYS_REQUIRED")
            if (firstDeviceHandoff?.isDone != true || firstDeviceHandoff?.isCompletedExceptionally == true)
                return projection("CHALLENGE_PENDING")
            // Selection and the existing close fence share this gate. These
            // coordinator methods enqueue once and return an immediate snapshot;
            // no network, JNI or owner receipt is awaited under the Module gate.
            val status = (if (prepare) currentLogin.prepareFirstDeviceEnrollment(appContext.currentActivity ?: return projection("UNAVAILABLE")) else currentLogin.observeFirstDeviceEnrollment())
                .getNow(mapOf("status" to "ENROLLMENT_PENDING"))["status"] ?: "ENROLLMENT_UNKNOWN_RETAINED"
            projection(status)
        }
    }

    private fun firstDeviceChallenge(start: Boolean): Map<String, String> {
        val originalLogin: VeilSocialLoginCoordinator
        val originalOwner: VeilCryptoEngineOwner?
        synchronized(gate) {
            if (destroyed || !lifecycle.isOpen()) return setupProjection("UNAVAILABLE")
            recoveredProductStatusLocked()?.let { return setupProjection(it) }
            originalLogin = login ?: return setupProjection("ORIGINAL_A_LOGIN_REQUIRED")
            originalOwner = owner
            if (firstDeviceHandoff == null && start) {
                val eligibility = originalLogin.firstDeviceEligibility()
                if (eligibility != "ORIGINAL_A_LOGIN_OBSERVED") return setupProjection(eligibility)
                val current = owner ?: return setupProjection("LOCAL_KEYS_REQUIRED")
                if (authenticatedSetup?.getNow(emptyMap())?.get("status") != "LOCAL_KEYS_AUTHENTICATED")
                    return setupProjection("LOCAL_KEYS_REQUIRED")
                // The cold Source/account producer is independent and must be supplied;
                // local pair authentication never forges a warm first-device origin.
                if (!current.firstDeviceProofOriginAvailable()) return setupProjection("UNAVAILABLE")
                val retained = CompletableFuture<Unit>()
                firstDeviceHandoff = retained // no second dispatch on timeout/remount
                try {
                    Thread({
                        try {
                            var intent: VeilCryptoEngineOwner.FirstDeviceIntent? = null
                            awaitOriginal(current.dispatch { scope ->
                                synchronized(gate) {
                                    check(!destroyed && lifecycle.isOpen() && owner === current &&
                                        login === originalLogin && firstDeviceHandoff === retained)
                                }
                                intent = scope.originalFirstDeviceIntent()
                            })
                            synchronized(gate) {
                                check(!destroyed && lifecycle.isOpen() && owner === current &&
                                    login === originalLogin && firstDeviceHandoff === retained)
                                val status = originalLogin.issueFirstDeviceChallenge(checkNotNull(intent)).getNow(emptyMap())["status"]
                                check(status !in setOf("UNAVAILABLE", "ORIGINAL_A_LOGIN_REQUIRED", "OBSERVATION_PENDING"))
                                retained.complete(Unit)
                            }
                        } catch (failure: Throwable) { retained.completeExceptionally(failure) }
                    }, "YNX-Social-First-Device-Handoff").apply { isDaemon = true }.start()
                } catch (failure: Throwable) { retained.completeExceptionally(failure) }
            }
            val retained = firstDeviceHandoff
            if (retained?.isDone == false) return setupProjection("CHALLENGE_PENDING")
            if (retained?.isCompletedExceptionally == true) return setupProjection("CHALLENGE_UNKNOWN_RETAINED")
        }
        val observed = originalLogin.observeFirstDeviceChallenge().getNow(emptyMap())["status"] ?: "CHALLENGE_REQUIRED"
        return synchronized(gate) {
            if (destroyed || !lifecycle.isOpen() || login !== originalLogin || owner !== originalOwner)
                setupProjection("UNAVAILABLE")
            else setupProjection(observed)
        }
    }

    // Select admission/future atomically, but invoke owner.close and wait OUTSIDE
    // the Module gate. Concurrent close/destroy observes the same receipt slot.
    private fun selectOwnerClose(destroying: Boolean = false):
        CompletableFuture<VeilCryptoEngineOwner.Receipt<VeilCryptoEngineOwner.CloseDisposition>>? {
        // Synchronous presentation invalidation precedes any owner queue/wait,
        // including a close that is refused because an original is still busy.
        attachmentUi?.invalidate()
        var launch: VeilCryptoEngineOwner? = null
        val selected = synchronized(gate) {
            if (!destroying) check(!destroyed) { "VEIL_MODULE_DESTROYED" }
            selectedClose?.let { return@synchronized it }
            lifecycle.select(localSetup?.isDone == false || localRecovery?.isDone == false ||
                authenticatedSetup?.isDone == false || firstDeviceHandoff?.isDone == false || productInvocation?.future?.isDone == false, destroying)
            val current = owner ?: return@synchronized null
            CompletableFuture<VeilCryptoEngineOwner.Receipt<VeilCryptoEngineOwner.CloseDisposition>>().also {
                selectedClose = it
                launch = current
            }
        }
        attachmentUi?.close()
        launch?.let { current ->
            try { selected!!.complete(current.close()) }
            catch (failure: Throwable) { selected!!.completeExceptionally(failure) }
        }
        return selected
    }

    private fun observeRetainedOwnerLifecycle(): Map<String, Any?> {
            // Observe only the retained close receipt. Never select close/open,
            // dispatch work, infer native status, or create a replacement owner.
            val captured = synchronized(gate) { Triple(selectedClose, owner, lifecycle.isOpen()) }
            val selected = captured.first
            val status = if (selected == null) {
                if (captured.third) "NOT_SELECTED"
                else if (captured.second == null) "NOT_OPENED"
                else "OBSERVATION_PENDING"
            } else if (!selected.isDone) "OBSERVATION_PENDING" else try {
                val receipt = selected.getNow(null)
                if (receipt == null || !receipt.done()) "OBSERVATION_PENDING" else receipt.await(1L).name
            } catch (_: Throwable) { "CLOSE_RECEIPT_FAILED" }
            return mapOf("closeStatus" to status, "nativeBoundary" to "REQUIRED",
                "owner" to captured.second?.let { projection(it.read()) })
    }

    // Exact first phase of OnDestroy, separated from platform cleanup. Existing
    // owner custody remains live until selectOwnerClose publishes its receipt.
    private fun markDestroyedAdmission() {
        synchronized(gate) {
            destroyed = true
            productWatch = false
            lifecycle.select(pending = true, destroying = true)
        }
    }

    override fun definition() = ModuleDefinition {
        Name("YNXSocialCryptoEngine")
        AsyncFunction("observeOwnDeviceDirectory") { action: String -> observeOwnDeviceDirectory(action) }
        AsyncFunction("observeLocalOwnerLifecycle") { observeRetainedOwnerLifecycle() }
        AsyncFunction("readNativeProductState") { readProductInventory() }
        AsyncFunction("readNativeProductSnapshot") { context: String -> normalProductCall(context) }
        AsyncFunction("executeNativeProductCommand") { command: String, context: String -> normalProductCall(context, command) }
        AsyncFunction("subscribeNativeProductInvalidation") { readProductInventory(true) }
        AsyncFunction("unsubscribeNativeProductInvalidation") { stopProductInventory() }
        AsyncFunction("prepareFirstDeviceEnrollment") { firstDeviceEnrollment(true) }
        AsyncFunction("observeFirstDeviceEnrollment") { firstDeviceEnrollment(false) }
        AsyncFunction("beginFirstDeviceChallenge") { firstDeviceChallenge(true) }
        AsyncFunction("observeFirstDeviceChallenge") { firstDeviceChallenge(false) }
        AsyncFunction("cancelFirstDeviceChallenge") {
            synchronized(gate) {
                if (destroyed) return@AsyncFunction setupProjection("UNAVAILABLE")
                // Never login.cancelOriginal: this sends only the retained
                // challenge's five exact strings, or retains UNKNOWN.
                val original = login ?: return@AsyncFunction setupProjection("ORIGINAL_A_LOGIN_REQUIRED")
                if (firstDeviceHandoff?.isDone == false) return@AsyncFunction setupProjection("CHALLENGE_PENDING")
                setupProjection(original.cancelFirstDeviceChallenge().getNow(emptyMap())["status"] ?: "CHALLENGE_UNKNOWN_RETAINED")
            }
        }
        AsyncFunction("readLocalDeviceAuthenticationEligibility") { setupProjection(authenticationEligibility()) }
        AsyncFunction("continueLocalDevice") { locale: String -> continueLocalDevice(locale, true) }
        AsyncFunction("observeLocalDeviceAuthentication") { continueLocalDevice("en", false) }
        AsyncFunction("beginLocalRecoveryCheck") { attachmentUi?.invalidate(); localRecoveryCheck(true) }
        AsyncFunction("observeLocalRecoveryCheck") { localRecoveryCheck(false) }
        AsyncFunction("initializeLocalDevice") { locale: String -> attachmentUi?.invalidate(); initializeLocalDevice(locale) }
        AsyncFunction("beginAccountLogin") { selected: String ->
            attachmentUi?.invalidate()
            require(selected in setOf("A", "B", "C", "D"))
            val activity = appContext.currentActivity
                ?: return@AsyncFunction loginProjection("UNAVAILABLE")
            val original = synchronized(gate) {
                if (destroyed) return@AsyncFunction loginProjection("CLOSED")
                currentLogin()
            }
            val result = original.begin(selected, activity)
            result.whenComplete { _, _ -> attachmentUi?.invalidate() }
            observeLoginResult(result)
        }
        AsyncFunction("observeAccountLogin") {
            val original = synchronized(gate) {
                if (destroyed) return@AsyncFunction loginProjection("CLOSED")
                login
            } ?: return@AsyncFunction loginProjection("UNAVAILABLE")
            observeLoginResult(original.observeOriginal())
        }
        AsyncFunction("readAccountLoginOriginal") {
            // Open only the native sealed original; no HTTP, browser or grant.
            synchronized(gate) {
                if (destroyed) VeilSocialLoginCoordinator.noOriginalSelection(true)
                else try { currentLogin().observeOriginalSelection() }
                catch (_: Exception) { VeilSocialLoginCoordinator.unavailableStoredOriginal() }
            }
        }
        AsyncFunction("readAccountLoginDiagnostic") {
            // No creation, IPC, verification rerun, or lifecycle transition.
            synchronized(gate) { login?.returnLinkDiagnostic() ?: VeilReturnLinkDiagnostic.notChecked() }
        }
        AsyncFunction("readAccountLoginFailureDiagnostic") {
            // Original in-memory observation only: no creation/status HTTP/retry.
            synchronized(gate) { login?.loginFailureDiagnostic() ?: VeilLoginFailureDiagnostic.notRecorded() }
        }
        AsyncFunction("cancelAccountLogin") {
            attachmentUi?.invalidate()
            val original = synchronized(gate) {
                if (destroyed) return@AsyncFunction loginProjection("CLOSED")
                login
            } ?: return@AsyncFunction loginProjection("UNAVAILABLE")
            observeLoginResult(original.cancelOriginal())
        }

        OnActivityResult { activity, result ->
            deviceAuthentication.onActivityResult(activity, result.requestCode, result.resultCode)
            attachmentUi?.onActivityResult(activity, result.requestCode, result.resultCode, result.data)
        }
        OnActivityDestroys { deviceAuthentication.onActivityDestroyed(); attachmentUi?.onActivityDestroyed(); synchronized(gate) { owner }?.invalidateDeviceProvisioningReview() }

        // AsyncFunction waits off the owner worker. A timeout never cancels or
        // recreates that owner; the next call observes the same initialization.
        AsyncFunction("readLocalOwnerState") {
            val current = currentOwner()
            current.initialized().await(30_000L)
            projection(current.read())
        }

        AsyncFunction("closeLocalOwner") {
            val selected = selectOwnerClose() ?: return@AsyncFunction mapOf(
                "closeDisposition" to "NOT_OPENED",
                "nativeBoundary" to "REQUIRED"
            )
            val disposition = selected.get(30L, TimeUnit.SECONDS).await(30_000L)
            val current = synchronized(gate) { checkNotNull(owner) }
            // Retain this exact owner even after CLOSED_LOCAL_ONLY. Native ABI2
            // release leaves a process tombstone, not permission to reopen.
            // Later reads project this terminal owner; no new worker is created.
            // Local close does not cancel messages or revoke a device.
            projection(current.read()) + mapOf("closeDisposition" to disposition.name)
        }

        OnDestroy {
            attachmentUi?.close()
            markDestroyedAdmission()
            // No Module monitor across platform/owner calls or receipt waits.
            deviceAuthentication.invalidate()
            val originalLogin = synchronized(gate) { login }
            try { originalLogin?.close() }
            finally { selectOwnerClose(destroying = true) }
        }
    }
}
