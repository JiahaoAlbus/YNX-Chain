package com.ynx.social.matrix

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.verify.domain.DomainVerificationManager
import android.content.pm.verify.domain.DomainVerificationUserState
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.security.MessageDigest
import java.util.concurrent.CompletableFuture

internal interface VeilLoginBrowserAccess {
    fun diagnostic(): Map<String, Any> = VeilReturnLinkDiagnostic.notChecked()
    fun reserve(activity: Activity?, callback: (() -> Pair<VeilSocialLoginClient.BrowserHandoff, String>?) -> Unit): Boolean
    fun open(activity: Activity?, handoff: VeilSocialLoginClient.BrowserHandoff): Boolean
    fun retire()
}

/**
 * Native-only external browser port. Operator-installed package/cert pins are
 * required, not obtained from JS or inferred from the presented package itself.
 * API31+ verified-domain inspection only; older platforms fail closed.
 */
class VeilSocialLoginBrowserPort(
    context: Context,
    private val expectedPackageName: String,
    expectedSigningSha256: Set<String>
) : VeilLoginBrowserAccess {
    internal val loginProfile = VeilSocialLoginProfile.forPackage(expectedPackageName)
    private val CALLBACK: String get() = loginProfile.callback
    private val CALLBACK_CLASS: String get() = loginProfile.callbackClass
    private val app = context.applicationContext
    private val lease = VeilLoginPortLease(registryGate)
    private val pins = expectedSigningSha256.map { it.lowercase() }.toSet()
    private var handoff: VeilSocialLoginClient.BrowserHandoff? = null
    private var state: String? = null
    private var delivered = false
    private var callback: ((() -> Pair<VeilSocialLoginClient.BrowserHandoff, String>?) -> Unit)? = null
    private var launch: CompletableFuture<Boolean>? = null
    private val diagnostics = VeilReturnLinkDiagnostic()
    override fun diagnostic(): Map<String, Any> = diagnostics.snapshot()

    private fun verified(): Boolean {
        if (!diagnostics.require(VeilReturnLinkDiagnostic.Check.SDK_SUPPORTED) { Build.VERSION.SDK_INT >= 31 } ||
            !diagnostics.require(VeilReturnLinkDiagnostic.Check.PACKAGE_MATCH) { expectedPackageName == app.packageName } ||
            !diagnostics.require(VeilReturnLinkDiagnostic.Check.APPROVED_PINS_PRESENT) { pins.isNotEmpty() } ||
            !diagnostics.require(VeilReturnLinkDiagnostic.Check.APPROVED_PINS_VALID) { pins.all { Regex("[0-9a-f]{64}").matches(it) } }) return false
        var actual: Set<String>? = null
        if (!diagnostics.require(VeilReturnLinkDiagnostic.Check.SIGNERS_PRESENT) {
            val pm = app.packageManager
            val info = pm.getPackageInfo(expectedPackageName, PackageManager.GET_SIGNING_CERTIFICATES)
            val signers = info.signingInfo?.apkContentsSigners ?: return@require false
            actual = signers.map { signature ->
                MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
                    .joinToString("") { "%02x".format(it.toInt() and 255) }
            }.toSet()
            true
        }) return false
        if (!diagnostics.require(VeilReturnLinkDiagnostic.Check.SIGNERS_MATCH) { actual == pins }) return false
        if (!diagnostics.require(VeilReturnLinkDiagnostic.Check.CALLBACK_ACTIVITY_ENABLED) {
            val component = ComponentName(expectedPackageName, CALLBACK_CLASS)
            val activity = app.packageManager.getActivityInfo(component, 0)
            activity.enabled && activity.exported && activity.applicationInfo.enabled
        }) return false
        var manager: DomainVerificationManager? = null
        if (!diagnostics.require(VeilReturnLinkDiagnostic.Check.DOMAIN_MANAGER_PRESENT) {
            manager = app.getSystemService(DomainVerificationManager::class.java); manager != null
        }) return false
        var user: DomainVerificationUserState? = null
        if (!diagnostics.require(VeilReturnLinkDiagnostic.Check.DOMAIN_STATE_PRESENT) {
            user = manager!!.getDomainVerificationUserState(expectedPackageName); user != null
        }) return false
        if (!diagnostics.require(VeilReturnLinkDiagnostic.Check.DOMAIN_VERIFIED) {
            user!!.isLinkHandlingAllowed && user!!.hostToStateMap[HOST] == DomainVerificationUserState.DOMAIN_STATE_VERIFIED
        }) return false
        return diagnostics.require(VeilReturnLinkDiagnostic.Check.EXACT_RESOLVER) {
            // Also prove that the installed default route resolves this exact
            // path to our dedicated Activity, not MainActivity/browser.
            val probe = Intent(Intent.ACTION_VIEW, Uri.parse(CALLBACK)).addCategory(Intent.CATEGORY_BROWSABLE)
            val resolved = app.packageManager.resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo ?: return@require false
            resolved.packageName == expectedPackageName && resolved.name == CALLBACK_CLASS
        }
    }

    override fun reserve(activity: Activity?, callback: (() -> Pair<VeilSocialLoginClient.BrowserHandoff, String>?) -> Unit): Boolean =
        lease.reserve(verify = {
            diagnostics.require(VeilReturnLinkDiagnostic.Check.ACTIVITY_USABLE) {
                activity != null && activity.packageName == expectedPackageName && !activity.isFinishing && !activity.isDestroyed
            } && verified().also { if (it) diagnostics.completed() }
        }, publish = {
            if (original != null && original !== this) false
            else {
                original = this
                this.callback = callback
                true
            }
        })

    override fun open(activity: Activity?, handoff: VeilSocialLoginClient.BrowserHandoff): Boolean {
        if (activity == null || lease.stopped() || !verified()) return false
        val completion = CompletableFuture<Boolean>()
        synchronized(registryGate) {
            if (lease.stopped() || original !== this || delivered || launch != null) return false
            this.handoff = handoff
            launch = completion
        }
        // No raw URL crosses React, no CookieManager mutation and no WebView.
        val queued = Handler(Looper.getMainLooper()).post {
            var success = false
            try {
                synchronized(registryGate) {
                    if (lease.stopped() || original !== this || delivered || completion.isDone || activity.isFinishing || activity.isDestroyed) return@post
                    // Held only for local native launch, never network/JS.
                    success = handoff.launchNative { url ->
                        val parsed = url.toHttpUrlOrNull() ?: throw IllegalArgumentException()
                        if (parsed.scheme != "https" || parsed.host != "wallet-auth.ynxweb4.com") throw IllegalArgumentException()
                        val candidate = parsed.queryParameter("state") ?: throw IllegalArgumentException()
                        if (state != null && state != candidate) throw IllegalArgumentException()
                        state = candidate
                        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
                    }
                }
            } catch (_: Exception) { success = false }
            finally { completion.complete(success) }
        }
        if (!queued) completion.complete(false)
        // No replacement worker on timeout. retire() releases this private wait;
        // a blocked main thread is not falsely reported as a completed launch.
        return try { completion.get() } catch (_: Exception) { false }
    }

    override fun retire() {
        val pending = lease.retire {
            if (original === this) original = null
            callback = null; handoff = null; state = null; delivered = true
            launch
        }
        pending?.complete(false)
    }

    private data class CallbackSnapshot(val raw: String, val action: String?, val browsable: Boolean,
        val selector: Boolean, val componentPackage: String?, val componentClass: String?,
        val actualClass: String, val actualPackage: String)

    // Executed only on the coordinator's existing IO worker, not the Activity.
    private fun validate(snapshot: CallbackSnapshot): Pair<VeilSocialLoginClient.BrowserHandoff, String>? {
        if (lease.stopped() || !verified() || snapshot.actualClass != CALLBACK_CLASS || snapshot.actualPackage != expectedPackageName ||
            snapshot.action != Intent.ACTION_VIEW || !snapshot.browsable || snapshot.selector) return null
        if (snapshot.componentPackage != null && (snapshot.componentPackage != expectedPackageName || snapshot.componentClass != CALLBACK_CLASS)) return null
        val raw = snapshot.raw
        if (raw.length > 2048 || !raw.startsWith("$CALLBACK?") || '#' in raw || '\\' in raw) return null
        val parsed = raw.toHttpUrlOrNull() ?: return null
        val keys = parsed.queryParameterNames
        if (keys != setOf("state", "code") && keys != setOf("state", "error")) return null
        if (keys.any { parsed.queryParameterValues(it).size != 1 }) return null
        val code = parsed.queryParameter("code")
        if (code != null && !Regex("[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]").matches(code) ||
            code == null && parsed.queryParameter("error") !in setOf("access_denied", "login_required")) return null
        return synchronized(registryGate) {
            val retained = handoff
            val sink = callback
            if (lease.stopped() || original !== this || delivered || retained == null || sink == null || state == null || parsed.queryParameter("state") != state) return null
            delivered = true // no replay dispatch; client also validates exact code/error.
            Pair(retained, raw)
        }
    }

    override fun toString() = "VeilSocialLoginBrowserPort[private original]"
    companion object {
        private const val HOST = "social.ynxweb4.com"


        private val registryGate = Any()
        private var original: VeilSocialLoginBrowserPort? = null
        internal fun receiveNative(activity: Activity, intent: Intent) {
            // Only immutable capture/queue here. No PM/domain IPC, parsing,
            // browser launch or network before NoDisplay Activity finishes.
            val raw = intent.dataString ?: return
            if (raw.length > 2048) return
            val component = intent.component
            val snapshot = CallbackSnapshot(raw, intent.action, intent.hasCategory(Intent.CATEGORY_BROWSABLE),
                intent.selector != null, component?.packageName, component?.className,
                activity.javaClass.name, activity.packageName)
            val route = synchronized(registryGate) {
                val port = original ?: return
                if (port.lease.stopped()) return
                Pair(port, port.callback ?: return)
            }
            // Capture the original port; never re-resolve to a later owner.
            route.second { route.first.validate(snapshot) }
        }
    }
}

internal class VeilLoginPortLease(private val gate: Any) {
    private var retired = false
    fun stopped(): Boolean = synchronized(gate) { retired }
    fun reserve(verify: () -> Boolean, publish: () -> Boolean): Boolean {
        synchronized(gate) { if (retired) return false }
        if (!verify()) return false
        return synchronized(gate) { if (retired) false else publish() }
    }
    fun <T> retire(cleanup: () -> T): T = synchronized(gate) { retired = true; cleanup() }
}
