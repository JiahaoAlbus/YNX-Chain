package com.ynxweb4.faucettransport

import android.app.Activity
import android.app.Instrumentation
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.security.NetworkSecurityPolicy
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray
import org.json.JSONObject

/** Executes on Android ART through am instrument, not host JVM/Robolectric.
 * The only server and endpoint are in this process on 127.0.0.1. No account,
 * storage, Expo bridge activation, signing, public RPC or Faucet is used. */
class BoundedHttpRuntimeInstrumentation : Instrumentation() {
  private val results = JSONArray()
  private var failed = 0

  override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

  override fun onStart() {
    val started = SystemClock.elapsedRealtime()
    case("android-runtime-and-test-only-network-policy") {
      equal("com.ynxweb4.faucettransport.runtimeqa", targetContext.packageName)
      check(Build.VERSION.SDK_INT >= 26)
      check(NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted("127.0.0.1"))
      check(!NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted("faucet.ynxweb4.com"))
      check(!NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted("192.0.2.1"))
      JSONObject().put("sdk", Build.VERSION.SDK_INT).put("vm", System.getProperty("java.vm.name"))
    }
    case("201-429-503-preserve-body-without-automatic-replay") {
      Fixture().use { f ->
        for (status in listOf(201, 429, 503)) {
          f.status = status
          f.headers = listOf("Retry-After: 0")
          val reply = f.submit().first ?: error("Expected an HTTP fact")
          equal(status, reply.status); equal("{}", reply.body)
          equal(false, reply.fields()["redirected"])
          equal(f.body, f.lastBody); equal("identity", f.acceptEncoding)
        }
        equal(3, f.received.get()); f.facts()
      }
    }
    case("307-never-dispatches-redirect-target") {
      Fixture().use { f ->
        f.status = 307
        equal("YNX_HTTP_REDIRECT", f.submit().second?.code)
        equal(1, f.received.get()); equal(0, f.redirectTargets.get()); f.facts()
      }
    }
    case("response-budget-exact-16384-and-16385-chunked-or-declared") {
      Fixture().use { f ->
        f.chunked = true; f.bytes = ByteArray(16384) { 32 }
        equal(16384, f.submit().first?.body?.length)
        f.bytes = ByteArray(16385) { 32 }
        equal("YNX_HTTP_RESPONSE_TOO_LARGE", f.submit().second?.code)
        f.chunked = false
        equal("YNX_HTTP_RESPONSE_TOO_LARGE", f.submit().second?.code)
        f.facts().put("acceptedBytes", 16384).put("rejectedBytes", 16385)
      }
    }
    case("utf8-compression-and-ambiguous-headers-fail-closed") {
      Fixture().use { f ->
        f.bytes = byteArrayOf(0xc3.toByte(), 0x28)
        equal("YNX_HTTP_ENCODING", f.submit().second?.code)
        f.bytes = "{}".toByteArray(); f.headers = listOf("Content-Encoding: gzip")
        equal("YNX_HTTP_ENCODING", f.submit().second?.code)
        f.headers = listOf("Content-Type: application/json")
        equal("YNX_HTTP_METADATA", f.submit().second?.code)
        f.headers = listOf("Transfer-Encoding: gzip")
        equal("YNX_HTTP_METADATA", f.submit().second?.code)
        equal(4, f.received.get()); f.facts()
      }
    }
    case("cancel-before-start-no-socket-and-no-id-resurrection") {
      Fixture().use { f ->
        val id = f.engine.reserve("admit")
        f.engine.cancel(id); f.engine.cancel(id)
        equal("YNX_HTTP_TASK_INVALID", f.submit(f.input(id)).second?.code)
        equal(0, f.accepted.get()); f.facts()
      }
    }
    case("inflight-cancel-settles-once-and-discards-late-response") {
      Fixture().use { f ->
        f.release = CountDownLatch(1)
        val completions = AtomicInteger()
        val done = CompletableFuture<Pair<HttpReply?, HttpFailure?>>()
        val id = f.engine.reserve("admit")
        f.engine.request(f.input(id)) { r, e -> completions.incrementAndGet(); done.complete(r to e) }
        check(f.entered.await(3, TimeUnit.SECONDS))
        f.engine.cancel(id)
        equal("YNX_HTTP_CANCELLED", done.get(2, TimeUnit.SECONDS).second?.code)
        f.release!!.countDown(); check(f.finished.await(3, TimeUnit.SECONDS))
        f.awaitNetworkIdle()
        equal("YNX_HTTP_TASK_INVALID", f.submit(f.input(id)).second?.code)
        equal(1, completions.get()); equal(1, f.received.get())
        f.facts().put("originalCompletions", completions.get())
      }
    }
    case("real-monotonic-deadline-during-response-wait-no-retry") {
      Fixture(deadlineMillis = 1000).use { f ->
        f.release = CountDownLatch(1)
        val calls = AtomicInteger()
        val done = CompletableFuture<Pair<HttpReply?, HttpFailure?>>()
        val before = SystemClock.elapsedRealtime()
        f.engine.request(f.input()) { r, e -> calls.incrementAndGet(); done.complete(r to e) }
        check(f.entered.await(3, TimeUnit.SECONDS))
        equal("YNX_HTTP_TIMEOUT", done.get(4, TimeUnit.SECONDS).second?.code)
        val elapsed = SystemClock.elapsedRealtime() - before
        check(elapsed in 750..4000) { "Deadline was not a real bounded elapsed wait" }
        f.release!!.countDown(); check(f.finished.await(3, TimeUnit.SECONDS)); f.awaitNetworkIdle()
        equal(1, calls.get()); equal(1, f.received.get())
        f.facts().put("elapsedMillis", elapsed).put("originalCompletions", calls.get())
      }
    }
    case("duplicate-task-cannot-replace-original-completion") {
      Fixture().use { f ->
        f.release = CountDownLatch(1)
        val calls = AtomicInteger()
        val done = CompletableFuture<Pair<HttpReply?, HttpFailure?>>()
        val id = f.engine.reserve("admit")
        f.engine.request(f.input(id)) { r, e -> calls.incrementAndGet(); done.complete(r to e) }
        check(f.entered.await(3, TimeUnit.SECONDS))
        equal("YNX_HTTP_TASK_INVALID", f.submit(f.input(id)).second?.code)
        f.release!!.countDown()
        equal(201, done.get(3, TimeUnit.SECONDS).first?.status)
        f.awaitNetworkIdle(); equal(1, calls.get()); equal(1, f.received.get())
        f.facts().put("originalCompletions", calls.get())
      }
    }
    case("engine-capacity-pause-resume-close-retire-old-reservations") {
      Fixture().use { f ->
        val ids = (1..8).map { f.engine.reserve("admit") }
        expectCode("YNX_HTTP_CAPACITY") { f.engine.reserve("admit") }
        f.engine.pause()
        ids.forEach { equal("YNX_HTTP_TASK_INVALID", f.submit(f.input(it)).second?.code) }
        expectCode("YNX_HTTP_CANCELLED") { f.engine.reserve("admit") }
        equal(0, f.accepted.get())
        f.engine.resume(); equal(201, f.submit().first?.status)
        f.engine.close(); f.engine.resume()
        expectCode("YNX_HTTP_UNAVAILABLE") { f.engine.reserve("admit") }
        equal(1, f.received.get()); f.facts().put("cancelledReservations", 8)
      }
    }
    case("peer-disconnect-after-body-does-not-replay-request") {
      Fixture().use { f ->
        f.disconnect = true
        equal("YNX_HTTP_NETWORK", f.submit().second?.code)
        f.awaitNetworkIdle()
        equal(1, f.received.get()); equal(f.body, f.lastBody); f.facts()
      }
    }
    case("five-readonly-rpc-methods-exact-and-unsupported-zero-dispatch") {
      Fixture().use { f ->
        val methods = listOf("eth_chainId", "ynx_getFaucetModel", "ynx_getDurabilityModel",
          "ynx_getTransactionDurability", "eth_getTransactionReceipt")
        for (method in methods) {
          val params = if (method in methods.take(3)) emptyList() else listOf("0x" + "a".repeat(64))
          val input = mapOf("purpose" to "rpc", "taskId" to f.engine.reserve("rpc"),
            "rpcId" to "runtime_qa", "method" to method, "params" to params)
          equal(201, f.submit(input).first?.status)
          val expected = "{\"jsonrpc\":\"2.0\",\"id\":\"runtime_qa\",\"method\":\"$method\",\"params\":" +
            (if (params.isEmpty()) "[]" else "[\"${params[0]}\"]") + "}"
          equal(expected, f.lastBody)
        }
        val bad = mapOf("purpose" to "rpc", "taskId" to f.engine.reserve("rpc"),
          "rpcId" to "runtime_qa", "method" to "eth_sendRawTransaction", "params" to emptyList<String>())
        equal("YNX_HTTP_INVALID_INPUT", f.submit(bad).second?.code)
        equal(5, f.received.get()); f.facts().put("supportedMethods", JSONArray(methods))
      }
    }
    val report = JSONObject().put("schema", "ynx-android-faucet-runtime-qa-v1")
      .put("package", targetContext.packageName).put("sdk", Build.VERSION.SDK_INT)
      .put("abi", Build.SUPPORTED_ABIS.first()).put("fingerprint", Build.FINGERPRINT)
      .put("elapsedMillis", SystemClock.elapsedRealtime() - started)
      .put("cases", results).put("passed", results.length() - failed).put("failed", failed)
      .put("productionAdapterIncluded", false).put("productionActivationTested", false)
      .put("publicRequests", 0)
      .put("expoLifecycleDeliveryTested", false).put("walletStorageAccessed", false)
    targetContext.filesDir.resolve("runtime-result.json").writeText(report.toString(2))
    finish(if (failed == 0) Activity.RESULT_OK else Activity.RESULT_CANCELED,
      Bundle().apply { putString("ynxResult", report.toString()) })
  }

  private fun case(name: String, body: () -> JSONObject) {
    val started = SystemClock.elapsedRealtime()
    val item = JSONObject().put("name", name)
    try { item.put("facts", body()).put("passed", true) }
    catch (failure: Throwable) {
      failed++; item.put("passed", false).put("error", failure.stackTraceToString())
    }
    item.put("elapsedMillis", SystemClock.elapsedRealtime() - started)
    results.put(item)
    sendStatus(0, Bundle().apply { putString("case", item.toString()) })
  }

  private fun equal(expected: Any?, actual: Any?) {
    check(expected == actual) { "Expected $expected; got $actual" }
  }
  private fun expectCode(expected: String, body: () -> Unit) {
    val code = try { body(); "no error" } catch (e: HttpFailure) { e.code }
    equal(expected, code)
  }

  private class Fixture(deadlineMillis: Long = 15000) : AutoCloseable {
    val requestId = "runtime_qa_0123456789abcdef0123456789"
    // Public synthetic address shape only; the host does not sign or validate
    // ownership. This body never leaves this process's loopback HTTP server.
    val body = "{\"requestId\":\"$requestId\",\"address\":\"ynx1syntheticqa\",\"amount\":100}"
    val accepted = AtomicInteger()
    val received = AtomicInteger()
    val redirectTargets = AtomicInteger()
    val entered = CountDownLatch(1)
    val finished = CountDownLatch(1)
    @Volatile var status = 201
    @Volatile var bytes = "{}".toByteArray()
    @Volatile var chunked = false
    @Volatile var disconnect = false
    @Volatile var headers: List<String> = emptyList()
    @Volatile var release: CountDownLatch? = null
    @Volatile var lastBody: String? = null
    @Volatile var acceptEncoding: String? = null
    private val sockets = Collections.synchronizedSet(mutableSetOf<Socket>())
    private val pool = Executors.newCachedThreadPool()
    private val server = ServerSocket().apply { bind(InetSocketAddress("127.0.0.1", 0)) }
    private val endpoint = "http://127.0.0.1:${server.localPort}/request"
    val engine = BoundedHttpEngine(endpoint, endpoint, SystemClock::elapsedRealtimeNanos,
      TimeUnit.MILLISECONDS.toNanos(deadlineMillis))

    init {
      check(server.inetAddress.hostAddress == "127.0.0.1")
      pool.execute {
        while (!server.isClosed) {
          val socket = try { server.accept() } catch (_: Exception) { break }
          accepted.incrementAndGet(); sockets.add(socket)
          pool.execute {
            socket.use {
              try {
                socket.soTimeout = 5000
                val source = socket.getInputStream()
                val path = line(source).split(' ')[1]
                val fields = mutableMapOf<String, String>()
                while (true) {
                  val row = line(source); if (row.isEmpty()) break
                  fields[row.substringBefore(':').lowercase()] = row.substringAfter(':').trim()
                }
                val size = fields["content-length"]!!.toInt(); check(size in 1..1024)
                val input = ByteArray(size)
                var offset = 0
                while (offset < size) {
                  val count = source.read(input, offset, size - offset); check(count > 0); offset += count
                }
                if (path == "/target") redirectTargets.incrementAndGet() else received.incrementAndGet()
                lastBody = input.toString(Charsets.UTF_8); acceptEncoding = fields["accept-encoding"]
                entered.countDown(); release?.await(5, TimeUnit.SECONDS)
                if (!disconnect) {
                  val responseHeaders = buildString {
                    append("HTTP/1.1 $status QA\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n")
                    if (status in 300..399) append("Location: /target\r\n")
                    headers.forEach { append("$it\r\n") }
                    append(if (chunked) "Transfer-Encoding: chunked\r\n" else "Content-Length: ${bytes.size}\r\n")
                    append("\r\n")
                  }
                  val output = socket.getOutputStream(); output.write(responseHeaders.toByteArray())
                  if (chunked) output.write("${bytes.size.toString(16)}\r\n".toByteArray())
                  output.write(bytes)
                  if (chunked) output.write("\r\n0\r\n\r\n".toByteArray())
                  output.flush()
                }
              } catch (_: Exception) { /* Cancellation intentionally closes this socket. */ }
              finally { sockets.remove(socket); finished.countDown() }
            }
          }
        }
      }
    }
    fun input(id: String = engine.reserve("admit")): Map<String, Any?> = mapOf(
      "purpose" to "admit", "taskId" to id, "requestId" to requestId, "body" to body)
    fun submit(input: Map<String, Any?> = input()): Pair<HttpReply?, HttpFailure?> {
      val done = CompletableFuture<Pair<HttpReply?, HttpFailure?>>()
      engine.request(input) { r, e -> done.complete(r to e) }
      return done.get(5, TimeUnit.SECONDS)
    }
    // Wait for actual OkHttp callbacks to retire before counting late results.
    // Reflection is test-only observation, never production injection.
    fun awaitNetworkIdle() {
      val field = BoundedHttpEngine::class.java.getDeclaredField("client").apply { isAccessible = true }
      val client = field.get(engine) as okhttp3.OkHttpClient
      val until = SystemClock.elapsedRealtime() + 3000
      while (client.dispatcher.runningCallsCount() != 0 && SystemClock.elapsedRealtime() < until) {
        Thread.sleep(10)
      }
      check(client.dispatcher.runningCallsCount() == 0)
      check(client.dispatcher.queuedCallsCount() == 0)
    }
    fun facts(): JSONObject = JSONObject().put("acceptedSockets", accepted.get())
      .put("originalPosts", received.get()).put("redirectPosts", redirectTargets.get())
    override fun close() {
      release?.countDown(); engine.close(); server.close()
      synchronized(sockets) { sockets.forEach { it.close() }; sockets.clear() }
      pool.shutdownNow(); pool.awaitTermination(3, TimeUnit.SECONDS)
    }
    private fun line(input: InputStream): String {
      val out = StringBuilder()
      while (out.length < 4096) {
        val byte = input.read(); check(byte >= 0)
        if (byte == 10) return out.toString().removeSuffix("\r")
        out.append(byte.toChar())
      }
      error("Oversized test request header")
    }
  }
}
