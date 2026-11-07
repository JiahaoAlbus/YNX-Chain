package com.ynxweb4.ai

import com.facebook.react.ReactHost
import com.ynx.wallet.ai.YNXOriginalAIMobileV6Registration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Normal host ownership, independent of JS sessions/permission/approval DATA. */
internal object NativeAIHostLifecycle {
  private class Retained(val host: ReactHost) { @Volatile var failure: Throwable? = null }
  private val retained = ConcurrentHashMap<ReactHost, Retained>()
  private val teardown = Executors.newSingleThreadExecutor { task -> Thread(task, "YNX-AI-Native-Teardown") }
  @Volatile private var registered = false
  @Volatile private var originalFailure: Throwable? = null

  @Synchronized fun registerAfterOriginalImageLoad() {
    if (!BuildConfig.YNX_AI_MATCHED_NATIVE_V6) return
    originalFailure?.let { throw IllegalStateException("AI_ORIGINAL_NATIVE_BOOTSTRAP_FAILED", it) }
    if (registered) return
    try {
      NativeInstalledApplication.bindNativeClass()
      NativeProtectedReview.bindNativeClass()
      YNXOriginalAIMobileV6Registration.registerBeforeReactHost()
      registered = true
    } catch (failure: Throwable) { originalFailure = failure; throw failure }
  }
  fun beforeHostConstruction() {
    if (!BuildConfig.YNX_AI_MATCHED_NATIVE_V6) return
    check(registered) { "AI_ORIGINAL_NATIVE_IMAGE_NOT_REGISTERED" }
    check(retained.isEmpty()) { "AI_ORIGINAL_HOST_CLOSE_DEBT_RETAINED" }
    originalFailure?.let { throw IllegalStateException("AI_ORIGINAL_NATIVE_BOOTSTRAP_FAILED", it) }
  }
  fun attach(host: ReactHost): ReactHost {
    if (!BuildConfig.YNX_AI_MATCHED_NATIVE_V6) return host
    host.addBeforeDestroyListener {
      val owner = Retained(host)
      if (retained.putIfAbsent(host, owner) == null) {
        try {
          // Synchronous reduction before RN destroys its JS context. Physical
          // shutdown runs ONLY on this retained native teardown executor.
          YNXOriginalAIMobileV6Registration.requestRetireBeforeReactHostInvalidation()
          teardown.execute {
            try {
              if (YNXOriginalAIMobileV6Registration.drainOnNativeTeardownExecutor()) retained.remove(host, owner)
              else owner.failure = IllegalStateException("AI_ORIGINAL_NATIVE_CLOSE_NOT_PHYSICAL")
            } catch (failure: Throwable) { owner.failure = failure }
          }
        } catch (failure: Throwable) { owner.failure = failure }
      }
    }
    // Native's exact matched runtime inventory independently blocks successor
    // runtime construction until its retained old runtime physically drains.
    return host
  }
}
