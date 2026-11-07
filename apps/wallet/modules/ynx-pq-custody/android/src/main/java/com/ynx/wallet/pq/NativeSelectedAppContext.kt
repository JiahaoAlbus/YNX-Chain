package com.ynx.wallet.pq

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext

/** Private Native Context, never a React method or a caller path/provider. */
internal object NativeSelectedAppContext {
    @Volatile private var application: Context? = null

    @Synchronized fun bind(context: ReactApplicationContext) {
        val actual = context.applicationContext
        check(!actual.isDeviceProtectedStorage) { "PQ_NATIVE_APP_CONTEXT_CHANGED" }
        val previous = application
        check(previous == null || previous === actual) { "PQ_NATIVE_APP_CONTEXT_CHANGED" }
        application = actual
    }

    @JvmStatic fun originalApplicationDirectory(): String? {
        val actual = application ?: return null
        if (actual.isDeviceProtectedStorage) return null
        return actual.dataDir.absolutePath
    }
}
