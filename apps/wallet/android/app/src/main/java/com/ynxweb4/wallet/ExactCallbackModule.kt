package com.ynxweb4.wallet

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ExactCallbackModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "YnxExactCallback"

  @ReactMethod
  fun open(url: String, packageName: String, promise: Promise) {
    try {
      if (!PACKAGE.matches(packageName)) throw IllegalArgumentException("Wallet callback package is invalid")
      val uri = Uri.parse(url)
      val scheme = uri.scheme ?: throw IllegalArgumentException("Wallet callback scheme is missing")
      if (!SCHEME.matches(scheme) || scheme == "http" || scheme == "https") throw IllegalArgumentException("Wallet exact-package callback requires a custom scheme")
      val intent = Intent(Intent.ACTION_VIEW, uri).apply {
        setPackage(packageName)
        addCategory(Intent.CATEGORY_BROWSABLE)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: ActivityNotFoundException) {
      promise.reject("YNX_CALLBACK_PACKAGE_NOT_FOUND", "The registered callback package is not installed", error)
    } catch (error: Throwable) {
      promise.reject("YNX_CALLBACK_HANDOFF_FAILED", error.message ?: "Exact callback handoff failed", error)
    }
  }

  companion object {
    private val PACKAGE = Regex("^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$")
    private val SCHEME = Regex("^[a-z][a-z0-9+.-]*$")
  }
}
