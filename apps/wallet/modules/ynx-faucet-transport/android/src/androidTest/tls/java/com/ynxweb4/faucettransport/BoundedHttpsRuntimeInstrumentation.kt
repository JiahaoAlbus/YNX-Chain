package com.ynxweb4.faucettransport

import android.app.Activity
import android.app.Instrumentation
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.security.NetworkSecurityPolicy
import com.ynxweb4.faucettransport.tlsruntimeqa.R
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateExpiredException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Collections
import java.util.Date
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket
import org.json.JSONArray
import org.json.JSONObject

/** TLS-only Android ART tests. No instrumentation URL/mode input, production
 * bridge, real account, system CA installation or custom client trust hook. */
class BoundedHttpsRuntimeInstrumentation : Instrumentation() {
  private val results = JSONArray()
  private var failures = 0
  private var started = 0L
  private val expectedCases = 7

  override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

  override fun onStart() {
    started = SystemClock.elapsedRealtime()
    if (!case("public-fixtures-validity-SAN-and-test-app-policy") {
        equal("com.ynxweb4.faucettransport.tlsruntimeqa", targetContext.packageName)
        check(!NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted("127.0.0.1"))
        val trusted = certificate(R.raw.qa_tls_trusted_ca)
        val other = certificate(R.raw.qa_tls_untrusted_ca)
        val valid = certificate(R.raw.qa_tls_valid)
        val wrong = certificate(R.raw.qa_tls_wrong_host)
        val expired = certificate(R.raw.qa_tls_expired)
        val untrusted = certificate(R.raw.qa_tls_untrusted)
        val now = Date()
        trusted.checkValidity(now); other.checkValidity(now)
        valid.checkValidity(now); wrong.checkValidity(now); untrusted.checkValidity(now)
        check(trusted.basicConstraints >= 0 && other.basicConstraints >= 0)
        trusted.verify(trusted.publicKey); other.verify(other.publicKey)
        listOf(valid, wrong, expired).forEach { it.verify(trusted.publicKey); check(it.basicConstraints == -1) }
        untrusted.verify(other.publicKey)
        check(!trusted.encoded.contentEquals(other.encoded))
        equal(listOf("127.0.0.1"), ipSans(valid))
        equal(listOf("127.0.0.2"), ipSans(wrong))
        equal(listOf("127.0.0.1"), ipSans(expired))
        equal(listOf("127.0.0.1"), ipSans(untrusted))
        try { expired.checkValidity(now); error("Expired certificate unexpectedly valid") }
        catch (_: CertificateExpiredException) { /* Required precondition, not client validation proof. */ }
        JSONObject().put("deviceTimeMillis", now.time).put("sdk", Build.VERSION.SDK_INT)
          .put("certificates", JSONArray(listOf(trusted, other, valid, wrong, expired, untrusted).map {
            JSONObject().put("subject", it.subjectX500Principal.name)
              .put("notBefore", it.notBefore.time).put("notAfter", it.notAfter.time)
              .put("ipSAN", JSONArray(ipSans(it))).put("derSha256", sha256(it.encoded))
          }))
      }) { finishReport(); return }

    case("trusted-local-CA-and-matching-IP-SAN-deliver-exact-original-POST") {
      TlsFixture(Leaf.VALID).use { f ->
        val reply = f.submit().first ?: error("Expected trusted TLS HTTP response")
        equal(201, reply.status); equal("{\"qa\":\"tls\"}", reply.body)
        equal(f.endpoint, reply.url); equal(false, reply.fields()["redirected"])
        f.awaitNetworkAndServer()
        equal(1, f.accepted.get()); equal(1, f.handshakes.get()); equal(1, f.posts.get())
        equal(f.body, f.lastBody); equal("POST /request HTTP/1.1", f.requestLine)
        check(f.applicationBytes.get() > f.body.toByteArray().size)
        f.facts()
      }
    }
    for ((name, leaf) in listOf(
      "untrusted-CA-rejected-before-HTTP-bytes" to Leaf.UNTRUSTED,
      "wrong-IP-SAN-rejected-before-HTTP-bytes" to Leaf.WRONG_HOST,
      "expired-leaf-rejected-before-HTTP-bytes" to Leaf.EXPIRED,
    )) {
      case(name) {
        TlsFixture(leaf).use { f ->
          val (reply, error) = f.submit()
          check(reply == null); equal("YNX_HTTP_NETWORK", error?.code)
          f.awaitNetworkAndServer()
          equal(1, f.accepted.get())
          equal(0, f.applicationBytes.get()); equal(0, f.posts.get())
          f.facts().put("engineError", error!!.code)
        }
      }
    }
    case("HTTPS-307-never-follows-relative-TLS-target") {
      TlsFixture(Leaf.VALID, redirect = Redirect.SAME_TLS).use { f ->
        equal("YNX_HTTP_REDIRECT", f.submit().second?.code)
        f.awaitNetworkAndServer()
        equal(1, f.accepted.get()); equal(1, f.posts.get()); equal(0, f.targetPosts.get())
        f.facts()
      }
    }
    case("HTTPS-307-never-downgrades-to-plain-loopback-target") {
      PlainConnectionProbe().use { target ->
        TlsFixture(Leaf.VALID, redirect = Redirect.PLAIN, plainPort = target.port).use { f ->
          equal("YNX_HTTP_REDIRECT", f.submit().second?.code)
          f.awaitNetworkAndServer()
          equal(1, f.accepted.get()); equal(1, f.posts.get()); equal(0, target.accepted.get())
          f.facts().put("plainTargetAcceptedSockets", target.accepted.get())
        }
      }
    }
    finishReport()
  }

  private fun certificate(resource: Int): X509Certificate = targetContext.resources.openRawResource(resource).use {
    CertificateFactory.getInstance("X.509").generateCertificate(it) as X509Certificate
  }
  private fun ipSans(certificate: X509Certificate): List<String> =
    certificate.subjectAlternativeNames?.filter { it[0] == 7 }?.map { it[1].toString() } ?: emptyList()

  private enum class Leaf(val resource: Int, val ca: Int) {
    VALID(R.raw.qa_tls_valid, R.raw.qa_tls_trusted_ca),
    UNTRUSTED(R.raw.qa_tls_untrusted, R.raw.qa_tls_untrusted_ca),
    WRONG_HOST(R.raw.qa_tls_wrong_host, R.raw.qa_tls_trusted_ca),
    EXPIRED(R.raw.qa_tls_expired, R.raw.qa_tls_trusted_ca),
  }
  private enum class Redirect { NONE, SAME_TLS, PLAIN }

  private inner class TlsFixture(leaf: Leaf, redirect: Redirect = Redirect.NONE, plainPort: Int = 0) : AutoCloseable {
    val accepted = AtomicInteger()
    val handshakes = AtomicInteger()
    val applicationBytes = AtomicInteger()
    val posts = AtomicInteger()
    val targetPosts = AtomicInteger()
    private val finished = CountDownLatch(1)
    private val sockets = Collections.synchronizedSet(mutableSetOf<Socket>())
    private val pool = Executors.newCachedThreadPool()
    private val server: SSLServerSocket
    val endpoint: String
    private val engine: BoundedHttpEngine
    @Volatile var lastBody: String? = null
    @Volatile var requestLine: String? = null
    @Volatile private var protocol: String? = null
    @Volatile private var cipherSuite: String? = null
    @Volatile private var terminalServerError: String? = null
    private val requestId = "tls_qa_0123456789abcdef0123456789abcdef"
    val body = "{\"requestId\":\"$requestId\",\"address\":\"ynx1synthetictlsqa\",\"amount\":100}"

    init {
      // SSLContext is SERVER-ONLY. It is never installed as a JVM default or
      // supplied to the production engine/client. No trust manager override.
      val keyBytes = targetContext.resources.openRawResource(R.raw.qa_tls_server_key).use { it.readBytes() }
      val key = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(keyBytes))
      val store = KeyStore.getInstance("PKCS12").apply {
        load(null, null)
        setKeyEntry("public-synthetic-server", key, CharArray(0),
          arrayOf(certificate(leaf.resource), certificate(leaf.ca)))
      }
      val keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
        init(store, CharArray(0))
      }
      val serverContext = SSLContext.getInstance("TLS").apply { init(keys.keyManagers, null, null) }
      server = (serverContext.serverSocketFactory.createServerSocket() as SSLServerSocket).apply {
        needClientAuth = false
        bind(InetSocketAddress("127.0.0.1", 0))
      }
      check(server.inetAddress.hostAddress == "127.0.0.1")
      endpoint = "https://127.0.0.1:${server.localPort}/request"
      engine = BoundedHttpEngine(endpoint, endpoint, SystemClock::elapsedRealtimeNanos)
      pool.execute {
        while (!server.isClosed) {
          val socket = try { server.accept() as SSLSocket } catch (_: Exception) { break }
          accepted.incrementAndGet(); sockets.add(socket)
          pool.execute {
            socket.use {
              try {
                socket.soTimeout = 3000
                socket.startHandshake()
                handshakes.incrementAndGet()
                protocol = socket.session.protocol; cipherSuite = socket.session.cipherSuite
                val input = socket.getInputStream()
                val first = line(input); requestLine = first
                check(first.startsWith("POST "))
                val headers = mutableMapOf<String, String>()
                while (true) {
                  val row = line(input); if (row.isEmpty()) break
                  headers[row.substringBefore(':').lowercase()] = row.substringAfter(':').trim()
                }
                val size = headers["content-length"]!!.toInt(); check(size in 1..1024)
                val raw = ByteArray(size)
                var offset = 0
                while (offset < raw.size) {
                  val n = input.read(raw, offset, raw.size - offset); check(n > 0)
                  applicationBytes.addAndGet(n); offset += n
                }
                lastBody = raw.toString(Charsets.UTF_8)
                if (first.split(' ')[1] == "/target") targetPosts.incrementAndGet() else posts.incrementAndGet()
                equal("identity", headers["accept-encoding"])
                val response = "{\"qa\":\"tls\"}".toByteArray()
                val head = buildString {
                  append("HTTP/1.1 ${if (redirect == Redirect.NONE) 201 else 307} QA\r\n")
                  append("Content-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\n")
                  when (redirect) {
                    Redirect.SAME_TLS -> append("Location: /target\r\n")
                    Redirect.PLAIN -> append("Location: http://127.0.0.1:$plainPort/target\r\n")
                    Redirect.NONE -> Unit
                  }
                  append("Content-Length: ${response.size}\r\n\r\n")
                }
                socket.getOutputStream().apply { write(head.toByteArray()); write(response); flush() }
              } catch (e: Exception) {
                // TLS failures and peer EOF are expected negative observations.
                // Tests require client failure AND no decrypted HTTP bytes.
                terminalServerError = e.javaClass.name
              } finally { sockets.remove(socket); finished.countDown() }
            }
          }
        }
      }
    }
    fun submit(): Pair<HttpReply?, HttpFailure?> {
      val done = CompletableFuture<Pair<HttpReply?, HttpFailure?>>()
      engine.request(mapOf("purpose" to "admit", "taskId" to engine.reserve("admit"),
        "requestId" to requestId, "body" to body)) { r, e -> done.complete(r to e) }
      return done.get(10, TimeUnit.SECONDS)
    }
    fun awaitNetworkAndServer() {
      check(finished.await(5, TimeUnit.SECONDS)) { "Loopback TLS server did not terminate" }
      // Read-only test observation; never replaces the client's trust objects.
      val field = BoundedHttpEngine::class.java.getDeclaredField("client").apply { isAccessible = true }
      val client = field.get(engine) as okhttp3.OkHttpClient
      val until = SystemClock.elapsedRealtime() + 3000
      while (client.dispatcher.runningCallsCount() != 0 && SystemClock.elapsedRealtime() < until) Thread.sleep(10)
      equal(0, client.dispatcher.runningCallsCount()); equal(0, client.dispatcher.queuedCallsCount())
    }
    private fun line(input: InputStream): String {
      val out = StringBuilder()
      while (out.length < 4096) {
        val value = input.read(); check(value >= 0) { "TLS peer closed before a complete HTTP line" }
        applicationBytes.incrementAndGet()
        if (value == 10) return out.toString().removeSuffix("\r")
        out.append(value.toChar())
      }
      error("Oversized synthetic request header")
    }
    fun facts(): JSONObject = JSONObject().put("acceptedTlsSockets", accepted.get())
      .put("serverCompletedHandshakes", handshakes.get()).put("decryptedHttpBytes", applicationBytes.get())
      .put("originalPosts", posts.get()).put("redirectTargetPosts", targetPosts.get())
      .put("protocol", protocol ?: JSONObject.NULL).put("cipherSuite", cipherSuite ?: JSONObject.NULL)
      .put("serverTerminalErrorClass", terminalServerError ?: JSONObject.NULL)
    override fun close() {
      engine.close(); server.close()
      synchronized(sockets) { sockets.forEach { it.close() }; sockets.clear() }
      pool.shutdownNow(); pool.awaitTermination(3, TimeUnit.SECONDS)
    }
  }

  private class PlainConnectionProbe : AutoCloseable {
    val accepted = AtomicInteger()
    private val server = ServerSocket().apply { bind(InetSocketAddress("127.0.0.1", 0)) }
    val port: Int get() = server.localPort
    private val thread = Thread {
      while (!server.isClosed) {
        val socket = try { server.accept() } catch (_: Exception) { break }
        accepted.incrementAndGet(); socket.close()
      }
    }.apply { name = "ynx-tls-qa-plain-target"; isDaemon = true; start() }
    override fun close() { server.close(); thread.join(3000); check(!thread.isAlive) }
  }

  private fun equal(expected: Any?, actual: Any?) { check(expected == actual) { "Expected $expected; got $actual" } }
  private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes)
    .joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun case(name: String, run: () -> JSONObject): Boolean {
    val item = JSONObject().put("name", name)
    val before = SystemClock.elapsedRealtime()
    var passed = false
    try { item.put("facts", run()).put("passed", true); passed = true }
    catch (e: Throwable) { failures++; item.put("passed", false).put("error", e.stackTraceToString()) }
    item.put("elapsedMillis", SystemClock.elapsedRealtime() - before); results.put(item)
    sendStatus(0, Bundle().apply { putString("case", item.toString()) })
    return passed
  }
  private fun finishReport() {
    val report = JSONObject().put("schema", "ynx-android-faucet-tls-runtime-qa-v1")
      .put("package", targetContext.packageName).put("sdk", Build.VERSION.SDK_INT)
      .put("abi", Build.SUPPORTED_ABIS.first()).put("fingerprint", Build.FINGERPRINT)
      .put("expectedCases", expectedCases).put("cases", results)
      .put("passed", results.length() - failures).put("failed", failures)
      .put("suiteComplete", results.length() == expectedCases)
      .put("elapsedMillis", SystemClock.elapsedRealtime() - started)
      .put("productionAdapterIncluded", false).put("publicRequests", 0)
      .put("systemCertificateStoreModified", false).put("clientTrustOverrideInjected", false)
      .put("expoLifecycleDeliveryTested", false).put("oldHttpSuiteRun", false)
    targetContext.filesDir.resolve("tls-runtime-result.json").writeText(report.toString(2))
    finish(if (failures == 0 && results.length() == expectedCases) Activity.RESULT_OK else Activity.RESULT_CANCELED,
      Bundle().apply { putString("ynxTlsResult", report.toString()) })
  }
}
