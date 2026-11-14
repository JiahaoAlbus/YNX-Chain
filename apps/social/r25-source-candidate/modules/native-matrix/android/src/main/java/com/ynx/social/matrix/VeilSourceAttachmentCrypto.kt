package com.ynx.social.matrix

/** Native-only sodium primitive. No authority constructors or JS exports.
 * The normal accepted Source is checked by the caller around every primitive.
 * Same admitted sodium1.0.22/secretstream/64KiB chunks, independent random key.
 */
internal object VeilSourceAttachmentCrypto {
    const val MAX_CLEAR = 25 * 1024 * 1024
    const val MAX_WIRE = 35 + MAX_CLEAR + 400 * 21
    @JvmStatic private external fun transform(key: ByteArray, aad: ByteArray, input: ByteArray, opening: Boolean): ByteArray
    @JvmStatic private external fun freshKey(): ByteArray
    @JvmStatic external fun available(): Boolean
    fun key(checkCurrent: () -> Unit): ByteArray {
        checkCurrent()
        val key = freshKey()
        try { require(key.size == 32); checkCurrent(); return key }
        catch (failure: Throwable) { key.fill(0); throw failure }
    }
    fun seal(key: ByteArray, aad: ByteArray, body: ByteArray, guard: () -> Unit) = call(key, aad, body, false, guard)
    fun open(key: ByteArray, aad: ByteArray, body: ByteArray, guard: () -> Unit) = call(key, aad, body, true, guard)
    private fun call(key: ByteArray, aad: ByteArray, body: ByteArray, opening: Boolean, guard: () -> Unit): ByteArray {
        require(key.size == 32 && aad.size in 1..4096 && body.size in 1..if (opening) MAX_WIRE else MAX_CLEAR)
        guard()
        val result = transform(key, aad, body, opening)
        try { require(result.size in 1..if (opening) MAX_CLEAR else MAX_WIRE); guard(); return result }
        catch (failure: Throwable) { result.fill(0); throw failure }
    }
}
