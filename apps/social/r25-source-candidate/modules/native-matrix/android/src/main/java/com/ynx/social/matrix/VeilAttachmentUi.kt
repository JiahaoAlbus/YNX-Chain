package com.ynx.social.matrix

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Concrete OS boundary, supplied only by this actual Expo module. No JS URI,
 * global picker callback, persistent URI grant or authorization provider. */
internal class VeilAttachmentUi(private val context: Context, private val activity: () -> Activity?) {
    data class Selected(val name: String, val mime: String, val clear: ByteArray)
    private class Pick(val activity: Activity, val stamp: VeilAttachmentUiLifetime.Token) { val result = CompletableFuture<Uri?>() }
    private val gate = Any()
    private val lifetime = VeilAttachmentUiLifetime(gate)
    private val main = Handler(Looper.getMainLooper())
    private var pending: Pick? = null
    private var closed = false
    private var cleanupFailure: Throwable? = null
    private val shown = mutableListOf<Uri>()
    fun available(): Boolean = synchronized(gate) { !closed && activity()?.isFinishing == false }
    fun choose(guard: () -> Unit): Selected? {
        check(Looper.myLooper() != Looper.getMainLooper())
        guard()
        val original = synchronized(gate) {
            check(!closed && pending == null)
            checkNotNull(activity()).let { Pick(it, lifetime.capture(it)) }.also { pending = it }
        }
        main.post {
            try {
                lifetime.current(original.stamp, activity()) {
                    check(!closed && pending === original)
                    original.activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }, REQUEST)
                }
            } catch (failure: Throwable) { original.result.completeExceptionally(failure) }
        }
        val selectionCurrent = {
            lifetime.current(original.stamp, activity()) { check(!closed && pending === original) }
            guard()
        }
        try {
            val uri = original.result.get(120, TimeUnit.SECONDS) ?: return null
            selectionCurrent()
            require(uri.scheme == "content")
            val resolver = context.contentResolver
            var name = "attachment"
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex)
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) require(cursor.getLong(sizeIndex) in 1..VeilSourceAttachmentCrypto.MAX_CLEAR.toLong())
                }
            }
            name = name.substringAfterLast('/').substringAfterLast('\\').filter { it.code >= 32 && it.code != 127 }.take(255).ifBlank { "attachment" }
            val mime = resolver.getType(uri)?.takeIf { it.matches(Regex("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")) && it.length <= 255 } ?: "application/octet-stream"
            val buffer = ByteArray(65536)
            val output = object : ByteArrayOutputStream() {
                @Synchronized override fun write(value: ByteArray, offset: Int, length: Int) {
                    val previous = buf
                    super.write(value, offset, length)
                    if (previous !== buf) previous.fill(0)
                }
                fun wipe() { buf.fill(0); reset() }
            }
            try {
                checkNotNull(resolver.openInputStream(uri)).use { input ->
                    while (true) {
                        selectionCurrent()
                        val count = input.read(buffer)
                        if (count < 0) break
                        require(output.size().toLong() + count <= VeilSourceAttachmentCrypto.MAX_CLEAR)
                        output.write(buffer, 0, count)
                    }
                }
                val bytes = output.toByteArray()
                try { require(bytes.isNotEmpty()); selectionCurrent(); return Selected(name, mime, bytes) }
                catch (failure: Throwable) { bytes.fill(0); throw failure }
            } finally { buffer.fill(0); output.wipe() }
        } finally {
            synchronized(gate) { if (pending === original) pending = null }
            original.result.complete(null) // late result has no remaining recipient
        }
    }
    fun onActivityResult(owner: Activity, request: Int, result: Int, data: Intent?) {
        if (request != REQUEST) return
        val original = synchronized(gate) { pending?.takeIf { !closed && it.activity === owner } } ?: return
        try {
            lifetime.current(original.stamp, owner) {
                if (pending === original) original.result.complete(if (result == Activity.RESULT_OK) data?.data else null)
            }
        } catch (_: IllegalStateException) { original.result.complete(null) }
    }
    fun show(name: String, mime: String, clear: ByteArray, guard: () -> Unit) {
        guard()
        val stamp = synchronized(gate) { check(!closed); lifetime.capture(checkNotNull(activity())) }
        val selected = VeilAuthenticatedAttachmentProvider.publish(context, clear, name, mime)
        try {
            lifetime.current(stamp, activity()) { check(!closed); shown.add(selected) }
            guard()
            val done = CompletableFuture<Unit>()
            main.post {
                try {
                    lifetime.current(stamp, activity()) {
                        check(!closed && selected in shown)
                        (stamp.activity as Activity).startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(selected, mime); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            clipData = android.content.ClipData.newRawUri(name, selected)
                        }, name))
                    }
                    done.complete(Unit)
                } catch (failure: Throwable) { done.completeExceptionally(failure) }
            }
            done.get(30, TimeUnit.SECONDS)
            lifetime.current(stamp, activity()) { check(!closed && selected in shown) }
            guard()
            main.postDelayed({
                try { erase(selected) } catch (failure: Throwable) { synchronized(gate) { if (cleanupFailure == null) cleanupFailure = failure } }
            }, 120000)
        } catch (failure: Throwable) {
            try { erase(selected) } catch (cleanup: Throwable) { failure.addSuppressed(cleanup) }
            throw failure
        }
    }
    private fun erase(uri: Uri) {
        try { context.revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        finally {
            VeilAuthenticatedAttachmentProvider.erase(uri)
            synchronized(gate) { shown.remove(uri) }
        }
    }
    fun onActivityDestroyed() = invalidate()
    fun invalidate() = invalidate(false)
    fun close() = invalidate(true)
    private fun invalidate(closing: Boolean) {
        val entries = synchronized(gate) {
            if (closing) { closed = true; lifetime.close() } else lifetime.invalidate()
            pending?.result?.complete(null); pending = null
            shown.toList()
        }
        entries.forEach { uri ->
            try { erase(uri) } catch (failure: Throwable) { synchronized(gate) { if (cleanupFailure == null) cleanupFailure = failure } }
        }
    }
    companion object { private const val REQUEST = 0x5941 }
}
