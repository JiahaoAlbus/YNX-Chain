package com.ynx.wallet.pq

import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.LifecycleState
import java.lang.ref.WeakReference

/** Private Native picker. No React methods, account writes or approval result. */
internal object NativeSelectedAccountUI : LifecycleEventListener {
    private val main = Handler(Looper.getMainLooper())
    private var context: WeakReference<ReactApplicationContext>? = null
    private val dialogs = mutableMapOf<Long, AlertDialog>() // main thread only

    fun bind(actual: ReactApplicationContext) {
        val previous = context?.get()
        if (previous !== actual) {
            previous?.removeLifecycleEventListener(this)
            context = WeakReference(actual)
            actual.addLifecycleEventListener(this)
        }
    }

    @JvmStatic fun showOriginal(token: Long, rows: Array<String>) {
        val copy = rows.copyOf()
        val posted = main.post {
            if (!nativeCurrent(token)) { nativeClosed(token); return@post }
            val actual = context?.get()
            val activity = actual?.currentActivity
            if (actual?.lifecycleState != LifecycleState.RESUMED || activity == null || activity.isFinishing || activity.isDestroyed) {
                nativeSelected(token, -1, 9802); nativeClosed(token); return@post
            }
            try {
                val dialog = AlertDialog.Builder(activity)
                    .setTitle("Select account only")
                    .setItems(copy) { _, index -> nativeSelected(token, index, 0) }
                    .setNegativeButton("Cancel") { _, _ -> nativeSelected(token, -1, 9803) }
                    .create()
                dialog.setOnCancelListener { nativeSelected(token, -1, 9803) }
                dialog.setOnDismissListener { dialogs.remove(token); nativeClosed(token) }
                dialogs[token] = dialog
                if (!nativeCurrent(token)) { dialogs.remove(token); nativeClosed(token); return@post }
                // Selection is DATA only. Signing/sending retain separate review.
                dialog.show()
            } catch (_: Exception) {
                nativeSelected(token, -1, 9802)
                val held = dialogs[token]
                if (held == null) nativeClosed(token)
                else {
                    // An exception after show cannot prove UI absence. Keep
                    // ownership until onDismiss or observed absence below.
                    try {
                        held.dismiss()
                        if (!held.isShowing) { dialogs.remove(token); nativeClosed(token) }
                    } catch (_: Exception) { /* retain the original UI debt */ }
                }
            }
        }
        if (!posted) { nativeSelected(token, -1, 9802); nativeClosed(token) }
    }

    @JvmStatic fun dismissOriginal(token: Long) {
        main.post {
            val dialog = dialogs[token]
            if (dialog == null) nativeClosed(token)
            else try {
                dialog.dismiss()
                if (!dialog.isShowing) { dialogs.remove(token); nativeClosed(token) }
            } catch (_: Exception) { /* no synthetic closed ACK */ }
        }
    }

    override fun onHostResume() = Unit
    override fun onHostPause() { main.post { for (token in dialogs.keys.toList()) { nativeSelected(token, -1, 9803); dismissOriginal(token) } } }
    override fun onHostDestroy() = onHostPause()
    private external fun nativeCurrent(token: Long): Boolean
    private external fun nativeSelected(token: Long, index: Int, result: Int): Boolean
    private external fun nativeClosed(token: Long)
}
