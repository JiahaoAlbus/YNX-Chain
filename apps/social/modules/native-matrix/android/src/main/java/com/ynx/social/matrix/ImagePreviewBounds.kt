package com.ynx.social.matrix

import android.graphics.BitmapFactory
import java.io.File

internal object ImagePreviewBounds {
    private val images = setOf("image/png", "image/jpeg", "image/webp", "image/gif")
    fun validate(file: File, declaredMime: String) {
        if (declaredMime !in images) return // Binary attachments are never decoded inline.
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true; inScaled = false }
        BitmapFactory.decodeFile(file.path, options) // Metadata only, no Bitmap allocation.
        ImagePreviewBudget.check(options.outWidth, options.outHeight, 1)
        // Count the actual codec, not the peer's possibly incorrect MIME label.
        val actualMime = options.outMimeType
        require(actualMime in images) { "MATRIX_MEDIA_IMAGE_METADATA_INVALID" }
        ImagePreviewBudget.frames(file, actualMime, options.outWidth, options.outHeight)
    }
}
