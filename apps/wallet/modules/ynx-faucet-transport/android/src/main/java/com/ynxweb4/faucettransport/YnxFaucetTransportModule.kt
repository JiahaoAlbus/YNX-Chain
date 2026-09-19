package com.ynxweb4.faucettransport

import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class YnxFaucetTransportModule : Module() {
  private val engines = mutableMapOf<String, BoundedHttpEngine>()
  private val taskRoutes = mutableMapOf<String, String>()
  // Expo replays a real RESUMED event after module creation. Until that event,
  // a lazily created bridge must not assume the Activity is in the foreground.
  private var foreground = false
  private var destroyed = false

  @Synchronized
  private fun enabledEngine(route: String): BoundedHttpEngine {
    if (!PRODUCTION_ENABLED) throw TransportException("YNX_HTTP_UNAVAILABLE")
    if (destroyed || !foreground) throw TransportException("YNX_HTTP_CANCELLED")
    val endpoints = when (route) {
      "primary" -> ADMIT_URL to RPC_URL
      "legacy" -> LEGACY_ADMIT_URL to LEGACY_RPC_URL
      else -> throw TransportException("YNX_HTTP_INVALID_INPUT")
    }
    return engines.getOrPut(route) { BoundedHttpEngine(endpoints.first, endpoints.second,
      now = SystemClock::elapsedRealtimeNanos) }
  }

  override fun definition() = ModuleDefinition {
    Name("YnxFaucetTransport")
    Function("reserveTask") { route: String, purpose: String ->
      try {
        val taskId = enabledEngine(route).reserve(purpose)
        synchronized(this@YnxFaucetTransportModule) { taskRoutes[taskId] = route }
        taskId
      }
      catch (error: HttpFailure) { throw TransportException(error.code) }
    }
    AsyncFunction("request") { input: Map<String, Any?>, promise: Promise ->
      try {
        val route = input["route"] as? String ?: throw TransportException("YNX_HTTP_INVALID_INPUT")
        val taskId = input["taskId"] as? String ?: throw TransportException("YNX_HTTP_INVALID_INPUT")
        val target = synchronized(this@YnxFaucetTransportModule) {
          if (taskRoutes[taskId] != route) throw TransportException("YNX_HTTP_TASK_INVALID")
          enabledEngine(route)
        }
        target.request(input - "route") { response, error ->
          synchronized(this@YnxFaucetTransportModule) { taskRoutes.remove(taskId) }
          if (error != null) promise.reject(error.code, "Faucet network operation could not be completed.", null)
          else if (response != null) promise.resolve(response.fields())
          else promise.reject("YNX_HTTP_NETWORK", "Faucet network operation could not be completed.", null)
        }
      } catch (error: TransportException) {
        promise.reject(error.code, "Faucet transport is not enabled.", null)
      }
    }
    Function("cancel") { route: String, taskId: String -> synchronized(this@YnxFaucetTransportModule) {
      if (taskRoutes.remove(taskId) == route) engines[route]?.cancel(taskId); Unit
    } }
    OnActivityEntersBackground { synchronized(this@YnxFaucetTransportModule) { foreground = false; taskRoutes.clear(); engines.values.forEach { it.pause() } } }
    OnActivityDestroys { synchronized(this@YnxFaucetTransportModule) { foreground = false; taskRoutes.clear(); engines.values.forEach { it.pause() } } }
    OnActivityEntersForeground { synchronized(this@YnxFaucetTransportModule) { foreground = true; engines.values.forEach { it.resume() } } }
    OnDestroy { synchronized(this@YnxFaucetTransportModule) { destroyed = true; taskRoutes.clear(); engines.values.forEach { it.close() }; engines.clear() } }
  }

  private class TransportException(code: String) : CodedException(code, "Faucet transport is not enabled.", null)
  companion object {
    private const val PRODUCTION_ENABLED = true
    private const val ADMIT_URL = "https://faucet-testnet.ynxweb4.com/request"
    private const val RPC_URL = "https://rpc-testnet.ynxweb4.com"
    // Compatibility identities remain frozen for an explicit same-request
    // recovery release. This disabled bridge never auto-replays a POST.
    private const val LEGACY_ADMIT_URL = "https://faucet.ynxweb4.com/request"
    private const val LEGACY_RPC_URL = "https://rpc.ynxweb4.com/evm"
  }
}
