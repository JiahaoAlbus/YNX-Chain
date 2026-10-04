package com.ynx.social.matrix

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/** Real JCA signatures with synthetic QA enrollment; not production admission. */
object VeilSignedDeviceGrantCheck {
  private var assertions = 0
  private fun assertThat(value: Boolean) { check(value); assertions++ }
  private fun rejects(block: () -> Unit) {
    var rejected = false
    try { block() } catch (_: Exception) { rejected = true }
    assertThat(rejected)
  }
  private fun issuer(curve: String = "secp256r1"): KeyPair = KeyPairGenerator.getInstance("EC")
    .apply { initialize(ECGenParameterSpec(curve)) }.generateKeyPair()
  private fun pin(pair: KeyPair) = MessageDigest.getInstance("SHA-256").digest(pair.public.encoded)
    .joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun payload(request: VeilSignedDeviceGrantVerifier.Request, generation: Long = 4L,
    approval: Int = 1, duration: Long = 60000L): ByteArray = ByteArrayOutputStream().also { buffer ->
    DataOutputStream(buffer).use { out ->
      out.write(request.bytes()); out.writeLong(generation); out.writeByte(approval); out.writeLong(duration)
    }
  }.toByteArray()
  private fun proof(pair: KeyPair, payload: ByteArray): ByteArray {
    val signature = Signature.getInstance("SHA256withECDSA").run {
      initSign(pair.private); update(payload); sign()
    }
    return ByteArrayOutputStream().also { buffer ->
      DataOutputStream(buffer).use { out ->
        out.writeInt(0x59445632); out.writeInt(payload.size); out.write(payload)
        out.writeShort(signature.size); out.write(signature)
      }
    }.toByteArray()
  }
  @JvmStatic fun main(args: Array<String>) {
    val key = issuer()
    val other = issuer()
    val binding = VeilDeviceBinding("qa-owner", "qa-device", "qa-social-key", "ynx.social.veil.v2.qa")
    var time = 1000L
    fun fresh() = VeilSignedDeviceGrantVerifier(binding, key.public.encoded, pin(key)) { time }
    val verifier = fresh()
    val authority = VeilNativeAuthority(binding, verifier) { time }
    val request = verifier.request(0)
    val originalRequest = request.bytes()
    val exported = request.bytes(); exported.fill(0)
    assertThat(request.bytes().contentEquals(originalRequest))
    val valid = proof(key, payload(request))
    val originalProof = valid.copyOf()
    rejects { authority.admit(proof(other, payload(request))) }
    val lease = authority.admit(valid)
    assertThat(valid.contentEquals(originalProof))
    authority.withLease(lease) { it.checkLive(); assertThat(true) }
    rejects { authority.admit(valid) }
    authority.revoke()
    rejects { authority.withLease(lease) { it.checkLive() } }
    val stale = verifier.request(5)
    rejects { authority.admit(proof(key, payload(stale, generation = 4))) }
    val recovered = authority.admit(proof(key, payload(stale, generation = 5, approval = 2)))
    authority.withLease(recovered) { it.checkLive(); assertThat(true) }
    time = 61000L
    rejects { authority.withLease(recovered) { it.checkLive() } }
    val expiredVerifier = fresh()
    val expired = expiredVerifier.request(0)
    val expiredProof = proof(key, payload(expired, duration = 100))
    time += 100
    rejects { expiredVerifier.verify(expiredProof, binding, 0) }
    time += 1
    val negative = fresh()
    val pending = negative.request(0)
    rejects { negative.verify(proof(key, payload(pending, generation = -1)), binding, 0) }
    rejects { negative.verify(proof(key, payload(pending, approval = 3)), binding, 0) }
    rejects { negative.verify(proof(key, payload(pending, duration = 0)), binding, 0) }
    rejects { negative.verify(proof(key, payload(pending, duration = 120001)), binding, 0) }
    rejects { negative.verify(proof(key, payload(pending)) + byteArrayOf(0), binding, 0) }
    rejects { negative.verify(proof(key, payload(pending) + byteArrayOf(0)), binding, 0) }
    rejects { negative.verify(proof(key, payload(pending)), binding.copy(device = "other"), 0) }
    rejects { negative.verify(proof(key, payload(pending)), binding, 1) }
    val wrongDomain = payload(pending).also { it[0] = 'X'.code.toByte() }
    rejects { negative.verify(proof(key, wrongDomain), binding, 0) }
    val tampered = proof(key, payload(pending)).also { it[12] = (it[12].toInt() xor 1).toByte() }
    rejects { negative.verify(tampered, binding, 0) }
    val unknownChallenge = proof(key, payload(fresh().request(0)))
    rejects { negative.verify(unknownChallenge, binding, 0) }
    assertThat(negative.verify(proof(key, payload(pending)), binding, 0).revocationGeneration == 4L)
    rejects { fresh().verify(valid, binding, 0) } // Cold process cannot replay an earlier challenge.
    val backwards = fresh(); backwards.request(0); time--
    rejects { backwards.request(0) }
    time++
    val budget = fresh(); repeat(32) { budget.request(0) }
    rejects { budget.request(0) }
    time += 120000
    assertThat(budget.request(0).bytes().isNotEmpty())
    rejects { VeilSignedDeviceGrantVerifier(binding, key.public.encoded, pin(other)) { time } }
    val p384 = issuer("secp384r1")
    rejects { VeilSignedDeviceGrantVerifier(binding, p384.public.encoded, pin(p384)) { time } }
    rejects { verifier.verify(ByteArray(8193), binding, 0) }
    println("VeilSignedDeviceGrantCheck: $assertions assertions PASS; synthetic QA issuer, production enrollment NOT_VERIFIED")
  }
}
