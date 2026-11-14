package com.ynx.social.matrix

/** Normal-worker business orchestration. Neither Binding nor an observed view
 * grants Native authority. Native device/session checks and per-operation
 * admission remain mandatory. No default/JS/runtime-created supplier exists.
 *
 * VeilMatrixProductBinding below owns product state and courier integration.
 * Only its actual Native source remains an upstream owning producer, not
 * supplied by the seven private execution actions or PUBLIC test controls.
 */
internal class VeilNativeMessageBusiness private constructor(
    private val native: NativePort,
    private val binding: Binding
) : VeilSocialMessagingCoordinator.Business {
    internal enum class Completion { PENDING, COMMITTED, ABORTED, UNKNOWN }
    internal interface Original {
        val reference: String
        fun checkCurrent()
        /** Same original normal command/context, checked by its producer. */
        fun requireRequest(command: Map<String, Any?>, context: Map<String, Any?>)
        /** Verified original commit/readback, never merely HTTP success. */
        fun completion(): Completion
        /** Retire only this original. Failure leaves its custody intact. */
        fun close()
    }
    internal interface Message : Original {
        /** Owned copies of existing Native wire inputs, not new wire schemas. */
        fun sessionRecords(): ByteArray
        fun frame(): ByteArray
        /** Same original protected outbox/inbox and transport. Must retain its
         * attempted state before I/O and never re-encrypt on an uncertain reply. */
        fun consumeOriginalOutput(output: VeilNativeMessageOutput)
    }
    /** Only genuine captured kind5 originals use this protocol consumer. */
    internal interface InitialSessionReceive : Message {
        fun controlAuthority(): VeilMatrixProductBinding.MessageAuthority
        /** Protocol bookkeeping only: no MessageContent JSON/bubble/draft clear. */
        fun recordVerifiedControl(output: VeilNativeMessageOutput)
    }
    /** Only the genuine established-purpose Source original uses this path. */
    internal interface InitialSessionSend : Message {
        fun canonicalPeerBundle(): ByteArray
        fun controlAuthority(): VeilMatrixProductBinding.MessageAuthority
    }
    internal interface Contact : Original {
        /** Uses the genuine ongoing request-bound actor, not an init cookie. */
        fun executeOriginal()
    }
    internal interface Binding {
        fun validate(command: Map<String, Any?>): String? = null
        fun nextIncoming(capture: (Message) -> Unit) {}
        fun checkCurrent()
        /** Authorized projection from the original protected product store.
         * It must not synthesize authorization from inventory or HTTP status. */
        fun projection(): Map<String, Any?>
        fun openConversation(command: Map<String, Any?>): Map<String, Any?>
        fun viewStoredMessage(command: Map<String, Any?>): Map<String, Any?> = error("VEIL_PRODUCT_STORED_MESSAGE_REQUIRED")
        fun searchLocalMessages(command: Map<String, Any?>): Map<String, Any?> = error("VEIL_PRODUCT_LOCAL_SEARCH_REQUIRED")
        fun markConversationRead(command: Map<String, Any?>): Map<String, Any?> = error("VEIL_PRODUCT_LOCAL_READ_REQUIRED")
        fun loadProtectedDraft(command: Map<String, Any?>, context: Map<String, Any?>): Map<String, Any?> = error("VEIL_PRODUCT_PROTECTED_DRAFT_REQUIRED")
        fun saveProtectedDraft(command: Map<String, Any?>, context: Map<String, Any?>): Map<String, Any?> = error("VEIL_PRODUCT_PROTECTED_DRAFT_REQUIRED")
        fun selectAttachment(command: Map<String, Any?>, context: Map<String, Any?>): Map<String, Any?> = error("VEIL_ATTACHMENT_OWNER_REQUIRED")
        fun openAttachment(command: Map<String, Any?>): Map<String, Any?> = error("VEIL_ATTACHMENT_OWNER_REQUIRED")
        fun recoverLocalViewFailure(): Map<String, Any?>? = null
        /** Capture transfers ownership only when it returns normally. Publish
         * before effects. An exception/partial acquisition stays at this owner. */
        fun prepare(command: Map<String, Any?>, context: Map<String, Any?>,
                    capture: (Original) -> Unit)
        fun hasRetainedWork(): Boolean
        fun hasWorkBlockingOwnerClose(): Boolean = hasRetainedWork()
        /** Historical lookup only; absence of an implementation never proves completion. */
        fun reviewSavedOriginal(reference: String, context: Map<String, Any?>): Map<String, Any?>? = null
        fun reconcileActiveOriginal(original: Original,
            acknowledgeNative: (VeilNativeMatrixSource, String, String, Int) -> Unit): Boolean = false
    }
    internal interface NativeOperation
    internal interface NativePort {
        fun deviceCurrent()
        fun openSession(records: ByteArray)
        fun epoch(): Long
        fun acquire(epoch: Long, frame: ByteArray): NativeOperation
        fun beginInitialReceive(epoch: Long, frame: ByteArray): NativeOperation = error("VEIL_INITIAL_RECEIVE_NATIVE_OWNER_REQUIRED")
        fun beginInitialSend(epoch: Long, frame: ByteArray, canonicalPeerBundle: ByteArray): NativeOperation =
            error("VEIL_INITIAL_SEND_NATIVE_OWNER_REQUIRED")
        fun execute(original: NativeOperation, epoch: Long, frame: ByteArray): Long
        fun advance(original: NativeOperation, epoch: Long): Long
        fun output(original: NativeOperation, epoch: Long, consume: (VeilNativeMessageOutput) -> Unit)
        fun retire(original: NativeOperation, epoch: Long)
        fun hasRetainedWork(): Boolean
        fun acknowledgeFinalizedLocal(original: NativeOperation?, epoch: Long, source: VeilNativeMatrixSource,
            account: String, reference: String, direction: Int) { error("VEIL_PRODUCT_NATIVE_FINALIZATION_REQUIRED") }
    }
    private enum class Phase { CAPTURED, NATIVE_HELD, OUTPUT, COMMIT, RETIRED, CLOSED }
    private class Pending(val original: Original, val incoming: Boolean) {
        var phase = Phase.CAPTURED
        var native: NativeOperation? = null
        var epoch = 0L
        var frame: ByteArray? = null
        var unknown = false
        var closeAttempted = false
    }
    private val worker = Thread.currentThread()
    private var pending: Pending? = null
    private var preparing = false
    private var firstFailure: Throwable? = null
    private var failureHeld = false
    private var localViewFailure = false
    private val finalizedHistory = linkedMapOf<String, Pending>()
    private var lastView: Map<String, Any?>? = null

    private fun checked() = check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
    private fun current() {
        checked()
        binding.checkCurrent()
        native.deviceCurrent()
    }
    private fun view(): Map<String, Any?> {
        current()
        val value = binding.projection()
        require(value["kind"] == "AUTHORIZED")
        for (key in listOf("accountViewRef", "viewRevision")) reference(value[key])
        current()
        return value.also { lastView = it }
    }
    private fun fail(failure: Throwable) {
        failureHeld = true
        if (firstFailure == null) firstFailure = failure
        else if (firstFailure !== failure) firstFailure!!.addSuppressed(failure)
        pending?.unknown = true
    }
    private fun error(code: String) = mapOf<String, Any?>("kind" to "error", "code" to code)
    private fun waiting(p: Pending) = mapOf<String, Any?>(
        "kind" to "pending", "disposition" to if (p.unknown) "unknown" else "queued",
        "originalOperationRef" to p.original.reference)
    private fun recovery(): Map<String, Any?> {
        val p = pending
        val previous = lastView
        if (p == null || previous == null) return mapOf(
            "kind" to "UNAVAILABLE", "gaps" to listOf("RESTORE_PRODUCT_BINDING_UNAVAILABLE"))
        return mapOf("kind" to "RECOVERY_REQUIRED",
            "accountViewRef" to previous.getValue("accountViewRef"),
            "viewRevision" to previous.getValue("viewRevision"),
            "items" to listOf(mapOf("originalOperationRef" to p.original.reference,
                "label" to "Check the original operation", "state" to "unknown")))
    }

    /** Cached delivery is still subject to the real source/device authority.
     * Unlike read(), this cannot poll, prepare, advance, consume or resend work.
     * An existing UNKNOWN operation and its first failure remain untouched. */
    override fun requireDeliveryCurrent() { current() }

    override fun read(context: Map<String, Any?>): Map<String, Any?> {
        checked()
        if (localViewFailure && pending == null && !preparing) {
            try {
                current()
                if (native.hasRetainedWork()) return recovery()
                val actual = binding.recoverLocalViewFailure() ?: return recovery()
                require(actual["kind"] == "AUTHORIZED")
                current()
                localViewFailure = false; failureHeld = false; lastView = actual
                return actual // Only actual readonly state; never retry the write.
            } catch (error: Throwable) { fail(error); return recovery() }
        }
        val held = pending
        if (held != null && held.phase != Phase.CLOSED && (failureHeld || held.unknown || held.closeAttempted)) {
            try {
                current()
                check(finalizedHistory.size < 4096 || finalizedHistory.containsKey(held.original.reference))
                val completed = binding.reconcileActiveOriginal(held.original) { source, account, reference, direction ->
                    check(pending === held && reference == held.original.reference)
                    if (held.original is Message) {
                        check(direction == if (held.incoming) 2 else 1)
                        native.acknowledgeFinalizedLocal(held.native, held.epoch, source, account, reference, direction)
                    } else check(direction == 0 && held.native == null)
                }
                if (completed) {
                    held.frame?.fill(0); held.frame = null
                    // Keep the UNKNOWN bit, old phase and first Throwable in
                    // private history. Actual final proof only ends live hold.
                    finalizedHistory[held.original.reference] = held
                    pending = null; preparing = false; failureHeld = false
                    return view() // No inbox poll/new intent in this read.
                }
            } catch (error: Throwable) { fail(error) }
            return recovery()
        }
        if (failureHeld || pending?.unknown == true) return recovery()
        return try {
            if (pending == null) {
                view()
                binding.nextIncoming { original ->
                    check(pending == null) { "VEIL_PRODUCT_ORIGINAL_ALREADY_CAPTURED" }
                    reference(original.reference)
                    pending = Pending(original, true)
                }
            }
            pending?.let { progress(it) } // One step, never a loop or new intent.
            if (pending?.unknown == true) recovery() else view().also {
                if (pending?.phase == Phase.CLOSED) pending = null
            }
        } catch (failure: Throwable) {
            if (pending == null && failure is VeilMatrixProductBinding.HistoryCapacity)
                mapOf("kind" to "UNAVAILABLE", "gaps" to listOf("SOCIAL_STORAGE_CAPACITY"))
            else { fail(failure); recovery() }
        }
    }
    /** Read-only startup projection. Unlike a normal inbox read this neither
     * polls Matrix nor prepares/decrypts a message during login publication. */
    internal fun requireStartupProjection() {
        checked()
        if (failureHeld) firstFailure?.let { throw it }
        check(pending == null && !preparing) { "VEIL_PRODUCT_ORIGINAL_RETAINED" }
        view() // Actual Native device + owning source + private store, not inventory.
    }

    override fun execute(command: Map<String, Any?>, context: Map<String, Any?>): Map<String, Any?> {
        checked()
        if (command["type"] == "reviewRecovery") return review(command, context)
        if (failureHeld || pending != null || preparing) return error("REVIEW_REQUIRED")
        val type = command["type"] as? String ?: return error("INPUT_INVALID")
        if (type !in setOf("openConversation", "viewStoredMessage", "markConversationRead", "searchLocalMessages", "loadDraft", "saveDraft", "selectAttachment", "sendAttachment", "openAttachment", "sendMessage", "requestContact", "acceptContact", "rejectContact", "blockContact", "unblockContact"))
            return error("UNAVAILABLE")
        val localReadAction = type in setOf("selectAttachment", "openAttachment", "openConversation", "viewStoredMessage", "markConversationRead", "searchLocalMessages", "loadDraft", "saveDraft")
        try {
            val before = view()
            if (before["accountViewRef"] != context["accountViewRef"] ||
                before["viewRevision"] != context["viewRevision"] ||
                command["viewRevision"] != context["viewRevision"]) return error("STALE_VIEW")
            if (type == "markConversationRead" && (before["messageWindow"] as? Map<*, *>)?.get("mode") == "anchored") return error("STALE_VIEW")
            if ((before["actions"] as? List<*>)?.contains(type) != true) return error("LOCKED")
            if (type == "selectAttachment" || type == "openAttachment") {
                if (before["activeConversationId"] != command["conversationId"]) return error("STALE_VIEW")
                current()
                val result = if (type == "selectAttachment") binding.selectAttachment(command, context) else binding.openAttachment(command)
                current()
                return result
            }
            if (type == "loadDraft" || type == "saveDraft") {
                if (before["activeConversationId"] != command["conversationId"]) return error("STALE_VIEW")
                current()
                val result = if (type == "loadDraft") binding.loadProtectedDraft(command, context)
                    else binding.saveProtectedDraft(command, context)
                if (result["kind"] == "error") return result
                require(result["kind"] == "draft" && result["conversationId"] == command["conversationId"] &&
                    result["completion"] == if (type == "loadDraft") "read" else "stored")
                require(result.containsKey("originalOperationRef") && result["originalOperationRef"] == null)
                current()
                return result
            }
            if (type == "searchLocalMessages") {
                current()
                val found = binding.searchLocalMessages(command)
                current()
                return found
            }
            if (localReadAction) {
                if (type == "markConversationRead" && (before["activeConversationId"] != command["conversationId"] ||
                    (before["messages"] as? List<*>)?.none { item ->
                        item is Map<*, *> && item["id"] == command["throughMessageId"] && item["conversationId"] == command["conversationId"]
                    } != false)) return error("STALE_VIEW")
                current()
                val opened = when (type) {
                    "openConversation" -> binding.openConversation(command)
                    "viewStoredMessage" -> binding.viewStoredMessage(command)
                    else -> binding.markConversationRead(command)
                }
                if (opened["kind"] == "error") return opened
                require(opened["kind"] == "AUTHORIZED" &&
                    opened["accountViewRef"] == before["accountViewRef"] &&
                    opened["activeConversationId"] == command["conversationId"])
                current()
                lastView = opened
                return mapOf("kind" to "snapshot", "snapshot" to opened,
                    "completion" to "read", "originalOperationRef" to null)
            }
            binding.validate(command)?.let { return error(it) }
            preparing = true
            binding.prepare(command, context) { original ->
                check(pending == null) { "VEIL_PRODUCT_ORIGINAL_ALREADY_CAPTURED" }
                reference(original.reference)
                require(if (type in setOf("sendMessage", "sendAttachment")) original is Message else original is Contact)
                pending = Pending(original, false)
            }
            val selected = checkNotNull(pending) { "VEIL_PRODUCT_ORIGINAL_NOT_CAPTURED" }
            preparing = false
            selected.original.requireRequest(command, context)
            current()
            progress(selected)
            if (selected.phase != Phase.CLOSED) return waiting(selected)
            val after = view()
            check(after["accountViewRef"] == before["accountViewRef"])
            if (type in setOf("sendMessage", "sendAttachment")) check(after["activeConversationId"] == command["conversationId"])
            pending = null
            return mapOf("kind" to "snapshot", "snapshot" to after,
                "completion" to "confirmed", "originalOperationRef" to selected.original.reference)
        } catch (failure: Throwable) {
            // The producer still owns a partial acquire which could not be
            // captured. Never replace it or infer no effect from no local token.
            if (localReadAction) localViewFailure = true
            fail(failure)
            return pending?.let { waiting(it) } ?: error("OUTCOME_UNKNOWN")
        }
    }

    /** Internal normal-worker producer, not a JS/UI algorithm action. The exact
     * logical and PUBLIC peer bytes must come from the SAME retained authorized
     * once-claim. Source/Native still independently authorize the full request. */
    internal fun establishSession(command: Map<String, Any?>, context: Map<String, Any?>,
                                  logicalId: String, canonicalPeerBundle: ByteArray): Map<String, Any?> {
        checked()
        if (failureHeld || pending != null || preparing) return error("REVIEW_REQUIRED")
        val actual = binding as? VeilMatrixProductBinding ?: return error("UNAVAILABLE")
        try {
            VeilSocialMessagingCoordinator.Request.decodeSourceOriginal(
                VeilSocialMessagingCoordinator.jsonObject(context).toString(),
                VeilSocialMessagingCoordinator.jsonObject(command).toString())
            require(command["type"] == "establishSession")
            val before = view()
            if (before["accountViewRef"] != context["accountViewRef"] ||
                before["viewRevision"] != context["viewRevision"] ||
                before["activeConversationId"] != command["conversationId"]) return error("STALE_VIEW")
            preparing = true
            actual.prepareInitialSession(command, context, logicalId, canonicalPeerBundle) { original ->
                check(pending == null) { "VEIL_PRODUCT_ORIGINAL_ALREADY_CAPTURED" }
                reference(original.reference)
                require(original.reference == logicalId)
                pending = Pending(original, false)
            }
            val selected = checkNotNull(pending) { "VEIL_PRODUCT_ORIGINAL_NOT_CAPTURED" }
            preparing = false
            selected.original.requireRequest(command, context)
            current(); progress(selected)
            if (selected.phase != Phase.CLOSED) return waiting(selected)
            val after = view()
            check(after["accountViewRef"] == before["accountViewRef"] &&
                after["activeConversationId"] == command["conversationId"])
            pending = null
            return mapOf("kind" to "snapshot", "snapshot" to after,
                "completion" to "confirmed", "originalOperationRef" to selected.original.reference)
        } catch (failure: Throwable) {
            fail(failure)
            return pending?.let { waiting(it) } ?: error("OUTCOME_UNKNOWN")
        }
    }

    /** Existing sync worker hands over an owned, authenticated original.
     * No selector, cipher kind or public transport event can construct one. */
    fun receive(original: Message) {
        checked()
        check(pending == null && !preparing && !failureHeld)
        reference(original.reference)
        val selected = Pending(original, true)
        pending = selected
        try { current(); progress(selected) }
        catch (failure: Throwable) { fail(failure); throw failure }
    }

    private fun progress(p: Pending) {
        check(pending === p)
        if (p.unknown || failureHeld || p.closeAttempted) return
        current()
        p.original.checkCurrent()
        when (p.phase) {
            Phase.CAPTURED -> {
                if (p.original is Contact) {
                    p.phase = Phase.COMMIT // Before the actual request.
                    p.original.executeOriginal()
                } else {
                    val message = p.original as Message
                    val records = message.sessionRecords()
                    try { native.openSession(records) } finally { records.fill(0) }
                    val frame = message.frame()
                    p.frame = frame
                    if (message is InitialSessionReceive) {
                        require(p.incoming)
                        VeilNativeProductPorts.validateInitialSessionReceiveFrame(frame)
                    } else if (message is InitialSessionSend) {
                        require(!p.incoming)
                        VeilNativeProductPorts.validateInitialSessionFrame(frame)
                    } else VeilNativeProductPorts.validateFrame(frame, if (p.incoming) 2 else 1)
                    p.epoch = native.epoch()
                    p.native = when (message) {
                        is InitialSessionReceive -> native.beginInitialReceive(p.epoch, frame)
                        is InitialSessionSend -> {
                            val peer = message.canonicalPeerBundle()
                            try { native.beginInitialSend(p.epoch, frame, peer) }
                            finally { peer.fill(0) }
                        }
                        else -> native.acquire(p.epoch, frame)
                    }
                    // Stage before entering native, so a thrown return can never
                    // cause the original prepare/encrypt to run a second time.
                    p.phase = Phase.NATIVE_HELD
                    val status = native.execute(checkNotNull(p.native), p.epoch, frame)
                    require(status == 0L || status == 30L)
                    if (status == 30L) return
                    p.phase = Phase.OUTPUT
                }
            }
            Phase.NATIVE_HELD -> {
                val status = native.advance(checkNotNull(p.native), p.epoch)
                require(status == 0L || status == 30L)
                if (status == 30L) return
                p.phase = Phase.OUTPUT
            }
            else -> Unit
        }
        if (p.phase == Phase.OUTPUT) {
            p.phase = Phase.COMMIT // Never retransmit if the consumer throws.
            native.output(checkNotNull(p.native), p.epoch) { output ->
                p.original.checkCurrent()
                val message = p.original as Message
                if (message is InitialSessionReceive) {
                    require(p.incoming && output.direction == 2 && output.kind == 4)
                    val authority = message.controlAuthority()
                    authority.checkCurrent()
                    authority.requireCommittedOutput(output)
                    authority.checkCurrent()
                    message.recordVerifiedControl(output)
                    authority.checkCurrent()
                } else {
                    require(output.kind != 4) { "VEIL_CONTROL_CANNOT_BECOME_CHAT_MESSAGE" }
                    message.consumeOriginalOutput(output)
                }
            }
        }
        if (p.phase == Phase.COMMIT) {
            current()
            p.original.checkCurrent()
            when (p.original.completion()) {
                Completion.PENDING -> return
                Completion.UNKNOWN, Completion.ABORTED -> { p.unknown = true; return }
                Completion.COMMITTED -> finish(p)
            }
        }
    }

    private fun finish(p: Pending) {
        // Verified durable commit is distinct from sending and peer delivery.
        current()
        p.original.checkCurrent()
        if (p.phase != Phase.RETIRED) {
            p.native?.let { native.retire(it, p.epoch) }
            p.phase = Phase.RETIRED
        }
        check(!p.closeAttempted)
        p.closeAttempted = true
        p.original.close()
        p.phase = Phase.CLOSED
        p.frame?.fill(0); p.frame = null
        // Retain the completed original until its authorized view is published.
    }

    private fun review(command: Map<String, Any?>, context: Map<String, Any?>): Map<String, Any?> {
        val p = pending ?: return try {
            val reference = command["originalOperationRef"] as? String ?: return error("INPUT_INVALID")
            reference(reference)
            // Historical lookup validates the same Source/account itself. A
            // fresh projection may require new-business current and must not
            // prevent observation of an original after local UNKNOWN.
            if (lastView != null && lastView?.get("accountViewRef") != context["accountViewRef"]) return error("STALE_VIEW")
            binding.reviewSavedOriginal(reference, context) ?: error("REVIEW_REQUIRED")
        } catch (failure: Throwable) {
            fail(failure)
            error("REVIEW_REQUIRED")
        }
        if (command["originalOperationRef"] != p.original.reference ||
            lastView?.get("accountViewRef") != context["accountViewRef"]) return error("STALE_VIEW")
        // Query the same retained owner only. No prepare, execute, transmit,
        // retirement or cleanup retry happens as a side effect of this read.
        return try {
            // A closed Native child can no longer pass its live-current getter.
            // The concrete binding reads this exact saved original plus genuine
            // historical terminal, without releasing any Java/native custody.
            binding.reviewSavedOriginal(p.original.reference, context)?.let { return it }
            current() // ordinary live-owner fallback retains every business gate
            p.original.checkCurrent()
            val state = p.original.completion()
            current()
            mapOf("kind" to "originalReview", "originalOperationRef" to p.original.reference,
                "resolution" to if (p.closeAttempted) "unresolved" else when (state) {
                    Completion.COMMITTED -> "confirmed"
                    Completion.ABORTED -> "aborted"
                    else -> "unresolved"
                },
                "nextStep" to if (p.closeAttempted || state == Completion.PENDING ||
                    state == Completion.UNKNOWN) "review-only" else if (state == Completion.COMMITTED) "none" else "new-draft")
        } catch (failure: Throwable) {
            fail(failure)
            mapOf("kind" to "originalReview", "originalOperationRef" to p.original.reference,
                "resolution" to "unresolved", "nextStep" to "review-only")
        }
    }
    override fun hasRetainedWork(): Boolean {
        checked()
        if (pending != null || preparing || failureHeld) return true
        return try { native.hasRetainedWork() || binding.hasRetainedWork() }
        catch (failure: Throwable) { fail(failure); true }
    }
    override fun hasWorkBlockingOwnerClose(): Boolean {
        checked()
        if (pending != null || preparing) return true
        // Historical failure still blocks business/replay. Only actual runtime
        // custody is relevant to selecting an owner's local cleanup barrier.
        return native.hasRetainedWork() || binding.hasWorkBlockingOwnerClose()
    }
    fun uses(original: Binding) = binding === original
    internal fun retainedFailure(): Throwable? { checked(); return firstFailure }

    private class Ports(private val ports: VeilNativeProductPorts) : NativePort {
        private class Owned(val source: Ports, val original: VeilNativeProductPorts.Operation) : NativeOperation
        private fun selected(op: NativeOperation): VeilNativeProductPorts.Operation {
            check(op is Owned && op.source === this)
            return op.original
        }
        override fun deviceCurrent() = ports.requireAcceptedDeviceCurrent()
        override fun openSession(records: ByteArray) = ports.openMessageSession(records)
        override fun epoch() = ports.currentMessageEpoch()
        override fun acquire(epoch: Long, frame: ByteArray): NativeOperation = Owned(this, ports.acquire(epoch, frame))
        override fun beginInitialReceive(epoch: Long, frame: ByteArray): NativeOperation =
            Owned(this, ports.acquireInitialSessionReceive(epoch, frame))
        override fun beginInitialSend(epoch: Long, frame: ByteArray, canonicalPeerBundle: ByteArray): NativeOperation =
            Owned(this, ports.acquireInitialSession(epoch, frame, canonicalPeerBundle))
        override fun execute(original: NativeOperation, epoch: Long, frame: ByteArray): Long =
            ports.advancePreparedInput(selected(original), epoch, frame)
        override fun advance(original: NativeOperation, epoch: Long) =
            ports.execute(selected(original), epoch, 3, byteArrayOf())
        override fun output(original: NativeOperation, epoch: Long, consume: (VeilNativeMessageOutput) -> Unit) =
            ports.withOriginalOutput(selected(original), epoch, consume)
        override fun retire(original: NativeOperation, epoch: Long) = ports.retireOriginalOutput(selected(original), epoch)
        override fun hasRetainedWork() = ports.hasRetainedMessages()
        override fun acknowledgeFinalizedLocal(original: NativeOperation?, epoch: Long, source: VeilNativeMatrixSource,
            account: String, reference: String, direction: Int) =
            ports.acknowledgeFinalizedLocal(source, original?.let(::selected), epoch, account, reference, direction)
    }
    companion object {
        fun owned(ports: VeilNativeProductPorts, binding: Binding): VeilNativeMessageBusiness {
            ports.requireAcceptedDeviceCurrent()
            binding.checkCurrent()
            ports.requireAcceptedDeviceCurrent()
            return VeilNativeMessageBusiness(Ports(ports), binding)
        }
        /** Internal dependency seam for PUBLIC unit controls, not an Expo/SDK
         * provider installer. Production uses owned() with actual product ports. */
        internal fun control(native: NativePort, binding: Binding) = VeilNativeMessageBusiness(native, binding)
        private fun reference(value: Any?) {
            require(value is String && value.length in 1..256 &&
                value.none { it.code < 32 || it.code == 127 })
        }
    }
}


/** Application content inside the selected core's authenticated plaintext.
 * This does not change libsignal framing, KDF, AEAD or authorization. */
internal object VeilProductMessageContent {
    private const val VERSION = "ynx.social.text/v1"
    private val keys = setOf("version", "body", "replyToMessageId")
    data class Text(val body: String, val replyToMessageId: String?, val attachment: String? = null)
    private fun checked(body: String, reply: String?) {
        require(body.isNotBlank() && body.length <= 16000 && body.none {
            it.code in 0..8 || it.code == 11 || it.code == 12 || it.code in 14..31 || it.code == 127
        }) { "VEIL_PRODUCT_TEXT_INVALID" }
        Charsets.UTF_8.newEncoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
            .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
            .encode(java.nio.CharBuffer.wrap(body))
        if (reply != null) require(java.util.UUID.fromString(reply).toString() == reply) {
            "VEIL_PRODUCT_REPLY_REFERENCE_INVALID"
        }
    }
    fun encode(body: String, reply: String?): ByteArray {
        checked(body, reply)
        val text = "{\"version\":" + org.json.JSONObject.quote(VERSION) +
            ",\"body\":" + org.json.JSONObject.quote(body) + ",\"replyToMessageId\":" +
            (reply?.let(org.json.JSONObject::quote) ?: "null") + "}"
        return text.toByteArray(Charsets.UTF_8).also { require(it.size <= 65536) }
    }
    fun decode(bytes: ByteArray): Text {
        require(bytes.size in 1..65536)
        val text = Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
            .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
            .decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        // Parse the three scalar fields directly: Android JSONObject otherwise
        // accepts duplicate names. No bare-text or unknown-version fallback.
        val input = org.json.JSONTokener(text)
        require(input.nextClean() == '{')
        val values = linkedMapOf<String, String?>()
        while (true) {
            require(input.nextClean() == '"')
            val key = input.nextString('"')
            require((key in keys || key == "attachment") && !values.containsKey(key))
            require(input.nextClean() == ':')
            values[key] = when (input.nextClean()) {
                '"' -> input.nextString('"')
                'n' -> { require(input.next(3) == "ull"); null }
                else -> error("VEIL_PRODUCT_CONTENT_FIELD_INVALID")
            }
            when (input.nextClean()) {
                '}' -> break
                ',' -> Unit
                else -> error("VEIL_PRODUCT_CONTENT_OBJECT_INVALID")
            }
        }
        require(input.nextClean() == '\u0000')
        val body = requireNotNull(values["body"])
        val reply = values["replyToMessageId"]
        if (values["version"] == VeilSourceAttachmentContent.VERSION) {
            require(values.keys == keys + "attachment" && reply == null)
            checked(body.ifBlank { "attachment" }, null)
            val encoded = requireNotNull(values["attachment"])
            VeilSourceAttachmentContent.decode(encoded).close()
            return Text(body, null, encoded)
        }
        require(values.keys == keys && values["version"] == VERSION)
        checked(body, reply)
        return Text(body, reply)
    }
}

/** Concrete normal-product consumer. NativeSource supplies only ORIGINAL
 * authenticated device/relation/session custody. Projection, local journal,
 * ciphertext HTTP and normal command dispatch are owned here, not by A or JS.
 * No implementation of NativeSource is fabricated when admission is absent. */
internal class VeilMatrixProductBinding private constructor(
    private val source: NativeSource,
    private val store: Store,
    private val courier: VeilMatrixCiphertextHttpTransport,
    private val storageIdentity: Any = store,
    private val attachmentUi: VeilAttachmentUi? = null
) : VeilNativeMessageBusiness.Binding {
    internal data class Identity(val accountViewRef: String, val displayName: String, val publicIdentifier: String)
    internal data class Route(val id: String, val title: String, val peerIdentifier: String,
                              val roomId: String, val localSender: String, val remoteSender: String)
    internal data class ContactEntry(val id: String, val peerAccountId: String, val displayName: String, val publicIdentifier: String?, val conversationId: String?)
    internal enum class ContactRequestDirection(val wire: String) { INCOMING("incoming"), OUTGOING("outgoing") }
    internal data class Invitation(val id: String, val peerAccountId: String, val displayName: String, val direction: ContactRequestDirection, val publicIdentifier: String? = null)
    internal data class BlockedContact(val peerAccountId: String, val displayName: String)
    internal interface MessageAuthority : VeilNativeMessageBusiness.Original {
        fun sessionRecords(): ByteArray
        /** Actual ratchet + original output durable commit, not an HTTP result,
         * stored Boolean, output presence or an inventory observation. */
        fun requireCommittedOutput(output: VeilNativeMessageOutput)
    }
    internal data class HistoricalOriginal(val identity: Identity, val saved: org.json.JSONObject?)
    internal interface NativeSource {
        /** One genuine namespace2 READ3 for precisely this original. DATA only;
         * it neither releases custody nor permits a write or another action. */
        fun historicalOriginal(reference: String): HistoricalOriginal? = null
        fun checkCurrent()
        fun identity(): Identity
        /** Current bilateral, non-revoked relations with their original routes.
         * DTO fields alone cannot implement this owning source. */
        fun routes(): List<Route>
        /** Display metadata only; production overrides with protected relation READ3. */
        fun contacts(): List<ContactEntry>
        fun invitations(): List<Invitation>
        fun blockedContacts(): List<BlockedContact>
        fun contactActions(): Set<String>
        fun prepareMessage(command: Map<String, Any?>, context: Map<String, Any?>,
                           logicalId: String, originalFrame: ByteArray,
                           capture: (MessageAuthority) -> Unit)
        /** PUBLIC copies from the SAME accepted Source; never peer lookup or a grant. */
        fun initialPublicBundle(): ByteArray = error("VEIL_INITIAL_PUBLIC_OWNER_REQUIRED")
        fun initialSessionSendFrame(logical: ByteArray, peerBundle: ByteArray): ByteArray =
            error("VEIL_INITIAL_SEND_NATIVE_FRAME_REQUIRED")
        fun initialSessionReceiveFrame(logical: ByteArray, preKey: ByteArray, ownBundle: ByteArray): ByteArray =
            error("VEIL_INITIAL_RECEIVE_NATIVE_FRAME_REQUIRED")
        fun prepareIncoming(route: Route, eventId: String, logicalId: String,
                            originalFrame: ByteArray, capture: (MessageAuthority) -> Unit)
        fun prepareContact(command: Map<String, Any?>, context: Map<String, Any?>,
                           capture: (VeilNativeMessageBusiness.Contact) -> Unit)
        fun hasRetainedWork(): Boolean
        /** No public observation or stored status can implement a terminal proof. */
        fun observeTerminal(reference: String, kind: Int): VeilNativeMessageBusiness.Completion =
            error("VEIL_PRODUCT_NATIVE_TERMINAL_QUERY_REQUIRED")
    }
    internal interface Records {
        fun state(): org.json.JSONObject?
        fun state(value: org.json.JSONObject)
        fun operation(id: String): org.json.JSONObject?
        fun operation(id: String, value: org.json.JSONObject)
        fun operations(): List<String>
        fun history(id: String): org.json.JSONObject?
        fun history(id: String, value: org.json.JSONObject)
        fun removeHistory(id: String)
    }
    internal enum class RecordAccess(val operationKind: Int) { READ(3), WRITE(4) }
    internal interface Store {
        /** Protected transaction completes before returning; no network inside. */
        fun <T> transaction(access: RecordAccess, block: (Records) -> T): T
    }
    private val attachments: VeilSourceAttachmentStore? = if (source is VeilNativeMatrixSource && attachmentUi != null)
        VeilSourceAttachmentStore(source, store, courier, attachmentUi) else null
    private val worker = Thread.currentThread()
    private var retained: VeilNativeMessageBusiness.Original? = null
    private var failure: Throwable? = null
    private var failureHeld = false
    private val savedReviewFailures = linkedMapOf<String, Throwable>()
    internal fun firstSavedReviewFailure(reference: String): Throwable? = savedReviewFailures[reference]
    private fun current() {
        check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
        source.checkCurrent()
    }
    override fun checkCurrent() = current()
    private fun identity(): Identity {
        current()
        val value = source.identity()
        ref(value.accountViewRef); bounded(value.displayName, 256); bounded(value.publicIdentifier, 512)
        current()
        return value
    }
    private fun routes(): List<Route> {
        current()
        val values = source.routes().toList()
        require(values.size <= 250 && values.map { it.id }.distinct().size == values.size)
        values.forEach { ref(it.id); bounded(it.title, 256); bounded(it.peerIdentifier, 512)
            require(it.roomId.startsWith("!") && it.localSender.startsWith("@") && it.remoteSender.startsWith("@"))
            ref(it.roomId); ref(it.localSender); ref(it.remoteSender) }
        current()
        return values
    }
    private fun invitations(): List<Invitation> {
        current()
        val values=source.invitations().toList()
        require(values.size <= 200 && values.map {it.id}.distinct().size == values.size && values.map {it.peerAccountId}.distinct().size == values.size)
        require(values.count { it.direction == ContactRequestDirection.INCOMING } <= 100 && values.count { it.direction == ContactRequestDirection.OUTGOING } <= 100)
        values.forEach {ref(it.id);bounded(it.displayName,256);it.publicIdentifier?.let { value -> bounded(value,512) };require(it.peerAccountId.length in 1..256 && it.peerAccountId.all { c -> c.code in 33..126 })}
        current()
        return values
    }
    private fun state(records: Records, identity: Identity): org.json.JSONObject {
        val state = records.state() ?: org.json.JSONObject().put("version", 1)
            .put("account", identity.accountViewRef).put("revision", 0L).put("active", org.json.JSONObject.NULL)
        require(state.get("version") == 1 && state.getString("account") == identity.accountViewRef)
        val revision = state.get("revision")
        require((revision is Long || revision is Int) && (revision as Number).toLong() in 0..9007199254740990L)
        return state
    }
    private fun bump(records: Records, identity: Identity) {
        val value = state(records, identity)
        value.put("revision", Math.addExact(value.getLong("revision"), 1))
        records.state(value)
    }
    private fun record(records: Records, id: String, identity: Identity): org.json.JSONObject {
        val value = checkNotNull(records.operation(id)) { "VEIL_PRODUCT_ORIGINAL_JOURNAL_REQUIRED" }
        require(value.get("version") == 1 && value.getString("reference") == id &&
            value.getString("account") == identity.accountViewRef)
        return value
    }
    private fun unfinished(records: Records, identity: Identity) =
        records.operations().also { require(it.size <= 4096) }
            .filter { record(records, it, identity).getString("status") !in setOf("CLOSED", "ABORTED") }
    private fun messageSequence(value: org.json.JSONObject): Long {
        val n = value.get("sequence")
        require((n is Long || n is Int) && (n as Number).toLong() in 1..9007199254740990L)
        return (n as Number).toLong()
    }
    private fun readWatermarks(state: org.json.JSONObject): org.json.JSONObject {
        if (!state.has("readThrough")) return org.json.JSONObject() // upgrade: all stored incoming remain unread
        val values = state.getJSONObject("readThrough")
        require(values.length() <= 4096)
        values.keys().forEach { id ->
            ref(id)
            val row = values.getJSONObject(id)
            require(row.keys().asSequence().toSet() == setOf("sequence", "messageId"))
            require(messageSequence(row) <= state.getLong("revision")) { "VEIL_PRODUCT_READ_WATERMARK_FUTURE" }
            ref(row.getString("messageId"))
        }
        return values
    }
    /** A restored scalar is not evidence that a conversation was read.
     * Bind the exact authenticated local original in this held transaction. */
    private fun readThroughSequence(records: Records, who: Identity, state: org.json.JSONObject,
        room: String, marks: org.json.JSONObject): Long {
        val mark = marks.optJSONObject(room) ?: return 0L
        val sequence = messageSequence(mark)
        require(sequence <= state.getLong("revision"))
        val reference = mark.getString("messageId")
        val target = record(records, reference, who)
        require(target.getString("type") == "message" && target.getString("logicalId") == reference &&
            target.getString("conversationId") == room && messageSequence(target) == sequence) {
            "VEIL_PRODUCT_READ_WATERMARK_ORIGINAL_MISMATCH"
        }
        val direction = target.getString("direction")
        val status = target.getString("status")
        require((direction == "incoming" && status in setOf("COMMITTED", "CLOSED")) ||
            (direction == "outgoing" && status in setOf("PREPARED", "NATIVE_COMMITTED", "UNKNOWN", "COMMITTED", "CLOSED", "ABORTED"))) {
            "VEIL_PRODUCT_READ_WATERMARK_HIDDEN_ORIGINAL"
        }
        return sequence
    }
    private fun preview(value: String): String {
        var end = minOf(value.length, 512)
        if (end > 0 && value[end - 1].isHighSurrogate()) end--
        return value.substring(0, end)
    }
    private fun projectionTextSize(value: Any?): Int = when (value) {
        is String -> value.length
        is Map<*, *> -> value.values.sumOf { projectionTextSize(it) }
        is List<*> -> value.sumOf { projectionTextSize(it) }
        else -> 0
    }
    override fun recoverLocalViewFailure(): Map<String, Any?>? {
        val actual = source as? VeilNativeMatrixSource ?: return null
        current()
        if (retained != null || failureHeld || actual.hasRetainedWork() || courier.hasRetainedWork()) return null
        // checkCurrent()/held-transaction outcome must prove the old scope ended.
        // A fresh actual projection reports either committed or rolled-back data.
        return projection()
    }
    override fun markConversationRead(command: Map<String, Any?>): Map<String, Any?> {
        val who = identity()
        val room = command["conversationId"] as String
        val through = command["throughMessageId"] as String
        if (routes().none { it.id == room }) return mapOf("kind" to "error", "code" to "STALE_VIEW")
        var expectedCursor: String? = null
        var expectedRevision = 0L
        val accepted = store.transaction(RecordAccess.WRITE) { records ->
            val state = state(records, who)
            if (state.getLong("revision").toString() != command["viewRevision"] ||
                state.has("messageAnchor") || state.opt("active") != room || records.operation(through) == null) return@transaction false
            val target = record(records, through, who)
            if (target.getString("type") != "message" || target.getString("logicalId") != through ||
                target.getString("conversationId") != room || (target.getString("direction") == "incoming" &&
                    target.getString("status") !in setOf("COMMITTED", "CLOSED"))) return@transaction false
            val sequence = messageSequence(target)
            if (sequence > state.getLong("revision")) return@transaction false
            val values = readWatermarks(state)
            val existing = values.optJSONObject(room)
            val prior = readThroughSequence(records, who, state, room, values)
            if (sequence > prior) {
                if ((!values.has(room) && values.length() >= 4096) || state.getLong("revision") >= 9007199254740990L)
                    return@transaction false
                val cursor = org.json.JSONObject().put("sequence", sequence).put("messageId", through)
                values.put(room, cursor); state.put("readThrough", values)
                state.put("revision", Math.addExact(state.getLong("revision"), 1)); records.state(state)
                expectedCursor = cursor.toString()
            } else expectedCursor = checkNotNull(existing).toString()
            expectedRevision = state.getLong("revision")
            true
        }
        if (!accepted) return mapOf("kind" to "error", "code" to "STALE_VIEW")
        current()
        store.transaction(RecordAccess.READ) { records ->
            val state = state(records, who)
            check(state.getLong("revision") == expectedRevision && readWatermarks(state).getJSONObject(room).toString() == expectedCursor) {
                "VEIL_PRODUCT_LOCAL_READBACK_REQUIRED"
            }
        }
        current()
        return projection()
    }
    private data class SearchRow(val sequence: Long, val reference: String, val value: Map<String, Any?>)
    override fun searchLocalMessages(command: Map<String, Any?>): Map<String, Any?> {
        val who = identity()
        val known = routes().associateBy { it.id }
        val query = command["query"] as? String ?: return mapOf("kind" to "error", "code" to "STALE_VIEW")
        bounded(query, 256)
        require(query == query.trim() && query.none { Character.isISOControl(it) })
        var queryIndex = 0
        while (queryIndex < query.length) {
            val c = query[queryIndex++]
            if (c.isHighSurrogate()) require(queryIndex < query.length && query[queryIndex++].isLowSurrogate())
            else require(!c.isLowSurrogate())
        }
        val folded = query.lowercase(java.util.Locale.ROOT)
        val cursor = command["beforeMessageId"]?.let { (it as String).also(::ref) }
        val result = store.transaction(RecordAccess.READ) { records ->
            val state = state(records, who)
            if (state.getLong("revision").toString() != command["viewRevision"])
                return@transaction mapOf<String, Any?>("kind" to "error", "code" to "STALE_VIEW")
            val ids = records.operations().also { require(it.size <= 4096 && it.distinct().size == it.size) }
            fun eligible(saved: org.json.JSONObject): Boolean = saved.getString("type") == "message" &&
                known.containsKey(saved.getString("conversationId")) &&
                visibleStoredMessage(saved, saved.getString("conversationId"), state.getLong("revision"))
            // Retain only the cursor's exact stable key, never its whole private
            // Native record while enumerating other protected originals.
            val after = if (cursor == null) null else {
                if (!ids.contains(cursor)) return@transaction mapOf<String, Any?>("kind" to "error", "code" to "STALE_VIEW")
                val saved = record(records, cursor, who)
                if (!eligible(saved) || !saved.getString("body").lowercase(java.util.Locale.ROOT).contains(folded))
                    return@transaction mapOf<String, Any?>("kind" to "error", "code" to "STALE_VIEW")
                messageSequence(saved) to cursor
            }
            val order = compareByDescending<SearchRow> { it.sequence }.thenBy { it.reference }
            val selected = java.util.PriorityQueue<SearchRow>(52, order.reversed())
            for (id in ids) {
                val saved = record(records, id, who)
                if (!eligible(saved)) continue
                val sequence = messageSequence(saved)
                if (after != null && (sequence > after.first || (sequence == after.first && id <= after.second))) continue
                val body = saved.getString("body"); require(body.length <= 16000)
                if (!body.lowercase(java.util.Locale.ROOT).contains(folded)) continue
                selected.add(SearchRow(sequence, id, mapOf(
                    "messageId" to id, "conversationId" to saved.getString("conversationId"),
                    "title" to known.getValue(saved.getString("conversationId")).title, "excerpt" to preview(body))))
                if (selected.size > 51) selected.remove()
            }
            val ordered = selected.toList().sortedWith(order)
            val page = ordered.take(50)
            mapOf<String, Any?>("kind" to "messageSearch", "query" to query,
                "matches" to page.map { it.value },
                "nextBeforeMessageId" to if (ordered.size > 50) page.last().reference else null,
                "completion" to "read", "originalOperationRef" to null)
        }
        current()
        return result
    }
    private fun visibleStoredMessage(saved: org.json.JSONObject, room: String, revision: Long): Boolean =
        saved.getString("type") == "message" && saved.getString("reference") == saved.getString("logicalId") &&
        saved.getString("conversationId") == room && messageSequence(saved) <= revision &&
        ((saved.getString("direction") == "incoming" && saved.getString("status") in setOf("COMMITTED", "CLOSED")) ||
         (saved.getString("direction") == "outgoing" && saved.getString("status") in
             setOf("PREPARED", "NATIVE_COMMITTED", "UNKNOWN", "COMMITTED", "CLOSED", "ABORTED")))
    override fun viewStoredMessage(command: Map<String, Any?>): Map<String, Any?> {
        val who = identity()
        val room = (command["conversationId"] as String).also(::ref)
        val id = (command["messageId"] as String).also(::ref)
        if (routes().none { it.id == room }) return mapOf("kind" to "error", "code" to "STALE_VIEW")
        var expected = ""
        var revision = 0L
        val selected = store.transaction(RecordAccess.WRITE) { records ->
            val state = state(records, who)
            if (state.getLong("revision").toString() != command["viewRevision"] || records.operation(id) == null) return@transaction false
            val target = record(records, id, who)
            if (!visibleStoredMessage(target, room, state.getLong("revision"))) return@transaction false
            expected = target.toString()
            if (state.opt("active") != room || state.opt("messageAnchor") != id) {
                if (state.getLong("revision") >= 9007199254740990L) return@transaction false
                state.put("active", room).put("messageAnchor", id).put("revision", Math.addExact(state.getLong("revision"), 1))
                records.state(state)
            }
            revision = state.getLong("revision")
            true
        }
        if (!selected) return mapOf("kind" to "error", "code" to "STALE_VIEW")
        current()
        store.transaction(RecordAccess.READ) { records ->
            val state = state(records, who)
            check(state.getLong("revision") == revision && state.getString("active") == room && state.getString("messageAnchor") == id &&
                record(records, id, who).toString() == expected) { "VEIL_PRODUCT_STORED_MESSAGE_READBACK_REQUIRED" }
        }
        current()
        return projection()
    }
    private data class ProjectionRow(val sequence: Long, val order: Int, val value: Map<String, Any?>)
    override fun projection(): Map<String, Any?> {
        val who = identity()
        val routes = routes()
        val invitations = invitations()
        val contacts = source.contacts().toList().also { values ->
            require(values.size <= 500 && values.map { it.id }.distinct().size == values.size)
            values.forEach { value ->
                ref(value.id); bounded(value.displayName, 256); value.publicIdentifier?.let { bounded(it, 512) }
                require(value.peerAccountId.length in 1..256 && value.peerAccountId.all { it.code in 33..126 })
                value.conversationId?.let { id ->
                    ref(id)
                    require(routes.singleOrNull { it.id == id }?.peerIdentifier == value.peerAccountId)
                }
            }
            current()
        }
        val blockedContacts = source.blockedContacts().toList().also { values ->
            require(values.size <= 500 && values.map { it.peerAccountId }.distinct().size == values.size)
            values.forEach { value -> bounded(value.displayName, 256); require(value.peerAccountId.length in 1..256 && value.peerAccountId.all { it.code in 33..126 }) }
            current()
        }
        val contactActions = source.contactActions().toList().also { values ->
            require(values.size <= 5 && values.distinct().size == values.size && values.all { it in setOf("requestContact", "acceptContact", "rejectContact", "blockContact", "unblockContact") })
            current()
        }
        val blockedPeers = blockedContacts.map { it.peerAccountId }.toSet()
        require(contacts.none { it.peerAccountId in blockedPeers } && invitations.none { it.peerAccountId in blockedPeers } && routes.none { it.peerIdentifier in blockedPeers })
        val view = store.transaction(RecordAccess.READ) { records ->
            val state = state(records, who)
            val active = state.opt("active").let { if (it == null || it === org.json.JSONObject.NULL) null else it as String }
                ?.takeIf { id -> routes.any { it.id == id } }
            val ids = records.operations().also { require(it.size <= 4096) }
            val anchor = if (state.has("messageAnchor")) state.getString("messageAnchor").also(::ref) else null
            val anchorBounds = anchor?.let { id ->
                require(active != null)
                val saved = record(records, id, who)
                require(visibleStoredMessage(saved, active, state.getLong("revision"))) { "VEIL_PRODUCT_STORED_MESSAGE_ANCHOR_INVALID" }
                val position = ids.indexOf(id); require(position >= 0)
                messageSequence(saved) to position
            }
            var windowCount = 0
            val marks = readWatermarks(state)
            val known = routes.associateBy { it.id }
            val through = routes.associate { it.id to readThroughSequence(records, who, state, it.id, marks) }
            val unread = routes.associate { it.id to 0 }.toMutableMap()
            val latest = mutableMapOf<String, Long>()
            val previews = mutableMapOf<String, String>()
            val order = compareBy<ProjectionRow> { it.sequence }.thenBy { it.order }
            val selected = java.util.PriorityQueue<ProjectionRow>(251, order)
            val recoveries = mutableListOf<ProjectionRow>()
            // Read one authenticated original at a time. Private native inputs,
            // frames and receipts can be much larger than the public text: never
            // retain every original JSON just to sort its UI representation.
            for ((position, id) in ids.withIndex()) {
                val item = record(records, id, who)
                val sequence = messageSequence(item)
                val status = item.getString("status")
                if (status !in setOf("CLOSED", "ABORTED")) {
                    require(recoveries.size < 128)
                    recoveries.add(ProjectionRow(sequence, position, mapOf(
                        "originalOperationRef" to item.getString("reference"),
                        "label" to "Check the original operation", "state" to "unknown")))
                }
                if (item.getString("type") != "message") continue
                val room = item.optString("conversationId")
                val route = known[room]
                val confirmed = status in setOf("COMMITTED", "CLOSED")
                if (route != null && confirmed) {
                    if (sequence >= (latest[room] ?: 0L)) {
                        previews[room] = preview(item.getString("body"))
                        latest[room] = sequence
                    }
                    if (item.getString("direction") == "incoming" && sequence > through.getValue(room))
                        unread[room] = Math.addExact(unread.getValue(room), 1)
                }
                if (room != active || (item.getString("direction") != "outgoing" && !confirmed)) continue
                if (anchorBounds != null && (sequence > anchorBounds.first ||
                    (sequence == anchorBounds.first && position > anchorBounds.second))) continue
                windowCount++
                val oldest = selected.peek()
                // Equal sequences preserve original enumeration order, exactly
                // as the previous stable sort + takeLast(250) did.
                if (selected.size == 250 && oldest != null &&
                    (sequence < oldest.sequence || (sequence == oldest.sequence && position < oldest.order))) continue
                val body = item.getString("body")
                require(body.length <= 16000) // existing normal text contract
                val message = mapOf<String, Any?>(
                    "id" to item.getString("logicalId"), "conversationId" to room,
                    "senderLabel" to if (item.getString("direction") == "outgoing") who.displayName else checkNotNull(route).title,
                    "body" to body, "direction" to item.getString("direction"),
                    "replyToMessageId" to if (!item.has("replyToMessageId") || item.isNull("replyToMessageId")) null else item.getString("replyToMessageId"),
                    "submission" to when (status) {
                        "COMMITTED", "CLOSED" -> "confirmed"
                        "ABORTED" -> "aborted"
                        else -> "unknown"
                    },
                    "delivery" to "unconfirmed", "attachments" to if (item.has("attachmentDescriptor"))
                        VeilSourceAttachmentContent.decode(item.getString("attachmentDescriptor")).use { descriptor ->
                            descriptor.matches(checkNotNull(route), item.getString("logicalId"), item.getString("direction") == "incoming")
                            listOf(mapOf("reference" to descriptor.id, "name" to descriptor.name))
                        } else emptyList<Any>())
                selected.add(ProjectionRow(sequence, position, message))
                if (selected.size > 250) selected.remove()
            }
            val conversations = routes.map { route -> mapOf(
                "id" to route.id, "title" to route.title, "preview" to (previews[route.id] ?: ""),
                "unreadCount" to unread.getValue(route.id)) }
            val base = mapOf<String, Any?>("kind" to "AUTHORIZED", "accountViewRef" to who.accountViewRef,
                "viewRevision" to state.getLong("revision").toString(),
                "profile" to mapOf("displayName" to who.displayName, "publicIdentifier" to who.publicIdentifier),
                "activeConversationId" to active, "conversations" to conversations,
                "messageWindow" to mapOf("mode" to if (anchor == null) "latest" else "anchored", "anchorMessageId" to anchor, "hasEarlier" to false),
                "messages" to emptyList<Any>(), "contacts" to contacts.map {
                    mapOf("id" to it.id, "peerAccountId" to it.peerAccountId, "displayName" to it.displayName, "publicIdentifier" to it.publicIdentifier,
                        "conversationId" to it.conversationId) },
                "contactRequests" to invitations.map { mapOf("id" to it.id, "peerAccountId" to it.peerAccountId, "displayName" to it.displayName, "publicIdentifier" to it.publicIdentifier, "direction" to it.direction.wire) },
                "blockedContacts" to blockedContacts.map { mapOf("peerAccountId" to it.peerAccountId, "displayName" to it.displayName) },
                "moments" to emptyList<Any>(), "devices" to emptyList<Any>(), "audiences" to emptyList<Any>(),
                "recoveries" to recoveries.sortedWith(order).map { it.value }, "localAi" to "unsupported",
                "actions" to if (recoveries.isEmpty()) (listOf("openConversation", "viewStoredMessage", "searchLocalMessages", "loadDraft", "saveDraft", "sendMessage") + (if (attachments?.available() == true) listOf("selectAttachment", "sendAttachment", "openAttachment") else emptyList()) + contactActions +
                        if (anchor == null) listOf("markConversationRead") else emptyList())
                    else (listOf("openConversation", "viewStoredMessage", "searchLocalMessages", "reviewRecovery") +
                        if (anchor == null) listOf("markConversationRead") else emptyList()))
            val limit = 1048576 - 1024
            var used = projectionTextSize(base)
            if (used > limit) throw HistoryCapacity()
            val messages = mutableListOf<Map<String, Any?>>()
            for (row in selected.toList().sortedWith(order).asReversed()) {
                val size = projectionTextSize(row.value)
                if (used + size > limit) break
                messages.add(row.value); used += size
            }
            base + mapOf("messages" to messages.asReversed(), "messageWindow" to mapOf(
                "mode" to if (anchor == null) "latest" else "anchored", "anchorMessageId" to anchor,
                "hasEarlier" to (windowCount > messages.size)))
        }
        current()
        return view
    }
    /** A crypto abort cannot undo a known or uncertain courier/business effect.
     * Incoming originals belong to the sender; they never create our draft. */
    private fun safeAbortCanCreateDraft(saved: org.json.JSONObject): Boolean {
        if (saved.getString("status") !in setOf("PREPARED", "ATTEMPTED", "UNKNOWN", "ABORTED")) return false
        if (saved.getString("type") == "contact") return true
        if (saved.getString("type") != "message" || saved.optString("direction") != "outgoing") return false
        return listOf("attachmentPhase", "ciphertext", "ciphertextType", "transportPhase", "eventId", "media").none {
            saved.has(it) && !saved.isNull(it)
        }
    }
    override fun reconcileActiveOriginal(original: VeilNativeMessageBusiness.Original,
        acknowledgeNative: (VeilNativeMatrixSource, String, String, Int) -> Unit): Boolean {
        current()
        val held = original as? Operation ?: return false
        if (retained !== held || held.closed) return false
        val genuine = source as? VeilNativeMatrixSource ?: return false
        val authority = held.authorityForLocalAck() ?: return false
        val who = identity()
        require(who.accountViewRef == held.who.accountViewRef)
        // Capture BEFORE the external terminal query. Its callback cannot
        // silently replace the original record that this acknowledgement binds.
        val candidate = store.transaction(RecordAccess.READ) { records ->
            Pair(record(records, held.reference, who).toString(), state(records, who).getLong("revision"))
        }
        val saved = org.json.JSONObject(candidate.first)
        held.requireSavedForLocalAck(saved)
        val direction = if (held is Message) { if (held.incoming) 2 else 1 } else 0
        val completed = genuine.withFinalizedLocalOriginal(authority, who.accountViewRef, held.reference) { terminal ->
            val target = when {
                terminal == VeilNativeMessageBusiness.Completion.COMMITTED && saved.getString("status") in setOf("COMMITTED", "CLOSED") -> "CLOSED"
                terminal == VeilNativeMessageBusiness.Completion.ABORTED && safeAbortCanCreateDraft(saved) -> "ABORTED"
                else -> return@withFinalizedLocalOriginal false
            }
            var expected = candidate.first
            var expectedRevision = candidate.second
            if (saved.getString("status") != target) {
                store.transaction(RecordAccess.WRITE) { records ->
                    val current = record(records, held.reference, who)
                    check(current.toString() == candidate.first && state(records, who).getLong("revision") == candidate.second) {
                        "VEIL_PRODUCT_SAVED_ORIGINAL_CHANGED"
                    }
                    current.put("status", target); records.operation(held.reference, current)
                    if (target == "CLOSED") {
                        clearFinalizedDraft(records, who, current)
                        VeilAttachmentSelectionLifecycle.releaseConfirmed(records, who.accountViewRef, current)
                    }
                    bump(records, who)
                    expected = current.toString(); expectedRevision = Math.addExact(candidate.second, 1)
                }
            }
            store.transaction(RecordAccess.READ) { records ->
                check(record(records, held.reference, who).toString() == expected &&
                    state(records, who).getLong("revision") == expectedRevision) { "VEIL_PRODUCT_SAVED_ORIGINAL_READBACK_REQUIRED" }
            }
            current()
            held.acknowledgeTransportLocal(genuine, who.accountViewRef)
            acknowledgeNative(genuine, who.accountViewRef, held.reference, direction)
            true
        }
        if (completed) {
            held.closed = true; retained = null; failureHeld = false
            // held.firstFailure and this.failure stay retained historical causes.
        }
        return completed
    }
    override fun reviewSavedOriginal(reference: String, context: Map<String, Any?>): Map<String, Any?> {
        check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
        ref(reference)
        val historical = source.historicalOriginal(reference)
        val who = historical?.identity ?: identity()
        if (context["accountViewRef"] != who.accountViewRef) return mapOf("kind" to "error", "code" to "STALE_VIEW")
        val saved = (if (historical != null) historical.saved else store.transaction(RecordAccess.READ) { records ->
            if (records.operation(reference) == null) null else record(records, reference, who)
        }) ?: return mapOf("kind" to "error", "code" to "STALE_VIEW")
        // Same checks as ordinary record(); a cached account or a row alone
        // never supplies the actual Native READ3/terminal authority.
        require(saved.get("version") == 1 && saved.getString("reference") == reference &&
            saved.getString("account") == who.accountViewRef)
        val type = saved.getString("type")
        require(type in setOf("message", "contact", "initialSession"))
        val originalCommand = saved.getJSONObject("originalCommand")
        val originalContext = saved.getJSONObject("originalContext")
        if (type == "contact" || saved.optString("direction") == "outgoing") {
            val original = if (type == "initialSession")
                VeilSocialMessagingCoordinator.Request.decodeSourceOriginal(originalContext.toString(), originalCommand.toString())
            else VeilSocialMessagingCoordinator.Request.decode(originalContext.toString(), originalCommand.toString())
            require(original.context["accountViewRef"] == who.accountViewRef)
            require(if (type == "contact") original.command?.get("type") in setOf("requestContact", "acceptContact", "rejectContact", "blockContact", "unblockContact")
                else original.command?.get("type") == if (type == "initialSession") "establishSession" else if (original.command?.get("type") == "sendAttachment") "sendAttachment" else "sendMessage")
        } else {
            // Historical incoming writer added an explicit null reply to its
            // otherwise empty command. It is no outgoing request or authority.
            val emptyIncomingCommand = originalCommand.length() == 0 ||
                (originalCommand.length() == 1 && originalCommand.has("replyToMessageId") &&
                    originalCommand.isNull("replyToMessageId"))
            require(saved.getString("direction") == "incoming" && emptyIncomingCommand && originalContext.length() == 0)
        }
        val terminal = try {
            source.observeTerminal(reference, if (type == "contact") 2 else 1)
        } catch (error: Throwable) {
            val first = savedReviewFailures[reference]
            if (first == null) savedReviewFailures[reference] = error
            else if (first !== error) try { first.addSuppressed(error) } catch (_: Throwable) { }
            VeilNativeMessageBusiness.Completion.UNKNOWN
        }
        if (historical == null) current()
        // COMMITTED JSON alone cannot prove a native result; likewise a native
        // crypto result alone cannot settle uncertain courier/business effects.
        val confirmed = terminal == VeilNativeMessageBusiness.Completion.COMMITTED &&
            saved.getString("status") in setOf("COMMITTED", "CLOSED")
        val eventPresent = !confirmed && terminal == VeilNativeMessageBusiness.Completion.COMMITTED &&
            historical != null && observeHistoricalMessage(reference, who, saved)
        val aborted = terminal == VeilNativeMessageBusiness.Completion.ABORTED && safeAbortCanCreateDraft(saved)
        val result = mutableMapOf("kind" to "originalReview", "originalOperationRef" to reference,
            "resolution" to if (confirmed) "confirmed" else if (aborted) "aborted" else "unresolved",
            "nextStep" to if (confirmed) "none" else if (aborted) "new-draft" else "review-only")
        if (eventPresent) result["eventObservation"] = "present"
        return result
    }
    /** A known event can be checked after the original send deadline, never
     * replayed. Native FINALIZED and an independent exact courier readback are
     * both required. The protected UNKNOWN row and all custody stay untouched. */
    private fun observeHistoricalMessage(reference: String, who: Identity, saved: org.json.JSONObject): Boolean {
        if (saved.getString("type") !in setOf("message", "initialSession") || saved.optString("direction") != "outgoing" ||
            saved.getString("status") !in setOf("UNKNOWN", "NATIVE_COMMITTED") ||
            !saved.has("eventId") || saved.isNull("eventId")) return false
        val genuine = source as? VeilNativeMatrixSource ?: return false
        try {
            require(saved.getString("logicalId") == reference)
            val kind = saved.get("ciphertextType"); val size = saved.get("ciphertextBytes")
            require(kind is Int && kind in 2..3 && size is Int && size in 1..VeilMatrixCiphertextHttpTransport.MAX_CIPHER)
            val digest = saved.getString("ciphertextSha256"); require(Regex("[0-9a-f]{64}").matches(digest))
            val encoded = saved.getString("ciphertext")
            require(encoded.length == ((size + 2) / 3) * 4)
            val cipher = java.util.Base64.getDecoder().decode(encoded)
            try {
                require(cipher.size == size && java.util.Base64.getEncoder().encodeToString(cipher) == encoded &&
                    java.security.MessageDigest.getInstance("SHA-256").digest(cipher).joinToString("") { "%02x".format(it.toInt() and 255) } == digest)
            } finally { cipher.fill(0) }
            val phase = VeilMatrixCiphertextHttpTransport.Phase.valueOf(saved.getString("transportPhase"))
            val candidate = VeilMatrixCiphertextHttpTransport.Snapshot(reference, saved.getString("roomId"),
                saved.getString("sender"), reference, kind, digest, size, phase,
                saved.getString("media"), saved.getString("eventId"),
                if (saved.getString("type") == "initialSession") saved.getString("initialPurpose") else null,
                if (saved.getString("type") == "initialSession") saved.getString("recipientBundleSha256") else null)
            val captured = saved.toString()
            val guard = { genuine.requireHistoricalMessageRead(courier, reference, candidate.sender) }
            guard()
            courier.observeSavedEvent(candidate, guard)
            val after = genuine.historicalOriginal(reference)
            require(after.identity.accountViewRef == who.accountViewRef && after.saved?.toString() == captured) {
                "VEIL_PRODUCT_SAVED_ORIGINAL_CHANGED"
            }
            guard() // last real current before publishing this observation only
            return true
        } catch (error: Throwable) {
            val first = savedReviewFailures[reference]
            if (first == null) savedReviewFailures[reference] = error
            else if (first !== error) try { first.addSuppressed(error) } catch (_: Throwable) { }
            return false
        }
    }
    override fun openConversation(command: Map<String, Any?>): Map<String, Any?> {
        val who = identity()
        val selected = routes().single { it.id == command["conversationId"] }
        store.transaction(RecordAccess.WRITE) { records ->
            val state = state(records, who)
            check(state.getLong("revision").toString() == command["viewRevision"]) { "VEIL_PRODUCT_STALE_VIEW" }
            check(state.getLong("revision") < 9007199254740990L) { "VEIL_PRODUCT_LOCAL_REVISION_CAPACITY" }
            state.remove("messageAnchor")
            state.put("active", selected.id).put("revision", Math.addExact(state.getLong("revision"), 1))
            records.state(state)
        }
        current()
        return projection()
    }
    /** Same current source and protected state as messages. These methods are
     * private owner adapters until the normal command contract is integrated;
     * no Expo installer, plaintext preferences, send original or draft replay. */
    private fun draftRevision(value: String): Long {
        require(value.matches(Regex("0|[1-9][0-9]{0,15}")))
        return value.toLong().also { require(it in 0..9007199254740990L) }
    }
    private fun draftText(value: String) {
        require(value.length <= 16000 && value.none {
            it.code in 0..8 || it.code in 11..12 || it.code in 14..31 || it.code == 127
        })
        var i = 0
        while (i < value.length) {
            val c = value[i++]
            if (c.isHighSurrogate()) require(i < value.length && value[i++].isLowSurrogate())
            else require(!c.isLowSurrogate())
        }
    }
    private fun drafts(state: org.json.JSONObject): org.json.JSONObject {
        val values = if (state.has("drafts")) state.getJSONObject("drafts") else org.json.JSONObject()
        require(values.length() <= 250)
        values.keys().forEach { conversation ->
            ref(conversation)
            val row = values.getJSONObject(conversation)
            require(row.keys().asSequence().toSet() == setOf("revision", "body", "replyToMessageId"))
            val n = row.get("revision")
            require((n is Long || n is Int) && (n as Number).toLong() in 1..9007199254740990L)
            draftText(row.getString("body"))
            if (!row.isNull("replyToMessageId")) ref(row.getString("replyToMessageId"))
        }
        val encoded = values.toString().toByteArray(Charsets.UTF_8)
        try { require(encoded.size <= 524288) { "VEIL_PRODUCT_DRAFT_CAPACITY" } }
        finally { encoded.fill(0) }
        return values
    }
    private fun draftResult(room: String, row: org.json.JSONObject?, completion: String): Map<String, Any?> =
        mapOf("kind" to "draft", "conversationId" to room,
            "draftRevision" to (row?.getLong("revision") ?: 0L).toString(),
            "body" to (row?.getString("body") ?: ""),
            "replyToMessageId" to if (row == null || row.isNull("replyToMessageId")) null else row.getString("replyToMessageId"),
            "completion" to completion, "originalOperationRef" to null)
    override fun loadProtectedDraft(command: Map<String, Any?>, context: Map<String, Any?>): Map<String, Any?> {
        val who = identity()
        if (context["accountViewRef"] != who.accountViewRef || command["viewRevision"] != context["viewRevision"])
            return mapOf("kind" to "error", "code" to "STALE_VIEW")
        val room = command["conversationId"] as String; ref(room)
        if (routes().none { it.id == room }) return mapOf("kind" to "error", "code" to "STALE_VIEW")
        val result = store.transaction(RecordAccess.READ) { records ->
            val state = state(records, who)
            if (state.getLong("revision").toString() != command["viewRevision"] || state.opt("active") != room)
                return@transaction mapOf("kind" to "error", "code" to "STALE_VIEW")
            val row = drafts(state).optJSONObject(room)
            if (row != null && !row.isNull("replyToMessageId"))
                require(replyTarget(records, who, room, row.getString("replyToMessageId"))) { "VEIL_PRODUCT_DRAFT_REPLY_NOT_CURRENT" }
            draftResult(room, row, "read")
        }
        current()
        return result
    }
    override fun saveProtectedDraft(command: Map<String, Any?>, context: Map<String, Any?>): Map<String, Any?> {
        val who = identity()
        if (context["accountViewRef"] != who.accountViewRef || command["viewRevision"] != context["viewRevision"])
            return mapOf("kind" to "error", "code" to "STALE_VIEW")
        if (retained != null || failureHeld || source.hasRetainedWork() || courier.hasRetainedWork())
            return mapOf("kind" to "error", "code" to "REVIEW_REQUIRED")
        val room = command["conversationId"] as String; ref(room)
        val body = command["body"] as String; draftText(body)
        val reply = command["replyToMessageId"] as String?; reply?.let(::ref)
        val expected = draftRevision(command["draftRevision"] as String)
        if (routes().none { it.id == room }) return mapOf("kind" to "error", "code" to "STALE_VIEW")
        val result = store.transaction(RecordAccess.WRITE) { records ->
            val state = state(records, who)
            if (state.getLong("revision").toString() != command["viewRevision"] || state.opt("active") != room)
                return@transaction mapOf("kind" to "error", "code" to "STALE_VIEW")
            if (unfinished(records, who).isNotEmpty()) return@transaction mapOf("kind" to "error", "code" to "REVIEW_REQUIRED")
            val rows = drafts(state)
            val previous = rows.optJSONObject(room)
            if ((previous?.getLong("revision") ?: 0L) != expected)
                return@transaction mapOf("kind" to "error", "code" to "STALE_VIEW")
            if (reply != null && !replyTarget(records, who, room, reply))
                return@transaction mapOf("kind" to "error", "code" to "INPUT_INVALID")
            check(expected < 9007199254740990L) { "VEIL_PRODUCT_DRAFT_REVISION_CAPACITY" }
            val row = org.json.JSONObject().put("revision", expected + 1).put("body", body)
                .put("replyToMessageId", reply ?: org.json.JSONObject.NULL)
            rows.put(room, row); state.put("drafts", rows)
            drafts(state) // Full authenticated, bounded record; never truncate older drafts.
            records.state(state) // Explicit WRITE4, same account and unchanged view revision.
            draftResult(room, row, "stored")
        }
        current()
        return result
    }
    private fun boundDraftRevision(saved: org.json.JSONObject): Long? {
        if (!saved.has("savedDraftRevision")) return null // old originals cannot clear an unbound editor
        val value = saved.get("savedDraftRevision")
        require((value is Long || value is Int) && (value as Number).toLong() in 1..9007199254740989L)
        return (value as Number).toLong()
    }
    private fun bindSavedDraft(records: Records, who: Identity, room: String, body: String, reply: String?): Long? {
        val state = state(records, who)
        if (state.opt("active") != room) return null
        val row = drafts(state).optJSONObject(room) ?: return null
        if (row.getString("body") != body ||
            (if (row.isNull("replyToMessageId")) null else row.getString("replyToMessageId")) != reply) return null
        return row.getLong("revision").also { check(it < 9007199254740990L) { "VEIL_PRODUCT_DRAFT_REVISION_CAPACITY" } }
    }
    /** Called only inside the very WRITE4 that persists actual CLOSED. A stored
     * body or Native crypto commit alone cannot remove an editor draft. */
    private fun clearFinalizedDraft(records: Records, who: Identity, saved: org.json.JSONObject) {
        val revision = boundDraftRevision(saved) ?: return
        require(saved.getString("type") == "message" && saved.getString("direction") == "outgoing" &&
            saved.getString("account") == who.accountViewRef && saved.getString("status") == "CLOSED")
        val room = saved.getString("conversationId"); ref(room)
        val state = state(records, who)
        val rows = drafts(state)
        val current = checkNotNull(rows.optJSONObject(room)) { "VEIL_PRODUCT_SAVED_DRAFT_BINDING_REQUIRED" }
        check(current.getLong("revision") >= revision) { "VEIL_PRODUCT_SAVED_DRAFT_ROLLBACK" }
        if (current.getLong("revision") != revision) return // newer edits, including identical text, are separate
        check(current.getString("body") == saved.getString("body") &&
            (if (current.isNull("replyToMessageId")) null else current.getString("replyToMessageId")) ==
                (if (!saved.has("replyToMessageId") || saved.isNull("replyToMessageId")) null else saved.getString("replyToMessageId"))) {
            "VEIL_PRODUCT_SAVED_DRAFT_CONTENT_CHANGED"
        }
        rows.put(room, org.json.JSONObject().put("revision", revision + 1).put("body", "")
            .put("replyToMessageId", org.json.JSONObject.NULL))
        state.put("drafts", rows); drafts(state); records.state(state)
    }
    private fun replyTarget(records: Records, who: Identity, conversation: Any?, reply: String): Boolean {
        if (records.operation(reply) == null) return false
        val target = record(records, reply, who)
        return target.getString("type") == "message" && target.getString("logicalId") == reply &&
            target.getString("conversationId") == conversation && target.getString("status") in setOf("COMMITTED", "CLOSED")
    }
    override fun selectAttachment(command: Map<String, Any?>, context: Map<String, Any?>): Map<String, Any?> {
        val owner = attachments ?: return mapOf("kind" to "error", "code" to "UNAVAILABLE")
        val who = identity()
        val route = routes().single { it.id == command["conversationId"] }
        return owner.select(command, context, route) {
            current()
            require(context["accountViewRef"] == who.accountViewRef)
            store.transaction(RecordAccess.READ) { records ->
                val state = state(records, who)
                require(state.getLong("revision").toString() == context["viewRevision"] && state.opt("active") == route.id && unfinished(records, who).isEmpty())
            }
        }
    }
    override fun openAttachment(command: Map<String, Any?>): Map<String, Any?> {
        val owner = attachments ?: return mapOf("kind" to "error", "code" to "UNAVAILABLE")
        val who = identity()
        val route = routes().single { it.id == command["conversationId"] }
        val saved = store.transaction(RecordAccess.READ) { records ->
            val state = state(records, who)
            require(state.getLong("revision").toString() == command["viewRevision"] && state.opt("active") == route.id)
            record(records, command["messageId"] as String, who).toString()
        }
        owner.open(org.json.JSONObject(saved), who.accountViewRef, route, command["attachmentReference"] as String)
        current()
        return mapOf("kind" to "snapshot", "snapshot" to projection(), "completion" to "read", "originalOperationRef" to null)
    }
    override fun validate(command: Map<String, Any?>): String? {
        when (command["type"]) {
            "acceptContact", "rejectContact" -> return if (invitations().any {it.id == command["requestId"] && it.direction == ContactRequestDirection.INCOMING}) null else "STALE_VIEW"
            "blockContact" -> return if (source.contacts().any { it.peerAccountId == command["peerAccountId"] } || invitations().any { it.peerAccountId == command["peerAccountId"] }) null else "STALE_VIEW"
            "unblockContact" -> return if (source.blockedContacts().any { it.peerAccountId == command["peerAccountId"] }) null else "STALE_VIEW"
            "sendMessage", "sendAttachment" -> if (routes().none {it.id == command["conversationId"]}) return "STALE_VIEW"
            else -> return null
        }
        if (command["replyToMessageId"] == null) return null
        val who = identity()
        val reply = command["replyToMessageId"] as String
        val valid = store.transaction(RecordAccess.READ) { replyTarget(it, who, command["conversationId"], reply) }
        current()
        return if (valid) null else "INPUT_INVALID"
    }
    override fun prepare(command: Map<String, Any?>, context: Map<String, Any?>,
                         capture: (VeilNativeMessageBusiness.Original) -> Unit) {
        current()
        check(retained == null && !failureHeld) { "VEIL_PRODUCT_ORIGINAL_RETAINED" }
        val who = identity()
        val draft = java.util.Collections.unmodifiableMap(LinkedHashMap(command))
        val call = java.util.Collections.unmodifiableMap(LinkedHashMap(context))
        require(call["accountViewRef"] == who.accountViewRef)
        store.transaction(RecordAccess.READ) { records ->
            check(unfinished(records, who).isEmpty()) { "VEIL_PRODUCT_RESTORE_ORIGINAL_REQUIRED" }
            check(state(records, who).getLong("revision").toString() == call["viewRevision"])
            if (draft["type"] == "sendMessage" && draft["replyToMessageId"] != null)
                require(replyTarget(records, who, draft["conversationId"], draft["replyToMessageId"] as String)) {
                    "VEIL_PRODUCT_REPLY_TARGET_NOT_CURRENT"
                }
        }
        if (draft["type"] == "sendAttachment") {
            val owner = checkNotNull(attachments) { "VEIL_ATTACHMENT_OWNER_REQUIRED" }
            val route = routes().single { it.id == draft["conversationId"] }
            owner.prepare(draft, call, route).use { prepared ->
                val original = Message(who, route, prepared.descriptor.id, draft, call, null, false, null, draft["caption"] as String, null)
                retained = original
                capture(original)
                original.persistInitial() // durable original intent BEFORE upload
                owner.upload(prepared, who.accountViewRef, route, original::persistAttachmentUpload, original::captureAttachmentUpload).use { descriptor ->
                    original.installAttachment(descriptor.encoded())
                    val content = VeilSourceAttachmentContent.message(draft["caption"] as String, descriptor)
                    val frame = try { com.ynx.social.veil.VeilMessageFrame.send(logical(prepared.descriptor.id), content) }
                        finally { content.fill(0) }
                    original.installOutgoingFrame(frame)
                    val borrowed = frame.copyOf()
                    try { source.prepareMessage(draft, call, prepared.descriptor.id, borrowed, original::captureAuthority) }
                    finally { borrowed.fill(0) }
                    original.requireAuthority()
                }
            }
        } else if (draft["type"] == "sendMessage") {
            val route = routes().single { it.id == draft["conversationId"] }
            val body = draft["body"] as String
            bounded(body, 16000)
            val id = java.util.UUID.randomUUID().toString()
            val content = VeilProductMessageContent.encode(body, draft["replyToMessageId"] as String?)
            val frame = try { com.ynx.social.veil.VeilMessageFrame.send(logical(id), content) }
                finally { content.fill(0) }
            val original = Message(who, route, id, draft, call, frame, false, null, body, null)
            retained = original
            capture(original)
            original.persistInitial()
            val borrowed = frame.copyOf()
            try { source.prepareMessage(draft, call, id, borrowed, original::captureAuthority) }
            finally { borrowed.fill(0) }
            original.requireAuthority()
        } else {
            require(draft["type"] in setOf("requestContact", "acceptContact", "rejectContact", "blockContact", "unblockContact"))
            source.prepareContact(draft, call) { authority ->
                check(retained == null) { "VEIL_PRODUCT_ORIGINAL_ALREADY_CAPTURED" }
                val original = Contact(who, draft, call, authority)
                retained = original
                capture(original)
                original.persistInitial()
            }
            check(retained != null) { "VEIL_PRODUCT_ORIGINAL_NOT_CAPTURED" }
        }
        current()
    }
    /** Same normal protected product store and Source capture, not a trust
     * installer. No fresh logical id is generated after an authorized claim. */
    internal fun prepareInitialSession(command: Map<String, Any?>, context: Map<String, Any?>,
                                       logicalId: String, canonicalPeerBundle: ByteArray,
                                       capture: (VeilNativeMessageBusiness.InitialSessionSend) -> Unit) {
        current(); check(retained == null && !failureHeld) { "VEIL_PRODUCT_ORIGINAL_RETAINED" }
        val request = VeilSocialMessagingCoordinator.Request.decodeSourceOriginal(
            VeilSocialMessagingCoordinator.jsonObject(context).toString(),
            VeilSocialMessagingCoordinator.jsonObject(command).toString())
        require(request.command?.get("type") == "establishSession")
        val who = identity(); val draft = checkNotNull(request.command); val call = request.context
        require(call["accountViewRef"] == who.accountViewRef)
        val route = routes().single { it.id == draft["conversationId"] }
        store.transaction(RecordAccess.READ) { records ->
            check(unfinished(records, who).isEmpty()) { "VEIL_PRODUCT_RESTORE_ORIGINAL_REQUIRED" }
            val state = state(records, who)
            require(state.getLong("revision").toString() == call["viewRevision"] && state.opt("active") == route.id)
        }
        val id = logical(logicalId)
        require(canonicalPeerBundle.size in 1..8192)
        val peer = canonicalPeerBundle.copyOf()
        var frame: ByteArray? = null
        var handed = false
        try {
            frame = try { source.initialSessionSendFrame(id, peer) } finally { id.fill(0) }
            VeilNativeProductPorts.validateInitialSessionFrame(frame)
            val original = InitialSendMessage(who, route, logicalId, draft, call, frame, peer)
            retained = original; handed = true
            capture(original)
            original.persistInitial()
            val borrowed = frame.copyOf()
            try { source.prepareMessage(draft, call, logicalId, borrowed, original::captureAuthority) }
            finally { borrowed.fill(0) }
            original.requireAuthority(); current()
        } finally { if (!handed) { frame?.fill(0); peer.fill(0) } }
    }

    /** Internal normal sync handoff only. The source binds the peer and event;
     * downloaded bytes alone never authorize a device or decrypt a message. */
    fun incoming(conversationId: String, eventId: String, sender: String,
                 content: VeilMatrixCiphertextHttpTransport.Content,
                 capture: (VeilNativeMessageBusiness.Message) -> Unit) {
        current(); check(retained == null && !failureHeld)
        val who = identity()
        val route = routes().single { it.id == conversationId && it.remoteSender == sender }
        ref(eventId); require(eventId.startsWith("$"))
        store.transaction(RecordAccess.READ) { records ->
            check(unfinished(records, who).isEmpty()) { "VEIL_PRODUCT_RESTORE_ORIGINAL_REQUIRED" }
            check(records.operation(content.logicalId) == null) { "VEIL_PRODUCT_ORIGINAL_ALREADY_SEEN" }
        }
        val original = if (content.initialSession)
            InitialReceiveMessage(who, route, content.logicalId, eventId, content)
        else Message(who, route, content.logicalId, emptyMap(), emptyMap(), null, true, eventId, "", content)
        retained = original
        try {
            capture(original)
            original.persistInitial()
            val bytes = courier.download(content, original)
            try {
                val frame = if (content.initialSession) {
                    val ownBundle = source.initialPublicBundle()
                    try {
                        require(ownBundle.size in 1..8192)
                        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(ownBundle)
                            .joinToString("") { "%02x".format(it.toInt() and 255) }
                        require(digest == content.recipientBundleSha256) { "VEIL_INITIAL_RECEIVER_BUNDLE_MISMATCH" }
                        current()
                        val id = logical(content.logicalId)
                        try { source.initialSessionReceiveFrame(id, bytes, ownBundle) }
                        finally { id.fill(0) }
                    } finally { ownBundle.fill(0) }
                } else com.ynx.social.veil.VeilMessageFrame.receive(logical(content.logicalId), content.kind, bytes)
                original.installIncomingFrame(frame)
                val borrowed = frame.copyOf()
                try { source.prepareIncoming(route, eventId, content.logicalId, borrowed, original::captureAuthority) }
                finally { borrowed.fill(0) }
                original.requireAuthority()
            } finally { bytes.fill(0) }
            current()
        } catch (error: Throwable) { original.retain(error) }
    }


    internal class HistoryCapacity(cause: Throwable? = null) :
        IllegalStateException("VEIL_MATRIX_HISTORY_STORAGE_CAPACITY", cause)
    private fun opaque(value: org.json.JSONObject, key: String): String? =
        if (!value.has(key) || value.isNull(key)) null else value.getString(key).also { bounded(it, 2048) }
    private fun events(rows: org.json.JSONArray): List<VeilMatrixCiphertextHttpTransport.SyncEvent> {
        require(rows.length() <= 128)
        return (0 until rows.length()).map { event(rows.getJSONObject(it)) }
    }
    private fun eventRows(values: List<VeilMatrixCiphertextHttpTransport.SyncEvent>) =
        org.json.JSONArray().also { result -> values.forEach { result.put(eventRow(it)) } }
    private fun sameEvent(a: VeilMatrixCiphertextHttpTransport.SyncEvent,
                          b: VeilMatrixCiphertextHttpTransport.SyncEvent): Boolean =
        a.roomId == b.roomId && a.eventId == b.eventId && a.sender == b.sender &&
            VeilMatrixCiphertextHttpTransport.parseContent(a.content) ==
                VeilMatrixCiphertextHttpTransport.parseContent(b.content)
    private fun admitted(values: List<VeilMatrixCiphertextHttpTransport.SyncEvent>, known: List<Route>) {
        values.forEach { entry -> require(known.any { it.roomId == entry.roomId &&
            (it.remoteSender == entry.sender || it.localSender == entry.sender) }) }
    }
    private fun boundaries(state: org.json.JSONObject): List<VeilMatrixCiphertextHttpTransport.SyncEvent> {
        val saved = if (state.has("syncBoundaries")) state.getJSONArray("syncBoundaries") else org.json.JSONArray()
        require(saved.length() <= 250)
        return (0 until saved.length()).map { event(saved.getJSONObject(it)) }.also {
            require(it.map { entry -> entry.roomId }.distinct().size == it.size)
        }
    }
    private fun gapRooms(gap: org.json.JSONObject): List<org.json.JSONObject> {
        val values = gap.getJSONArray("rooms"); require(values.length() in 1..250)
        return (0 until values.length()).map { values.getJSONObject(it) }.also {
            require(it.map { room -> room.getString("room") }.distinct().size == it.size)
        }
    }
    private fun originalGap(records: Records, who: Identity, expected: org.json.JSONObject): org.json.JSONObject {
        val state = state(records, who)
        check(opaque(expected, "since") == cursor(state) && queue(state).length() == 0)
        check(state.getJSONObject("syncGap").toString() == expected.toString()) {
            "VEIL_MATRIX_HISTORY_ORIGINAL_CHANGED" }
        return state
    }
    private fun retainHistoryFailure(who: Identity, expected: org.json.JSONObject, error: Throwable): Nothing {
        if (syncFailure == null || syncFailure is VeilMatrixCiphertextHttpTransport.SyncWindow ||
            syncFailure is java.io.IOException || syncFailure is HistoryCapacity) syncFailure = error
        val first = checkNotNull(syncFailure)
        try {
            store.transaction(RecordAccess.WRITE) { records ->
                val state = originalGap(records, who, expected)
                val gap = state.getJSONObject("syncGap")
                if (!gap.has("failure")) gap.put("failure",
                    if (error.message == "VEIL_MATRIX_HISTORY_UNAVAILABLE" ||
                        error.message == "VEIL_MATRIX_HISTORY_BOUNDARY_REQUIRED") error.message
                    else "VEIL_MATRIX_HISTORY_ORIGINAL_UNKNOWN")
                records.state(state)
            }
        } catch (secondary: Throwable) { if (secondary !== first) first.addSuppressed(secondary) }
        throw first
    }
    private fun digest(value: String): String = java.security.MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun historyId(gap: org.json.JSONObject, type: String, value: String): String =
        "matrix-history-" + gap.getString("id") + "-" + type + "-" + digest(value)
    private fun tokenId(gap: org.json.JSONObject, room: String, token: String) =
        historyId(gap, "token", room + "\u0000" + token)
    private fun eventId(gap: org.json.JSONObject, value: VeilMatrixCiphertextHttpTransport.SyncEvent) =
        historyId(gap, "event", value.roomId + "\u0000" + value.eventId)
    private fun logicalId(gap: org.json.JSONObject, value: VeilMatrixCiphertextHttpTransport.SyncEvent) =
        historyId(gap, "logical", VeilMatrixCiphertextHttpTransport.parseContent(value.content).logicalId)
    private fun owner(value: org.json.JSONObject, who: Identity, gap: org.json.JSONObject) {
        check(value.getString("account") == who.accountViewRef &&
            value.getString("gap") == gap.getString("id") && value.getInt("version") == 1) {
            "VEIL_MATRIX_HISTORY_RECORD_OWNER" }
    }
    private fun originalToken(records: Records, who: Identity, gap: org.json.JSONObject,
                              room: String, token: String): org.json.JSONObject? =
        records.history(tokenId(gap, room, token))?.also {
            owner(it, who, gap)
            check(it.getString("room") == room && it.getString("from") == token) {
                "VEIL_MATRIX_HISTORY_TOKEN_INDEX_CONFLICT" }
        }
    private fun originalIndex(records: Records, who: Identity, gap: org.json.JSONObject,
                              value: VeilMatrixCiphertextHttpTransport.SyncEvent,
                              logical: Boolean): org.json.JSONObject? =
        records.history(if (logical) logicalId(gap, value) else eventId(gap, value))?.also {
            owner(it, who, gap)
            check(sameEvent(event(it.getJSONObject("event")), value)) {
                "VEIL_MATRIX_HISTORY_EVENT_CONFLICT" }
        }
    private fun readPage(records: Records, who: Identity, gap: org.json.JSONObject,
                         reference: org.json.JSONObject): org.json.JSONObject {
        val hash = reference.getString("hash")
        val id = reference.getString("id")
        check(id == historyId(gap, "page", hash))
        val page = checkNotNull(records.history(id)) { "VEIL_MATRIX_HISTORY_SEGMENT_REQUIRED" }
        owner(page, who, gap)
        check(digest(page.toString()) == hash) { "VEIL_MATRIX_HISTORY_SEGMENT_HASH" }
        require(events(page.getJSONArray("rows")).size <= 32)
        require(events(page.getJSONArray("originalRows")).size <= 32)
        require(events(page.getJSONArray("prefix")).size <= 32)
        return page
    }
    private fun nextPage(page: org.json.JSONObject): org.json.JSONObject? =
        if (page.isNull("next")) null else page.getJSONObject("next")
    /** Each immutable segment retains a <=32 identity lookahead. Empty-page
     * chains therefore do not trigger an unbounded scan on a normal read. */
    private fun prefix(records: Records, who: Identity, gap: org.json.JSONObject, room: String,
                       head: org.json.JSONObject?): List<VeilMatrixCiphertextHttpTransport.SyncEvent> {
        if (head == null) return emptyList()
        val page = readPage(records, who, gap, head)
        check(page.getString("room") == room) { "VEIL_MATRIX_HISTORY_SEGMENT_ROOM" }
        return events(page.getJSONArray("prefix")).also { require(it.size <= 32) }
    }
    /** These indices identify this protected read batch, not trusted devices.
     * The storage engine's actual 4096-record/64MiB quota remains in force. */
    private fun savePage(records: Records, who: Identity, gap: org.json.JSONObject, room: String,
                         from: String?, end: String?, rawHash: String,
                         originalRows: List<VeilMatrixCiphertextHttpTransport.SyncEvent>,
                         accepted: List<VeilMatrixCiphertextHttpTransport.SyncEvent>,
                         next: org.json.JSONObject?): org.json.JSONObject {
        require(originalRows.size <= 32 && accepted.size <= 32)
        val page = org.json.JSONObject().put("version", 1).put("account", who.accountViewRef)
            .put("gap", gap.getString("id")).put("room", room).put("from", from ?: org.json.JSONObject.NULL)
            .put("end", end ?: org.json.JSONObject.NULL).put("responseHash", rawHash)
            .put("originalRows", eventRows(originalRows)).put("rows", eventRows(accepted))
            .put("prefix", eventRows((accepted + prefix(records, who, gap, room, next)).take(32)))
            .put("next", next ?: org.json.JSONObject.NULL)
        val hash = digest(page.toString())
        val id = historyId(gap, "page", hash)
        check(records.history(id) == null) { "VEIL_MATRIX_HISTORY_SEGMENT_ALREADY_CAPTURED" }
        for (entry in accepted) {
            check(originalIndex(records, who, gap, entry, false) == null &&
                originalIndex(records, who, gap, entry, true) == null) {
                "VEIL_MATRIX_HISTORY_BOUNDARY_CONFLICT" }
            val index = org.json.JSONObject().put("version", 1).put("account", who.accountViewRef)
                .put("gap", gap.getString("id")).put("page", id).put("event", eventRow(entry))
            records.history(eventId(gap, entry), index)
            records.history(logicalId(gap, entry), index)
        }
        if (from != null) {
            check(originalToken(records, who, gap, room, from) == null) {
                "VEIL_MATRIX_HISTORY_CURSOR_CYCLE" }
            records.history(tokenId(gap, room, from), org.json.JSONObject().put("version", 1)
                .put("account", who.accountViewRef).put("gap", gap.getString("id")).put("room", room)
                .put("from", from).put("end", end ?: org.json.JSONObject.NULL).put("page", id)
                .put("responseHash", rawHash))
        }
        records.history(id, page)
        gap.put("segments", Math.addExact(gap.getLong("segments"), 1L))
        return org.json.JSONObject().put("id", id).put("hash", hash)
    }
    private fun captureGap(records: Records, who: Identity, batch: VeilMatrixCiphertextHttpTransport.SyncWindow) {
        val state = state(records, who)
        check(cursor(state) == batch.since && queue(state).length() == 0 && !state.has("syncGap"))
        val existing = boundaries(state)
        val rooms = org.json.JSONArray()
        val gap = org.json.JSONObject().put("id", java.util.UUID.randomUUID().toString())
            .put("since", batch.since ?: org.json.JSONObject.NULL).put("next", batch.next)
            .put("tail", eventRows(batch.events)).put("rooms", rooms).put("segments", 0L)
        val roomIds = (batch.boundaries.map { it.room } + batch.events.map { it.roomId }).distinct()
        for (room in roomIds) {
            val boundary = batch.boundaries.singleOrNull { it.room == room }
            val anchor = existing.singleOrNull { it.roomId == room }
            if (anchor != null) {
                val content = VeilMatrixCiphertextHttpTransport.parseContent(anchor.content)
                check(matchesSaved(record(records, content.logicalId, who), anchor))
            }
            val tail = batch.events.filter { it.roomId == room }
            val index = if (anchor == null) -1 else tail.indexOfFirst { it.eventId == anchor.eventId }
            if (index >= 0) check(sameEvent(tail[index], checkNotNull(anchor))) {
                "VEIL_MATRIX_HISTORY_EVENT_CONFLICT" }
            val accepted = if (index >= 0) tail.drop(index + 1) else tail
            val head = savePage(records, who, gap, room, null, null,
                digest(eventRows(tail).toString()), tail, accepted, null)
            rooms.put(org.json.JSONObject().put("room", room)
                .put("previous", boundary?.previous ?: org.json.JSONObject.NULL)
                .put("from", boundary?.previous ?: org.json.JSONObject.NULL)
                .put("anchor", anchor?.let { eventRow(it) } ?: org.json.JSONObject.NULL)
                .put("head", head).put("connected", boundary == null || index >= 0))
        }
        state.put("syncGap", gap)
        records.state(state)
    }
    /** One normal read fetches one backward page. Each page and its exact
     * token/event indices are protected records, not an ever-growing JSON list. */
    private fun fillHistoryPage(who: Identity, known: List<Route>, saved: org.json.JSONObject) {
        val original = saved.getJSONObject("syncGap")
        if (original.has("failure")) error(original.getString("failure"))
        try {
            check(opaque(original, "since") == cursor(saved)) { "VEIL_MATRIX_HISTORY_ORIGINAL_CURSOR_CHANGED" }
            val selected = gapRooms(original).first { !it.getBoolean("connected") }
            val room = selected.getString("room"); require(known.any { it.roomId == room })
            val from = opaque(selected, "from") ?: error("VEIL_MATRIX_HISTORY_BOUNDARY_REQUIRED")
            if (selected.isNull("anchor")) error("VEIL_MATRIX_HISTORY_BOUNDARY_REQUIRED")
            val anchor = event(selected.getJSONObject("anchor"))
            store.transaction(RecordAccess.READ) { records ->
                originalGap(records, who, original)
                check(originalToken(records, who, original, room, from) == null) {
                    "VEIL_MATRIX_HISTORY_CURSOR_CYCLE" }
            }
            val guard = object : VeilMatrixCiphertextHttpTransport.Guard {
                override fun checkCurrent() = current()
                override fun persistOriginal(snapshot: VeilMatrixCiphertextHttpTransport.Snapshot) {
                    error("VEIL_MATRIX_HISTORY_IS_READ_ONLY")
                }
            }
            val page = courier.history(room, from, guard)
            admitted(page.events, known)
            val ordered = page.events.asReversed()
            val boundary = ordered.indexOfFirst { it.eventId == anchor.eventId }
            if (boundary >= 0) check(sameEvent(ordered[boundary], anchor)) { "VEIL_MATRIX_HISTORY_EVENT_CONFLICT" }
            val connected = boundary >= 0
            val candidate = if (connected) ordered.drop(boundary + 1) else ordered
            current()
            store.transaction(RecordAccess.WRITE) { records ->
                val state = originalGap(records, who, original)
                val updated = state.getJSONObject("syncGap")
                val target = gapRooms(updated).single { it.getString("room") == room }
                if (page.end != null) check(page.end != from &&
                    originalToken(records, who, updated, room, page.end) == null) {
                    "VEIL_MATRIX_HISTORY_CURSOR_CYCLE" }
                val head = if (target.isNull("head")) null else target.getJSONObject("head")
                val newer = prefix(records, who, updated, room, head)
                var overlap = 0
                for (size in minOf(candidate.size, newer.size) downTo 1) {
                    if (candidate.takeLast(size).zip(newer.take(size)).all { (a, b) -> sameEvent(a, b) }) {
                        overlap = size; break
                    }
                }
                for ((position, entry) in candidate.withIndex()) {
                    val byEvent = originalIndex(records, who, updated, entry, false)
                    val byLogical = originalIndex(records, who, updated, entry, true)
                    if (position < candidate.size - overlap) check(byEvent == null && byLogical == null) {
                        "VEIL_MATRIX_HISTORY_BOUNDARY_CONFLICT" }
                    else check(byEvent != null && byLogical != null &&
                        byEvent.getString("page") == byLogical.getString("page")) {
                        "VEIL_MATRIX_HISTORY_BOUNDARY_CONFLICT" }
                }
                val next = savePage(records, who, updated, room, from, page.end, page.responseSha256,
                    page.events, candidate.dropLast(overlap), head)
                target.put("head", next).put("connected", connected).put("from", page.end ?: org.json.JSONObject.NULL)
                updated.remove("capacity")
                if (!connected && page.end == null) updated.put("failure", "VEIL_MATRIX_HISTORY_UNAVAILABLE")
                records.state(state)
            }
            current()
            if (!connected && page.end == null) {
                syncFailure = IllegalStateException("VEIL_MATRIX_HISTORY_UNAVAILABLE")
                throw checkNotNull(syncFailure)
            }
            syncFailure = null
        } catch (capacity: HistoryCapacity) {
            // No Native operation was attempted. Confirm the original protected
            // gap survived the rolled-back write before allowing a normal retry.
            try {
                store.transaction(RecordAccess.WRITE) { records ->
                    val state = originalGap(records, who, original)
                    state.getJSONObject("syncGap").put("capacity", "SOCIAL_STORAGE_CAPACITY")
                    records.state(state)
                }
                current()
            } catch (unknown: Throwable) {
                throw IllegalStateException("VEIL_MATRIX_HISTORY_CAPACITY_STATE_UNKNOWN", capacity).also {
                    it.addSuppressed(unknown)
                }
            }
            syncFailure = capacity
            throw capacity
        } catch (network: java.io.IOException) {
            syncFailure = network; current()
        } catch (error: Throwable) {
            if (error === syncFailure && error.message == "VEIL_MATRIX_HISTORY_UNAVAILABLE") throw error
            retainHistoryFailure(who, original, error)
        }
    }
    private fun retirePage(records: Records, who: Identity, state: org.json.JSONObject,
                           reference: org.json.JSONObject) {
        val gap = state.getJSONObject("syncGap")
        check(gapRooms(gap).all { it.getBoolean("connected") } && queue(state).length() == 0)
        val page = readPage(records, who, gap, reference)
        val room = gapRooms(gap).single { it.getString("room") == page.getString("room") }
        check(room.getJSONObject("head").toString() == reference.toString())
        for (entry in events(page.getJSONArray("rows"))) {
            val content = VeilMatrixCiphertextHttpTransport.parseContent(entry.content)
            check(matchesSaved(record(records, content.logicalId, who), entry)) {
                "VEIL_MATRIX_HISTORY_SEGMENT_NOT_COMMITTED" }
            for (logical in listOf(false, true)) {
                val index = checkNotNull(originalIndex(records, who, gap, entry, logical))
                check(index.getString("page") == reference.getString("id"))
                records.removeHistory(if (logical) logicalId(gap, entry) else eventId(gap, entry))
            }
        }
        opaque(page, "from")?.let { from ->
            val token = checkNotNull(originalToken(records, who, gap, page.getString("room"), from))
            check(token.getString("page") == reference.getString("id"))
            records.removeHistory(tokenId(gap, page.getString("room"), from))
        }
        records.removeHistory(reference.getString("id"))
        room.put("head", nextPage(page) ?: org.json.JSONObject.NULL)
        gap.put("segments", Math.subtractExact(gap.getLong("segments"), 1L)).remove("activePage")
        if (gapRooms(gap).all { it.isNull("head") }) {
            check(gap.getLong("segments") == 0L)
            state.put("syncCursor", gap.getString("next")).remove("syncNext")
            state.remove("syncGap")
        }
    }
    /** After the exact boundary is joined, only one oldest protected segment
     * enters the <=128 Native queue. Its removal shares the final CLOSED commit. */
    private fun loadHistoryQueue(who: Identity) {
        current()
        store.transaction(RecordAccess.WRITE) { records ->
            val state = state(records, who)
            val gap = state.getJSONObject("syncGap")
            check(!gap.has("failure") && gapRooms(gap).all { it.getBoolean("connected") })
            check(queue(state).length() == 0 && !gap.has("activePage"))
            val selected = gapRooms(gap).first { !it.isNull("head") }
            val reference = selected.getJSONObject("head")
            val page = readPage(records, who, gap, reference)
            check(page.getString("room") == selected.getString("room")) { "VEIL_MATRIX_HISTORY_SEGMENT_ROOM" }
            val values = events(page.getJSONArray("rows"))
            if (values.isEmpty()) retirePage(records, who, state, reference)
            else {
                gap.put("activePage", reference)
                state.put("syncQueue", eventRows(values)).put("syncNext", gap.getString("next"))
            }
            records.state(state)
        }
        current()
    }

    private var syncFailure: Throwable? = null
    private fun cursor(value: org.json.JSONObject): String? =
        if (value.has("syncCursor")) value.getString("syncCursor").also { bounded(it, 2048) } else null
    private fun queue(value: org.json.JSONObject): org.json.JSONArray =
        (if (value.has("syncQueue")) value.getJSONArray("syncQueue") else org.json.JSONArray())
            .also { require(it.length() <= 128) }
    private fun event(row: org.json.JSONObject): VeilMatrixCiphertextHttpTransport.SyncEvent {
        require(row.keys().asSequence().toSet() == setOf("roomId", "eventId", "sender", "content"))
        return VeilMatrixCiphertextHttpTransport.SyncEvent(row.getString("roomId"),
            row.getString("eventId"), row.getString("sender"), row.getString("content"))
    }
    private fun eventRow(value: VeilMatrixCiphertextHttpTransport.SyncEvent) = org.json.JSONObject()
        .put("roomId", value.roomId).put("eventId", value.eventId)
        .put("sender", value.sender).put("content", value.content)
    private fun matchesSaved(saved: org.json.JSONObject, expected: VeilMatrixCiphertextHttpTransport.SyncEvent): Boolean {
        val content = VeilMatrixCiphertextHttpTransport.parseContent(expected.content)
        return saved.getString("type") == (if (content.initialSession) "initialSession" else "message") &&
            saved.optString("initialPurpose", "") == (content.purpose ?: "") &&
            saved.optString("recipientBundleSha256", "") == (content.recipientBundleSha256 ?: "") &&
            saved.getString("status") == "CLOSED" &&
            saved.getString("logicalId") == content.logicalId && saved.getString("roomId") == expected.roomId &&
            saved.getString("eventId") == expected.eventId && saved.getString("sender") == expected.sender &&
            saved.getString("media") == content.media && saved.getInt("ciphertextType") == content.kind &&
            saved.getString("ciphertextSha256") == content.sha256 && saved.getInt("ciphertextBytes") == content.bytes
    }
    /** Queue and next cursor are committed together only when each original
     * event has a verified Native/business terminal. This is progress, not trust. */
    private fun acknowledge(records: Records, who: Identity, value: VeilMatrixCiphertextHttpTransport.SyncEvent) {
        val state = state(records, who)
        val rows = queue(state)
        if (rows.length() == 0 || event(rows.getJSONObject(0)) != value) return
        val content = VeilMatrixCiphertextHttpTransport.parseContent(value.content)
        check(matchesSaved(record(records, content.logicalId, who), value)) { "VEIL_MATRIX_SYNC_ORIGINAL_NOT_COMMITTED" }
        val remaining = org.json.JSONArray()
        for (index in 1 until rows.length()) remaining.put(rows.getJSONObject(index))
        state.put("syncQueue", remaining)
        val anchors = boundaries(state).filter { it.roomId != value.roomId } + value
        state.put("syncBoundaries", eventRows(anchors))
        if (remaining.length() == 0) {
            if (state.has("syncGap")) {
                val gap = state.getJSONObject("syncGap")
                retirePage(records, who, state, gap.getJSONObject("activePage"))
            } else {
                val next = state.getString("syncNext"); bounded(next, 2048)
                state.put("syncCursor", next).remove("syncNext")
            }
        }
        records.state(state)
    }
    /** Normal-read bookkeeping only, after a genuine native terminal query.
     * The review path itself never writes, retires, closes or retransmits.
     * Process at most one exact saved original; never loop or poll afterwards
     * in this same read. UNKNOWN effects cannot become committed. A distinct
     * ABORTED bookkeeping result needs safe-abort proof and no courier effects. */
    private fun reconcileFinalizedBookkeeping(who: Identity): Boolean {
        val candidate = store.transaction(RecordAccess.READ) { records ->
            val id = unfinished(records, who).firstOrNull {
                val value = record(records, it, who)
                value.getString("status") == "COMMITTED" || safeAbortCanCreateDraft(value)
            } ?: return@transaction null
            Pair(record(records, id, who).toString(), state(records, who).getLong("revision"))
        } ?: return false
        val saved = org.json.JSONObject(candidate.first)
        val reference = saved.getString("reference")
        val reviewed = reviewSavedOriginal(reference, mapOf("accountViewRef" to who.accountViewRef))
        val terminalStatus = when {
            reviewed["resolution"] == "confirmed" && saved.getString("status") == "COMMITTED" -> "CLOSED"
            reviewed["resolution"] == "aborted" && safeAbortCanCreateDraft(saved) -> "ABORTED"
            else -> return false
        }
        current()
        var expectedReadback: String? = null
        store.transaction(RecordAccess.WRITE) { records ->
            val actual = record(records, reference, who)
            check(actual.toString() == candidate.first &&
                (if (terminalStatus == "CLOSED") actual.getString("status") == "COMMITTED" else safeAbortCanCreateDraft(actual)) &&
                state(records, who).getLong("revision") == candidate.second) { "VEIL_PRODUCT_SAVED_ORIGINAL_CHANGED" }
            actual.put("status", terminalStatus)
            records.operation(reference, actual)
            if (terminalStatus == "CLOSED") {
                clearFinalizedDraft(records, who, actual)
                VeilAttachmentSelectionLifecycle.releaseConfirmed(records, who.accountViewRef, actual)
            }
            bump(records, who)
            expectedReadback = actual.toString()
        }
        current()
        // Independently read the committed protected record and state. An
        // uncertain transaction finish throws before this read, is retained by
        // the existing Business/Source owner and never gets a second finish.
        store.transaction(RecordAccess.READ) { records ->
            check(record(records, reference, who).toString() == expectedReadback &&
                state(records, who).getLong("revision") == Math.addExact(candidate.second, 1)) {
                "VEIL_PRODUCT_SAVED_ORIGINAL_READBACK_REQUIRED"
            }
        }
        current()
        return true
    }
    override fun nextIncoming(capture: (VeilNativeMessageBusiness.Message) -> Unit) {
        current()
        if (retained != null || failureHeld) return
        val who = identity()
        if (attachments?.reconcileOneFinalizedQuota(who.accountViewRef) == true) return
        if (reconcileFinalizedBookkeeping(who)) return
        val known = routes()
        if (known.isEmpty()) return
        var saved = store.transaction(RecordAccess.READ) { records ->
            if (unfinished(records, who).isNotEmpty()) return@transaction null
            state(records, who)
        } ?: return
        var rows = queue(saved)
        if (rows.length() == 0 && saved.has("syncGap")) {
            if (!gapRooms(saved.getJSONObject("syncGap")).all { it.getBoolean("connected") }) {
                fillHistoryPage(who, known, saved)
                saved = store.transaction(RecordAccess.READ) { state(it, who) }
            }
            if (saved.has("syncGap") && !saved.getJSONObject("syncGap").has("failure") &&
                gapRooms(saved.getJSONObject("syncGap")).all { it.getBoolean("connected") })
                loadHistoryQueue(who)
            saved = store.transaction(RecordAccess.READ) { state(it, who) }
            rows = queue(saved)
            if (rows.length() == 0) return // One network page or one empty-segment retirement per normal call.
        }
        if (rows.length() == 0) {
            val since = cursor(saved)
            val guard = object : VeilMatrixCiphertextHttpTransport.Guard {
                override fun checkCurrent() = current()
                override fun persistOriginal(snapshot: VeilMatrixCiphertextHttpTransport.Snapshot) {
                    error("VEIL_MATRIX_SYNC_IS_READ_ONLY")
                }
            }
            val admittedRooms = known.map { it.roomId }.distinct()
            val batch = try {
                courier.sync(since, admittedRooms, guard)
            } catch (gap: VeilMatrixCiphertextHttpTransport.SyncWindow) {
                admitted(gap.events, known)
                store.transaction(RecordAccess.WRITE) { records -> captureGap(records, who, gap) }
                syncFailure = gap
                current()
                return // Protected pages drain first; actual missing boundaries are never crossed.
            } catch (network: java.io.IOException) {
                // A later normal read can make one new read-only GET. This is
                // not replay of an effectful Native/POST/PUT original.
                syncFailure = network
                current()
                return
            }
            current()
            syncFailure = null
            val captured = org.json.JSONArray()
            for (entry in batch.events) {
                require(known.any { it.roomId == entry.roomId &&
                    (it.remoteSender == entry.sender || it.localSender == entry.sender) })
                captured.put(eventRow(entry))
            }
            store.transaction(RecordAccess.WRITE) { records ->
                val state = state(records, who)
                check(cursor(state) == since && queue(state).length() == 0)
                state.put("syncQueue", captured)
                if (captured.length() == 0) {
                    state.put("syncCursor", batch.next)
                } else state.put("syncNext", batch.next)
                records.state(state)
            }
            current()
            rows = captured
        }
        if (rows.length() == 0) return
        val selected = event(rows.getJSONObject(0))
        val content = VeilMatrixCiphertextHttpTransport.parseContent(selected.content)
        val already = store.transaction(RecordAccess.READ) { it.operation(content.logicalId) }
        if (already != null) {
            // Exact self echoes also need an original CLOSED Native/business
            // result. This does not establish peer delivery.
            check(matchesSaved(already, selected)) { "VEIL_MATRIX_SYNC_ORIGINAL_CONFLICT" }
            store.transaction(RecordAccess.WRITE) { acknowledge(it, who, selected) }
            current()
            return
        }
        val route = known.single { it.roomId == selected.roomId && it.remoteSender == selected.sender }
        incoming(route.id, selected.eventId, selected.sender, content, capture)
    }
    internal fun retainedSyncFailure(): Throwable? { current(); return syncFailure }

    private abstract inner class Operation(
        val who: Identity, final override val reference: String,
        val command: Map<String, Any?>, val context: Map<String, Any?>
    ) : VeilNativeMessageBusiness.Original {
        var firstFailure: Throwable? = null
        var closed = false
        open fun requireSavedForLocalAck(saved: org.json.JSONObject) {
            require(saved.getString("type") == when (this) {
                is Contact -> "contact"
                is VeilNativeMessageBusiness.InitialSessionReceive, is VeilNativeMessageBusiness.InitialSessionSend -> "initialSession"
                else -> "message"
            })
            if (command.isEmpty() && context.isEmpty()) {
                val cmd = saved.getJSONObject("originalCommand")
                require(saved.getJSONObject("originalContext").length() == 0 &&
                    (cmd.length() == 0 || (cmd.length() == 1 && cmd.has("replyToMessageId") && cmd.isNull("replyToMessageId"))))
            } else {
                val decoded = if (this is VeilNativeMessageBusiness.InitialSessionSend)
                    VeilSocialMessagingCoordinator.Request.decodeSourceOriginal(
                        saved.getJSONObject("originalContext").toString(), saved.getJSONObject("originalCommand").toString())
                else VeilSocialMessagingCoordinator.Request.decode(
                    saved.getJSONObject("originalContext").toString(), saved.getJSONObject("originalCommand").toString())
                require(decoded.command == command && decoded.context == context)
            }
        }
        abstract fun authorityForLocalAck(): VeilNativeMessageBusiness.Original?
        open fun acknowledgeTransportLocal(source: VeilNativeMatrixSource, account: String) {}
        fun retain(error: Throwable): Nothing {
            if (firstFailure == null) firstFailure = error
            else if (firstFailure !== error) firstFailure!!.addSuppressed(error)
            failure = firstFailure
            failureHeld = true
            try { update { it.put("status", "UNKNOWN") } }
            catch (secondary: Throwable) { if (secondary !== firstFailure) firstFailure!!.addSuppressed(secondary) }
            throw checkNotNull(firstFailure)
        }
        override fun checkCurrent() {
            current(); check(!closed && retained === this)
            require(identity().accountViewRef == who.accountViewRef)
        }
        override fun requireRequest(command: Map<String, Any?>, context: Map<String, Any?>) {
            checkCurrent(); require(this.command == command && this.context == context)
        }
        fun update(block: (org.json.JSONObject) -> Unit) {
            current()
            store.transaction(RecordAccess.WRITE) { records ->
                val value = record(records, reference, who)
                block(value)
                records.operation(reference, value)
                bump(records, who)
            }
            current()
        }
        fun status() = store.transaction(RecordAccess.READ) { record(it, reference, who).getString("status") }
        fun finish(after: (Records) -> Unit = {}) {
            current()
            store.transaction(RecordAccess.WRITE) { records ->
                val value = record(records, reference, who)
                value.put("status", "CLOSED")
                records.operation(reference, value)
                clearFinalizedDraft(records, who, value)
                after(records)
                bump(records, who)
            }
            current()
            closed = true; retained = null
        }
    }
    private inner class InitialSendMessage(
        who: Identity, route: Route, id: String, command: Map<String, Any?>, context: Map<String, Any?>,
        frame: ByteArray, private val peerBundle: ByteArray
    ) : Message(who, route, id, command, context, frame, false, null, "", null),
        VeilNativeMessageBusiness.InitialSessionSend {
        override fun canonicalPeerBundle(): ByteArray { checkCurrent(); return peerBundle.copyOf() }
        override fun controlAuthority(): MessageAuthority = initialSendAuthority()
        override fun close() { super.close(); peerBundle.fill(0) }
    }
    private inner class InitialReceiveMessage(
        who: Identity, route: Route, id: String, eventId: String,
        content: VeilMatrixCiphertextHttpTransport.Content
    ) : Message(who, route, id, emptyMap(), emptyMap(), null, true, eventId, "", content),
        VeilNativeMessageBusiness.InitialSessionReceive {
        override fun controlAuthority(): MessageAuthority = initialControlAuthority()
        override fun recordVerifiedControl(output: VeilNativeMessageOutput) = commitInitialControl(output)
    }
    private open inner class Message(
        who: Identity, val route: Route, id: String,
        command: Map<String, Any?>, context: Map<String, Any?>,
        private var originalFrame: ByteArray?, val incoming: Boolean,
        val eventId: String?, private var body: String,
        private val incomingContent: VeilMatrixCiphertextHttpTransport.Content?
    ) : Operation(who, id, command, context), VeilNativeMessageBusiness.Message,
        VeilMatrixCiphertextHttpTransport.Guard {
        private val protocolControl: Boolean get() = this is VeilNativeMessageBusiness.InitialSessionReceive ||
            this is VeilNativeMessageBusiness.InitialSessionSend
        private var authority: MessageAuthority? = null
        private var transport: VeilMatrixCiphertextHttpTransport.Original? = null
        private var attachmentTransport: VeilMatrixCiphertextHttpTransport.AttachmentOriginal? = null
        private var attachmentDescriptor: String? = null
        private var outputSeen = false
        private var closeAttempted = false
        private var replyToMessageId: String? = command["replyToMessageId"] as String?
        private var savedDraftRevision: Long? = null
        override fun requireSavedForLocalAck(saved: org.json.JSONObject) {
            super.requireSavedForLocalAck(saved)
            require(boundDraftRevision(saved) == savedDraftRevision)
            require(saved.getString("logicalId") == reference && saved.getString("conversationId") == route.id &&
                saved.getString("roomId") == route.roomId && saved.getString("direction") == if (incoming) "incoming" else "outgoing")
            require(saved.getString("sender") == if (incoming) route.remoteSender else route.localSender)
            require((if (saved.has("attachmentDescriptor")) saved.getString("attachmentDescriptor") else null) == attachmentDescriptor)
            require(saved.getString("body") == body &&
                (if (!saved.has("replyToMessageId") || saved.isNull("replyToMessageId")) null else saved.getString("replyToMessageId")) == replyToMessageId)
        }
        override fun authorityForLocalAck(): VeilNativeMessageBusiness.Original? = authority
        override fun acknowledgeTransportLocal(source: VeilNativeMatrixSource, account: String) {
            transport?.acknowledgeFinalizedLocal(source, account, reference)
        }
        fun captureAttachmentUpload(value: VeilMatrixCiphertextHttpTransport.AttachmentOriginal) {
            checkCurrent(); check(!incoming && attachmentTransport == null); attachmentTransport = value
        }
        fun persistAttachmentUpload(snapshot: VeilMatrixCiphertextHttpTransport.AttachmentSnapshot) {
            require(snapshot.logicalId == reference)
            update { it.put("attachmentPhase", snapshot.phase.name).put("attachmentMedia", snapshot.media ?: org.json.JSONObject.NULL) }
        }
        fun installAttachment(value: String) {
            checkCurrent(); check(attachmentDescriptor == null)
            VeilSourceAttachmentContent.decode(value).use { it.matches(route, reference, incoming) }
            attachmentDescriptor = value
            update { it.put("attachmentDescriptor", value) }
        }
        fun installOutgoingFrame(frame: ByteArray) {
            checkCurrent(); check(!incoming && originalFrame == null)
            originalFrame = frame
            update { it.put("originalFrame", java.util.Base64.getEncoder().encodeToString(frame)) }
        }
        fun captureAuthority(value: MessageAuthority) {
            check(authority == null) { "VEIL_PRODUCT_ORIGINAL_ALREADY_CAPTURED" }
            authority = value
        }
        override fun requireRequest(command: Map<String, Any?>, context: Map<String, Any?>) {
            super.requireRequest(command, context)
            checkNotNull(authority).requireRequest(command, context)
        }
        fun requireAuthority() { checkNotNull(authority) { "VEIL_PRODUCT_NATIVE_MESSAGE_SOURCE_REQUIRED" }.checkCurrent() }
        override fun checkCurrent() {
            super.checkCurrent()
            authority?.checkCurrent()
        }
        fun persistInitial() {
            checkCurrent()
            store.transaction(RecordAccess.WRITE) { records ->
                check(records.operation(reference) == null)
                records.operation(reference, org.json.JSONObject().put("version", 1).put("reference", reference)
                    .put("account", who.accountViewRef).put("type", if (protocolControl) "initialSession" else "message")
                    .put("sequence", Math.addExact(state(records, who).getLong("revision"), 1))
                    .put("logicalId", reference).put("conversationId", route.id)
                    .put("roomId", route.roomId).put("sender", if (incoming) route.remoteSender else route.localSender)
                    .put("direction", if (incoming) "incoming" else "outgoing").put("body", body)
                    .put("replyToMessageId", replyToMessageId ?: org.json.JSONObject.NULL)
                    .put("originalCommand", VeilSocialMessagingCoordinator.jsonObject(command).also { savedCommand ->
                        if (!incoming && !protocolControl && command["type"] == "sendMessage") savedCommand.put("replyToMessageId",
                            command["replyToMessageId"] ?: org.json.JSONObject.NULL)
                    })
                    .put("originalContext", VeilSocialMessagingCoordinator.jsonObject(context))
                    .put("eventId", eventId ?: org.json.JSONObject.NULL).put("status", "PREPARED").also { value ->
                        if (this is VeilNativeMessageBusiness.InitialSessionSend) {
                            val peer = canonicalPeerBundle()
                            try {
                                val digest = java.security.MessageDigest.getInstance("SHA-256").digest(peer)
                                    .joinToString("") { "%02x".format(it.toInt() and 255) }
                                value.put("initialPurpose", VeilMatrixCiphertextHttpTransport.INITIAL_SESSION_PURPOSE)
                                    .put("recipientBundleSha256", digest)
                            } finally { peer.fill(0) }
                        }
                        if (!incoming && !protocolControl) {
                            savedDraftRevision = bindSavedDraft(records, who, route.id, body, replyToMessageId)
                            savedDraftRevision?.let { value.put("savedDraftRevision", it) }
                        }
                        incomingContent?.let { content -> value.put("media", content.media)
                            .put("ciphertextSha256", content.sha256).put("ciphertextBytes", content.bytes)
                            .put("ciphertextType", content.kind)
                            content.purpose?.let { value.put("initialPurpose", it)
                                .put("recipientBundleSha256", checkNotNull(content.recipientBundleSha256)) }
                        }
                    })
                bump(records, who)
            }
            checkCurrent()
        }
        fun installIncomingFrame(frame: ByteArray) {
            check(incoming && originalFrame == null); originalFrame = frame
            update { it.put("originalFrame", java.util.Base64.getEncoder().encodeToString(frame)) }
        }
        override fun sessionRecords(): ByteArray {
            checkCurrent(); return checkNotNull(authority).sessionRecords()
        }
        override fun frame(): ByteArray {
            checkCurrent(); return checkNotNull(originalFrame).copyOf()
        }
        fun initialSendAuthority(): MessageAuthority {
            checkCurrent(); require(!incoming && this is VeilNativeMessageBusiness.InitialSessionSend)
            return checkNotNull(authority)
        }
        fun initialControlAuthority(): MessageAuthority {
            checkCurrent()
            require(incoming && this is VeilNativeMessageBusiness.InitialSessionReceive &&
                incomingContent?.initialSession == true)
            return checkNotNull(authority)
        }
        fun commitInitialControl(output: VeilNativeMessageOutput) {
            checkCurrent(); check(!outputSeen)
            require(incoming && this is VeilNativeMessageBusiness.InitialSessionReceive &&
                output.direction == 2 && output.kind == 4 && incomingContent?.initialSession == true)
            outputSeen = true // A late failure cannot rerun or reinterpret this output.
            try {
                val id = output.logicalId()
                try { require(id.contentEquals(logical(reference))) } finally { id.fill(0) }
                initialControlAuthority().requireCommittedOutput(output)
                checkCurrent()
                val control = output.body()
                try {
                    val digest = java.security.MessageDigest.getInstance("SHA-256").digest(control)
                        .joinToString("") { "%02x".format(it.toInt() and 255) }
                    update { it.put("controlSha256", digest).put("status", "COMMITTED") }
                } finally { control.fill(0) }
                checkCurrent()
            } catch (error: Throwable) { retain(error) }
        }
        override fun consumeOriginalOutput(output: VeilNativeMessageOutput) {
            require(this !is VeilNativeMessageBusiness.InitialSessionReceive) { "VEIL_CONTROL_CANNOT_BECOME_CHAT_MESSAGE" }
            checkCurrent(); check(!outputSeen)
            outputSeen = true
            try {
                require(output.direction == if (incoming) 2 else 1)
                val id = output.logicalId()
                try { require(id.contentEquals(logical(reference))) } finally { id.fill(0) }
                val owner = checkNotNull(authority)
                owner.requireCommittedOutput(output)
                checkCurrent()
                val bytes = output.body()
                try {
                    if (incoming) {
                        val content = VeilProductMessageContent.decode(bytes)
                        require(content.replyToMessageId != reference) { "VEIL_PRODUCT_REPLY_SELF_REFERENCE" }
                        body = content.body
                        replyToMessageId = content.replyToMessageId
                        content.attachment?.let { encoded ->
                            VeilSourceAttachmentContent.decode(encoded).use { it.matches(route, reference, true) }
                            attachmentDescriptor = encoded
                        }
                        update { saved -> saved.put("body", body).put("replyToMessageId", replyToMessageId ?: org.json.JSONObject.NULL)
                            .put("status", "COMMITTED")
                            attachmentDescriptor?.let { saved.put("attachmentDescriptor", it) }
                        }
                    } else {
                        // This local sealed journal is additional product persistence,
                        // never a substitute for the original Native ratchet commit.
                        update { it.put("ciphertext", java.util.Base64.getEncoder().encodeToString(bytes))
                            .put("ciphertextType", output.kind).put("status", "NATIVE_COMMITTED") }
                        val tx = if (this is VeilNativeMessageBusiness.InitialSessionSend)
                            courier.captureInitial(output, this, route.roomId, route.localSender, reference, this)
                        else courier.capture(output, route.roomId, route.localSender, reference, this)
                        transport = tx
                        tx.send()
                        checkCurrent()
                        check(owner.completion() == VeilNativeMessageBusiness.Completion.COMMITTED)
                        update { it.put("status", "COMMITTED") }
                    }
                } finally { bytes.fill(0) }
                checkCurrent()
            } catch (error: Throwable) { retain(error) }
        }
        override fun persistOriginal(snapshot: VeilMatrixCiphertextHttpTransport.Snapshot) {
            checkCurrent()
            require(!incoming && snapshot.logicalId == reference && snapshot.transactionId == reference &&
                snapshot.roomId == route.roomId && snapshot.sender == route.localSender)
            update { it.put("transportPhase", snapshot.phase.name)
                .put("ciphertextSha256", snapshot.ciphertextSha256).put("ciphertextBytes", snapshot.ciphertextBytes)
                .put("media", snapshot.media ?: org.json.JSONObject.NULL)
                .put("eventId", snapshot.eventId ?: org.json.JSONObject.NULL)
                .put("status", if (snapshot.phase == VeilMatrixCiphertextHttpTransport.Phase.UNKNOWN) "UNKNOWN" else "NATIVE_COMMITTED")
                if (this is VeilNativeMessageBusiness.InitialSessionSend) {
                    require(snapshot.purpose == it.getString("initialPurpose") &&
                        snapshot.recipientBundleSha256 == it.getString("recipientBundleSha256"))
                } else require(snapshot.purpose == null && snapshot.recipientBundleSha256 == null)
            }
        }
        override fun completion(): VeilNativeMessageBusiness.Completion {
            checkCurrent()
            val saved = status()
            checkCurrent()
            if (firstFailure != null || saved == "UNKNOWN") return VeilNativeMessageBusiness.Completion.UNKNOWN
            val native = checkNotNull(authority).completion()
            checkCurrent()
            return if (native == VeilNativeMessageBusiness.Completion.COMMITTED && saved == "COMMITTED") native
                else if (native == VeilNativeMessageBusiness.Completion.ABORTED &&
                    store.transaction(RecordAccess.READ) { safeAbortCanCreateDraft(record(it, reference, who)) }) native
                else VeilNativeMessageBusiness.Completion.PENDING
        }
        override fun close() {
            checkCurrent(); check(!closeAttempted && completion() == VeilNativeMessageBusiness.Completion.COMMITTED)
            closeAttempted = true
            try {
                transport?.retireAfterNativeCommit {
                    check(checkNotNull(authority).completion() == VeilNativeMessageBusiness.Completion.COMMITTED)
                }
                attachmentTransport?.retireAfterNativeCommit {
                    check(checkNotNull(authority).completion() == VeilNativeMessageBusiness.Completion.COMMITTED)
                }
                checkNotNull(authority).close()
                // Authority close is not proof of journal success. A late store
                // failure retains this exact operation for explicit recovery.
                if (!incoming && VeilAttachmentSelectionLifecycle.isOutgoingAttachment(
                    store.transaction(RecordAccess.READ) { record(it, reference, who) })) {
                    check(source.observeTerminal(reference, 1) == VeilNativeMessageBusiness.Completion.COMMITTED)
                }
                finish { records ->
                    if (!incoming) VeilAttachmentSelectionLifecycle.releaseConfirmed(records, who.accountViewRef, record(records, reference, who))
                    if (incoming) {
                        val rows = queue(state(records, who))
                        if (rows.length() > 0) {
                            val selected = event(rows.getJSONObject(0))
                            if (selected.roomId == route.roomId && selected.eventId == eventId)
                                acknowledge(records, who, selected)
                        }
                    }
                }
                originalFrame?.fill(0); originalFrame = null; body = ""; replyToMessageId = null
            } catch (error: Throwable) { retain(error) }
        }
    }
    private inner class Contact(who: Identity, command: Map<String, Any?>, context: Map<String, Any?>,
                                private val authority: VeilNativeMessageBusiness.Contact) :
        Operation(who, authority.reference, command, context), VeilNativeMessageBusiness.Contact {
        private var attempted = false
        private var closeAttempted = false
        fun persistInitial() {
            ref(reference)
            checkCurrent()
            store.transaction(RecordAccess.WRITE) { records ->
                check(records.operation(reference) == null)
                records.operation(reference, org.json.JSONObject().put("version", 1).put("reference", reference)
                    .put("account", who.accountViewRef).put("type", "contact").put("status", "PREPARED")
                    .put("sequence", Math.addExact(state(records, who).getLong("revision"), 1))
                    .put("originalCommand", VeilSocialMessagingCoordinator.jsonObject(command)).put("originalContext", VeilSocialMessagingCoordinator.jsonObject(context)))
                bump(records, who)
            }
        }
        override fun authorityForLocalAck(): VeilNativeMessageBusiness.Original = authority
        override fun checkCurrent() { super.checkCurrent(); authority.checkCurrent() }
        override fun requireRequest(command: Map<String, Any?>, context: Map<String, Any?>) {
            super.requireRequest(command, context); authority.requireRequest(command, context)
        }
        override fun executeOriginal() {
            checkCurrent(); check(!attempted); attempted = true
            try {
                update { it.put("status", "ATTEMPTED") }
                authority.executeOriginal()
                checkCurrent()
                if (authority.completion() == VeilNativeMessageBusiness.Completion.COMMITTED)
                    update { it.put("status", "COMMITTED") }
            } catch (error: Throwable) { retain(error) }
        }
        override fun completion(): VeilNativeMessageBusiness.Completion {
            checkCurrent()
            if (firstFailure != null) return VeilNativeMessageBusiness.Completion.UNKNOWN
            return authority.completion()
        }
        override fun close() {
            checkCurrent(); check(!closeAttempted && completion() == VeilNativeMessageBusiness.Completion.COMMITTED)
            closeAttempted = true
            try { authority.close(); finish() } catch (error: Throwable) { retain(error) }
        }
    }
    override fun hasRetainedWork(): Boolean {
        check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
        if (retained != null || failureHeld) return true
        return try {
            current()
            if (source.hasRetainedWork() || courier.hasRetainedWork()) true
            else {
                val who = identity()
                store.transaction(RecordAccess.READ) { unfinished(it, who).isNotEmpty() }
            }
        } catch (original: Throwable) {
            // Current/lease/store failures cannot terminate the normal owner's
            // close loop, drop custody, or become a fresh close/replay attempt.
            failure = original
            failureHeld = true
            true
        }
    }
    internal fun retainedCloseFailure(): Throwable? {
        check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
        return failure
    }
    internal fun usesSourceForOwnerClose(source: VeilNativeMatrixSource): Boolean {
        check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
        return this.source === source && store === source.recordStore
    }
    override fun hasWorkBlockingOwnerClose(): Boolean {
        check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
        if (retained != null) return true
        val actual = source as? VeilNativeMatrixSource ?: return true
        if (actual.hasWorkBlockingOwnerClose()) return true
        if (actual.isClosedForOwner()) return false
        // Never read or rewrite a protected saved journal under an expired
        // business lease. Local RAM cleanup leaves its UNKNOWN rows unchanged.
        return courier.hasRetainedWork()
    }
    fun uses(source: VeilNativeMatrixSource, courier: VeilMatrixCiphertextHttpTransport) =
        this.source === source && this.storageIdentity === source.recordStore && this.courier === courier
    fun uses(source: NativeSource, store: VeilNativeStore,
             courier: VeilMatrixCiphertextHttpTransport) =
        this.source === source && this.storageIdentity === store && this.courier === courier
    companion object {
        /** Concrete normal JNI source; never a generic runtime Store installer. */
        fun owned(source: VeilNativeMatrixSource, courier: VeilMatrixCiphertextHttpTransport, attachmentUi: VeilAttachmentUi? = null): VeilMatrixProductBinding {
            source.checkCurrent()
            return VeilMatrixProductBinding(source, source.recordStore, courier, source.recordStore, attachmentUi)
        }
        fun owned(source: NativeSource, store: VeilNativeStore,
                  courier: VeilMatrixCiphertextHttpTransport): VeilMatrixProductBinding =
            VeilMatrixProductBinding(source, object : Store {
                override fun <T> transaction(access: RecordAccess, block: (Records) -> T): T = store.transaction { tx ->
                    block(object : Records {
                        private fun read(kind: VeilRecordKind, id: String): org.json.JSONObject? {
                            val bytes = tx.read(kind, id) ?: return null
                            try {
                                val value = Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                                    .decode(java.nio.ByteBuffer.wrap(bytes)).toString()
                                val reader = org.json.JSONTokener(value)
                                val json = reader.nextValue()
                                require(json is org.json.JSONObject && reader.nextClean() == '\u0000')
                                return json
                            } finally { bytes.fill(0) }
                        }
                        private fun write(kind: VeilRecordKind, id: String, value: org.json.JSONObject) {
                            check(access == RecordAccess.WRITE) { "VEIL_PRODUCT_RECORD_READ_ONLY" }
                            val bytes = value.toString().toByteArray(Charsets.UTF_8)
                            try { tx.write(kind, id, bytes) }
                            catch (capacity: IllegalArgumentException) {
                                if (capacity.message == "VEIL_STORAGE_BUDGET_EXCEEDED") throw HistoryCapacity(capacity)
                                throw capacity
                            } finally { bytes.fill(0) }
                        }
                        override fun state() = read(VeilRecordKind.SOCIAL_PRODUCT_STATE, "normal-product-v1")
                        override fun state(value: org.json.JSONObject) = write(VeilRecordKind.SOCIAL_PRODUCT_STATE, "normal-product-v1", value)
                        override fun operation(id: String) = read(VeilRecordKind.SOCIAL_PRODUCT_OPERATION, id)
                        override fun operation(id: String, value: org.json.JSONObject) = write(VeilRecordKind.SOCIAL_PRODUCT_OPERATION, id, value)
                        override fun operations() = tx.ids(VeilRecordKind.SOCIAL_PRODUCT_OPERATION)
                        override fun history(id: String) = read(VeilRecordKind.SOCIAL_PRODUCT_STATE, id)
                        override fun history(id: String, value: org.json.JSONObject) =
                            write(VeilRecordKind.SOCIAL_PRODUCT_STATE, id, value)
                        override fun removeHistory(id: String) {
                            check(access == RecordAccess.WRITE) { "VEIL_PRODUCT_RECORD_READ_ONLY" }
                            tx.remove(VeilRecordKind.SOCIAL_PRODUCT_STATE, id)
                        }
                    })
                }
            }, courier, store)
        /** PUBLIC JVM controls only. Production always uses owned + actual store. */
        internal fun control(source: NativeSource, store: Store, courier: VeilMatrixCiphertextHttpTransport) =
            VeilMatrixProductBinding(source, store, courier)
        private fun logical(id: String): ByteArray {
            val value = java.util.UUID.fromString(id)
            require(value.version() == 4 && value.variant() == 2 && value.toString() == id)
            return java.nio.ByteBuffer.allocate(16).putLong(value.mostSignificantBits).putLong(value.leastSignificantBits).array()
        }
        private fun ref(value: String) { bounded(value, 256); require(value.none { it == '\r' || it == '\n' || it == '\t' }) }
        private fun bounded(value: String, max: Int) {
            require(value.isNotBlank() && value.length <= max &&
                value.none { it.code in 0..8 || it.code in 11..12 || it.code in 14..31 || it.code == 127 })
        }
    }
}
