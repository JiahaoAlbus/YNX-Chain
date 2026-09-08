package com.ynxweb4.faucettransport

import java.io.IOException
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.util.UUID
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink

internal class HttpFailure(val code: String) : Exception("Faucet network operation could not be completed.")

internal data class HttpReply(
  val url: String, val status: Int, val contentType: String, val cacheControl: String, val body: String
) {
  fun fields(): Map<String, Any> = mapOf(
    "url" to url, "redirected" to false, "status" to status,
    "contentType" to contentType, "cacheControl" to cacheControl, "body" to body
  )
}

/** The Expo adapter supplies only compiled HTTPS endpoints. Constructor injection
 * is package-internal for native tests; no Expo function accepts URLs or a client. */
internal class BoundedHttpEngine(
  private val admitURL: String,
  private val rpcURL: String,
  private val now: () -> Long = System::nanoTime,
  private val deadlineNanos: Long = TimeUnit.SECONDS.toNanos(15),
) : AutoCloseable {
  private class Entry(val purpose: String, val deadline: Long) {
    var started = false
    var call: Call? = null
    var timeout: ScheduledFuture<*>? = null
    var completion: ((HttpReply?, HttpFailure?) -> Unit)? = null
  }

  private val monitor = Any()
  private val prefix = UUID.randomUUID().toString()
  private var sequence = 0L
  private var closed = false
  private var paused = false
  private val entries = mutableMapOf<String, Entry>()
  private val timer = ScheduledThreadPoolExecutor(1) { action ->
    Thread(action, "ynx-faucet-deadline").apply { isDaemon = true }
  }.apply { removeOnCancelPolicy = true }
  private val client = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .cookieJar(CookieJar.NO_COOKIES).cache(null)
    .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
    .connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
    .writeTimeout(5, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS).build()

  fun reserve(purpose: String): String = synchronized(monitor) {
    if (purpose != "admit" && purpose != "rpc") fail("YNX_HTTP_INVALID_INPUT")
    if (closed) fail("YNX_HTTP_UNAVAILABLE")
    if (paused) fail("YNX_HTTP_CANCELLED")
    if (entries.size >= 8 || sequence == Long.MAX_VALUE) fail("YNX_HTTP_CAPACITY")
    val id = "$prefix-${++sequence}"
    val entry = Entry(purpose, now() + deadlineNanos)
    entries[id] = entry
    entry.timeout = timer.schedule({ finish(id, entry, null, HttpFailure("YNX_HTTP_TIMEOUT")) },
      deadlineNanos, TimeUnit.NANOSECONDS)
    id
  }

  /** A reservation exists before this async entry point, so cancel-before-start
   * cannot be lost. A closed/unknown id is never recreated. */
  fun request(input: Map<String, Any?>, completion: (HttpReply?, HttpFailure?) -> Unit) {
    var claimed: Pair<String, Entry>? = null
    try {
      synchronized(monitor) {
        val id = input["taskId"] as? String ?: fail("YNX_HTTP_INVALID_INPUT")
        if (id.length > 96) fail("YNX_HTTP_INVALID_INPUT")
        val entry = entries[id] ?: fail("YNX_HTTP_TASK_INVALID")
        if (entry.started) fail("YNX_HTTP_TASK_INVALID")
        entry.started = true
        entry.completion = completion
        claimed = id to entry
        if (closed || paused) fail("YNX_HTTP_CANCELLED")
        if (now() >= entry.deadline) fail("YNX_HTTP_TIMEOUT")
        if (input["purpose"] != entry.purpose) fail("YNX_HTTP_INVALID_INPUT")
        val bytes = encodeRequest(input, entry.purpose)
        val url = if (entry.purpose == "admit") admitURL else rpcURL
        val body = object : RequestBody() {
          private val written = AtomicBoolean(false)
          override fun contentType() = "application/json; charset=utf-8".toMediaType()
          override fun contentLength() = bytes.size.toLong()
          override fun isOneShot() = true
          override fun writeTo(sink: BufferedSink) {
            if (!written.compareAndSet(false, true)) throw IOException("Request body cannot be replayed.")
            sink.write(bytes)
          }
        }
        val request = Request.Builder().url(url).header("Accept", "application/json")
          .header("Accept-Encoding", "identity").post(body).build()
        val call = client.newCall(request)
        entry.call = call
        // enqueue only schedules network work; the check+enqueue boundary is
        // atomic against cancellation. No response/body I/O holds the monitor.
        call.enqueue(object : Callback {
          override fun onFailure(call: Call, error: IOException) {
            finish(id, entry, null, HttpFailure("YNX_HTTP_NETWORK"))
          }
          override fun onResponse(call: Call, response: Response) {
            try {
              response.use { finish(id, entry, readReply(id, entry, it, url), null) }
            } catch (failure: Exception) {
              call.cancel()
              finish(id, entry, null, failure as? HttpFailure ?: HttpFailure("YNX_HTTP_NETWORK"))
            }
          }
        })
      }
    } catch (failure: Exception) {
      val error = failure as? HttpFailure ?: HttpFailure("YNX_HTTP_INVALID_INPUT")
      val own = claimed
      if (own != null) finish(own.first, own.second, null, error) else completion(null, error)
    }
  }

  fun cancel(id: String) {
    val entry = synchronized(monitor) { entries[id] } ?: return
    finish(id, entry, null, HttpFailure("YNX_HTTP_CANCELLED"))
  }

  fun cancelAll() {
    val pending = synchronized(monitor) { entries.toMap() }
    pending.forEach { (id, entry) -> finish(id, entry, null, HttpFailure("YNX_HTTP_CANCELLED")) }
  }

  fun pause() {
    synchronized(monitor) { paused = true }
    cancelAll()
  }

  fun resume() { synchronized(monitor) { if (!closed) paused = false } }

  private fun active(id: String, entry: Entry) = synchronized(monitor) {
    if (entries[id] !== entry) fail("YNX_HTTP_CANCELLED")
    if (now() >= entry.deadline) fail("YNX_HTTP_TIMEOUT")
  }

  private fun finish(id: String, entry: Entry, reply: HttpReply?, failure: HttpFailure?) {
    var result = reply
    var error = failure
    val completion = synchronized(monitor) {
      if (entries[id] !== entry) return
      if (now() >= entry.deadline) { result = null; error = HttpFailure("YNX_HTTP_TIMEOUT") }
      entries.remove(id)
      entry.timeout?.cancel(false)
      // Mark terminal before cancel. A late callback cannot settle this entry twice.
      if (error != null) entry.call?.cancel()
      entry.completion.also { entry.completion = null; entry.call = null }
    }
    completion?.invoke(result, error)
  }

  private fun readReply(id: String, entry: Entry, response: Response, url: String): HttpReply {
    active(id, entry)
    if (response.code in 300..399 || response.priorResponse != null) fail("YNX_HTTP_REDIRECT")
    if (response.request.url.toString() != url) fail("YNX_HTTP_METADATA")
    fun header(name: String, required: Boolean = false): String {
      val values = response.headers.values(name)
      if (values.size > 1 || required && values.size != 1) fail("YNX_HTTP_METADATA")
      val value = values.singleOrNull() ?: ""
      if (value.length > 256) fail("YNX_HTTP_METADATA")
      return value
    }
    val contentType = header("Content-Type", true)
    if (!JSON_TYPE.matches(contentType)) fail("YNX_HTTP_METADATA")
    val encoding = header("Content-Encoding")
    if (encoding.isNotEmpty() && !encoding.equals("identity", ignoreCase = true)) fail("YNX_HTTP_ENCODING")
    val cacheControl = header("Cache-Control")
    if (entry.purpose == "admit" && cacheControl != "no-store") fail("YNX_HTTP_METADATA")
    val transferEncoding = header("Transfer-Encoding")
    if (transferEncoding.isNotEmpty() && !transferEncoding.equals("chunked", ignoreCase = true)) fail("YNX_HTTP_METADATA")
    val length = header("Content-Length")
    if (length.isNotEmpty()) {
      if (!DECIMAL.matches(length)) fail("YNX_HTTP_METADATA")
      val declared = length.toLongOrNull() ?: fail("YNX_HTTP_RESPONSE_TOO_LARGE")
      if (declared > RESPONSE_CAP) fail("YNX_HTTP_RESPONSE_TOO_LARGE")
      if (transferEncoding.isNotEmpty()) fail("YNX_HTTP_METADATA")
    }
    val body = response.body ?: fail("YNX_HTTP_METADATA")
    val buffer = ByteArray(RESPONSE_CAP)
    var count = 0
    body.byteStream().use { stream ->
      while (count < buffer.size) {
        active(id, entry)
        val received = stream.read(buffer, count, buffer.size - count)
        if (received < 0) break
        count += received
      }
      active(id, entry)
      if (count == buffer.size && stream.read() != -1) fail("YNX_HTTP_RESPONSE_TOO_LARGE")
    }
    active(id, entry)
    val text = try {
      Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(buffer, 0, count)).toString()
    } catch (_: Exception) { fail("YNX_HTTP_ENCODING") }
    return HttpReply(response.request.url.toString(), response.code, contentType, cacheControl, text)
  }

  override fun close() {
    synchronized(monitor) { closed = true }
    cancelAll()
    timer.shutdownNow()
    client.dispatcher.executorService.shutdownNow()
    client.connectionPool.evictAll()
  }

  companion object {
    private const val RESPONSE_CAP = 16384
    private val JSON_TYPE = Regex("application/json(?:;\\s*charset=utf-8)?", RegexOption.IGNORE_CASE)
    private val DECIMAL = Regex("[0-9]{1,20}")
    private val ID = Regex("[A-Za-z0-9_-]{1,96}")
    private val HASH = Regex("0x[0-9a-f]{64}")
    private val ADMISSION = Regex("\\{\"requestId\":\"([A-Za-z0-9_-]{32,128})\",\"address\":\"(ynx1[0-9a-z]{1,86})\",\"amount\":([1-9][0-9]{0,15})\\}")
    private val EMPTY_METHODS = setOf("eth_chainId", "ynx_getFaucetModel", "ynx_getDurabilityModel")
    private val HASH_METHODS = setOf("ynx_getTransactionDurability", "eth_getTransactionReceipt")
    private fun fail(code: String): Nothing = throw HttpFailure(code)

    private fun encodeRequest(input: Map<String, Any?>, purpose: String): ByteArray {
      val body = if (purpose == "admit") {
        if (input.keys != setOf("purpose", "taskId", "requestId", "body")) fail("YNX_HTTP_INVALID_INPUT")
        val body = input["body"] as? String ?: fail("YNX_HTTP_INVALID_INPUT")
        if (body.length > 1024) fail("YNX_HTTP_INVALID_INPUT")
        val match = ADMISSION.matchEntire(body) ?: fail("YNX_HTTP_INVALID_INPUT")
        if (match.groupValues[1] != input["requestId"] ||
          (match.groupValues[3].toLongOrNull() ?: Long.MAX_VALUE) > 9007199254740991L) fail("YNX_HTTP_INVALID_INPUT")
        body
      } else {
        if (input.keys != setOf("purpose", "taskId", "rpcId", "method", "params")) fail("YNX_HTTP_INVALID_INPUT")
        val rpcId = input["rpcId"] as? String ?: fail("YNX_HTTP_INVALID_INPUT")
        val method = input["method"] as? String ?: fail("YNX_HTTP_INVALID_INPUT")
        val params = input["params"] as? List<*> ?: fail("YNX_HTTP_INVALID_INPUT")
        if (!ID.matches(rpcId)) fail("YNX_HTTP_INVALID_INPUT")
        val tuple = when {
          method in EMPTY_METHODS && params.isEmpty() -> "[]"
          method in HASH_METHODS && params.size == 1 && params[0] is String && HASH.matches(params[0] as String) -> "[\"${params[0]}\"]"
          else -> fail("YNX_HTTP_INVALID_INPUT")
        }
        "{\"jsonrpc\":\"2.0\",\"id\":\"$rpcId\",\"method\":\"$method\",\"params\":$tuple}"
      }
      val encoded = try {
        Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(body))
      } catch (_: Exception) { fail("YNX_HTTP_INVALID_INPUT") }
      if (encoded.remaining() > 1024) fail("YNX_HTTP_INVALID_INPUT")
      return ByteArray(encoded.remaining()).also { encoded.get(it) }
    }
  }
}
