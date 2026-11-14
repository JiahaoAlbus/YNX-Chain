package com.ynx.social.matrix

import java.io.File
import java.io.RandomAccessFile

internal object ImagePreviewBudget {
    const val MAX_FRAMES = 256
    const val MAX_SIDE = 16384
    const val STATIC_PIXELS = 64L * 1024 * 1024
    const val ANIMATED_PIXELS = 16L * 1024 * 1024
    private const val INVALID = "MATRIX_MEDIA_IMAGE_METADATA_INVALID"

    fun check(width: Int, height: Int, frames: Int) {
        require(width in 1..MAX_SIDE && height in 1..MAX_SIDE && frames in 1..MAX_FRAMES) {
            "MATRIX_MEDIA_IMAGE_PREVIEW_TOO_LARGE"
        }
        val pixels = width.toLong() * height
        require(pixels <= (if (frames == 1) STATIC_PIXELS else ANIMATED_PIXELS / frames)) {
            "MATRIX_MEDIA_IMAGE_PREVIEW_TOO_LARGE"
        }
    }

    // Reads block headers only; no compressed pixels are decoded or retained.
    fun frames(file: File, mime: String, width: Int, height: Int): Int = RandomAccessFile(file, "r").use { input ->
        require(input.length() in 1..(32L * 1024 * 1024)) { INVALID }
        fun tag(size: Int): String = ByteArray(size).also { input.readFully(it) }.toString(Charsets.ISO_8859_1)
        fun uintLE(): Long = java.lang.Integer.toUnsignedLong(Integer.reverseBytes(input.readInt()))
        fun uintBE(): Long = java.lang.Integer.toUnsignedLong(input.readInt())
        fun wordLE(): Int = java.lang.Short.toUnsignedInt(java.lang.Short.reverseBytes(input.readShort()))
        fun skip(size: Long) {
            require(size >= 0 && size <= input.length() - input.filePointer) { INVALID }
            input.seek(input.filePointer + size)
        }
        var blocks = 0
        fun boundedBlock() { require(++blocks <= 262144) { INVALID } }
        fun subBlocks() {
            while (true) {
                boundedBlock(); val size = input.readUnsignedByte()
                if (size == 0) return
                skip(size.toLong())
            }
        }
        var count = 0
        when (mime) {
            "image/gif" -> {
                require(tag(6) in setOf("GIF87a", "GIF89a")) { INVALID }
                require(wordLE() == width && wordLE() == height) { INVALID }
                val flags = input.readUnsignedByte(); skip(2)
                if (flags and 128 != 0) skip(3L * (1 shl ((flags and 7) + 1)))
                while (true) {
                    boundedBlock()
                    when (input.readUnsignedByte()) {
                        0x3b -> break
                        0x21 -> { input.readUnsignedByte(); subBlocks() }
                        0x2c -> {
                            val x = wordLE(); val y = wordLE(); val w = wordLE(); val h = wordLE()
                            require(w > 0 && h > 0 && x + w <= width && y + h <= height) { INVALID }
                            val local = input.readUnsignedByte()
                            if (local and 128 != 0) skip(3L * (1 shl ((local and 7) + 1)))
                            check(width, height, ++count)
                            input.readUnsignedByte(); subBlocks()
                        }
                        else -> error(INVALID)
                    }
                }
                require(count > 0) { INVALID }
            }
            "image/png" -> {
                require(tag(8) == "\u0089PNG\r\n\u001a\n") { INVALID }
                var declared = 0
                var ended = false
                while (input.filePointer < input.length()) {
                    boundedBlock(); val size = uintBE(); val kind = tag(4); val start = input.filePointer
                    require(size + 4 <= input.length() - start) { INVALID }
                    when (kind) {
                        "acTL" -> {
                            require(size == 8L && declared == 0) { INVALID }
                            val frames = uintBE(); require(frames in 1..MAX_FRAMES.toLong()) { INVALID }
                            declared = frames.toInt()
                        }
                        "fcTL" -> { require(size == 26L) { INVALID }; count++; check(width, height, count) }
                        "IEND" -> { require(size == 0L) { INVALID }; ended = true }
                    }
                    input.seek(start); skip(size + 4)
                    if (ended) break
                }
                require(ended && input.filePointer == input.length()) { INVALID }
                // Budget a separate default image as well as all animation frames.
                count = maxOf(declared, count).let { if (it > 0) it + 1 else 1 }
            }
            "image/webp" -> {
                require(tag(4) == "RIFF") { INVALID }
                require(uintLE() == input.length() - 8 && tag(4) == "WEBP") { INVALID }
                while (input.filePointer < input.length()) {
                    boundedBlock(); val kind = tag(4); val size = uintLE()
                    if (kind == "ANMF") { require(size >= 16) { INVALID }; check(width, height, ++count) }
                    skip(size + (size and 1))
                }
                count = maxOf(1, count)
            }
            "image/jpeg" -> count = 1 // Android's JPEG preview is a single raster.
            else -> error(INVALID)
        }
        check(width, height, count)
        count
    }
}
