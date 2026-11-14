package com.ynx.social.matrix

import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.InterruptedIOException
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/**
 * One native-owned original login attempt. Blocking methods MUST run on
 * an owned IO worker, never the UI thread. No Expo exports, shared CookieHandler,
 * cookie getters, token DTOs, endpoint override or crypto/device actor.
 *
 * Browser integration must intercept the EXACT HTTPS callback in a trusted
 * native browser port before navigation, then call bindCallback on this SAME
 * instance. Custom Tabs/RN cookies are NOT assumed shared. The normal module
 * uses a Keystore-sealed original journal; recovery is the same read-only
 * association, never a replacement START or restored device authorization.
 */
class VeilSocialLoginClient private constructor(private val factory: Call.Factory, private val profile: VeilSocialLoginProfile = VeilSocialLoginProfile.PRODUCTION, private val originalJournal: VeilLoginOriginalJournal? = null) : AutoCloseable {
    constructor() : this(fixedClient())
    internal constructor(profile: VeilSocialLoginProfile) : this(fixedClient(profile), profile)
    internal constructor(context: android.content.Context, profile: VeilSocialLoginProfile) :
        this(fixedClient(profile), profile, VeilAndroidLoginOriginalJournal(context, profile))
    private val CALLBACK: String get() = profile.callback
    enum class Intent { A, B, C, D }
    enum class Failure { BUSY, CLOSED, ASSOCIATION_REQUIRED, ORIGINAL_START_UNKNOWN, INVALID_RESPONSE,
        HTTP_REFUSED, REDIRECT_REFUSED, NO_RESPONSE, TLS_FAILED, TIMEOUT, CANCELLED, CALLBACK_REFUSED, PERSISTENCE_REFUSED }
    sealed class Outcome {
        class Authorization(val browser: BrowserHandoff) : Outcome()
        data class State(val intent: Intent, val phase: String, val expiresAt: String) : Outcome()
        data class AccountObserved(val subject: String, val generation: Long) : Outcome() {
            val deviceAuthorization: String get() = "REQUIRED"
        }
        object CallbackBound : Outcome()
        object LocallyCancelledRemoteNotAsserted : Outcome()
        internal class ChallengeState(val status: String) : Outcome()
        internal class EnrollmentRecords(val original: VeilCryptoEngineOwner.FirstDeviceIntent,
            val prepared: VeilFirstDeviceEnrollmentWire.Prepared, private val bytes: ByteArray) : Outcome() {
            internal fun originalCopy(): ByteArray = bytes.copyOf()
            internal fun sameOriginal(other: ByteArray): Boolean = bytes.contentEquals(other)
            private var courierRecord: ByteArray? = null
            private var courierDigest: ByteArray? = null
            @Synchronized internal fun retainCourierRecord(value: ByteArray) {
                require(value.size in 1..VeilFirstDeviceEnrollmentWire.COURIER_RECORD_LIMIT)
                val digest = java.security.MessageDigest.getInstance("SHA-256").digest(value)
                try {
                    val old = courierDigest
                    if (old == null) { courierRecord = value.copyOf(); courierDigest = digest.copyOf() }
                    else check(java.security.MessageDigest.isEqual(old, digest)) { "ENROLLMENT_COURIER_RECORD_CHANGED" }
                } finally { digest.fill(0) }
            }
            @Synchronized internal fun courierRecordCopy(): ByteArray? = courierRecord?.copyOf()
            @Synchronized internal fun hasCourierRecord(): Boolean = courierRecord != null
            @Synchronized internal fun eraseCourierRecord() { courierRecord?.fill(0); courierRecord = null }
            override fun toString() = "EnrollmentRecords[unverified public originals]"
        }
        internal class StorageRegistered(val value: VeilFirstDeviceStorageWire.Registered) : Outcome()
        internal class SourceSelection(val value: VeilFirstDeviceSourceWire.Selection) : Outcome()
        internal class SourceEvidence(val bytes: ByteArray) : Outcome()
        /** Exact opaque PUBLIC transport; only Native may verify its contents. */
        internal class RuntimeCoreOriginals(val original: VeilCryptoEngineOwner.FirstDeviceIntent,
            val prepared: VeilFirstDeviceEnrollmentWire.Prepared, private val bytes: ByteArray) : Outcome() {
            internal fun originalCopy(): ByteArray = bytes.copyOf()
            override fun toString() = "RuntimeCoreOriginals[unverified public transport]"
        }
        data class Refused(val reason: Failure, val httpStatus: Int = 0, val remoteOutcomeUnknown: Boolean = false) : Outcome()
    }
    /** Native-only launch object: never serialize/forward this through JS. */
    class BrowserHandoff internal constructor(private val owner: VeilSocialLoginClient, private val url: String) {
        fun launchNative(launch: (String) -> Unit): Boolean = owner.launch(this, url, launch)
        override fun toString() = "SocialLoginBrowserHandoff[redacted]"
    }
    // The original login owns cookies throughout. This loan is local custody,
    // never a Central identity or a peer/profile capability.
    private var accountChannelBorrow: AccountChannelBorrow? = null
    internal inner class AccountChannelBorrow internal constructor(
        private val original: VeilCryptoEngineOwner.FirstDeviceIntent,
        private val prepared: VeilFirstDeviceEnrollmentWire.Prepared,
        private val capturedEpoch: Long,
        private val started: Long,
        private val budgetNanos: Long
    ) {
        private var nativeThread: Thread? = null
        private var nativeFactsUnadmitted = false
        internal fun requireM1QaTransport() = synchronized(gate) {
            check(profile == VeilSocialLoginProfile.M1_QA)
            requireCurrent()
        }
        internal fun retainNativeFactsUnadmitted() = synchronized(gate) {
            requireCurrent()
            nativeFactsUnadmitted = true
        }
        internal fun requireSourceRefresh() = synchronized(gate) {
            check(nativeFactsUnadmitted)
            // Refresh IO runs on the original login executor, not the JNI
            // worker. Do not transfer or change this borrow's pinned thread.
            check(accountChannelBorrow === this && !closed && !stopped && epoch == capturedEpoch)
            check(challengeOriginal === original && enrollmentPrepared === prepared && !challengeCancelAttempted && !enrollmentFinalizeAttempted)
            original.requestForOriginal()
            val wall = System.currentTimeMillis()
            check(wall >= prepared.original.value("issuedAtMs").toLong() && wall < prepared.original.expiresMs)
            check(System.nanoTime() - started in 0 until budgetNanos)
        }
        private fun requireCurrent() = synchronized(gate) {
            check(accountChannelBorrow === this && !closed && !stopped && epoch == capturedEpoch)
            check(challengeOriginal === original && enrollmentPrepared === prepared && !challengeCancelAttempted && !enrollmentFinalizeAttempted)
            check(prepared.original === enrollmentOriginal && intent == Intent.A && accountObserved && cookiePair != null)
            original.requestForOriginal()
            val thread = Thread.currentThread()
            if (nativeThread == null) nativeThread = thread else check(nativeThread === thread)
            // Reading the original may block on its owner. Check both deadlines
            // after that read before publishing any credential or transport loan.
            val wall = System.currentTimeMillis()
            check(wall >= prepared.original.value("issuedAtMs").toLong() && wall < prepared.original.expiresMs)
            check(System.nanoTime() - started in 0 until budgetNanos)
        }
        // Called only by the private native receiver after actual LOCAL/loan
        // checks. Never exposed as a JS getter. Profile admission is separate.
        private fun cookieForNative(): ByteArray = synchronized(gate) {
            requireCurrent()
            val cookie = checkNotNull(cookiePair)
            check(cookie.length in 1..8192 && cookie.all { it.code in 0x20..0x7e })
            cookie.toByteArray(Charsets.US_ASCII)
        }
        private fun revisionForNative(): Long { requireCurrent(); return prepared.revision }
        private fun issuerForNative(): ByteArray { requireCurrent(); return prepared.issuerMessageCopy() }
        private fun targetForNative(): ByteArray { requireCurrent(); return prepared.targetMessageCopy() }
        private fun bodyForNative(): ByteArray { requireCurrent(); return prepared.original.requestBody() }
        override fun toString() = "NativeAccountChannelBorrow[private unadmitted]"
    }
    internal fun borrowAccountChannel(original: VeilCryptoEngineOwner.FirstDeviceIntent,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared): AccountChannelBorrow = synchronized(gate) {
        check(profile == VeilSocialLoginProfile.M1_QA)
        check(!closed && !stopped && !busy && intent == Intent.A && accountObserved)
        check(challengeOriginal === original && enrollmentPrepared === prepared && !challengeCancelAttempted && !enrollmentFinalizeAttempted)
        original.requestForOriginal()
        accountChannelBorrow?.let { return@synchronized it }
        val started = System.nanoTime()
        val now = System.currentTimeMillis()
        check(now >= prepared.original.value("issuedAtMs").toLong() && now < prepared.original.expiresMs)
        val remaining = minOf(30000L, prepared.original.expiresMs - now)
        AccountChannelBorrow(original, prepared, epoch, started, remaining * 1000000L).also { accountChannelBorrow = it }
    }
    private val gate = Any()
    private var active: Call? = null
    private var busy = false
    private var closed = false
    private var stopped = false
    private var epoch = 0L
    private var startAttempted = false
    private var originalKey: String? = null
    private var originalPersistenceFailure: Throwable? = null
    private var intent: Intent? = null
    private var cookiePair: String? = null
    private var browser: BrowserHandoff? = null
    private var authorizeURL: String? = null
    private var state: String? = null
    private var originalCallback: String? = null
    private var accountObserved = false
    private var originalAccount: Pair<String, Long>? = null // snapshot association, NOT a remote lease
    private var challengeOriginal: VeilCryptoEngineOwner.FirstDeviceIntent? = null
    private var challengeRequest: VeilFirstDeviceChallengeWire.Request? = null
    private var challenge: VeilFirstDeviceChallengeWire.Challenge? = null
    private var challengeIssueAttempted = false
    private var challengeCancelAttempted = false
    private var challengeState = "CHALLENGE_REQUIRED"
    private var enrollmentOriginal: VeilFirstDeviceEnrollmentWire.Original? = null
    private var enrollmentPrepared: VeilFirstDeviceEnrollmentWire.Prepared? = null
    private var enrollmentRecords: Outcome.EnrollmentRecords? = null
    private var enrollmentPrepareAttempted = false
    private var enrollmentFinalizeAttempted = false
    private var storageRegistrationAttempted = false
    private var storageRegistration: Outcome.StorageRegistered? = null
    private var storageRegistrationObserved: Outcome.StorageRegistered? = null // opaque DATA retained even on late close failure
    private var sourceSelectionAttempted = false
    private var sourceCurrentAttempted = false
    private var sourceCurrentSucceeded = false
    private var sourceRefreshAttempted = false
    private var sourceRefreshSucceeded = false
    private var runtimeCoreFetchAttempted = false
    private var runtimeCoreOriginalsObserved: Outcome.RuntimeCoreOriginals? = null
    private var sourceCurrentOriginalBody: ByteArray? = null
    private var selectedSource: VeilFirstDeviceSourceWire.Selection? = null
    init {
        originalJournal?.read()?.let { original ->
            originalKey = original.key; intent = original.intent; startAttempted = true
            cookiePair = original.cookie; stopped = original.cancelled
        }
    }
    internal fun retainedIntent(): Intent? = synchronized(gate) { intent }
    internal fun retainedCancelled(): Boolean = synchronized(gate) { stopped }
    internal fun hasOriginalKey(): Boolean = synchronized(gate) { originalKey != null }
    internal fun originalScope(): String = if (originalJournal == null) "PROCESS" else "NATIVE_STORAGE"
    internal fun recoverOriginalStart(): Outcome = transact("original")
    private fun preservePersistenceFailure(failure: Throwable): Nothing {
        if (originalPersistenceFailure == null) originalPersistenceFailure = failure
        throw Refusal(Failure.PERSISTENCE_REFUSED)
    }
    internal fun selectFirstDeviceSource(original: VeilCryptoEngineOwner.FirstDeviceIntent,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared): Outcome =
        transact("first-device-source-selection", firstDeviceOriginal = original, prepared = prepared)
    internal fun registerFirstDeviceStorage(original: VeilCryptoEngineOwner.FirstDeviceIntent,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared, nonce: ByteArray,
        association: VeilFirstDeviceStorageWire.Association): Outcome =
        transact("first-device-storage-register", firstDeviceOriginal = original, prepared = prepared,
            proofBody = association.body(prepared, nonce))

    internal fun fetchFirstDeviceSource(original: VeilCryptoEngineOwner.FirstDeviceIntent,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared, nonce: ByteArray): Outcome =
        transact("first-device-source-current", firstDeviceOriginal = original, prepared = prepared,
            proofBody = VeilFirstDeviceSourceWire.currentBody(prepared, nonce))

    internal fun fetchRuntimeCoreOriginals(original: VeilCryptoEngineOwner.FirstDeviceIntent,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared, nonce: ByteArray): Outcome =
        transact("first-device-runtime-core", firstDeviceOriginal = original, prepared = prepared,
            proofBody = VeilFirstDeviceSourceWire.currentBody(prepared, nonce))

    internal fun issueFirstDevice(original: VeilCryptoEngineOwner.FirstDeviceIntent): Outcome =
        transact("first-device-challenge", firstDeviceOriginal = original)

    internal fun prepareFirstDevice(original: VeilCryptoEngineOwner.FirstDeviceIntent): Outcome =
        transact("first-device-prepare", firstDeviceOriginal = original)

    internal fun observeFirstDevice(original: VeilCryptoEngineOwner.FirstDeviceIntent): Outcome =
        transact("first-device-observe", firstDeviceOriginal = original)

    // Transport of a genuine future native producer's public results only. No signing
    // API or permission is minted here; the server independently verifies both roles.
    internal fun finalizeFirstDevice(original: VeilCryptoEngineOwner.FirstDeviceIntent,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared, issuerClassic: ByteArray, issuerPQ: ByteArray,
        targetClassic: ByteArray, targetPQ: ByteArray): Outcome =
        transact("first-device-finalize", firstDeviceOriginal = original, prepared = prepared,
            proofBody = VeilFirstDeviceEnrollmentWire.finalizeBody(prepared, issuerClassic, issuerPQ, targetClassic, targetPQ))

    internal fun retainedPreparation(original: VeilCryptoEngineOwner.FirstDeviceIntent): VeilFirstDeviceEnrollmentWire.Prepared? = synchronized(gate) {
        if (closed || stopped || busy || challengeOriginal !== original || challengeCancelAttempted || enrollmentFinalizeAttempted ||
            challengeState != "NATIVE_PROOF_AUTHORIZATION_REQUIRED" ||
            System.currentTimeMillis() >= (enrollmentOriginal?.expiresMs ?: 0L)) return@synchronized null
        original.requestForOriginal()
        enrollmentPrepared
    }
    internal fun cancelFirstDevice(original: VeilCryptoEngineOwner.FirstDeviceIntent): Outcome =
        transact("first-device-cancel", firstDeviceOriginal = original)

    // Local publication freshness only, never a remote lease or authority.
    // Coordinator calls the check while holding its own final publication gate.
    internal fun challengePublicationEpoch(): Long = synchronized(gate) { epoch }
    internal fun challengePublicationCurrent(original: VeilCryptoEngineOwner.FirstDeviceIntent, expectedEpoch: Long): Boolean =
        synchronized(gate) { !closed && !stopped && epoch == expectedEpoch && challengeOriginal === original }

    fun start(selected: Intent): Outcome = transact("start", selected = selected)
    fun resume(): Outcome = transact("resume")
    fun status(): Outcome = transact("status")
    fun redeem(): Outcome = transact("redeem")
    fun observeAccount(): Outcome = transact("account")
    fun bindCallback(handoff: BrowserHandoff, absoluteCallback: String): Outcome =
        transact("callback", callback = absoluteCallback, handoff = handoff)

    /** Invalidates local delivery before cancellation. No remote revoke claim. */
    fun cancelLocal() {
        val call = synchronized(gate) { stopped = true; epoch++; enrollmentRecords?.eraseCourierRecord(); active }
        try {
            originalKey?.let { key -> originalJournal?.cancel(key, checkNotNull(intent)) }
        } finally { call?.cancel() }
    }
    /** Retry this exact operation after a BUSY/uncertain result; never new start. */
    fun cancelRemote(): Outcome { cancelLocal(); return transact("cancel") }
    override fun close() {
        val call = synchronized(gate) {
            closed = true; stopped = true; epoch++
            if (!busy) erase()
            active
        }
        call?.cancel()
    }
    override fun toString() = "VeilSocialLoginClient[private attempt]"
    private fun erase() { enrollmentRecords?.eraseCourierRecord(); cookiePair = null; browser = null; authorizeURL = null; state = null; originalCallback = null }
    private fun launch(handoff: BrowserHandoff, url: String, launch: (String) -> Unit): Boolean {
        synchronized(gate) { if (closed || stopped || browser !== handoff || authorizeURL != url) return false }
        // Callback is outside the gate. A concurrent cancel still fences bind.
        launch(url)
        return true
    }
    private class Refusal(val reason: Failure) : Exception()
    private fun refuse(reason: Failure): Nothing = throw Refusal(reason)

    private fun transact(operation: String, selected: Intent? = null, callback: String? = null, handoff: BrowserHandoff? = null,
        firstDeviceOriginal: VeilCryptoEngineOwner.FirstDeviceIntent? = null,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared? = null, proofBody: ByteArray? = null): Outcome {
        var code = 0
        var submitted = false
        val ticket: Long
        val request: Request
        synchronized(gate) {
            if (closed) return Outcome.Refused(Failure.CLOSED)
            if (busy) return Outcome.Refused(Failure.BUSY)
            if (stopped && operation != "cancel" && operation != "status" && operation != "first-device-cancel") return Outcome.Refused(Failure.CANCELLED)
            try {
                if (operation == "start") {
                    if (startAttempted) return Outcome.Refused(Failure.ORIGINAL_START_UNKNOWN, remoteOutcomeUnknown = true)
                    require(selected != null)
                } else if (operation == "original") {
                    if (originalKey == null) return Outcome.Refused(Failure.ASSOCIATION_REQUIRED, remoteOutcomeUnknown = startAttempted)
                } else if (cookiePair == null) return Outcome.Refused(Failure.ASSOCIATION_REQUIRED, remoteOutcomeUnknown = startAttempted)
                var firstDeviceBody: ByteArray? = null
                if (operation.startsWith("first-device-")) {
                    if (intent != Intent.A || !accountObserved || firstDeviceOriginal == null)
                        return Outcome.Refused(Failure.ASSOCIATION_REQUIRED)
                    if (challengeOriginal != null && challengeOriginal !== firstDeviceOriginal)
                        return Outcome.Refused(Failure.ASSOCIATION_REQUIRED)
                    if (operation == "first-device-challenge") {
                        if (challengeIssueAttempted) return Outcome.ChallengeState(challengeState)
                        val originalRequest = firstDeviceOriginal.requestForOriginal()
                        firstDeviceBody = originalRequest.body()
                        challengeOriginal = firstDeviceOriginal; challengeRequest = originalRequest
                        challengeIssueAttempted = true; challengeState = "CHALLENGE_UNKNOWN_RETAINED"
                    } else if (operation == "first-device-cancel") {
                        if (challengeOriginal !== firstDeviceOriginal || challenge == null)
                            return Outcome.ChallengeState("CHALLENGE_UNKNOWN_RETAINED")
                        if (challengeCancelAttempted) return Outcome.ChallengeState(challengeState)
                        firstDeviceBody = challenge!!.cancelBody()
                        challengeCancelAttempted = true; challengeState = "CHALLENGE_CANCEL_UNKNOWN_RETAINED"
                    } else {
                        if (challengeOriginal !== firstDeviceOriginal || challenge == null || challengeCancelAttempted)
                            return Outcome.ChallengeState(challengeState)
                        firstDeviceOriginal.requestForOriginal() // same live owner/input, never reconstructed from DTO
                        val retained = enrollmentOriginal ?: VeilFirstDeviceEnrollmentWire.Original.retained(
                            checkNotNull(challengeRequest), checkNotNull(challenge)).also { enrollmentOriginal = it }
                        if (operation != "first-device-observe" && System.currentTimeMillis() >= retained.expiresMs)
                            return Outcome.ChallengeState("ENROLLMENT_EXPIRED_RETAINED")
                        when (operation) {
                            "first-device-prepare" -> {
                                if (enrollmentPrepareAttempted) return Outcome.ChallengeState(challengeState)
                                enrollmentPrepareAttempted = true
                                firstDeviceBody = retained.requestBody()
                            }
                            "first-device-observe" -> firstDeviceBody = retained.requestBody()
                            "first-device-storage-register" -> {
                                require(prepared != null && prepared === enrollmentPrepared && prepared.original === retained)
                                require(!enrollmentFinalizeAttempted && sourceSelectionAttempted && selectedSource != null && !sourceCurrentAttempted)
                                if (storageRegistrationAttempted) return Outcome.ChallengeState("STORAGE_REGISTRATION_UNKNOWN_RETAINED")
                                require(proofBody != null)
                                storageRegistrationAttempted = true // sticky before IO; no automatic replay
                                firstDeviceBody = proofBody
                            }
                            "first-device-source-selection", "first-device-source-current" -> {
                                require(prepared != null && prepared === enrollmentPrepared && prepared.original === retained)
                                require(!enrollmentFinalizeAttempted)
                                if (operation == "first-device-source-selection") {
                                    require(!sourceSelectionAttempted)
                                    sourceSelectionAttempted = true
                                    firstDeviceBody = retained.requestBody()
                                } else {
                                    require(sourceSelectionAttempted && selectedSource != null && storageRegistration != null && proofBody != null)
                                    if (sourceCurrentAttempted) {
                                        require(sourceCurrentSucceeded && !sourceRefreshAttempted)
                                        checkNotNull(accountChannelBorrow).requireSourceRefresh()
                                        require(sourceCurrentOriginalBody?.contentEquals(proofBody) == true)
                                        sourceRefreshAttempted = true // sticky before IO, including UNKNOWN
                                    } else {
                                        sourceCurrentAttempted = true
                                        sourceCurrentOriginalBody = proofBody.copyOf()
                                    }
                                    firstDeviceBody = proofBody
                                }
                            }
                            "first-device-runtime-core" -> {
                                require(profile == VeilSocialLoginProfile.M1_QA)
                                require(prepared != null && prepared === enrollmentPrepared && prepared.original === retained)
                                require(!enrollmentFinalizeAttempted && sourceRefreshSucceeded && !challengeCancelAttempted)
                                checkNotNull(accountChannelBorrow).requireSourceRefresh()
                                require(proofBody != null && sourceCurrentOriginalBody?.contentEquals(proofBody) == true)
                                if (runtimeCoreFetchAttempted) return Outcome.ChallengeState("CORE_STARTUP_UNKNOWN_RETAINED")
                                runtimeCoreFetchAttempted = true // before dispatch; never replay an unknown request
                                firstDeviceBody = proofBody
                            }
                            "first-device-finalize" -> {
                                if (enrollmentFinalizeAttempted) return Outcome.ChallengeState(challengeState)
                                require(challengeState == "NATIVE_PROOF_AUTHORIZATION_REQUIRED")
                                require(prepared != null && prepared === enrollmentPrepared && prepared.original === retained && proofBody != null)
                                enrollmentFinalizeAttempted = true
                                firstDeviceBody = proofBody
                            }
                            else -> refuse(Failure.ASSOCIATION_REQUIRED)
                        }
                        challengeState = "ENROLLMENT_UNKNOWN_RETAINED"
                    }
                }
                val target = if (operation == "callback") {
                    if (handoff == null || browser !== handoff || callback == null) refuse(Failure.CALLBACK_REFUSED)
                    validateCallback(callback)
                    if (profile != VeilSocialLoginProfile.M1_QA) callback else {
                        // Validate the signed callback above BEFORE routing its
                        // exact path/query to this same private API session.
                        // The service reconstructs the original signed URI.
                        val bound = callback.toHttpUrlOrNull() ?: refuse(Failure.CALLBACK_REFUSED)
                        val api = profile.apiOrigin.toHttpUrlOrNull() ?: refuse(Failure.CALLBACK_REFUSED)
                        api.newBuilder().encodedPath(bound.encodedPath).encodedQuery(bound.encodedQuery).build().toString()
                    }
                } else when (operation) {
                    "first-device-challenge" -> "${profile.apiOrigin}${profile.apiMount}/v4/first-device/challenge"
                    "first-device-cancel" -> "${profile.apiOrigin}${profile.apiMount}/v4/first-device/challenge/cancel"
                    "first-device-prepare" -> "${profile.apiOrigin}${profile.apiMount}/v4/first-device/prepare"
                    "first-device-observe" -> "${profile.apiOrigin}${profile.apiMount}/v4/first-device/observe"
                    "first-device-finalize" -> "${profile.apiOrigin}${profile.apiMount}/v4/first-device/finalize"
                    "first-device-source-selection" -> "${profile.apiOrigin}${profile.apiMount}/v4/first-device/source-selection"
                    "first-device-storage-register" -> "${profile.apiOrigin}${profile.apiMount}/v4/first-device/storage-register"
                    "first-device-source-current" -> "${profile.apiOrigin}${profile.apiMount}/v4/first-device/source-current"
                    "first-device-runtime-core" -> "${profile.apiOrigin}${profile.apiMount}/v4/first-device/native-core/startup"
                    else -> "${profile.apiOrigin}${profile.apiMount}/v4/login/$operation"
                }
                val builder = Request.Builder().url(target)
                    .header("Origin", ORIGIN).header("Cache-Control", "no-store, no-cache")
                    .header("Pragma", "no-cache").header("Accept", if (operation == "first-device-runtime-core") RUNTIME_CORE_MIME else "application/json")
                    .header("Accept-Encoding", "identity")
                cookiePair?.let { builder.header("Cookie", it) }
                if (operation == "status" || operation == "callback" || operation == "original") builder.get()
                else if (firstDeviceBody != null) builder.post(firstDeviceBody.toRequestBody(JSON)) // bytes: NO charset parameter
                else builder.post((if (operation == "start") "{\"intent\":\"$selected\"}" else "").toRequestBody(JSON))
                if (operation == "start") {
                    // Refuse duplicate before any mutation. The uncertainty fence is
                    // selected before persistence; no IO occurs on a failed commit.
                    startAttempted = true; intent = selected
                    originalJournal?.let { journal ->
                        val original = try { journal.begin(checkNotNull(selected)) }
                            catch (failure: Throwable) { preservePersistenceFailure(failure) }
                        check(original.intent == selected && original.cookie == null && !original.cancelled)
                        originalKey = original.key
                    }
                }
                if (operation == "start" || operation == "original") originalKey?.let {
                    builder.header("X-YNX-Social-Login-Original", it)
                }
                request = builder.build()
                busy = true; ticket = epoch
            } catch (failure: Refusal) {
                return Outcome.Refused(failure.reason, remoteOutcomeUnknown = operation != "first-device-finalize" && startAttempted)
            } catch (_: Exception) {
                return Outcome.Refused(Failure.CALLBACK_REFUSED, remoteOutcomeUnknown = operation != "first-device-finalize" && startAttempted)
            }
        }
        try {
            val call = factory.newCall(request)
            synchronized(gate) {
                active = call
                if (closed || epoch != ticket) refuse(Failure.CANCELLED)
            }
            call.timeout().timeout(15, TimeUnit.SECONDS)
            submitted = true
            val result = call.execute().use { response ->
                code = response.code
                synchronized(gate) {
                    // Retain initial custody even on HTTP errors. Never publish
                    // a late success or silently overwrite another association.
                    val headers = response.headers.values("Set-Cookie")
                    if (headers.isNotEmpty()) {
                        val parsed = parseCookies(headers, profile)
                        if (operation !in setOf("start", "original") || cookiePair != null && cookiePair != parsed) refuse(Failure.INVALID_RESPONSE)
                        originalKey?.let { key ->
                            try { originalJournal?.retainCookie(key, checkNotNull(intent), parsed) }
                            catch (failure: Throwable) { preservePersistenceFailure(failure) }
                        }
                        cookiePair = parsed
                    }
                    if (closed || epoch != ticket) refuse(Failure.CANCELLED)
                }
                if (operation == "callback" && code == 303) {
                    if (response.headers.values("Location") != listOf("/#login")) refuse(Failure.REDIRECT_REFUSED)
                    Outcome.CallbackBound
                } else {
                    if (code in 300..399) refuse(Failure.REDIRECT_REFUSED)
                    if (code != 200) refuse(Failure.HTTP_REFUSED)
                    val mime = response.headers.values("Content-Type")
                    if (operation == "first-device-runtime-core") {
                        if (mime != listOf(RUNTIME_CORE_MIME)) refuse(Failure.INVALID_RESPONSE)
                    } else if (!jsonMime(mime)) refuse(Failure.INVALID_RESPONSE)
                    val encoding = response.headers.values("Content-Encoding")
                    if (encoding.size > 1 || encoding.any { !it.equals("identity", true) }) refuse(Failure.INVALID_RESPONSE)
                    val body = response.body ?: refuse(Failure.INVALID_RESPONSE)
                    val limit = if (operation == "first-device-runtime-core") RUNTIME_CORE_LIMIT
                        else if (operation == "first-device-storage-register") VeilFirstDeviceStorageWire.RESPONSE_LIMIT
                        else if (operation == "first-device-source-current") VeilFirstDeviceSourceWire.RESPONSE_LIMIT
                        else if (operation in setOf("first-device-prepare", "first-device-observe", "first-device-finalize"))
                        VeilFirstDeviceEnrollmentWire.RESPONSE_LIMIT else 8192
                    if (body.contentLength() > limit) refuse(Failure.INVALID_RESPONSE)
                    val buffer = ByteArray(limit + 1)
                    try {
                        body.byteStream().use { input ->
                            var used = 0; var empty = 0
                            while (used < buffer.size) {
                                val n = input.read(buffer, used, buffer.size - used)
                                if (n < 0) break
                                if (n == 0) { if (++empty > 8) refuse(Failure.INVALID_RESPONSE) }
                                else { used += n; empty = 0 }
                            }
                            if (used > limit) refuse(Failure.INVALID_RESPONSE)
                            if (operation == "first-device-runtime-core") {
                                if (used == 0) refuse(Failure.INVALID_RESPONSE)
                                synchronized(gate) {
                                    if (closed || epoch != ticket || stopped || challengeCancelAttempted) refuse(Failure.CANCELLED)
                                    check(prepared === enrollmentPrepared && firstDeviceOriginal === challengeOriginal)
                                    Outcome.RuntimeCoreOriginals(checkNotNull(firstDeviceOriginal), checkNotNull(prepared),
                                        buffer.copyOf(used)).also { runtimeCoreOriginalsObserved = it }
                                }
                            } else {
                            val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(buffer, 0, used)).toString()
                            if (operation == "first-device-challenge" || operation == "first-device-cancel") {
                                synchronized(gate) {
                                    if (closed || epoch != ticket) refuse(Failure.CANCELLED)
                                    if (operation == "first-device-challenge") {
                                        challenge = VeilFirstDeviceChallengeWire.Challenge.decode(text, checkNotNull(challengeRequest))
                                        challengeState = "CHALLENGE_ISSUED_UNVERIFIED"
                                    } else {
                                        VeilFirstDeviceChallengeWire.decodeCancel(text)
                                        challengeState = "CHALLENGE_CANCELED"
                                    }
                                    Outcome.ChallengeState(challengeState)
                                }
                            } else if (operation == "first-device-storage-register") {
                                synchronized(gate) {
                                    if (closed || epoch != ticket || challengeCancelAttempted) refuse(Failure.CANCELLED)
                                    require(prepared === enrollmentPrepared)
                                    val parsed = VeilFirstDeviceStorageWire.Registered.decode(text, checkNotNull(prepared))
                                    Outcome.StorageRegistered(parsed).also { storageRegistrationObserved = it }
                                }
                            } else if (operation == "first-device-source-selection" || operation == "first-device-source-current") {
                                synchronized(gate) {
                                    if (closed || epoch != ticket || challengeCancelAttempted) refuse(Failure.CANCELLED)
                                    require(prepared === enrollmentPrepared)
                                    if (operation == "first-device-source-selection") {
                                        val selection = VeilFirstDeviceSourceWire.Selection.decode(text)
                                        selectedSource = selection
                                        Outcome.SourceSelection(selection)
                                    } else {
                                        val evidence = VeilFirstDeviceSourceWire.evidence(text, checkNotNull(prepared))
                                        sourceCurrentSucceeded = true
                                        Outcome.SourceEvidence(evidence)
                                    }
                                }
                            } else if (operation in setOf("first-device-prepare", "first-device-observe", "first-device-finalize")) {
                                synchronized(gate) {
                                    if (closed || epoch != ticket) refuse(Failure.CANCELLED)
                                    val retained = checkNotNull(enrollmentOriginal)
                                    if (operation == "first-device-prepare") {
                                        val parsed = VeilFirstDeviceEnrollmentWire.Prepared.decode(text, retained)
                                        require(enrollmentPrepared == null || enrollmentPrepared!!.sameRevision(parsed))
                                        if (enrollmentPrepared == null) enrollmentPrepared = parsed
                                        challengeState = "NATIVE_PROOF_AUTHORIZATION_REQUIRED"
                                    } else {
                                        val observed = VeilFirstDeviceEnrollmentWire.observation(text, retained, enrollmentPrepared)
                                        try { observed.originalRecordsCopy()?.let { records ->
                                            try {
                                                val bound = checkNotNull(enrollmentPrepared)
                                                val originalIntent = checkNotNull(firstDeviceOriginal)
                                                val previous = enrollmentRecords
                                                if (previous == null) {
                                                    enrollmentRecords = Outcome.EnrollmentRecords(originalIntent, bound, records.copyOf())
                                                } else check(previous.original === originalIntent && previous.prepared === bound &&
                                                    previous.sameOriginal(records)) { "ENROLLMENT_ORIGINAL_RECORDS_CHANGED" }
                                                observed.courierRecordCopy()?.let { courier ->
                                                    try { checkNotNull(enrollmentRecords).retainCourierRecord(courier) }
                                                    finally { courier.fill(0) }
                                                }
                                            } finally { records.fill(0) }
                                        } } finally { observed.eraseCourierRecord() }
                                        if (observed.state == "prepared" && enrollmentPrepared == null)
                                            enrollmentPrepared = VeilFirstDeviceEnrollmentWire.Prepared.decode(text, retained)
                                        challengeState = when (observed.state) {
                                            "prepared" -> "NATIVE_PROOF_AUTHORIZATION_REQUIRED"
                                            "committed" -> "ENROLLMENT_COMMITTED_UNVERIFIED"
                                            "canceled" -> "CHALLENGE_CANCELED"
                                            else -> error("INVALID_ENROLLMENT_STATE")
                                        }
                                    }
                                    if (challengeState == "ENROLLMENT_COMMITTED_UNVERIFIED" && enrollmentRecords != null)
                                        checkNotNull(enrollmentRecords)
                                    else Outcome.ChallengeState(challengeState)
                                }
                            } else decode(operation, flatJSON(text))
                            }
                        }
                    } finally { buffer.fill(0) }
                }
            } // actual response/reader close precedes successful publication
            synchronized(gate) {
                if (closed || epoch != ticket) refuse(Failure.CANCELLED)
                if (result is Outcome.SourceSelection || result is Outcome.SourceEvidence || result is Outcome.StorageRegistered || result is Outcome.RuntimeCoreOriginals) {
                    // Parsing alone is not definitive success. Both reader and
                    // response have closed; retain the original UNKNOWN phase
                    // unless the same live request still owns publication.
                    if (stopped || challengeCancelAttempted || enrollmentFinalizeAttempted ||
                        firstDeviceOriginal == null || challengeOriginal !== firstDeviceOriginal ||
                        prepared == null || prepared !== enrollmentPrepared ||
                        prepared.original !== enrollmentOriginal) refuse(Failure.ASSOCIATION_REQUIRED)
                    firstDeviceOriginal.requestForOriginal()
                    val now = System.currentTimeMillis()
                    if (now < prepared.original.value("issuedAtMs").toLong() || now >= prepared.original.expiresMs)
                        refuse(Failure.ASSOCIATION_REQUIRED)
                    if (operation == "first-device-source-current" && sourceRefreshAttempted)
                        checkNotNull(accountChannelBorrow).requireSourceRefresh()
                    if (result is Outcome.StorageRegistered) storageRegistration = result
                    if (result is Outcome.SourceEvidence && sourceRefreshAttempted) sourceRefreshSucceeded = true
                    if (result is Outcome.RuntimeCoreOriginals) {
                        if (result !== runtimeCoreOriginalsObserved || result.original !== firstDeviceOriginal ||
                            result.prepared !== prepared) refuse(Failure.ASSOCIATION_REQUIRED)
                        checkNotNull(accountChannelBorrow).requireSourceRefresh()
                    }
                    // Only the pending-proof phase, never source/device approval.
                    challengeState = "NATIVE_PROOF_AUTHORIZATION_REQUIRED"
                }
                if (result is Outcome.EnrollmentRecords) {
                    // Both reader and response have closed. Cancellation or a
                    // replaced original cannot publish records to the native owner.
                    if (stopped || challengeCancelAttempted || result !== enrollmentRecords ||
                        firstDeviceOriginal !== result.original || challengeOriginal !== result.original ||
                        enrollmentPrepared !== result.prepared || enrollmentOriginal !== result.prepared.original)
                        refuse(Failure.ASSOCIATION_REQUIRED)
                    result.original.requestForOriginal()
                    val now = System.currentTimeMillis()
                    if (now < result.prepared.original.value("issuedAtMs").toLong() ||
                        now >= result.prepared.original.expiresMs) refuse(Failure.ASSOCIATION_REQUIRED)
                }
                if (result is Outcome.Authorization) browser = result.browser
                if (operation == "first-device-cancel" && result is Outcome.ChallengeState && result.status == "CHALLENGE_CANCELED")
                    checkNotNull(challengeOriginal).acknowledgeCancellation()
                return result
            }
        } catch (e: Exception) {
            synchronized(gate) {
                if (operation == "first-device-runtime-core") challengeState = "CORE_STARTUP_UNKNOWN_RETAINED"
                if (operation == "first-device-storage-register") challengeState = "STORAGE_REGISTRATION_UNKNOWN_RETAINED"
                if (operation == "first-device-challenge") challengeState = "CHALLENGE_UNKNOWN_RETAINED"
                if (operation == "first-device-cancel") challengeState = "CHALLENGE_CANCEL_UNKNOWN_RETAINED"
                if (operation in setOf("first-device-prepare", "first-device-observe", "first-device-finalize")) challengeState = "ENROLLMENT_UNKNOWN_RETAINED"
            }
            val reason = when (e) {
                is Refusal -> e.reason
                is SSLException -> Failure.TLS_FAILED
                is InterruptedIOException -> Failure.TIMEOUT
                else -> Failure.NO_RESPONSE
            }
            return Outcome.Refused(reason, code, submitted)
        } finally {
            synchronized(gate) { active = null; busy = false; if (closed) erase() }
        }
    }

    private fun decode(operation: String, values: Map<String, String>): Outcome = synchronized(gate) {
        when (operation) {
            "start", "resume", "original" -> {
                exact(values, setOf("authorizeUrl"))
                if (cookiePair == null) refuse(Failure.INVALID_RESPONSE)
                val raw = values.getValue("authorizeUrl")
                val url = raw.toHttpUrlOrNull() ?: refuse(Failure.INVALID_RESPONSE)
                if (raw.length > 2048 || !raw.startsWith("$ISSUER/v2/browser-sessions/authorize?") ||
                    url.host != "wallet-auth.ynxweb4.com" || url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null ||
                    url.queryParameterNames != setOf("clientId", "origin", "redirectUri", "state", "codeChallenge", "codeChallengeMethod") ||
                    url.queryParameterNames.any { url.queryParameterValues(it).size != 1 } ||
                    url.queryParameter("clientId") != profile.clientId || url.queryParameter("origin") != ORIGIN ||
                    url.queryParameter("redirectUri") != CALLBACK || url.queryParameter("codeChallengeMethod") != "S256" ||
                    !token(url.queryParameter("state")) || !token(url.queryParameter("codeChallenge"))) refuse(Failure.INVALID_RESPONSE)
                if (authorizeURL != null && authorizeURL != raw) refuse(Failure.INVALID_RESPONSE)
                authorizeURL = raw; state = url.queryParameter("state")
                Outcome.Authorization(browser ?: BrowserHandoff(this, raw))
            }
            "account" -> {
                exact(values, setOf("status", "subject", "generation", "deviceAuthorization"))
                val subject = values.getValue("subject")
                val generation = values.getValue("generation").toLongOrNull()
                if (values["status"] != "ACCOUNT_OBSERVED" || values["deviceAuthorization"] != "REQUIRED" ||
                    subject.isBlank() || subject.length > 1024 || subject.any { it < ' ' || it == '\u007f' } ||
                    generation == null || generation < 0 || generation > 9007199254740991L) refuse(Failure.INVALID_RESPONSE)
                val observed = subject to generation
                if (originalAccount != null && originalAccount != observed) {
                    stopped = true; epoch++
                    refuse(Failure.ASSOCIATION_REQUIRED)
                }
                originalAccount = observed
                accountObserved = true
                Outcome.AccountObserved(subject, generation)
            }
            "cancel" -> {
                exact(values, setOf("status", "deviceAuthorization"))
                if (values["status"] != "LOGIN_LOCALLY_CANCELLED_REMOTE_STATUS_NOT_ASSERTED" || values["deviceAuthorization"] != "REQUIRED") refuse(Failure.INVALID_RESPONSE)
                Outcome.LocallyCancelledRemoteNotAsserted
            }
            else -> {
                exact(values, setOf("Intent", "Phase", "ExpiresAt"))
                val phase = values.getValue("Phase")
                val expires = values.getValue("ExpiresAt")
                if (values["Intent"] != intent?.name || phase !in PHASES || !timestamp(expires)) refuse(Failure.INVALID_RESPONSE)
                Outcome.State(intent ?: refuse(Failure.INVALID_RESPONSE), phase, expires)
            }
        }
    }

    private fun validateCallback(raw: String) {
        if (raw.length > 2048 || !raw.startsWith("$CALLBACK?") || '#' in raw || '\\' in raw) refuse(Failure.CALLBACK_REFUSED)
        val url = raw.toHttpUrlOrNull() ?: refuse(Failure.CALLBACK_REFUSED)
        val keys = url.queryParameterNames
        if (keys != setOf("state", "code") && keys != setOf("state", "error")) refuse(Failure.CALLBACK_REFUSED)
        if (keys.any { url.queryParameterValues(it).size != 1 } || url.queryParameter("state") != state) refuse(Failure.CALLBACK_REFUSED)
        val value = url.queryParameter("code")
        if (value != null && !token(value) || value == null && url.queryParameter("error") !in setOf("access_denied", "login_required")) refuse(Failure.CALLBACK_REFUSED)
        val canonical = listOf(url.queryParameter("state"), value, url.queryParameter("error")).joinToString("|")
        if (originalCallback != null && originalCallback != canonical) refuse(Failure.CALLBACK_REFUSED)
        originalCallback = canonical // original retained even on uncertain send
    }

    companion object {
        private const val ORIGIN = "https://social.ynxweb4.com"
        private const val ISSUER = "https://wallet-auth.ynxweb4.com"

        private val JSON = "application/json".toMediaType()
        private val PHASES = setOf("AWAIT_CALLBACK", "CODE_BOUND", "CALLBACK_DENIED", "REDEMPTION_PENDING_OR_UNKNOWN", "FAMILY_RESPONSE_CAPTURED_UNVERIFIED", "CANCELLED")
        private fun fixedClient(profile: VeilSocialLoginProfile = VeilSocialLoginProfile.PRODUCTION) =
            VeilSocialQaLoopbackTls.configure(OkHttpClient.Builder().dns(profile.transportDns()), profile)
            .cookieJar(CookieJar.NO_COOKIES).cache(null)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .callTimeout(15, TimeUnit.SECONDS).connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS).writeTimeout(15, TimeUnit.SECONDS).build()
        internal fun publicFixture(factory: Call.Factory, profile: VeilSocialLoginProfile = VeilSocialLoginProfile.PRODUCTION) = VeilSocialLoginClient(factory, profile)
        internal fun originalPublicFixture(factory: Call.Factory, profile: VeilSocialLoginProfile, journal: VeilLoginOriginalJournal) =
            VeilSocialLoginClient(factory, profile, journal)
        private fun token(v: String?) = v != null && Regex("[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]").matches(v)
        private fun exact(v: Map<String, String>, names: Set<String>) { if (v.keys != names) throw Refusal(Failure.INVALID_RESPONSE) }
        private fun parseCookies(headers: List<String>, profile: VeilSocialLoginProfile): String {
            if (headers.size != 2) throw Refusal(Failure.INVALID_RESPONSE)
            // Fixed native profile only. Never infer a namespace from response
            // names or accept another profile as a compatibility fallback.
            val idName = profile.cookieIdName
            val bindingName = profile.cookieBindingName
            val found = mutableMapOf<String, String>()
            for (header in headers) {
                if (header.length > 512) throw Refusal(Failure.INVALID_RESPONSE)
                val parts = header.split(';').map { it.trim(' ', '\t') }
                val pair = parts[0].split('=', limit = 2)
                if (pair.size != 2 || pair[0] !in setOf(idName, bindingName) || !token(pair[1]) || found.put(pair[0], pair[1]) != null) throw Refusal(Failure.INVALID_RESPONSE)
                val attrs = parts.drop(1).map { it.lowercase(Locale.ROOT) }
                if (attrs.size != 4 || attrs.toSet() != setOf("path=/", "secure", "httponly", "samesite=lax")) throw Refusal(Failure.INVALID_RESPONSE)
            }
            return "$idName=${found.getValue(idName)}; $bindingName=${found.getValue(bindingName)}"
        }
        internal const val RUNTIME_CORE_LIMIT = 1048576
        internal const val RUNTIME_CORE_MIME = "application/vnd.ynx.social.native-core-startup.v1+json"
        private fun jsonMime(values: List<String>) = values.size == 1 &&
            Regex("[ \\t]*application/json[ \\t]*(?:;[ \\t]*charset[ \\t]*=[ \\t]*(?:utf-8|\"utf-8\")[ \\t]*)?", RegexOption.IGNORE_CASE).matches(values[0])
        private fun timestamp(value: String): Boolean {
            val match = Regex("(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d{1,9}))?(Z|[+-]\\d{2}:\\d{2})").matchEntire(value) ?: return false
            val normalized = match.groupValues[1] + "." + match.groupValues[2].padEnd(3, '0').take(3) + match.groupValues[3]
            val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.ROOT)
            parser.isLenient = false
            val pos = ParsePosition(0)
            return parser.parse(normalized, pos) != null && pos.index == normalized.length
        }

        /** Bounded flat response grammar: only strings, except generation integer.
         * Duplicate decoded keys, escapes with unpaired surrogates, extra fields
         * and trailing input are refused. No JSONObject duplicate-key erasure. */
        private fun flatJSON(text: String): Map<String, String> {
            var at = 0
            fun bad(): Nothing = throw Refusal(Failure.INVALID_RESPONSE)
            fun ws() { while (at < text.length && text[at] in " \t\r\n") at++ }
            fun string(): String {
                if (at >= text.length || text[at++] != '"') bad()
                val out = StringBuilder()
                var ended = false
                while (at < text.length) {
                    val c = text[at++]
                    if (c == '"') { ended = true; break }
                    if (c < ' ') bad()
                    if (c != '\\') out.append(c) else {
                        if (at >= text.length) bad()
                        when (val escaped = text[at++]) {
                            '"', '\\', '/' -> out.append(escaped)
                            'b' -> out.append('\b'); 'f' -> out.append('\u000c'); 'n' -> out.append('\n'); 'r' -> out.append('\r'); 't' -> out.append('\t')
                            'u' -> {
                                if (at + 4 > text.length) bad()
                                val hex = text.substring(at, at + 4)
                                if (!hex.all { it in "0123456789abcdefABCDEF" }) bad()
                                out.append(hex.toInt(16).toChar()); at += 4
                            }
                            else -> bad()
                        }
                    }
                }
                if (!ended) bad()
                var i = 0
                while (i < out.length) {
                    val c = out[i++]
                    if (Character.isHighSurrogate(c)) { if (i >= out.length || !Character.isLowSurrogate(out[i++])) bad() }
                    else if (Character.isLowSurrogate(c)) bad()
                }
                return out.toString()
            }
            ws(); if (at >= text.length || text[at++] != '{') bad()
            val values = linkedMapOf<String, String>()
            while (true) {
                ws(); val key = string(); ws()
                if (at >= text.length || text[at++] != ':' || key in values) bad()
                ws()
                val value = if (key == "generation") {
                    val from = at
                    while (at < text.length && text[at] in '0'..'9') at++
                    val digits = text.substring(from, at)
                    if (!Regex("0|[1-9][0-9]{0,15}").matches(digits)) bad()
                    digits
                } else string()
                values[key] = value; ws()
                if (at >= text.length) bad()
                when (text[at++]) { '}' -> break; ',' -> {}; else -> bad() }
                if (values.size > 4) bad()
            }
            ws(); if (at != text.length) bad()
            return values
        }
    }
}
