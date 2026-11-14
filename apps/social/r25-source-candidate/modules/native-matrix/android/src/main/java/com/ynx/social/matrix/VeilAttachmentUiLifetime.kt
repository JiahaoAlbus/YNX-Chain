package com.ynx.social.matrix

/** Mechanical presentation fence only. A token cannot grant Native, account,
 * device, file or Source authority. The real Source guard stays on its worker.
 * Shared monitor makes OS dispatch linearize against synchronous UI invalidation.
 */
internal class VeilAttachmentUiLifetime(private val gate: Any = Any()) {
    internal class Token internal constructor(internal val owner: VeilAttachmentUiLifetime, internal val revision: Any, internal val activity: Any)
    private var revision = Any()
    private var closed = false
    fun capture(activity: Any): Token = synchronized(gate) {
        check(!closed); Token(this, revision, activity)
    }
    fun <T> current(token: Token, activity: Any?, block: () -> T): T = synchronized(gate) {
        check(!closed && token.owner === this && token.revision === revision && token.activity === activity) { "VEIL_ATTACHMENT_UI_LIFETIME_CHANGED" }
        block()
    }
    fun invalidate() { synchronized(gate) { revision = Any() } }
    fun close() { synchronized(gate) { closed = true; revision = Any() } }
}
