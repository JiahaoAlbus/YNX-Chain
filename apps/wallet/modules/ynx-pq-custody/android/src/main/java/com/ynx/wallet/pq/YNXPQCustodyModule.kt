package com.ynx.wallet.pq

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.turbomodule.core.CallInvokerHolderImpl
import com.facebook.react.common.annotations.FrameworkAPI
import java.util.concurrent.Executors

/** No backup, credential, native pointer or sign input in the Java/JS API. */
@OptIn(FrameworkAPI::class)
class YNXPQCustodyModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val lifecycle = Executors.newSingleThreadExecutor()
    @Volatile private var installed = false
    @Volatile private var invalidated = false
    private var runtimeBinding = 0L // Native lifecycle identity, never returned to JS
    override fun getName() = "YNXPQCustody"
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun readPublicStatus(): WritableMap {
        // Never binds secure input, installs JSI, or queues a Source operation.
        val value = nativeReadPublicStatus()
        check(value != null && value.size == 8 && value[0] == 1 && value[1] in 0..3) { "PQ_PUBLIC_STATUS_UNAVAILABLE" }
        val states = arrayOf("not-installed", "initializing", "ready", "retaining")
        return Arguments.createMap().apply {
            putInt("version", 1); putString("runtime", states[value[1]])
            putInt("heldOperations", value[2]); putInt("heldCoreUncertain", value[3])
            putInt("heldOSUncertain", value[4]); putInt("heldOSRecorded", value[5])
            putInt("heldCleanupFaults", value[6]); putBoolean("workerBusy", value[7] == 1)
        }
    }
    @ReactMethod(isBlockingSynchronousMethod = true)
    @Synchronized fun install(): Boolean {
        if (invalidated) return false
        if (installed) return true
        if (runtimeBinding != 0L) return false // retain the same partial, no replacement
        NativeSecure43.bind(context)
        NativeSelectedAppContext.bind(context)
        // Run on the actual JS thread. RN0.86's original ReactContext exposes
        // these getters in both bridge and BridgelessReactContext. Never create
        // a second runtime or reach through a nonexistent CatalystInstance.
        val runtime = context.javaScriptContextHolder?.get() ?: return false
        if (runtime == 0L) return false
        val invoker = context.jsCallInvokerHolder as? CallInvokerHolderImpl ?: return false
        val adopted = LongArray(1) // allocate before the native installation
        try { installed = nativeInstall(runtime, invoker, adopted) }
        finally {
            runtimeBinding = adopted[0] // retains partials even if native threw
            if (runtimeBinding <= 0L) installed = false
        }
        if (installed) NativeSelectedAccountUI.bind(context)
        return installed
    }
    override fun invalidate() {
        val binding = synchronized(this) {
            if (invalidated) return
            invalidated = true; installed = false; runtimeBinding
        }
        if (binding == 0L) { lifecycle.shutdown(); super.invalidate(); return }
        nativeRequestInvalidate(binding) // stop effects/completions before async drain
        lifecycle.execute {
            // Native retains its worker on false; never force-free custody or
            // pretend Java GC has acknowledged wiping/closing.
            if (nativeInvalidate(binding)) lifecycle.shutdown()
        }
        super.invalidate()
    }
    private external fun nativeInstall(runtime: Long, invoker: CallInvokerHolderImpl, adopted: LongArray): Boolean
    private external fun nativeInvalidate(binding: Long): Boolean
    private external fun nativeRequestInvalidate(binding: Long): Boolean
    private external fun nativeReadPublicStatus(): IntArray?
    companion object { init { System.loadLibrary("ynx_pq_custody") } }
}
