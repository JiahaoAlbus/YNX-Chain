package com.ynxweb4.receivepng

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Public PNG only. No vault, key, network, broad storage permission or URI grant
 * persistence. Activity recreation never replays a write in a fallback callback. */
class YnxReceivePngModule : Module() {
  private var picker: AppContextActivityResultLauncher<String, Destination>? = null
  private val saving = AtomicBoolean(false)
  @Volatile private var foreground = false
  @Volatile private var destroyed = false
  override fun definition() = ModuleDefinition {
    Name("YnxReceivePng")
    RegisterActivityContracts { picker = registerForActivityResult(CreatePNG()) }
    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground { foreground = false }
    OnDestroy { destroyed = true }
    AsyncFunction("savePng") Coroutine { base64: String, filename: String ->
      if (destroyed || !foreground) throw ExportFailure("RECEIVE_PNG_NOT_FOREGROUND")
      if (!saving.compareAndSet(false, true)) throw ExportFailure("RECEIVE_PNG_BUSY")
      try {
        val bytes = validatePNG(base64, filename)
        val launcher = picker ?: throw ExportFailure("RECEIVE_PNG_UNAVAILABLE")
        val destination = withContext(Dispatchers.Main) { launcher.launch(filename) }
        if (destination.cancelled) mapOf("status" to "cancelled") else {
          val uri = destination.uri ?: throw ExportFailure("RECEIVE_PNG_WRITE_UNKNOWN")
          if (destroyed || uri.scheme != "content") throw ExportFailure("RECEIVE_PNG_WRITE_UNKNOWN")
          val context = appContext.reactContext ?: throw ExportFailure("RECEIVE_PNG_WRITE_UNKNOWN")
          // A user-picked document can fail after a partial write. Never report
          // success, auto-delete it, retry, or reopen the picker on that failure.
          withContext(Dispatchers.IO) {
            context.contentResolver.openOutputStream(uri, "w")?.use { stream ->
              stream.write(bytes)
              stream.flush()
            } ?: throw ExportFailure("RECEIVE_PNG_WRITE_UNKNOWN")
          }
          mapOf("status" to "saved")
        }
      } finally { saving.set(false) }
    }
  }
  private data class Destination(val cancelled: Boolean, val uri: Uri? = null)
  private class CreatePNG : AppContextActivityResultContract<String, Destination> {
    override fun createIntent(context: Context, input: String) = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "image/png"
      putExtra(Intent.EXTRA_TITLE, input)
    }
    override fun parseResult(input: String, resultCode: Int, intent: Intent?) =
      Destination(resultCode == Activity.RESULT_CANCELED, if (resultCode == Activity.RESULT_OK) intent?.data else null)
  }
  private fun validatePNG(base64: String, filename: String): ByteArray {
    if (!Regex("YNX-Testnet-receive-ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}\\.png").matches(filename) ||
      base64.length > 699052 || base64.length % 4 != 0 || !Regex("iVBORw0KGgo[A-Za-z0-9+/]*={0,2}").matches(base64)) throw ExportFailure("INVALID_RECEIVE_PNG")
    val bytes = try { Base64.decode(base64, Base64.NO_WRAP) } catch (_: IllegalArgumentException) { throw ExportFailure("INVALID_RECEIVE_PNG") }
    if (bytes.size > 524288 || bytes.size < 24 || !bytes.copyOfRange(0, 8).contentEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10))) throw ExportFailure("INVALID_RECEIVE_PNG")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outMimeType != "image/png" || bounds.outWidth !in 64..2048 || bounds.outHeight !in 64..2048) throw ExportFailure("INVALID_RECEIVE_PNG")
    return bytes
  }
  private class ExportFailure(code: String) : CodedException(code, "Receiving PNG was not confirmed saved. Check the chosen file before trying again.", null)
}
