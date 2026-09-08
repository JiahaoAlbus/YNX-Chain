package com.ynxweb4.faucettransport

import java.io.InputStream
import java.net.ServerSocket
import java.net.InetSocketAddress
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class BoundedHttpEngineTest {
  private lateinit var server: ServerSocket
  private lateinit var engine: BoundedHttpEngine
  private val received = AtomicInteger()
  private val targets = AtomicInteger()
  private val pool = Executors.newCachedThreadPool()
  private var status = 201
  private var bytes = "{}".toByteArray()
  private var chunked = false
  private var contentType = "application/json"
  private var encoding: String? = null
  private var retryAfter: String? = null
  private var transferEncoding: String? = null
  private var extraHeaders: List<String> = emptyList()
  private var delay: CountDownLatch? = null
  private var entered = CountDownLatch(1)
  private var responseFinished = CountDownLatch(1)
  private var echo: String? = null
  private var acceptEncoding: String? = null
  private val requestId = "req_0123456789abcdef0123456789abcdef"
  private val body = "{\"requestId\":\"$requestId\",\"address\":\"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80\",\"amount\":100}"

  @Before fun setup() {
    // Raw loopback sockets use only java.base, also available in the Android
    // unit-test compile API. No Android network mock or public server is used.
    server = ServerSocket().apply { bind(InetSocketAddress("127.0.0.1", 0)) }
    pool.execute {
      while (!server.isClosed) {
        val socket = try { server.accept() } catch (_: Exception) { break }
        pool.execute {
          socket.use {
            try {
              socket.soTimeout = 3000
              val source = socket.getInputStream()
              val path = line(source).split(' ')[1]
              val headers = mutableMapOf<String, String>()
              while (true) {
                val row = line(source); if (row.isEmpty()) break
                headers[row.substringBefore(':').lowercase()] = row.substringAfter(':').trim()
              }
              val request = ByteArray(headers["content-length"]!!.toInt())
              var offset = 0
              while (offset < request.size) {
                val count = source.read(request, offset, request.size - offset)
                check(count > 0); offset += count
              }
              if (path == "/target") targets.incrementAndGet() else received.incrementAndGet()
              echo = request.toString(Charsets.UTF_8); acceptEncoding = headers["accept-encoding"]
              entered.countDown(); delay?.await(3, TimeUnit.SECONDS)
              val header = buildString {
                append("HTTP/1.1 $status QA\r\nConnection: close\r\nContent-Type: $contentType\r\nCache-Control: no-store\r\n")
                encoding?.let { append("Content-Encoding: $it\r\n") }
                retryAfter?.let { append("Retry-After: $it\r\n") }
                extraHeaders.forEach { append("$it\r\n") }
                if (status in 300..399) append("Location: /target\r\n")
                append(transferEncoding?.let { "Transfer-Encoding: $it\r\n" }
                  ?: if (chunked) "Transfer-Encoding: chunked\r\n" else "Content-Length: ${bytes.size}\r\n")
                append("\r\n")
              }
              val output = socket.getOutputStream(); output.write(header.toByteArray())
              if (chunked) output.write("${bytes.size.toString(16)}\r\n".toByteArray())
              output.write(bytes)
              if (chunked) output.write("\r\n0\r\n\r\n".toByteArray())
              output.flush()
            } catch (_: Exception) { /* Cancellation deliberately closes the socket. */ }
            finally { responseFinished.countDown() }
          }
        }
      }
    }
    val endpoint = "http://127.0.0.1:${server.localPort}/request"
    engine = BoundedHttpEngine(endpoint, endpoint)
  }

  private fun line(source: InputStream): String {
    val line = StringBuilder()
    while (line.length < 4096) {
      val next = source.read(); check(next >= 0)
      if (next == 10) return line.toString().removeSuffix("\r")
      line.append(next.toChar())
    }
    error("Oversized QA request header")
  }

  @After fun cleanup() { delay?.countDown(); engine.close(); server.close(); pool.shutdownNow() }

  private fun input(id: String = engine.reserve("admit")) = mapOf<String, Any?>(
    "purpose" to "admit", "taskId" to id, "requestId" to requestId, "body" to body)
  private fun submit(value: Map<String, Any?>): Pair<HttpReply?, HttpFailure?> {
    val result = CompletableFuture<Pair<HttpReply?, HttpFailure?>>()
    engine.request(value) { reply, error -> result.complete(reply to error) }
    return result.get(4, TimeUnit.SECONDS)
  }
  private fun code(value: Map<String, Any?>) = submit(value).second?.code

  @Test fun `accepted and error HTTP facts preserve exact status body and original bytes`() {
    for (code in listOf(201, 200, 409, 429, 503)) {
      status = code
      val (reply, error) = submit(input())
      assertNull(error); assertEquals(code, reply!!.status); assertEquals("{}", reply.body)
      assertEquals(body, echo); assertEquals("identity", acceptEncoding)
      assertEquals(false, reply.fields()["redirected"])
    }
    assertEquals(5, received.get())
  }

  @Test fun `503 retry-after zero never resends the one-shot body`() {
    status = 503; retryAfter = "0"
    assertEquals(503, submit(input()).first!!.status)
    assertEquals(1, received.get())
  }

  @Test fun `redirect has no second target dispatch`() {
    status = 307
    assertEquals("YNX_HTTP_REDIRECT", code(input()))
    assertEquals(1, received.get()); assertEquals(0, targets.get())
  }

  @Test fun `native byte budget accepts 16384 and rejects 16385 without content length`() {
    chunked = true; bytes = ByteArray(16384) { 32 }
    assertEquals(16384, submit(input()).first!!.body.length)
    bytes = ByteArray(16385) { 32 }
    assertEquals("YNX_HTTP_RESPONSE_TOO_LARGE", code(input()))
  }

  @Test fun `declared oversized compressed and malformed UTF8 responses fail closed`() {
    bytes = ByteArray(20000)
    assertEquals("YNX_HTTP_RESPONSE_TOO_LARGE", code(input()))
    bytes = byteArrayOf(1); encoding = "gzip"
    assertEquals("YNX_HTTP_ENCODING", code(input()))
    encoding = null; bytes = byteArrayOf(0xc3.toByte(), 0x28)
    assertEquals("YNX_HTTP_ENCODING", code(input()))
    contentType = "text/html"; bytes = "{}".toByteArray()
    assertEquals("YNX_HTTP_METADATA", code(input()))
  }

  @Test fun `unknown transfer coding and duplicate relevant headers are never normalized into trusted metadata`() {
    transferEncoding = "gzip"
    assertEquals("YNX_HTTP_METADATA", code(input()))
    transferEncoding = null; chunked = true
    extraHeaders = listOf("Transfer-Encoding: chunked")
    assertEquals("YNX_HTTP_METADATA", code(input()))
    extraHeaders = listOf("Content-Type: application/json")
    assertEquals("YNX_HTTP_METADATA", code(input()))
  }

  @Test fun `cancellation before async start cannot recreate the reserved task`() {
    val id = engine.reserve("admit")
    engine.cancel(id); engine.cancel(id)
    assertEquals("YNX_HTTP_TASK_INVALID", code(input(id)))
    assertEquals(0, received.get())
  }

  @Test fun `duplicate task calls cannot replace the first completion`() {
    delay = CountDownLatch(1)
    val original = CompletableFuture<Pair<HttpReply?, HttpFailure?>>()
    val id = engine.reserve("admit")
    engine.request(input(id)) { r, e -> original.complete(r to e) }
    assertTrue(entered.await(2, TimeUnit.SECONDS))
    assertEquals("YNX_HTTP_TASK_INVALID", code(input(id)))
    delay!!.countDown()
    assertTrue(responseFinished.await(2, TimeUnit.SECONDS))
    assertNotNull(original.get(3, TimeUnit.SECONDS).first)
    assertEquals(1, received.get())
  }

  @Test fun `cancel during response wait settles once and late response is discarded`() {
    delay = CountDownLatch(1)
    val calls = AtomicInteger(); val result = CompletableFuture<String>()
    val id = engine.reserve("admit")
    engine.request(input(id)) { _, e -> calls.incrementAndGet(); result.complete(e?.code ?: "success") }
    assertTrue(entered.await(2, TimeUnit.SECONDS))
    engine.cancel(id)
    assertEquals("YNX_HTTP_CANCELLED", result.get(1, TimeUnit.SECONDS))
    delay!!.countDown()
    assertTrue(responseFinished.await(2, TimeUnit.SECONDS))
    assertEquals("YNX_HTTP_TASK_INVALID", code(input(id)))
    assertEquals(1, calls.get()); assertEquals(1, received.get())
  }

  @Test fun `pause cancels outstanding work and prevents late creation until resume`() {
    val id = engine.reserve("admit")
    engine.pause()
    assertEquals("YNX_HTTP_TASK_INVALID", code(input(id)))
    try { engine.reserve("admit"); fail("must remain paused") } catch (e: HttpFailure) { assertEquals("YNX_HTTP_CANCELLED", e.code) }
    engine.resume()
    assertNotNull(submit(input()).first)
    assertEquals(1, received.get())
  }

  @Test fun `native absolute deadline rejects a response even before scheduled timer executes`() {
    engine.close()
    val clock = AtomicLong(0)
    val endpoint = "http://127.0.0.1:${server.localPort}/request"
    engine = BoundedHttpEngine(endpoint, endpoint, now = clock::get)
    delay = CountDownLatch(1)
    val result = CompletableFuture<String>()
    engine.request(input()) { _, e -> result.complete(e?.code ?: "success") }
    assertTrue(entered.await(2, TimeUnit.SECONDS))
    clock.set(TimeUnit.SECONDS.toNanos(16)); delay!!.countDown()
    assertEquals("YNX_HTTP_TIMEOUT", result.get(3, TimeUnit.SECONDS))
    assertEquals(1, received.get())
  }

  @Test fun `reserved capacity is bounded and close prevents new tasks`() {
    val ids = List(8) { engine.reserve("admit") }
    assertEquals(8, ids.toSet().size)
    try { engine.reserve("rpc"); fail("must reject capacity") } catch (e: HttpFailure) { assertEquals("YNX_HTTP_CAPACITY", e.code) }
    engine.cancel(ids[0]); assertFalse(ids.contains(engine.reserve("rpc")))
    engine.close()
    try { engine.reserve("admit"); fail("must reject closed engine") } catch (e: HttpFailure) { assertEquals("YNX_HTTP_UNAVAILABLE", e.code) }
    assertEquals(0, received.get())
  }

  @Test fun `rapid reserve cancel cycles do not retain unbounded native timers`() {
    repeat(1000) { engine.cancel(engine.reserve("rpc")) }
    val field = BoundedHttpEngine::class.java.getDeclaredField("timer").apply { isAccessible = true }
    val executor = field.get(engine) as ScheduledThreadPoolExecutor
    assertEquals(0, executor.queue.size)
    val ids = List(8) { engine.reserve("rpc") }
    assertEquals(8, executor.queue.size)
    ids.forEach(engine::cancel)
    assertEquals(0, executor.queue.size); assertEquals(0, received.get())
  }

  @Test fun `native scheduled deadline frees all never started reservations`() {
    engine.close()
    val endpoint = "http://127.0.0.1:${server.localPort}/request"
    engine = BoundedHttpEngine(endpoint, endpoint, deadlineNanos = TimeUnit.MILLISECONDS.toNanos(40))
    val ids = List(8) { engine.reserve("rpc") }
    val expiry = System.nanoTime() + TimeUnit.SECONDS.toNanos(1)
    val field = BoundedHttpEngine::class.java.getDeclaredField("entries").apply { isAccessible = true }
    val monitor = requireNotNull(BoundedHttpEngine::class.java.getDeclaredField("monitor").apply { isAccessible = true }.get(engine))
    while (System.nanoTime() < expiry && synchronized(monitor) { (field.get(engine) as Map<*, *>).isNotEmpty() }) Thread.sleep(5)
    assertTrue(synchronized(monitor) { (field.get(engine) as Map<*, *>).isEmpty() })
    assertEquals("YNX_HTTP_TASK_INVALID", code(input(ids[0])))
    assertEquals(8, List(8) { engine.reserve("rpc") }.size)
    assertEquals(0, received.get())
  }

  @Test fun `body substitution duplicate fields unsafe amount and purpose mutation make zero requests`() {
    val bad = listOf(body.replace("100}", "9007199254740992}"), body.replace("100}", "1,\"amount\":100}"),
      body.replace(requestId, "different_0123456789abcdef0123456789"), body + " ", body.replace("100}", "1e2}"))
    for (value in bad) assertEquals("YNX_HTTP_INVALID_INPUT", code(input() + ("body" to value)))
    assertEquals("YNX_HTTP_INVALID_INPUT", code(input(engine.reserve("rpc"))))
    assertEquals("YNX_HTTP_INVALID_INPUT", code(input() + ("url" to "https://example.invalid")))
    assertEquals(0, received.get())
  }

  @Test fun `all five read-only RPC methods have exact native envelopes and reject other methods`() {
    for (method in listOf("eth_chainId", "ynx_getFaucetModel", "ynx_getDurabilityModel", "ynx_getTransactionDurability", "eth_getTransactionReceipt")) {
      val hash = "0x" + "a".repeat(64)
      val params = if (method in setOf("ynx_getTransactionDurability", "eth_getTransactionReceipt")) listOf(hash) else emptyList()
      val value = mapOf("purpose" to "rpc", "taskId" to engine.reserve("rpc"), "rpcId" to "read_1", "method" to method, "params" to params)
      assertNotNull(submit(value).first)
      val expectedParams = if (params.isEmpty()) "[]" else "[\"$hash\"]"
      assertEquals("{\"jsonrpc\":\"2.0\",\"id\":\"read_1\",\"method\":\"$method\",\"params\":$expectedParams}", echo)
    }
    val value = mapOf("purpose" to "rpc", "taskId" to engine.reserve("rpc"), "rpcId" to "read_2", "method" to "eth_sendRawTransaction", "params" to emptyList<String>())
    assertEquals("YNX_HTTP_INVALID_INPUT", code(value)); assertEquals(5, received.get())
  }
}
