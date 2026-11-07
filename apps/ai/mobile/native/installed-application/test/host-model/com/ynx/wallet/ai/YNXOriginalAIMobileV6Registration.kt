package com.ynx.wallet.ai
import java.util.concurrent.CountDownLatch
object YNXOriginalAIMobileV6Registration {
  var registers = 0; var retires = 0; @Volatile var drains = 0
  var registerError: Throwable? = null
  @Volatile var physical = true
  var gate = CountDownLatch(1); var entered = CountDownLatch(1)
  @JvmStatic fun registerBeforeReactHost() { registers++; registerError?.let { throw it } }
  @JvmStatic fun requestRetireBeforeReactHostInvalidation() { retires++ }
  @JvmStatic fun drainOnNativeTeardownExecutor(): Boolean {
    check(Thread.currentThread().name == "YNX-AI-Native-Teardown"); drains++; entered.countDown(); gate.await(); return physical
  }
}
