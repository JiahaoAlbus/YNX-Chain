package com.ynx.social.matrix

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** Dedicated callback surface: no React inheritance, JS bridge or raw URL log. */
class VeilSocialQaLoginCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        consume(intent)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consume(intent)
    }
    private fun consume(incoming: Intent?) {
        try {
            if (incoming != null) VeilSocialLoginBrowserPort.receiveNative(this, incoming)
        } catch (_: Exception) {
            // No raw intent, credential or exception is exported.
        } finally {
            setIntent(Intent())
            finish()
        }
    }
}
