package com.ynxweb4.faucettransport

import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class YnxFaucetTransportModule : Module() {
  private var engine: BoundedHttpEngine? = null
  // Expo replays a real RESUMED event after module creation. Until that event,
  // a lazily created bridge must not assume the Activity is in the foreground.
  private var foreground = false
  private var destroyed = false

  @Synchronized
  private fun enabledEngine(): BoundedHttpEngine {
    // Activation requires a separately reviewed Central origin/runtime lease.
    // There is intentionally no JS flag, caller URL, or Fetch fallback.
    if (!PRODUCTION_ENABLED) throw TransportException("YNX_HTTP_UNAVAILABLE")
    if (destroyed || !foreground) throw TransportException("YNX_HTTP_CANCELLED")
    return engine ?: BoundedHttpEngine(ADMIT_URL, RPC_URL,
      now = SystemClock::elapsedRealtimeNanos).also { engine = it }
  }

  override fun definition() = ModuleDefinition {
    Name("YnxFaucetTransport")
    Function("reserveTask") { purpose: String ->
      try { enabledEngine().reserve(purpose) }
      catch (error: HttpFailure) { throw TransportException(error.code) }
    }
    AsyncFunction("request") { input: Map<String, Any?>, promise: Promise ->
      try {
        enabledEngine().request(input) { response, error ->
          if (error != null) promise.reject(error.code, "Faucet network operation could not be completed.", null)
          else if (response != null) promise.resolve(response.fields())
          else promise.reject("YNX_HTTP_NETWORK", "Faucet network operation could not be completed.", null)
        }
      } catch (error: TransportException) {
        promise.reject(error.code, "Faucet transport is not enabled.", null)
      }
    }
    Function("cancel") { taskId: String -> synchronized(this@YnxFaucetTransportModule) { engine?.cancel(taskId); Unit } }
    OnActivityEntersBackground { synchronized(this@YnxFaucetTransportModule) { foreground = false; engine?.pause() } }
    OnActivityDestroys { synchronized(this@YnxFaucetTransportModule) { foreground = false; engine?.pause() } }
    OnActivityEntersForeground { synchronized(this@YnxFaucetTransportModule) { foreground = true; engine?.resume() } }
    OnDestroy { synchronized(this@YnxFaucetTransportModule) { destroyed = true; engine?.close(); engine = null } }
  }

  private class TransportException(code: String) : CodedException(code, "Faucet transport is not enabled.", null)
  companion object {
    private const val PRODUCTION_ENABLED = false
    private const val ADMIT_URL = "https://faucet.ynxweb4.com/request"
    private const val RPC_URL = "https://rpc.ynxweb4.com/evm"
  }
}
