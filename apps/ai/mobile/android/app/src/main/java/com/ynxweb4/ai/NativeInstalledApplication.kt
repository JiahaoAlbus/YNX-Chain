package com.ynxweb4.ai

import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import android.system.Os
import android.system.StructStat
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.zip.ZipFile

/** P08's private OS loan. No React method, caller-selected Context or identity DTO. */
internal object NativeInstalledApplication {
  private const val UNAVAILABLE = -68201
  private const val INVALID = -68202
  private const val CHANGED = -68203
  private const val ACTOR = -68204
  private const val RETIRED = -68205
  private const val IO = -68206
  private const val MANIFEST = "YNXAIInstalledModuleManifest.v6.json"
  @Volatile private var actualApplication: Application? = null
  private val sequence = AtomicLong(1)
  private val loans = ConcurrentHashMap<Long, Loan>()

  @Synchronized fun bindApplication(application: Application) {
    check(application.javaClass.name == "com.ynxweb4.ai.MainApplication")
    check(application.applicationContext === application && !application.isDeviceProtectedStorage)
    check(application.packageName == "com.ynxweb4.ai" && application.applicationInfo.uid == Process.myUid())
    check(actualApplication == null || actualApplication === application) { "AI_INSTALLED_APPLICATION_REBIND" }
    actualApplication = application
  }

  // Called only by the normal App after A's one image has loaded, never JNI_OnLoad
  // replacement or another guessed System.loadLibrary call.
  @JvmStatic external fun bindNativeClass()

  private fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun hashStream(stream: InputStream, cap: Long): String {
    val hash = MessageDigest.getInstance("SHA-256"); val bytes = ByteArray(65536); var count = 0L
    while (true) { val n = stream.read(bytes); if (n < 0) break; check(n > 0); count += n; check(count <= cap); hash.update(bytes, 0, n) }
    return hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
  }
  private fun identity(parts: List<String>): String {
    val hash = MessageDigest.getInstance("SHA-256")
    hash.update("YNX_AI_ANDROID_INSTALLED_IDENTITY_V1".toByteArray(Charsets.UTF_8))
    for (part in parts) {
      val bytes = part.toByteArray(Charsets.UTF_8); val n = bytes.size.toLong()
      hash.update(ByteArray(8) { i -> (n ushr ((7 - i) * 8)).toByte() }); hash.update(bytes)
    }
    return hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
  }
  private fun same(a: StructStat, b: StructStat): Boolean = a.st_dev == b.st_dev && a.st_ino == b.st_ino &&
    a.st_size == b.st_size && a.st_mode == b.st_mode && a.st_uid == b.st_uid && a.st_gid == b.st_gid &&
    a.st_mtim.tv_sec == b.st_mtim.tv_sec && a.st_mtim.tv_nsec == b.st_mtim.tv_nsec &&
    a.st_ctim.tv_sec == b.st_ctim.tv_sec && a.st_ctim.tv_nsec == b.st_ctim.tv_nsec

  private class Held(val observed: String, val canonical: String, val descriptor: ParcelFileDescriptor) {
    var captured: StructStat? = null; var digest = ""; var closeSelected = false
    fun hash(): String {
      val before = Os.fstat(descriptor.fileDescriptor)
      check(before.st_size in 1..(2L shl 30))
      val hash = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(65536); var offset = 0L
      while (offset < before.st_size) {
        val n = Os.pread(descriptor.fileDescriptor, buffer, 0, minOf(buffer.size.toLong(), before.st_size - offset).toInt(), offset)
        check(n > 0); hash.update(buffer, 0, n); offset += n
      }
      check(same(before, Os.fstat(descriptor.fileDescriptor)))
      return hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    fun current(): Boolean = !closeSelected && File(observed).canonicalPath == canonical &&
      captured?.let { same(it, Os.lstat(canonical)) && same(it, Os.fstat(descriptor.fileDescriptor)) } == true && hash() == digest
  }
  private data class PackageOriginal(val paths: List<String>, val nativeDir: String, val version: String, val updated: String, val signerDigests: List<String>)
  private fun packageOriginal(app: Application): PackageOriginal {
    check(Build.VERSION.SDK_INT >= 28)
    val info = app.packageManager.getPackageInfo("com.ynxweb4.ai", PackageManager.GET_SIGNING_CERTIFICATES)
    val installed = checkNotNull(info.applicationInfo)
    check(installed.packageName == app.packageName && installed.uid == Process.myUid())
    val signers = checkNotNull(info.signingInfo).apkContentsSigners.map { digest(it.toByteArray()) }.sorted()
    check(signers.isNotEmpty())
    return PackageOriginal((listOf(installed.sourceDir) + (installed.splitSourceDirs?.toList() ?: emptyList())).sorted(), checkNotNull(installed.nativeLibraryDir), info.longVersionCode.toString(), info.lastUpdateTime.toString(), signers)
  }
  private class Loan(val id: Long, val app: Application) {
    val actor = Process.myTid(); val retired = AtomicBoolean(false); val files = mutableListOf<Held>()
    var original: PackageOriginal? = null; var manifestOriginal = ByteArray(0); var captured: Array<String>? = null
    var first = 0; var firstPresent = false; var closed = false; var closeUncertain = false; var closeCode = 0
    private class HeldZip(val zip: ZipFile) { var closeSelected = false }
    private val zipFiles = mutableMapOf<String, HeldZip>()
    val imagePaths = mutableListOf<String>(); var libraryName = ""
    fun fail(code: Int): Int { if (!firstPresent) { firstPresent = true; first = code }; return first }
    fun hold(path: String): Held {
      val canonical = File(path).canonicalPath; val before = Os.lstat(canonical)
      check(android.system.OsConstants.S_ISREG(before.st_mode))
      val held = Held(path, canonical, ParcelFileDescriptor.open(File(canonical), ParcelFileDescriptor.MODE_READ_ONLY))
      files.add(held) // retain partial descriptor BEFORE hashing or interpreting failure
      held.captured = Os.fstat(held.descriptor.fileDescriptor); check(same(before, checkNotNull(held.captured)))
      held.digest = held.hash(); return held
    }
    fun manifest(): ByteArray = app.assets.open(MANIFEST).use { stream ->
      val bytes = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
      while (true) { val n = stream.read(buffer); if (n < 0) break; check(n > 0 && bytes.size() + n <= 65536); bytes.write(buffer, 0, n) }
      check(bytes.size() > 0); bytes.toByteArray()
    }
    fun imageHash(loaded: String): String {
      val bang = loaded.indexOf("!/")
      if (bang >= 0) {
        val apk = File(loaded.substring(0, bang)).canonicalPath
        val entry = loaded.substring(bang + 2)
        check(entry.startsWith("lib/") && entry.split('/').size == 3 && entry.substringAfterLast('/') == libraryName)
        check(Build.SUPPORTED_ABIS.contains(entry.split('/')[1]))
        val held = files.firstOrNull { it.canonical == apk } ?: error("AI_LOADED_IMAGE_NOT_INSTALLED_APK")
        check(held.current())
        val zip = zipFiles.getOrPut(apk) { HeldZip(ZipFile("/proc/self/fd/${held.descriptor.fd}")) }.zip
        val member = checkNotNull(zip.getEntry(entry)); check(!member.isDirectory && member.size in 1..(512L shl 20))
        val result = zip.getInputStream(member).use { hashStream(it, 512L shl 20) }
        check(held.current()); return result
      }
      val expected = File(checkNotNull(original?.nativeDir), libraryName).canonicalPath
      check(File(loaded).canonicalPath == expected)
      val held = files.firstOrNull { it.canonical == expected } ?: hold(expected)
      check(held.current()); return held.digest
    }
    fun capture(implementingImage: String, privateModule: String) {
      check(implementingImage == privateModule) // original A's ONE combined image
      original = packageOriginal(app); checkNotNull(original).paths.forEach { hold(it) }
      manifestOriginal = manifest(); val m = JSONObject(Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(manifestOriginal)).toString())
      check(m.length() == 4 && m.getString("version") == "6" && m.getString("applicationId") == "com.ynxweb4.ai")
      val a = m.getJSONObject("implementingImage"); val b = m.getJSONObject("privateModule")
      check(a.length() == 1 && b.length() == 1)
      libraryName = a.getString("libraryName"); check(libraryName.matches(Regex("lib[A-Za-z0-9_-]+\\.so")) && b.getString("libraryName") == libraryName)
      imagePaths.add(implementingImage); imagePaths.add(privateModule)
      val implementing = imageHash(implementingImage); val module = imageHash(privateModule); val metadata = checkNotNull(original)
      val manifestHash = digest(manifestOriginal)
      val identity = identity(listOf("android", app.packageName, Process.myUid().toString(), metadata.version, metadata.updated,
        metadata.signerDigests.size.toString()) + metadata.signerDigests + listOf(metadata.paths.size.toString()) + files.take(metadata.paths.size).map { it.digest } + listOf(manifestHash, implementing, module))
      captured = arrayOf("android", app.packageName, identity, manifestHash, implementing, module)
      check(current() == 0)
    }
    fun current(): Int {
      if (Process.myTid() != actor) return ACTOR
      if (firstPresent) return first
      if (closed || retired.get()) return RETIRED
      return try {
        if (actualApplication !== app || packageOriginal(app) != original || !manifest().contentEquals(manifestOriginal) || files.any { !it.current() }) fail(CHANGED)
        else if (captured != null && (imageHash(imagePaths[0]) != captured!![4] || imageHash(imagePaths[1]) != captured!![5])) fail(CHANGED)
        else 0
      } catch (_: Throwable) { fail(IO) }
    }
    fun close(): IntArray {
      if (Process.myTid() != actor) return intArrayOf(1, ACTOR, 0)
      retired.set(true)
      if (closeUncertain) return intArrayOf(1, closeCode, 0)
      if (closed) return intArrayOf(0, 0, 1)
      for (held in zipFiles.values) if (!held.closeSelected) {
        held.closeSelected = true
        try { held.zip.close() } catch (_: Throwable) { closeUncertain = true; if (closeCode == 0) closeCode = IO }
      }
      for (held in files) if (!held.closeSelected) {
        held.closeSelected = true // close is selected only once, even if the OS result is uncertain
        try { held.descriptor.close() } catch (_: Throwable) { closeUncertain = true; if (closeCode == 0) closeCode = IO }
      }
      if (closeUncertain) return intArrayOf(1, closeCode, 0)
      closed = true; loans.remove(id, this); return intArrayOf(0, 0, 1)
    }
  }
  // Fixed private JNI methods. IDs never leave Native or reconstruct an owner
  // from caller DATA; this inventory retains every partial until physical close.
  @JvmStatic private fun captureNative(implementing: String, module: String): Long {
    val app = actualApplication ?: return 0
    val id = sequence.getAndIncrement(); if (id <= 0) return 0
    val loan = Loan(id, app); loans[id] = loan
    try { loan.capture(implementing, module) } catch (_: Throwable) { loan.fail(UNAVAILABLE) }
    return id
  }
  @JvmStatic private fun failureNative(id: Long): IntArray = loans[id]?.let { intArrayOf(if (it.firstPresent) 1 else 0, it.first) } ?: intArrayOf(1, INVALID)
  @JvmStatic private fun currentNative(id: Long): IntArray = loans[id]?.let { val rc = it.current(); intArrayOf(if (rc != 0 || it.firstPresent) 1 else 0, rc) } ?: intArrayOf(1, INVALID)
  @JvmStatic private fun readNative(id: Long): Array<String>? = loans[id]?.let { if (it.current() != 0 || it.firstPresent) null else it.captured?.clone() }
  @JvmStatic private fun retireNative(id: Long) { loans[id]?.retired?.set(true) }
  @JvmStatic private fun closeNative(id: Long): IntArray = loans[id]?.close() ?: intArrayOf(1, INVALID, 0)
}
