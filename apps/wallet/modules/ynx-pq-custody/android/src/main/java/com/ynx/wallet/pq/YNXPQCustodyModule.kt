package com.ynx.wallet.pq

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.turbomodule.core.CallInvokerHolderImpl
import com.facebook.react.common.annotations.FrameworkAPI
import java.util.concurrent.Executors

/** No backup, credential, native pointer or sign input in the Java/JS API. */
@OptIn(FrameworkAPI::class)
class YNXPQCustodyModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val lifecycle = Executors.newSingleThreadExecutor()
    @Volatile private var installed = false
    override fun getName() = "YNXPQCustody"
    @ReactMethod(isBlockingSynchronousMethod = true)
    @Synchronized fun install(): Boolean {
        if (installed) return true
        // Run on the actual JS thread. RN0.86's original ReactContext exposes
        // these getters in both bridge and BridgelessReactContext. Never create
        // a second runtime or reach through a nonexistent CatalystInstance.
        val runtime = context.javaScriptContextHolder?.get() ?: return false
        if (runtime == 0L) return false
        val invoker = context.jsCallInvokerHolder as? CallInvokerHolderImpl ?: return false
        installed = nativeInstall(runtime, invoker)
        return installed
    }
    override fun invalidate() {
        installed = false
        lifecycle.execute {
            // Native retains its worker on false; never force-free custody or
            // pretend Java GC has acknowledged wiping/closing.
            if (nativeInvalidate()) lifecycle.shutdown()
        }
        super.invalidate()
    }
    private external fun nativeInstall(runtime: Long, invoker: CallInvokerHolderImpl): Boolean
    private external fun nativeInvalidate(): Boolean
    companion object { init { System.loadLibrary("ynx_pq_custody") } }
}
