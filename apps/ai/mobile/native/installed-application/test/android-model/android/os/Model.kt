@file:Suppress("DEPRECATION")
package android.os
import java.io.File
import java.io.FileDescriptor
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap
object Build { @JvmField val SUPPORTED_ABIS = arrayOf("arm64-v8a"); @JvmField var unused = 0
  object VERSION { @JvmField val SDK_INT = 36 }
}
object Process { @JvmStatic fun myUid() = 10001; @JvmStatic fun myTid() = Thread.currentThread().id.toInt() }
class ParcelFileDescriptor private constructor(val file: RandomAccessFile, val path: String) {
  val fileDescriptor: FileDescriptor get() = file.fd
  val fd = FileDescriptor::class.java.getDeclaredField("fd").let { it.isAccessible = true; it.getInt(file.fd) }
  var closed = false
  fun close() { closeCalls++; file.close(); closed = true; if (failClose) throw java.io.IOException("PUBLIC close outcome uncertain") }
  companion object {
    const val MODE_READ_ONLY = 1
    val held = ConcurrentHashMap<FileDescriptor, ParcelFileDescriptor>()
    var failClose = false; var closeCalls = 0
    @JvmStatic fun open(file: File, mode: Int): ParcelFileDescriptor {
      check(mode == MODE_READ_ONLY); val result = ParcelFileDescriptor(RandomAccessFile(file, "r"), file.path); held[result.fileDescriptor] = result; return result
    }
  }
}
