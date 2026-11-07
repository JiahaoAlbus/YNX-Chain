package android.system
import android.os.ParcelFileDescriptor
import java.io.FileDescriptor
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.util.concurrent.TimeUnit
class StructTimespec(@JvmField val tv_sec: Long, @JvmField val tv_nsec: Long)
class StructStat(private val attrs: Map<String, Any>) {
  @JvmField val st_dev = (attrs["dev"] as Number).toLong()
  @JvmField val st_ino = (attrs["ino"] as Number).toLong()
  @JvmField val st_size = (attrs["size"] as Number).toLong()
  @JvmField val st_uid = (attrs["uid"] as Number).toInt()
  @JvmField val st_gid = (attrs["gid"] as Number).toInt()
  @JvmField val st_mode = (attrs["mode"] as Number).toInt()
  private fun time(name: String): StructTimespec { val n = (attrs[name] as FileTime).to(TimeUnit.NANOSECONDS); return StructTimespec(n / 1000000000, n % 1000000000) }
  @JvmField val st_mtim = time("lastModifiedTime")
  @JvmField val st_ctim = time("ctime")
}
object OsConstants { @JvmStatic fun S_ISREG(mode: Int) = mode and 61440 == 32768 }
object Os {
  @JvmStatic fun lstat(path: String): StructStat = StructStat(Files.readAttributes(Path.of(path), "unix:*", java.nio.file.LinkOption.NOFOLLOW_LINKS))
  @JvmStatic fun fstat(fd: FileDescriptor): StructStat { val held = checkNotNull(ParcelFileDescriptor.held[fd]); check(!held.closed); return lstat(held.path) }
  @JvmStatic fun pread(fd: FileDescriptor, bytes: ByteArray, offset: Int, count: Int, position: Long): Int {
    val held = checkNotNull(ParcelFileDescriptor.held[fd]); check(!held.closed); synchronized(held) { held.file.seek(position); return held.file.read(bytes, offset, count) }
  }
}
