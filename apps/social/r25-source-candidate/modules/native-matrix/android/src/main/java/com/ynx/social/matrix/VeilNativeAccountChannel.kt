package com.ynx.social.matrix

import android.content.Context
import java.util.Base64

/** Native transport observations only. No status or signature array grants authority. */
internal object VeilNativeAccountChannel {
    const val INSTANCE_REQUIRED = 203
    const val FACTS_UNADMITTED = 204
    const val SIGNATURE_RAM_CLOSED = 44

    fun prepare(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int {
        // Validate before selecting. The native prepare consumes this one-shot
        // choice on the same worker, including failure; it is never authority.
        borrow.requireM1QaTransport()
        val selected = nativeSelectM1QaPeer()
        check(selected == 0) { "M1QA_NATIVE_TRANSPORT_SELECTION_$selected" }
        val code = nativePrepare(context, input, borrow)
        if (code == FACTS_UNADMITTED) borrow.retainNativeFactsUnadmitted()
        return code
    }

    fun observe(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared): ObservedSignatures? {
        val parts = nativeObserveSignatures(context, input, borrow) ?: return null
        return ObservedSignatures.decode(prepared, parts)
    }

    fun closeSignatures(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int = nativeCloseSignatures(context, input, borrow)

    /** Actual authenticated cold owner, never a reconstructed warm command. */
    fun prepare(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int {
        borrow.requireM1QaTransport()
        val code = original.withAuthenticatedBusiness { actualContext, lease ->
            check(actualContext === context && lease === original)
            nativePrepareCold(context, original, borrow)
        }
        if (code == FACTS_UNADMITTED) {
            original.retainOriginalAccountFactsUnadmitted(code)
            borrow.retainNativeFactsUnadmitted()
        }
        return code
    }

    fun observe(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow,
        prepared: VeilFirstDeviceEnrollmentWire.Prepared): ObservedSignatures? {
        val parts = original.withAuthenticatedBusiness { actualContext, lease ->
            check(actualContext === context && lease === original)
            nativeObserveColdSignatures(context, original, borrow)
        } ?: return null
        return ObservedSignatures.decode(prepared, parts)
    }

    fun closeSignatures(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int =
        original.withBusinessCleanup { actualContext, lease ->
            check(actualContext === context && lease === original)
            nativeCloseColdSignatures(context, original, borrow)
        }

    /** Runtime Core observations only. Zero is not device authority or chat readiness. */
    fun prepareRuntimeCore(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow, originals: ByteArray): Int {
        require(originals.size in 1..VeilSocialLoginClient.RUNTIME_CORE_LIMIT)
        borrow.requireM1QaTransport(); borrow.requireSourceRefresh()
        return nativePrepareRuntimeCore(context, input, borrow, originals)
    }
    fun prepareRuntimeCore(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow, originals: ByteArray): Int {
        require(originals.size in 1..VeilSocialLoginClient.RUNTIME_CORE_LIMIT)
        borrow.requireM1QaTransport(); borrow.requireSourceRefresh()
        return original.withAuthenticatedBusiness { actualContext, lease ->
            check(actualContext === context && lease === original)
            nativePrepareColdRuntimeCore(context, original, borrow, originals)
        }
    }
    fun runtimeCoreCurrent(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int {
        borrow.requireSourceRefresh()
        return nativeRuntimeCoreCurrent(context, input, borrow)
    }
    fun runtimeCoreCurrent(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int {
        borrow.requireSourceRefresh()
        return original.withAuthenticatedBusiness { actualContext, lease ->
            check(actualContext === context && lease === original)
            nativeColdRuntimeCoreCurrent(context, original, borrow)
        }
    }
    // Cleanup checks immutable Native identity, not an expired HTTP/signing gate.
    fun closeRuntimeCore(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int = nativeCloseRuntimeCore(context, input, borrow)
    fun closeRuntimeCore(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int =
        original.withBusinessCleanup { actualContext, lease ->
            check(actualContext === context && lease === original)
            nativeCloseColdRuntimeCore(context, original, borrow)
        }
    fun runtimeCoreStatus(code: Int): String = when (code) {
        0 -> "CORE_STARTUP_CURRENT_UNADMITTED"
        1 -> "CORE_STARTUP_RESOURCE_REQUIRED"
        2 -> "CORE_STARTUP_BOUNDARY_REFUSED"
        4 -> "CORE_STARTUP_THREAD_REFUSED"
        5 -> "CORE_STARTUP_WINDOW_REFUSED"
        6 -> "CORE_STARTUP_BUSY_RETAINED"
        7 -> "CORE_STARTUP_BINDING_REFUSED"
        else -> "CORE_STARTUP_UNKNOWN_RETAINED"
    }

    @JvmStatic private external fun nativePrepareRuntimeCore(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow, originals: ByteArray): Int
    @JvmStatic private external fun nativePrepareColdRuntimeCore(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow, originals: ByteArray): Int
    @JvmStatic private external fun nativeRuntimeCoreCurrent(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int
    @JvmStatic private external fun nativeColdRuntimeCoreCurrent(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int
    @JvmStatic private external fun nativeCloseRuntimeCore(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int
    @JvmStatic private external fun nativeCloseColdRuntimeCore(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int

    /** Owns only PUBLIC copies from one actual observation. Not a native capability. */
    internal class ObservedSignatures private constructor(
        private val prepared: VeilFirstDeviceEnrollmentWire.Prepared,
        private val parts: Array<ByteArray?>
    ) : AutoCloseable {
        private var consumed = false

        internal fun finalizeOriginal(client: VeilSocialLoginClient,
            original: VeilCryptoEngineOwner.FirstDeviceIntent,
            borrow: VeilSocialLoginClient.AccountChannelBorrow): VeilSocialLoginClient.Outcome {
            check(!consumed) { "FIRST_DEVICE_SIGNATURE_OBSERVATION_CONSUMED" }
            consumed = true
            try {
                check(client.retainedPreparation(original) === prepared)
                // Same original monotonic budget; this call never renews it or performs IO.
                borrow.requireSourceRefresh()
                return client.finalizeFirstDevice(original, prepared, checkNotNull(parts[0]),
                    checkNotNull(parts[1]), checkNotNull(parts[2]), checkNotNull(parts[3]))
            } finally { close() }
        }

        override fun close() {
            consumed = true
            for (i in parts.indices) { parts[i]?.fill(0); parts[i] = null }
        }

        override fun toString() = "FirstDeviceSignatures[public observation; unverified]"

        companion object {
            /** Internal bounded binding check; expected wires were strictly parsed by Prepared. */
            internal fun decode(prepared: VeilFirstDeviceEnrollmentWire.Prepared,
                parts: Array<ByteArray?>): ObservedSignatures {
                var accepted = false
                val issuer = prepared.issuerMessageCopy()
                val target = prepared.targetMessageCopy()
                try {
                    require(parts.size == 8)
                    val lengths = intArrayOf(64, 4627, 64, 4627, 32, 32)
                    for (i in lengths.indices) require(parts[i]?.size == lengths[i])
                    require(parts[6]?.size in 1..65536 && parts[7]?.size in 1..65536)
                    val base64 = Base64.getUrlEncoder().withoutPadding()
                    require("fd1-" + base64.encodeToString(parts[4]) == prepared.original.operation)
                    // This is the ACCOUNT challenge nonce, not the Source lookup nonce.
                    require(base64.encodeToString(parts[5]) == prepared.original.value("nonce"))
                    require(checkNotNull(parts[6]).contentEquals(issuer))
                    require(checkNotNull(parts[7]).contentEquals(target))
                    val now = System.currentTimeMillis()
                    require(now >= prepared.original.value("issuedAtMs").toLong() && now < prepared.original.expiresMs)
                    return ObservedSignatures(prepared, parts).also { accepted = true }
                } finally {
                    issuer.fill(0); target.fill(0)
                    if (!accepted) for (i in parts.indices) { parts[i]?.fill(0); parts[i] = null }
                }
            }
        }
    }

    @JvmStatic private external fun nativePrepareCold(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int
    @JvmStatic private external fun nativeObserveColdSignatures(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Array<ByteArray?>?
    @JvmStatic private external fun nativeCloseColdSignatures(context: Context, original: VeilOwnKeyColdRecoveryLease,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int

    @JvmStatic private external fun nativeSelectM1QaPeer(): Int
    @JvmStatic private external fun nativePrepare(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int
    @JvmStatic private external fun nativeObserveSignatures(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Array<ByteArray?>?
    @JvmStatic private external fun nativeCloseSignatures(context: Context, input: VeilLocalRecoveryInput,
        borrow: VeilSocialLoginClient.AccountChannelBorrow): Int
}
