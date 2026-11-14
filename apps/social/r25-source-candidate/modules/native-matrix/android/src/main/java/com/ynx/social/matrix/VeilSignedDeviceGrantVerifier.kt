package com.ynx.social.matrix

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.X509EncodedKeySpec

/**
 * Native-only, challenge-bound device admission. The issuer pin MUST come from
 * independently admitted native enrollment, not JS, SSO or this response.
 * P-256 authenticates this directory response; it does not replace libsignal's
 * message protocol or prove that a production directory has been enrolled.
 * No auto-enrollment, key creation, network call or protocol activation occurs.
 */
internal class VeilSignedDeviceGrantVerifier(
  private val binding: VeilDeviceBinding,
  issuerSpki: ByteArray,
  enrolledIssuerSha256: String,
  private val elapsedMillis: () -> Long,
) : VeilDeviceGrantVerifier {
  internal class Request internal constructor(private val encoded: ByteArray) {
    fun bytes(): ByteArray = encoded.copyOf()
  }
  private data class Pending(val issuedAt: Long, val minimum: Long)
  private val pending = LinkedHashMap<String, Pending>()
  private val random = SecureRandom()
  private var lastElapsed = -1L
  private val issuer: ECPublicKey

  init {
    require(issuerSpki.size in 1..1024)
    require(enrolledIssuerSha256.length == 64 && enrolledIssuerSha256.all { it in '0'..'9' || it in 'a'..'f' })
    val spki = issuerSpki.copyOf()
    try {
      val pin = ByteArray(32) { enrolledIssuerSha256.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
      require(MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(spki), pin)) {
        "VEIL_ENROLLED_ISSUER_MISMATCH"
      }
      val parsed = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))
      require(parsed is ECPublicKey && parsed.encoded.contentEquals(spki)) { "VEIL_ISSUER_KEY_INVALID" }
      val parameters = AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
        .getParameterSpec(ECParameterSpec::class.java)
      require(parsed.params.curve == parameters.curve && parsed.params.generator == parameters.generator &&
        parsed.params.order == parameters.order && parsed.params.cofactor == parameters.cofactor) {
        "VEIL_ISSUER_KEY_INVALID"
      }
      issuer = parsed
    } finally { spki.fill(0) }
  }

  private fun now(): Long {
    val value = elapsedMillis()
    check(value >= 0 && value >= lastElapsed) { "VEIL_MONOTONIC_CLOCK_ROLLBACK" }
    lastElapsed = value
    return value
  }

  /** Original native caller obtains this before requesting a signed response. */
  @Synchronized
  fun request(minimumGeneration: Long): Request {
    require(minimumGeneration >= 0)
    val issued = now()
    pending.entries.removeAll { issued - it.value.issuedAt >= MAX_LEASE_MILLIS }
    check(pending.size < MAX_PENDING) { "VEIL_DEVICE_CHALLENGE_BUDGET" }
    val challenge = ByteArray(32)
    var key: String
    do { random.nextBytes(challenge); key = hex(challenge) } while (pending.containsKey(key))
    val bytes = ByteArrayOutputStream().also { buffer ->
      DataOutputStream(buffer).use { out ->
        out.write(DOMAIN); out.writeByte(1)
        for (value in fields(binding)) {
          val text = value.toByteArray(Charsets.US_ASCII)
          out.writeShort(text.size); out.write(text)
        }
        out.writeLong(minimumGeneration); out.write(challenge)
      }
    }.toByteArray()
    pending[key] = Pending(issued, minimumGeneration)
    challenge.fill(0)
    return Request(bytes)
  }

  @Synchronized
  override fun verify(publicProof: ByteArray, expected: VeilDeviceBinding, minimumGeneration: Long): VeilVerifiedDeviceGrant {
    require(expected == binding && minimumGeneration >= 0) { "VEIL_DEVICE_BINDING_MISMATCH" }
    require(publicProof.size in 1..MAX_PROOF_BYTES)
    val copy = publicProof.copyOf()
    var payload: ByteArray? = null
    var signature: ByteArray? = null
    try {
      val current = now()
      DataInputStream(ByteArrayInputStream(copy)).use { frame ->
        require(frame.readInt() == FRAME) { "VEIL_DEVICE_PROOF_INVALID" }
        val size = frame.readInt()
        require(size in 1..MAX_PAYLOAD_BYTES && frame.available() >= size + 2) { "VEIL_DEVICE_PROOF_INVALID" }
        val message = ByteArray(size).also { frame.readFully(it) }; payload = message
        val signatureSize = frame.readUnsignedShort()
        require(signatureSize in 1..144 && frame.available() == signatureSize) { "VEIL_DEVICE_PROOF_INVALID" }
        val signed = ByteArray(signatureSize).also { frame.readFully(it) }; signature = signed
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(issuer); verifier.update(message)
        require(verifier.verify(signed)) { "VEIL_DEVICE_PROOF_SIGNATURE_INVALID" }
        DataInputStream(ByteArrayInputStream(message)).use { input ->
          val domain = ByteArray(DOMAIN.size).also { input.readFully(it) }
          require(domain.contentEquals(DOMAIN) && input.readUnsignedByte() == 1) { "VEIL_DEVICE_PROOF_INVALID" }
          for (value in fields(binding)) {
            val length = input.readUnsignedShort()
            require(length in 1..512 && input.available() >= length) { "VEIL_DEVICE_PROOF_INVALID" }
            val text = ByteArray(length).also { input.readFully(it) }
            require(text.all { it.toInt() in 33..126 } && text.toString(Charsets.US_ASCII) == value) {
              "VEIL_DEVICE_BINDING_MISMATCH"
            }
          }
          val requestedMinimum = input.readLong()
          val challenge = ByteArray(32).also { input.readFully(it) }
          val key = hex(challenge); challenge.fill(0)
          val issued = pending[key] ?: error("VEIL_DEVICE_CHALLENGE_UNKNOWN_OR_REPLAYED")
          require(requestedMinimum == issued.minimum && requestedMinimum == minimumGeneration) {
            "VEIL_DEVICE_GENERATION_MISMATCH"
          }
          val generation = input.readLong()
          require(generation >= minimumGeneration && generation >= 0) { "VEIL_GENERATION_ROLLBACK" }
          val approval = when (input.readUnsignedByte()) {
            1 -> VeilDeviceApproval.TRUSTED_DEVICE
            2 -> VeilDeviceApproval.USER_HELD_RECOVERY
            else -> error("VEIL_DEVICE_APPROVAL_INVALID")
          }
          val duration = input.readLong()
          require(duration in 1..MAX_LEASE_MILLIS && input.available() == 0) { "VEIL_DEVICE_PROOF_INVALID" }
          val expires = Math.addExact(issued.issuedAt, duration)
          require(current < expires) { "VEIL_DEVICE_PROOF_EXPIRED" }
          // No unauthenticated failure consumes the original pending request.
          // A valid response is single-use even across signature re-encoding.
          pending.remove(key)
          return VeilVerifiedDeviceGrant(binding, generation, expires, approval)
        }
      }
    } finally { copy.fill(0); payload?.fill(0); signature?.fill(0) }
  }

  internal companion object {
    private const val FRAME = 0x59445632 // YDV2
    private const val MAX_PENDING = 32
    private const val MAX_LEASE_MILLIS = 120000L
    private const val MAX_PROOF_BYTES = 8192
    private const val MAX_PAYLOAD_BYTES = 4096
    private val DOMAIN = "YNX/SOCIAL/DEVICE-GRANT/V2\u0000".toByteArray(Charsets.US_ASCII)
    private fun fields(value: VeilDeviceBinding) = listOf(value.owner, value.device, value.socialIdentityFingerprint, value.keyAlias)
    private fun hex(value: ByteArray) = value.joinToString("") { "%02x".format(it.toInt() and 255) }
  }
}
