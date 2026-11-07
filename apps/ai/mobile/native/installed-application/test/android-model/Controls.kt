import com.ynxweb4.ai.MainApplication
import com.ynxweb4.ai.NativeInstalledApplication
import java.nio.file.Files
import android.content.pm.*
import android.os.ParcelFileDescriptor
// Reflect only the real private production methods under PUBLIC OS doubles;
// the normal App has no reflective/JS owner creation or approval path.
private fun call(name: String, vararg args: Any): Any? {
  val method = NativeInstalledApplication::class.java.declaredMethods.single { it.name == name }; method.isAccessible = true
  return method.invoke(null, *args)
}
private fun pair(name: String, id: Long) = call(name, id) as IntArray
fun main() {
  val dir = Files.createTempDirectory("P08-Android-PUBLIC-").toFile()
  try {
    val apk = dir.resolve("base.apk").apply { writeText("PUBLIC APK DOUBLE") }
    val library = dir.resolve("libpublic.so").apply { writeText("PUBLIC LOADED IMAGE DOUBLE") }
    val manifest = dir.resolve("YNXAIInstalledModuleManifest.v6.json")
    val manifestText = """{"version":"6","applicationId":"com.ynxweb4.ai","implementingImage":{"libraryName":"libpublic.so"},"privateModule":{"libraryName":"libpublic.so"}}"""
    manifest.writeText(manifestText)
    val info = ApplicationInfo().apply { sourceDir = apk.path; nativeLibraryDir = dir.path }
    val record = PackageInfo().apply { applicationInfo = info }
    val app = MainApplication().apply { applicationInfo = info; packageManager = PackageManager(record); assets = android.content.res.AssetManager(dir) }
    NativeInstalledApplication.bindApplication(app)
    fun acquire(): Long = call("captureNative", library.path, library.path) as Long
    fun close(id: Long) { check(pair("closeNative", id).contentEquals(intArrayOf(0, 0, 1))) }
    val original = acquire(); check(original > 0 && pair("failureNative", original).contentEquals(intArrayOf(0, 0)))
    val tuple = call("readNative", original) as Array<*>; check(tuple.size == 6 && tuple[0] == "android" && tuple[1] == "com.ynxweb4.ai")
    check(tuple.drop(2).all { (it as String).matches(Regex("[a-f0-9]{64}")) })
    var wrong = intArrayOf(); Thread { wrong = pair("closeNative", original) }.apply { start(); join() }
    check(wrong[0] == 1 && wrong[2] == 0); check(pair("currentNative", original)[0] == 0)
    call("retireNative", original); check(pair("currentNative", original)[0] == 1 && call("readNative", original) == null); close(original)
    val changedImage = acquire(); library.writeText("PUBLIC IMAGE CHANGED"); check(pair("currentNative", changedImage)[0] == 1); close(changedImage)
    val changedManifest = acquire(); manifest.writeText(manifestText + " "); check(pair("currentNative", changedManifest)[0] == 1); close(changedManifest); manifest.writeText(manifestText)
    val changedPackage = acquire(); record.lastUpdateTime++; check(pair("currentNative", changedPackage)[0] == 1); close(changedPackage)
    manifest.delete(); val partial = acquire(); check(partial > 0 && pair("failureNative", partial)[0] == 1); close(partial); manifest.writeText(manifestText)
    var packed = "NOT_EXECUTED_NO_PROC_FD"
    if (Files.isDirectory(java.nio.file.Path.of("/proc/self/fd"))) {
      val archive = dir.resolve("packed.apk")
      java.util.zip.ZipOutputStream(archive.outputStream()).use { zip ->
        zip.putNextEntry(java.util.zip.ZipEntry("lib/arm64-v8a/libpublic.so")); zip.write(library.readBytes()); zip.closeEntry()
        zip.putNextEntry(java.util.zip.ZipEntry("assets/YNXAIInstalledModuleManifest.v6.json")); zip.write(manifest.readBytes()); zip.closeEntry()
      }
      info.sourceDir = archive.path
      val image = archive.path + "!/lib/arm64-v8a/libpublic.so"
      val packedId = call("captureNative", image, image) as Long
      check(pair("failureNative", packedId)[0] == 0 && pair("currentNative", packedId)[0] == 0)
      val tuplePacked = call("readNative", packedId) as Array<*>
      val hash = java.security.MessageDigest.getInstance("SHA-256").digest(library.readBytes()).joinToString("") { "%02x".format(it.toInt() and 255) }
      check(tuplePacked[4] == hash && tuplePacked[5] == hash); close(packedId)
      info.sourceDir = apk.path; packed = "PASS_REAL_ZIP_ORIGINAL_FD"
    }
    val uncertain = acquire(); ParcelFileDescriptor.failClose = true
    val first = pair("closeNative", uncertain); val count = ParcelFileDescriptor.closeCalls; val again = pair("closeNative", uncertain)
    check(first[0] == 1 && first[2] == 0 && again.contentEquals(first) && ParcelFileDescriptor.closeCalls == count)
    check(pair("currentNative", uncertain)[0] == 1)
    println("PUBLIC normal Kotlin body: capture/read six DATA; wrong actor; retire; image/manifest/package changes; partial; uncertain close no retry PASS. Android OS/installed/Root/Source/approval false. Packed APK: $packed.")
  } finally { dir.deleteRecursively() }
}
