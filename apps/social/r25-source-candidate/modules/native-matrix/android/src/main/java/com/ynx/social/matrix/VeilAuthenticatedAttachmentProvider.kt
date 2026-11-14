package com.ynx.social.matrix

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.provider.OpenableColumns
import java.io.FileNotFoundException
import java.util.UUID

/** Read-only, bounded OS view of ALREADY authenticated plaintext. No disk
 * plaintext, Source grant creation, key, JS API or arbitrary filesystem path.
 * Android enforces the explicit URI read grant on this non-exported provider.
 */
class VeilAuthenticatedAttachmentProvider : ContentProvider() {
    override fun onCreate() = true
    override fun getType(uri: Uri): String = synchronized(gate) { live(uri).mime }
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
        require(selection == null && selectionArgs == null && sortOrder == null)
        return synchronized(gate) {
            val lease = live(uri)
            val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
            require(columns.all { it in setOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE) })
            MatrixCursor(columns).apply { addRow(columns.map<String, Any> { if (it == OpenableColumns.DISPLAY_NAME) lease.name else lease.bytes.size }.toTypedArray()) }
        }
    }
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Read only")
        val lease = synchronized(gate) {
            val selected = live(uri)
            if (selected.opens >= 8) throw FileNotFoundException("Original view read limit")
            selected.opens++; selected
        }
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            try {
                val manager = checkNotNull(context).getSystemService(android.os.storage.StorageManager::class.java)
                return manager.openProxyFileDescriptor(ParcelFileDescriptor.MODE_READ_ONLY, object : android.os.ProxyFileDescriptorCallback() {
                    override fun onGetSize(): Long = synchronized(gate) { live(uri).bytes.size.toLong() }
                    override fun onRead(offset: Long, size: Int, data: ByteArray): Int = synchronized(gate) {
                        val current = live(uri)
                        if (current !== lease || offset < 0 || offset > current.bytes.size || size < 0 || size > data.size)
                            throw android.system.ErrnoException("read", android.system.OsConstants.EINVAL)
                        val count = minOf(size.toLong(), current.bytes.size - offset).toInt()
                        current.bytes.copyInto(data, 0, offset.toInt(), offset.toInt() + count)
                        count
                    }
                    override fun onRelease() { /* Same bounded lease; some viewers reopen after probing. */ }
                }, reader)
            } catch (failure: Throwable) { erase(uri); throw failure }
        }
        val pipe = try { ParcelFileDescriptor.createPipe() }
        catch (failure: Throwable) { erase(uri); throw failure }
        try {
            Thread({
                try {
                    ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { output ->
                        var offset = 0
                        while (offset < lease.bytes.size) {
                            val part = synchronized(gate) {
                                if (leases[uri.toString()] !== lease || SystemClock.elapsedRealtime() >= lease.expires)
                                    throw FileNotFoundException("Original view closed")
                                lease.bytes.copyOfRange(offset, minOf(offset + 65536, lease.bytes.size))
                            }
                            try { output.write(part); offset += part.size } finally { part.fill(0) }
                        }
                    }
                } catch (_: Throwable) { try { pipe[1].close() } catch (_: Throwable) { } }
                // The Native UI retains the bounded lease until its timer/close;
                // another read cannot re-download, decrypt or extend it.
            }, "YNX-authenticated-file-view").apply { isDaemon = true }.start()
            return pipe[0]
        } catch (failure: Throwable) { pipe.forEach { try { it.close() } catch (_: Throwable) { } }; erase(uri); throw failure }
    }
    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException("Read only")
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException("Read only")
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException("Read only")
    companion object {
        private class Lease(val bytes: ByteArray, val name: String, val mime: String, val expires: Long) { var opens = 0 }
        private val reader by lazy { android.os.Handler(android.os.HandlerThread("YNX-authenticated-file-reader").apply { start() }.looper) }
        private val gate = Any()
        private val leases = linkedMapOf<String, Lease>()
        private fun live(uri: Uri): Lease {
            val lease = leases[uri.toString()] ?: throw FileNotFoundException("Original view absent")
            if (SystemClock.elapsedRealtime() >= lease.expires) { erase(uri); throw FileNotFoundException("Original view expired") }
            return lease
        }
        internal fun publish(context: Context, clear: ByteArray, name: String, mime: String): Uri = synchronized(gate) {
            require(clear.size in 1..VeilSourceAttachmentCrypto.MAX_CLEAR)
            check(leases.size < 4 && leases.values.sumOf { it.bytes.size.toLong() } + clear.size <= 64L * 1024 * 1024)
            val uri = Uri.Builder().scheme("content").authority(context.packageName + ".veil.attachments")
                .appendPath("authenticated").appendPath(UUID.randomUUID().toString()).build()
            leases[uri.toString()] = Lease(clear.copyOf(), name, mime, SystemClock.elapsedRealtime() + 120000)
            uri
        }
        internal fun erase(uri: Uri) { synchronized(gate) { leases.remove(uri.toString())?.bytes?.fill(0) } }
    }
}
