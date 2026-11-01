package com.ynx.wallet.pq

import android.app.AlertDialog
import android.app.KeyguardManager
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.text.InputType
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import com.facebook.react.bridge.ReactApplicationContext
import java.lang.ref.WeakReference
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Arrays
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/** Fixed Native/JNI class; not a ReactModule and has NO @ReactMethod. Neither
 * a Result nor credential bytes can be sent through the Hermes module. */
object NativeSecure43 {
    class Result(val code: Int, val protection: Int, val possible: Boolean, val bytes: ByteArray)
    @Volatile private var app: WeakReference<ReactApplicationContext>? = null
    @JvmStatic fun bind(context: ReactApplicationContext) { app = WeakReference(context) }
    private fun failure(code: Int = 9103, possible: Boolean = false) = Result(code, 0, possible, ByteArray(0))
    private fun aliasOK(alias: String) = Regex("com\\.ynx\\.wallet\\.pq43\\.v1\\.[0-9a-f]{64}").matches(alias)
    private fun store(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun keyInfo(key: SecretKey): KeyInfo = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java) as KeyInfo
    private fun level(key: SecretKey): Int {
        val info = keyInfo(key)
        if (!info.isUserAuthenticationRequired || info.userAuthenticationValidityDurationSeconds != 30 || info.keySize != 256 ||
            info.purposes != (KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT) ||
            !info.blockModes.contentEquals(arrayOf(KeyProperties.BLOCK_MODE_GCM)) ||
            !info.encryptionPaddings.contentEquals(arrayOf(KeyProperties.ENCRYPTION_PADDING_NONE))) return 0
        if (Build.VERSION.SDK_INT < 30 || info.userAuthenticationType == 0 ||
            (info.userAuthenticationType and (KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL).inv()) != 0) return 0
        if (!info.isUserAuthenticationRequirementEnforcedBySecureHardware) return 1 // never claim hardware enforcement
        if (Build.VERSION.SDK_INT >= 31) return when (info.securityLevel) {
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> 3
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> 2
            KeyProperties.SECURITY_LEVEL_SOFTWARE -> 1
            else -> 0
        }
        @Suppress("DEPRECATION")
        return if (info.isInsideSecureHardware) 2 else 1
    }
    private fun authenticate(timeout: Int): Boolean {
        if (Build.VERSION.SDK_INT < 30 || Looper.myLooper() == Looper.getMainLooper()) return false
        val activity = app?.get()?.currentActivity ?: return false
        val manager = activity.getSystemService(KeyguardManager::class.java)
        if (!manager.isDeviceSecure) return false
        val result = CompletableFuture<Boolean>(); val cancel = CancellationSignal()
        Handler(Looper.getMainLooper()).post {
            if (activity.isFinishing || activity.isDestroyed) { result.complete(false); return@post }
            val prompt = BiometricPrompt.Builder(activity).setTitle("Unlock original PQ credential")
                .setSubtitle("This does not approve signing or sending")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL).build()
            prompt.authenticate(cancel, activity.mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(value: BiometricPrompt.AuthenticationResult) { result.complete(true) }
                override fun onAuthenticationError(code: Int, message: CharSequence?) { result.complete(false) }
            })
        }
        return try { result.get(timeout.toLong(), TimeUnit.MILLISECONDS) } catch (_: Exception) { cancel.cancel(); false }
    }
    @JvmStatic fun digest(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)
    @JvmStatic fun inspect(alias: String): Result = try {
        if (Build.VERSION.SDK_INT < 30 || !aliasOK(alias)) failure(9102)
        else {
            val activity = app?.get()?.currentActivity
            if (activity == null || activity.getSystemService(KeyguardManager::class.java).isDeviceLocked) failure()
            else { val key = store().getKey(alias, null) as? SecretKey; if (key == null) failure(9104) else Result(0, level(key), false, ByteArray(0)) }
        }
    } catch (_: Exception) { failure() }
    @JvmStatic fun unwrap(alias: String, wrapped: ByteArray, aad: ByteArray, minimum: Int, timeout: Int): Result = try {
        if (Build.VERSION.SDK_INT < 30 || !aliasOK(alias) || wrapped.size != 71 || aad.size != 88 || minimum !in 1..3) failure(9101)
        else {
            val key = store().getKey(alias, null) as? SecretKey
            if (key == null) failure(9104) else {
                val actual = level(key)
                if (actual < minimum || !authenticate(timeout)) failure() else {
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, wrapped.copyOfRange(0, 12))); cipher.updateAAD(aad)
                    val plaintext = cipher.doFinal(wrapped, 12, 59)
                    if (plaintext.size != 43) { Arrays.fill(plaintext, 0.toByte()); failure() } else Result(0, actual, false, plaintext)
                }
            }
        }
    } catch (_: Exception) { failure() }
    @JvmStatic fun sealAbsent(alias: String, original43: ByteArray, aad: ByteArray, minimum: Int, timeout: Int): Result {
        var possible = false
        try {
            if (Build.VERSION.SDK_INT < 30 || !aliasOK(alias) || original43.size != 43 || aad.size != 88 || minimum !in 1..3) return failure(9101)
            if (minimum == 3 && Build.VERSION.SDK_INT < 31) return failure(9102)
            if (store().containsAlias(alias)) return failure(9105)
            val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).setUnlockedDeviceRequired(true).setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(30, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
            if (minimum == 3) builder.setIsStrongBoxBacked(true)
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(builder.build()); possible = true // a failed generate may already have an alias
            val key = generator.generateKey(); val actual = level(key)
            if (actual < minimum || !authenticate(timeout)) return failure(9103, possible)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(aad)
            val encrypted = cipher.doFinal(original43)
            if (cipher.iv.size != 12 || encrypted.size != 59) return failure(9110, possible)
            return Result(0, actual, true, cipher.iv + encrypted)
        } catch (_: Exception) { return failure(9110, possible) }
    }
    @JvmStatic fun removeExact(alias: String, timeout: Int): Result = try {
        if (Build.VERSION.SDK_INT < 30 || !aliasOK(alias)) failure(9101)
        else if (!authenticate(timeout)) failure() else {
            val ks = store(); val present = ks.containsAlias(alias)
            if (present) ks.deleteEntry(alias) // only per-item alias, never a shared/master key
            Result(0, 0, present, ByteArray(0))
        }
    } catch (_: Exception) { failure(9110, true) }
    @JvmStatic fun inputOriginal(timeout: Int): Result {
        if (Looper.myLooper() == Looper.getMainLooper()) return failure(9102)
        val activity = app?.get()?.currentActivity ?: return failure()
        val result = CompletableFuture<Result>(); val abandoned = AtomicBoolean(false)
        val field = arrayOfNulls<EditText>(1); val dialog = arrayOfNulls<AlertDialog>(1)
        Handler(Looper.getMainLooper()).post {
            if (abandoned.get() || activity.isFinishing || activity.isDestroyed) { result.complete(failure()); return@post }
            val input = EditText(activity); field[0] = input
            input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            input.imeOptions = EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            input.isSaveEnabled = false; input.isLongClickable = false
            input.importantForAutofill = EditText.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            val alert = AlertDialog.Builder(activity).setTitle("Original PQ backup credential")
                .setMessage("Enter the original 43-character credential. This does not approve signing or sending.")
                .setView(input).setNegativeButton("Cancel") { _, _ -> input.text?.clear(); result.complete(failure(9109)) }
                .setPositiveButton("Use original") { _, _ ->
                    val text = input.text; val bytes = ByteArray(43); var valid = text != null && text.length == 43
                    if (valid) for (i in 0 until 43) { val value = text!![i].code; if (value > 127) valid = false; bytes[i] = value.toByte() }
                    text?.clear()
                    if (abandoned.get() || !valid || !result.complete(Result(0, 0, false, bytes))) Arrays.fill(bytes, 0.toByte())
                    if (abandoned.get()) Arrays.fill(bytes, 0.toByte())
                    if (!valid) result.complete(failure(9101))
                }.create()
            dialog[0] = alert; alert.setOnDismissListener { input.text?.clear(); if (!result.isDone) result.complete(failure(9109)) }
            alert.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE); alert.show()
            alert.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        return try { result.get(timeout.toLong(), TimeUnit.MILLISECONDS) } catch (_: Exception) {
            abandoned.set(true)
            result.getNow(null)?.let { Arrays.fill(it.bytes, 0.toByte()) }
            Handler(Looper.getMainLooper()).post { field[0]?.text?.clear(); dialog[0]?.dismiss() }
            failure(9109)
        }
    }
}
