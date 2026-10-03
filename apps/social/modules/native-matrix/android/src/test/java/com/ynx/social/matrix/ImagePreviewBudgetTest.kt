package com.ynx.social.matrix

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.ByteArrayOutputStream

class ImagePreviewBudgetTest {
    private fun rejected(action: () -> Unit) {
        try { action(); fail("Expected predecode rejection") } catch (_: IllegalArgumentException) {}
    }
    @Test fun ordinary48MegapixelPhotoStillFits() { ImagePreviewBudget.check(8064, 6048, 1) }
    @Test fun sidePixelFrameAndOverflowLimits() {
        for ((w, h, f) in listOf(Triple(0, 10, 1), Triple(-1, 10, 1), Triple(16385, 1, 1),
            Triple(16384, 16384, 1), Triple(Int.MAX_VALUE, Int.MAX_VALUE, 1), Triple(1, 1, 257),
            Triple(4096, 4096, 2))) rejected { ImagePreviewBudget.check(w, h, f) }
        ImagePreviewBudget.check(4096, 4096, 1); ImagePreviewBudget.check(256, 256, 256)
    }
    private fun gif(frames: Int): ByteArray {
        val output = ByteArrayOutputStream()
        output.write("GIF89a".toByteArray()); output.write(byteArrayOf(1,0,1,0,0,0,0))
        repeat(frames) { output.write(byteArrayOf(0x2c,0,0,0,0,1,0,1,0,0,2,2,0x44,1,0)) }
        output.write(0x3b); return output.toByteArray()
    }
    private fun withFile(bytes: ByteArray, action: (File) -> Unit) {
        val file = File.createTempFile("social-public-header-", ".fixture")
        try { file.writeBytes(bytes); action(file) } finally { file.delete() }
    }
    @Test fun actualGifHeadersCountFramesWithoutRasterDecode() {
        withFile(gif(3)) { assertEquals(3, ImagePreviewBudget.frames(it, "image/gif", 1, 1)) }
    }
    @Test fun gifFrameFloodIsRejected() {
        withFile(gif(257)) { rejected { ImagePreviewBudget.frames(it, "image/gif", 1, 1) } }
    }
    @Test fun truncatedGifIsRejectedBeforePreview() {
        withFile(gif(2).copyOf(18)) {
            try { ImagePreviewBudget.frames(it, "image/gif", 1, 1); fail("Expected invalid metadata") }
            catch (_: java.io.EOFException) {}
        }
    }
}
