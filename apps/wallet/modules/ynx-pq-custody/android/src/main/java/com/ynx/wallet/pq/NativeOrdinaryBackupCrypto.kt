package com.ynx.wallet.pq

import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Native-only fixed-format AEAD primitive. No UI, OS store, JS or signing.
 * Raw PBKDF2 password is decoded 32 bytes, NOT a PBEKeySpec char conversion.
 * Mutable caller/result buffers are wiped by this helper/JNI owner. Provider
 * internal heap physical erasure is not claimed. Never log exception values.
 */
internal object NativeOrdinaryBackupCrypto {
    @JvmStatic
    fun open(password: ByteArray, salt: ByteArray, nonce: ByteArray,
             aad: ByteArray, ciphertext: ByteArray): ByteArray? {
        val u = ByteArray(32)
        val next = ByteArray(32)
        val derived = ByteArray(32)
        val block = ByteArray(36)
        try {
            if (password.size != 32 || salt.size != 32 || nonce.size != 12 ||
                aad.isEmpty() || aad.size > 8192 || ciphertext.size < 16 ||
                ciphertext.size > 196608) return null
            salt.copyInto(block)
            block[35] = 1
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(password, "HmacSHA256"))
            mac.update(block)
            mac.doFinal(u, 0)
            u.copyInto(derived)
            repeat(599999) {
                mac.update(u)
                mac.doFinal(next, 0)
                for (i in derived.indices) derived[i] = (derived[i].toInt() xor next[i].toInt()).toByte()
                u.fill(0)
                next.copyInto(u)
                next.fill(0)
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(derived, "AES"), GCMParameterSpec(128, nonce))
            cipher.updateAAD(aad)
            return cipher.doFinal(ciphertext)
        } catch (_: Exception) {
            return null
        } finally {
            password.fill(0); u.fill(0); next.fill(0); derived.fill(0); block.fill(0)
        }
    }
}
