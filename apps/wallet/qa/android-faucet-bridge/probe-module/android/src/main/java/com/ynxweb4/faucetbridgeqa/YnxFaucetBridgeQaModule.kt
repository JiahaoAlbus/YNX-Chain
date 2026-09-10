package com.ynxweb4.faucetbridgeqa

import android.os.Handler
import android.os.Looper
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/** Test-only observer. It reads the registered original instance without
 * changing a gate, field, engine factory, URL, method or lifecycle callback. */
class YnxFaucetBridgeQaModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  private fun snapshotFields(): Map<String, Any> {
    val packageName = appContext.reactContext?.packageName
    check(packageName == "com.ynxweb4.wallet.faucetbridgeqa") { "QA observer requires its own application ID" }
    val original = checkNotNull(appContext.registry.getModule("YnxFaucetTransport"))
    check(original.javaClass.name == "com.ynxweb4.faucettransport.YnxFaucetTransportModule")
    return synchronized(original) {
      fun field(name: String): Any? = original.javaClass.getDeclaredField(name).also { it.isAccessible = true }.get(original)
      mapOf(
        "packageName" to packageName,
        "engineCreated" to (field("engine") != null),
        "foreground" to checkNotNull(field("foreground")),
        "destroyed" to checkNotNull(field("destroyed"))
      )
    }
  }

  private fun observeLifecycle(event: String) {
    // Read after the current event delivery queue. Ordering is recorded, not
    // changed; the original module receives the real Expo lifecycle itself.
    main.post {
      try {
        Log.i("YNX_FAUCET_BRIDGE_QA", JSONObject(snapshotFields() + ("event" to event)).toString())
      } catch (error: Exception) {
        Log.e("YNX_FAUCET_BRIDGE_QA", JSONObject(mapOf("event" to event, "observerFailed" to true, "errorClass" to error.javaClass.simpleName)).toString())
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("YnxFaucetBridgeQA")
    Function("snapshot") { snapshotFields() }
    OnActivityEntersForeground { observeLifecycle("activity-foreground") }
    OnActivityEntersBackground { observeLifecycle("activity-background") }
    OnActivityDestroys { observeLifecycle("activity-destroyed") }
  }
}
