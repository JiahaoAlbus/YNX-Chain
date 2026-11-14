package com.ynx.social.matrix

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import org.matrix.rustcomponents.sdk.Client
import java.io.InputStream
import java.util.concurrent.atomic.AtomicBoolean

/** Actual bounded reader composition; original SDK streaming producer missing.
 * No fallback to getMediaContent/getMediaFile or a copied-token HTTP client.
 * Neither a caller's version string nor this interface is producer admission. */
internal class VeilMatrixBoundedDownload(
  private val original: OriginalSdkStreams? = null
) : VeilMatrixPipeline.BoundedCipherDownload {
  internal data class Response(val input: InputStream, val advertisedLength: Long?)
  internal fun interface OriginalSdkStreams {
    // Producer must use original native SDK client/session with approved stream
    // limit, finite socket timeout/cancellation and no upstream whole-body buffer.
    // This component cannot prove those requirements from InputStream alone.
    suspend fun open(client: Client, media: String, maximum: Int, recheck: () -> Unit): Response
  }

  override suspend fun download(client: Client, media: String, maximum: Int, recheck: () -> Unit): ByteArray {
    check(maximum in 1..(2 * 1024 * 1024)
      && Regex("mxc://[A-Za-z0-9.\\[\\]:-]+/[A-Za-z0-9_-]+").matches(media)) { "VEIL_MATRIX_EVENT_INVALID" }
    val producer = original ?: error("VEIL_MATRIX_BOUNDED_STREAM_UNAVAILABLE")
    recheck()
    return withContext(Dispatchers.IO) {
      recheck()
      val response = producer.open(client, media, maximum, recheck)
      val readerOwns = AtomicBoolean(false)
      try {
        recheck()
        check(response.advertisedLength == null || response.advertisedLength == maximum.toLong()) {
          "VEIL_CIPHER_SIZE_MISMATCH"
        }
        runInterruptible {
          readerOwns.set(true)
          VeilBoundedCipherRead.readExact(response.input, maximum, recheck)
        }
      } finally {
        // Cancellation before the reader starts must still abort the response.
        // Once started, readExact owns close/wipe, including close failures.
        if (!readerOwns.get()) response.input.close()
      }
    }
  }
}
