package com.ynx.social.matrix

import android.app.Activity
import android.app.KeyguardManager
import android.os.SystemClock
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** System credential observation only, never a device grant or a Keystore bypass.
 * Main retains the request with the original durable local intent. It must recheck
 * that intent/account/lifecycle before consuming the result on its owner worker.
 * No receipt, timestamp, request code or success boolean is accepted from JS.
 */
internal class VeilLocalDeviceAuthentication {
    internal enum class Outcome { CONFIRMED, CANCELLED, SCREEN_LOCK_REQUIRED, UNAVAILABLE, INVALIDATED }
    internal class Request internal constructor(
        internal val owner: VeilLocalDeviceAuthentication,
        internal val activity: Activity,
        internal val requestCode: Int
    ) {
        internal val result = CompletableFuture<Outcome>()
        internal var confirmedAt: Long? = null
        internal var consumed = false
        // Observation timeout does not release the outstanding system request.
        fun await(timeoutMillis: Long): Outcome {
            require(timeoutMillis in 1..120_000)
            return result.get(timeoutMillis, TimeUnit.MILLISECONDS)
        }
    }

    private val gate = Any()
    private var active: Request? = null
    private var closed = false

    fun request(activity: Activity, title: String, description: String): Request {
        require(title.isNotBlank() && title.length <= 128 && description.length <= 512)
        val request = synchronized(gate) {
            check(!closed && active == null) { "VEIL_DEVICE_AUTH_ORIGINAL_REQUEST_RETAINED" }
            val code = nextCode.getAndIncrement()
            check(code in FIRST_CODE..LAST_CODE) { "VEIL_DEVICE_AUTH_REQUEST_CODES_EXHAUSTED" }
            Request(this, activity, code).also { active = it }
        }
        try {
            activity.runOnUiThread {
                synchronized(gate) {
                    if (closed || active !== request || request.result.isDone) return@runOnUiThread
                    if (activity.isFinishing || activity.isDestroyed) {
                        request.result.complete(Outcome.UNAVAILABLE)
                        return@runOnUiThread
                    }
                    try {
                        val keyguard = activity.getSystemService(KeyguardManager::class.java)
                        if (keyguard == null) {
                            request.result.complete(Outcome.UNAVAILABLE)
                            return@runOnUiThread
                        }
                        if (!keyguard.isDeviceSecure) {
                            request.result.complete(Outcome.SCREEN_LOCK_REQUIRED)
                            return@runOnUiThread
                        }
                        @Suppress("DEPRECATION")
                        val intent = keyguard.createConfirmDeviceCredentialIntent(title, description)
                        if (intent == null) {
                            request.result.complete(Outcome.UNAVAILABLE)
                            return@runOnUiThread
                        }
                        @Suppress("DEPRECATION")
                        activity.startActivityForResult(intent, request.requestCode)
                    } catch (_: Exception) {
                        request.result.complete(Outcome.UNAVAILABLE)
                    }
                }
            }
        } catch (_: Exception) {
            synchronized(gate) { request.result.complete(Outcome.UNAVAILABLE) }
        }
        return request
    }

    fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int) {
        synchronized(gate) {
            val request = active ?: return
            if (closed || request.activity !== activity || request.requestCode != requestCode || request.result.isDone) return
            if (resultCode == Activity.RESULT_OK) {
                request.confirmedAt = SystemClock.elapsedRealtime()
                request.result.complete(Outcome.CONFIRMED)
            } else request.result.complete(Outcome.CANCELLED)
        }
    }

    /** One-use, 30-second product authentication policy, not a crypto parameter.
     * The actual AndroidKeyStore still independently enforces authentication.
     */
    fun consume(request: Request): Boolean = synchronized(gate) {
        if (closed || active !== request || request.owner !== this || request.consumed ||
            !request.result.isDone || request.result.getNow(Outcome.UNAVAILABLE) != Outcome.CONFIRMED) return@synchronized false
        request.consumed = true
        if (request.activity.isFinishing || request.activity.isDestroyed) return@synchronized false
        val confirmedAt = request.confirmedAt ?: return@synchronized false
        val now = SystemClock.elapsedRealtime()
        now >= confirmedAt && now - confirmedAt < AUTH_WINDOW_MILLIS
    }

    // The original result is retained until its caller has observed it. A timed
    // out but still-live prompt cannot be replaced by a second prompt.
    fun releaseObserved(request: Request) = synchronized(gate) {
        check(request.owner === this && active === request && request.result.isDone) {
            "VEIL_DEVICE_AUTH_ORIGINAL_RESULT_REQUIRED"
        }
        request.consumed = true
        active = null
    }

    fun onActivityDestroyed() = synchronized(gate) {
        active?.let { it.consumed = true; it.result.complete(Outcome.INVALIDATED) }
    }

    fun invalidate() = synchronized(gate) {
        closed = true
        active?.let { it.consumed = true; it.result.complete(Outcome.INVALIDATED) }
        // Keep the original request; late system results cannot revive it.
    }

    private companion object {
        const val AUTH_WINDOW_MILLIS = 30_000L
        const val FIRST_CODE = 0x6a00
        const val LAST_CODE = 0x7aff
        val nextCode = AtomicInteger(FIRST_CODE)
    }
}
