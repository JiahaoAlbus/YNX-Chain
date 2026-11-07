import com.ynxweb4.ai.NativeAIHostLifecycle
import com.ynx.wallet.ai.YNXOriginalAIMobileV6Registration as Native
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
private class Host : com.facebook.react.ReactHost {
  lateinit var beforeDestroy: () -> Unit
  override fun addBeforeDestroyListener(listener: () -> Unit) { beforeDestroy = listener }
}
private fun rejected(action: () -> Unit) { check(runCatching(action).isFailure) }
fun main(args: Array<String>) {
  if (args.contains("bootstrap-error")) {
    val first = IllegalStateException("PUBLIC original registration failure"); Native.registerError = first
    rejected { NativeAIHostLifecycle.registerAfterOriginalImageLoad() }
    val repeated = runCatching { NativeAIHostLifecycle.registerAfterOriginalImageLoad() }.exceptionOrNull()
    check(repeated?.cause === first && Native.registers == 1)
    println("PUBLIC host bootstrap original failure retained; register never retried PASS"); return
  }
  try {
    NativeAIHostLifecycle.registerAfterOriginalImageLoad(); NativeAIHostLifecycle.registerAfterOriginalImageLoad(); check(Native.registers == 1)
    NativeAIHostLifecycle.beforeHostConstruction(); val host = Host(); NativeAIHostLifecycle.attach(host)
    host.beforeDestroy(); check(Native.retires == 1); check(Native.entered.await(5, TimeUnit.SECONDS))
    rejected { NativeAIHostLifecycle.beforeHostConstruction() }
    Native.gate.countDown()
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    while (runCatching { NativeAIHostLifecycle.beforeHostConstruction() }.isFailure) { check(System.nanoTime() < deadline); Thread.yield() }
    Native.physical = false; Native.gate = CountDownLatch(0); Native.entered = CountDownLatch(1)
    host.beforeDestroy(); check(Native.entered.await(5, TimeUnit.SECONDS)); rejected { NativeAIHostLifecycle.beforeHostConstruction() }
    host.beforeDestroy(); check(Native.retires == 2 && Native.drains == 2)
    println("PUBLIC actual host lifecycle body: before-destroy retire, dedicated executor, pending retained, physical release and false-close debt/no retry PASS; Native/installed/Root/approval false")
  } finally {
    val field = NativeAIHostLifecycle::class.java.getDeclaredField("teardown"); field.isAccessible = true
    (field.get(null) as java.util.concurrent.ExecutorService).shutdownNow()
  }
}
