package com.ynxweb4.finance

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

class FinanceSecureDeviceModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "FinanceSecureDevice"

  @ReactMethod
  fun descriptor(promise: Promise) {
    runCatching {
      val publicKey = ensureKey().public as ECPublicKey
      val encoded = compressed(publicKey)
      Arguments.createMap().apply {
        putString("id", "finance-android-" + hex(MessageDigest.getInstance("SHA-256").digest(encoded)).take(24))
        putString("key", encode(encoded))
      }
    }.onSuccess(promise::resolve).onFailure { promise.reject("SECURE_DEVICE_UNAVAILABLE", "Finance secure device signing is unavailable", it) }
  }

  @ReactMethod
  fun sign(payload: String, promise: Promise) {
    runCatching {
      val bytes = Base64.decode(payload, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
      val signature = Signature.getInstance("SHA256withECDSA")
      signature.initSign((ensureKey().private))
      signature.update(bytes)
      encode(signature.sign())
    }.onSuccess(promise::resolve).onFailure { promise.reject("SECURE_DEVICE_SIGNING_FAILED", "Finance secure device signing failed", it) }
  }

  private fun ensureKey(): java.security.KeyPair {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val alias = "ynx.finance.product-session.v2"
    val existingPrivate = keyStore.getKey(alias, null)
    val existingPublic = keyStore.getCertificate(alias)?.publicKey
    if (existingPrivate != null && existingPublic != null) return java.security.KeyPair(existingPublic, existingPrivate as java.security.PrivateKey)
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .build())
    return generator.generateKeyPair()
  }

  private fun compressed(key: ECPublicKey): ByteArray {
    val x = fixed(key.w.affineX); val y = key.w.affineY
    return byteArrayOf(if (y.testBit(0)) 3 else 2) + x
  }
  private fun fixed(value: BigInteger): ByteArray {
    val raw = value.toByteArray(); val output = ByteArray(32)
    val source = if (raw.size > 32) raw.copyOfRange(raw.size - 32, raw.size) else raw
    System.arraycopy(source, 0, output, 32 - source.size, source.size)
    return output
  }
  private fun encode(value: ByteArray) = Base64.encodeToString(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  private fun hex(value: ByteArray) = value.joinToString("") { "%02x".format(it) }
}
