package android.content.pm
class ApplicationInfo { @JvmField var packageName = "com.ynxweb4.ai"; @JvmField var uid = 10001; @JvmField var sourceDir = ""; @JvmField var splitSourceDirs: Array<String>? = null; @JvmField var nativeLibraryDir: String? = null }
class Signature(private val bytes: ByteArray) { fun toByteArray() = bytes.clone() }
class SigningInfo { val apkContentsSigners get() = arrayOf(Signature("PUBLIC NOT A CERTIFICATE".toByteArray())) }
class PackageInfo {
  @JvmField var applicationInfo: ApplicationInfo? = null
  val signingInfo: SigningInfo? get() = SigningInfo()
  val longVersionCode: Long get() = 7
  @JvmField var lastUpdateTime: Long = 1234
}
class PackageManager(val info: PackageInfo) {
  companion object { const val GET_SIGNING_CERTIFICATES = 134217728 }
  fun getPackageInfo(name: String, flags: Int): PackageInfo { check(name == "com.ynxweb4.ai" && flags == GET_SIGNING_CERTIFICATES); return info }
}
