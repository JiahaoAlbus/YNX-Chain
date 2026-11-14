package com.ynx.social.matrix

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Presentation of one real same-worker Source read. Never a Source constructor,
 * device grant, signing review, background retry or replacement read operation. */
internal class VeilOwnDirectoryUi(private val original: Original) {
    internal interface Original {
        fun account(): String
        fun open()
        fun read(): ByteArray
        fun revalidateData()
        fun inventory(): VeilNativeMatrixSource.DirectoryCleanupInventory
        fun close()
    }
    private val worker = Thread.currentThread()
    private var selected = false
    private var closed = false
    private var physicallyClosed = false
    private var account: String? = null
    private var data: String? = null
    private var first: Throwable? = null
    private fun remember(t: Throwable) { if (first == null) first = t }
    fun observe(action: String): Map<String, Any?> {
        check(Thread.currentThread() === worker)
        require(action in setOf("read", "observe", "close"))
        if (physicallyClosed) return closedView()
        if (action == "close") {
            closed = true // UI cannot reopen this original, including partial close.
            data = null
            try { original.close() } catch (t: Throwable) { remember(t) }
        } else if (action == "read" && !selected && !closed) {
            selected = true // before any fallible current/open/read
            try {
                account = original.account()
                original.open()
                val bytes = original.read()
                require(bytes.size in 1..(4 * 1024 * 1024))
                val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
                check(original.account() == account)
                data = text
            } catch (t: Throwable) { remember(t) }
        }
        val inventory = try { original.inventory() } catch (t: Throwable) {
            remember(t); return view("RETAINED", null)
        }
        if (inventory.firstPresent) remember(VeilNativeMatrixSource.Refused(inventory.originalFirstRaw.toLong()))
        if (closed) {
            if (inventory.held) return view("CLOSING", null)
            physicallyClosed = true
            return closedView()
        }
        if (first != null) return view("RETAINED", null)
        if (!selected) return view("NOT_REQUESTED", null)
        val text = data ?: return view("RETAINED", null)
        return try {
            // Every UI publication needs fresh same-owner current/account.
            check(original.account() == account)
            original.revalidateData()
            view("OBSERVED", text)
        } catch (t: Throwable) { remember(t); view("RETAINED", null) }
    }
    private fun closedView() = view(if (first != null) "CLOSED_ERROR" else "CLOSED", null)
    private fun view(state: String, value: String?): Map<String, Any?> = mapOf(
        "version" to 1, "state" to state, "accountViewRef" to account,
        "data" to value, "firstFailureRetained" to (first != null))
    companion object {
        fun unavailable(): Map<String, Any?> = mapOf("version" to 1, "state" to "UNAVAILABLE",
            "accountViewRef" to null, "data" to null, "firstFailureRetained" to false)
    }
}
