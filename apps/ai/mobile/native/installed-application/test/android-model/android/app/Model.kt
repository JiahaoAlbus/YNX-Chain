package android.app
open class Application {
  val applicationContext: Application get() = this
  val isDeviceProtectedStorage: Boolean get() = false
  val packageName: String get() = "com.ynxweb4.ai"
  lateinit var applicationInfo: android.content.pm.ApplicationInfo
  lateinit var packageManager: android.content.pm.PackageManager
  lateinit var assets: android.content.res.AssetManager
}
