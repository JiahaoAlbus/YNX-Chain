package com.ynx.social

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class WalletLauncherModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    private const val WALLET_PACKAGE = "com.ynxweb4.wallet"
    private const val WALLET_ACTIVITY = "com.ynxweb4.wallet.MainActivity"
  }

  override fun getName(): String = "YNXWalletLauncher"

  @ReactMethod
  fun openCanonicalWallet(value: String, promise: Promise) {
    val uri = try {
      Uri.parse(value)
    } catch (_: Exception) {
      promise.resolve(failure("SCHEME_NOT_REGISTERED"))
      return
    }
    if (!isCanonicalRoute(uri)) {
      promise.resolve(failure("SCHEME_NOT_REGISTERED"))
      return
    }
    val context = reactApplicationContext
    val manager = context.packageManager
    val implicit = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
    val resolved = manager.resolveActivity(implicit, PackageManager.MATCH_DEFAULT_ONLY)
    val candidates = manager.queryIntentActivities(implicit, PackageManager.MATCH_DEFAULT_ONLY)
    if (resolved == null || candidates.size != 1 || !isExactWallet(resolved.activityInfo) || !isExactWallet(candidates.single().activityInfo)) {
      promise.resolve(failure(if (isWalletInstalled(manager)) "SCHEME_NOT_REGISTERED" else "WALLET_NOT_INSTALLED"))
      return
    }
    try {
      implicit.component = ComponentName(WALLET_PACKAGE, WALLET_ACTIVITY)
      implicit.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      context.startActivity(implicit)
      promise.resolve(Arguments.createMap().apply { putBoolean("opened", true) })
    } catch (_: Exception) {
      promise.resolve(failure("SCHEME_NOT_REGISTERED"))
    }
  }

  private fun isCanonicalRoute(uri: Uri): Boolean =
    uri.scheme == "ynxwallet" &&
      uri.host == "authorize" &&
      uri.path.isNullOrEmpty() &&
      uri.fragment == null &&
      uri.userInfo == null &&
      uri.port == -1 &&
      uri.queryParameterNames == setOf("request") &&
      Regex("^request=[A-Za-z0-9_-]+$").matches(uri.encodedQuery ?: "")

  private fun isExactWallet(info: android.content.pm.ActivityInfo?): Boolean =
    info != null && info.exported && info.packageName == WALLET_PACKAGE && info.name == WALLET_ACTIVITY

  @Suppress("DEPRECATION")
  private fun isWalletInstalled(manager: PackageManager): Boolean = try {
    manager.getPackageInfo(WALLET_PACKAGE, 0)
    true
  } catch (_: PackageManager.NameNotFoundException) {
    false
  }

  private fun failure(code: String) = Arguments.createMap().apply {
    putBoolean("opened", false)
    putString("code", code)
  }
}
