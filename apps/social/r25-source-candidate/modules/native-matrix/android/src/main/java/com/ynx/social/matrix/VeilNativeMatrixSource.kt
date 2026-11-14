package com.ynx.social.matrix

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Collections
import java.util.LinkedHashMap
import org.json.JSONObject
import org.json.JSONTokener

/** Normal product adapter. Its only production supplier is the private JNI
 * bridge to the already accepted native owner, not a map, SSO result, grant
 * verifier, test provider, or a newly constructed storage authority. */
internal class VeilNativeMatrixSource private constructor(
    private val ports: VeilNativeProductPorts
) : VeilMatrixProductBinding.NativeSource {
    internal class Refused(val status: Long) : IllegalStateException("VEIL_MATRIX_SOURCE_REFUSAL_$status")
    private val worker = Thread.currentThread()
    private var selector = 0L
    private var acquisitionSelected = false
    private var acquisitionStatus: Int? = null
    private var sourceObserved = false
    private var initialized = false
    private var courierInstallDigest: ByteArray? = null
    private var courierInstallFailure: Throwable? = null
    private var closing = false
    private var closed = false
    private var firstFailure: Throwable? = null
    private var directoryOpenSelected = false
    private var directoryFailure: Throwable? = null
    private var directoryUi: VeilOwnDirectoryUi? = null
    internal fun observeOwnDirectoryForUi(action: String): Map<String, Any?> {
        worker()
        val ui = directoryUi ?: VeilOwnDirectoryUi(object : VeilOwnDirectoryUi.Original {
            override fun account() = identity().accountViewRef
            override fun open() = openOwnDirectoryReadForOwner()
            override fun read() = readOwnDirectoryDataForOwner()
            override fun revalidateData() {
                // Frozen Native contract: subsequent read checks SAME captured
                // DATA/Auth current and never dispatches another request/nonce.
                readOwnDirectoryDataForOwner()
            }
            override fun inventory() = ownDirectoryCleanupInventoryForOwner()
            override fun close() { drainOwnDirectoryBeforeSourceClose() }
        }).also { directoryUi = it }
        return ui.observe(action)
    }
    private fun rememberDirectory(failure: Throwable) {
        if (directoryFailure == null) directoryFailure = failure
        if (firstFailure == null) firstFailure = directoryFailure
    }
    /** Same original SourceSlot and worker. DATA is not device authority. */
    internal fun openOwnDirectoryReadForOwner() {
        checkCurrent()
        check(!directoryOpenSelected) { "VEIL_DIRECTORY_OPEN_ALREADY_SELECTED" }
        directoryOpenSelected = true
        try { status(VeilNativeMatrixSourceJni.openOwnDirectoryRead(selector)); checkCurrent() }
        catch (failure: Throwable) { rememberDirectory(failure); throw failure }
    }
    internal fun readOwnDirectoryDataForOwner(): ByteArray {
        checkCurrent(); check(directoryOpenSelected)
        try {
            val copy = VeilNativeMatrixSourceJni.readOwnDirectoryData(selector).copyOf()
            require(copy.size in 1..(4 * 1024 * 1024)) { "VEIL_DIRECTORY_DATA_LENGTH" }
            checkCurrent()
            return copy
        } catch (failure: Throwable) { rememberDirectory(failure); throw failure }
    }
    internal data class DirectoryCleanupInventory(val started: Boolean, val parentHeld: Boolean,
        val authHeld: Boolean, val closing: Boolean, val readSelected: Boolean,
        val firstPresent: Boolean, val originalFirstRaw: Int) {
        val held: Boolean get() = parentHeld || authHeld
    }
    internal fun ownDirectoryCleanupInventoryForOwner(): DirectoryCleanupInventory {
        worker(); check(!closed && selector > 0)
        val out = LongArray(8)
        try {
            status(VeilNativeMatrixSourceJni.ownDirectoryReadCleanupInventory(selector, out))
            require(out[0] == 1L)
            for (i in 1..6) require(out[i] in 0L..1L)
            require(out[7] in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong())
            if (out[1] == 0L) require((2..7).all { out[it] == 0L })
            if (out[6] == 0L) require(out[7] == 0L)
            return DirectoryCleanupInventory(out[1] == 1L, out[2] == 1L, out[3] == 1L,
                out[4] == 1L, out[5] == 1L, out[6] == 1L, out[7].toInt())
        } finally { out.fill(0) }
    }
    private fun drainOwnDirectoryBeforeSourceClose(): Throwable? {
        // Cleanup never needs current, another factory or a fresh nonce.
        try {
            val code = VeilNativeMatrixSourceJni.closeOwnDirectoryRead(selector)
            if (code != 0) rememberDirectory(Refused(code.toLong()))
        } catch (failure: Throwable) { rememberDirectory(failure) }
        val inventory = try { ownDirectoryCleanupInventoryForOwner() }
        catch (failure: Throwable) { rememberDirectory(failure); throw failure }
        if (inventory.firstPresent) rememberDirectory(Refused(inventory.originalFirstRaw.toLong()))
        if (inventory.held) throw (directoryFailure ?: IllegalStateException("VEIL_DIRECTORY_ORIGINAL_RETAINED"))
        return directoryFailure
    }
    private var originalIdentity: VeilMatrixProductBinding.Identity? = null
    private var courierSender: String? = null
    private var courier: VeilMatrixCiphertextHttpTransport? = null
    private var transaction: RecordScope? = null
    private val originals = linkedSetOf<Original>()
    private class LocalFinalization(val account: String, val reference: String, val kind: Int,
        val direction: Int, val completion: VeilNativeMessageBusiness.Completion)
    private var localFinalization: LocalFinalization? = null
    /** One controlled same-worker consumption, not a transferable proof/DTO.
     * A result exists only after the actual private JNI terminal query. */
    internal fun withFinalizedLocalOriginal(original: VeilNativeMessageBusiness.Original,
        account: String, reference: String, consume: (VeilNativeMessageBusiness.Completion) -> Boolean): Boolean {
        checkCurrent(); check(localFinalization == null)
        val selected = original as? Original ?: error("VEIL_MATRIX_SOURCE_FOREIGN_ORIGINAL")
        check(selected.belongsTo(this) && selected.capturedReference() == reference)
        require(identity().accountViewRef == account)
        val kind = if (selected is ContactOriginal) 2 else 1
        val direction = if (selected is MessageOriginal) { if (selected.incoming) 2 else 1 } else 0
        val terminal = observeTerminal(reference, kind)
        if (terminal !in setOf(VeilNativeMessageBusiness.Completion.COMMITTED, VeilNativeMessageBusiness.Completion.ABORTED)) return false
        localFinalization = LocalFinalization(account, reference, kind, direction, terminal)
        try {
            if (!consume(terminal)) return false
            checkCurrent() // last fallible external check BEFORE local release
            selected.closed = true
            originals.remove(selected)
            selected.commandBytes.fill(0); selected.contextBytes.fill(0); selected.erase()
            return true
        } finally { localFinalization = null }
    }
    internal fun requireFinalizedLocalAck(originalPorts: VeilNativeProductPorts?,
        originalCourier: VeilMatrixCiphertextHttpTransport?, account: String, reference: String,
        kind: Int, direction: Int, committedOnly: Boolean = false) {
        checkCurrent()
        val selected = checkNotNull(localFinalization) { "VEIL_MATRIX_FINALIZED_LOCAL_SCOPE_REQUIRED" }
        check(selected.account == account && selected.reference == reference && selected.kind == kind && selected.direction == direction)
        check((originalPorts != null && originalPorts === ports && originalCourier == null) ||
            (originalCourier != null && originalCourier === courier && originalPorts == null))
        if (committedOnly) check(selected.completion == VeilNativeMessageBusiness.Completion.COMMITTED)
        require(identity().accountViewRef == account)
    }

    private fun worker() = check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
    private fun retain(error: Throwable): Nothing {
        if (firstFailure == null) firstFailure = error
        else if (firstFailure !== error) try { firstFailure!!.addSuppressed(error) } catch (_: Throwable) { }
        throw error
    }
    private fun status(code: Int) { if (code != 0) throw Refused(code.toLong()) }
    private fun length(value: Long, maximum: Int): Int {
        if (value < 0) throw Refused(if (value == Long.MIN_VALUE) 32 else -value)
        require(value <= maximum.toLong()) { "VEIL_MATRIX_SOURCE_LENGTH" }
        return value.toInt()
    }
    override fun checkCurrent() {
        worker()
        check(VeilNativeMatrixSourceJni.abiVersion() == 2) { "VEIL_MATRIX_SOURCE_ABI_REQUIRED" }
        check(!closed && !closing && selector > 0 && sourceObserved) { "VEIL_MATRIX_SOURCE_ORIGINAL_REQUIRED" }
        observeFinishedRecords()
        check(transaction == null) { "VEIL_MATRIX_EXTERNAL_CALL_INSIDE_TRANSACTION" }
        try {
            ports.requireAcceptedDeviceCurrent()
            status(VeilNativeMatrixSourceJni.current(selector))
            ports.requireAcceptedDeviceCurrent()
        } catch (failure: Throwable) { retain(failure) }
    }
    private fun observeFinishedRecords() {
        val held = transaction ?: return
        if (held.invocationActive || held.observingOutcome || held.firstFailure == null || held.selector <= 0) return
        held.observingOutcome = true
        val outcome = try { VeilNativeMatrixSourceJni.recordsOutcome(selector, held.selector) }
        catch (error: Throwable) {
            val primary = held.firstFailure ?: error
            if (primary !== error) try { primary.addSuppressed(error) } catch (_: Throwable) { }
            retain(primary)
        } finally { held.observingOutcome = false }
        when (outcome) {
            1, 2 -> { held.closed = true; transaction = null } // actual end proved; no finish retry
            0, 3 -> throw (held.firstFailure ?: Refused(16))
            else -> {
                val error = if (outcome < 0) Refused(-outcome.toLong()) else Refused(32)
                val primary = held.firstFailure ?: error
                if (primary !== error) try { primary.addSuppressed(error) } catch (_: Throwable) { }
                retain(primary)
            }
        }
    }
    private fun checkHistoricalRead() {
        worker()
        check(VeilNativeMatrixSourceJni.abiVersion() == 2)
        check(!closed && !closing && selector > 0 && sourceObserved && initialized && originalIdentity != null) {
            "VEIL_MATRIX_SOURCE_ORIGINAL_REQUIRED"
        }
        check(transaction == null) { "VEIL_MATRIX_EXTERNAL_CALL_INSIDE_TRANSACTION" }
        ports.requireAcceptedDeviceCurrent()
        // Actual Root/device/context and READ3 are independently checked by C.
        // No ordinary current, finish/close retry or first/UNKNOWN reset here.
    }
    /** Scope for a read-only lookup through the SAME original courier. The
     * Native getter independently checks Root/device/context on every call;
     * its closed fact alone never authorizes a write, retry or retirement. */
    internal fun requireHistoricalMessageRead(originalCourier: VeilMatrixCiphertextHttpTransport,
        reference: String, sender: String) {
        checkHistoricalRead()
        check(originalCourier === courier && sender == courierSender) { "VEIL_MATRIX_HISTORICAL_COURIER_REBOUND" }
        check(observeTerminal(reference, 1) == VeilNativeMessageBusiness.Completion.COMMITTED) {
            "VEIL_MATRIX_HISTORICAL_MESSAGE_NOT_FINALIZED"
        }
        checkHistoricalRead()
    }
    override fun historicalOriginal(reference: String): VeilMatrixProductBinding.HistoricalOriginal {
        checkHistoricalRead(); reference(reference)
        val who = checkNotNull(originalIdentity)
        val bytes = try { VeilNativeMatrixSourceJni.historicalRecord(selector, reference) }
            catch (failure: Throwable) { retain(failure) }
        try {
            require(bytes.size <= MAX_RECORD)
            val saved = if (bytes.isEmpty()) null else {
                val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
                val parser = JSONTokener(text)
                val value = parser.nextValue()
                require(value is JSONObject && parser.nextClean() == '\u0000')
                value
            }
            checkHistoricalRead()
            return VeilMatrixProductBinding.HistoricalOriginal(who, saved)
        } catch (failure: Throwable) { retain(failure) }
        finally { bytes.fill(0) }
    }
    override fun observeTerminal(reference: String, kind: Int): VeilNativeMessageBusiness.Completion {
        checkHistoricalRead(); reference(reference); require(kind in 1..2)
        val value = VeilNativeMatrixSourceJni.observeTerminal(selector, reference, kind)
        if (value < 0) throw Refused(-value.toLong())
        val result = when (value) {
            0 -> VeilNativeMessageBusiness.Completion.PENDING
            1 -> VeilNativeMessageBusiness.Completion.COMMITTED
            2 -> VeilNativeMessageBusiness.Completion.ABORTED
            3 -> VeilNativeMessageBusiness.Completion.UNKNOWN
            else -> error("VEIL_MATRIX_SOURCE_TERMINAL_INVALID")
        }
        checkHistoricalRead()
        return result
    }
    /** A second call observes this SAME borrow only. It never calls acquisition
     * again, opens a replacement source, or creates a new courier credential. */
    internal fun initialize() = initialize(null)
    internal fun initialize(courierRecord: ByteArray?) {
        worker(); check(!closed && !closing)
        try {
            if (!acquisitionSelected) {
                ports.requireAcceptedDeviceCurrent()
                acquisitionSelected = true
                val out = LongArray(1)
                try { acquisitionStatus = VeilNativeMatrixSourceJni.acquireOriginal(out) }
                finally { selector = out[0]; out.fill(0) }
                status(acquisitionStatus ?: throw Refused(16))
            }
            require(selector > 0) { "VEIL_MATRIX_SOURCE_ORIGINAL_REQUIRED" }
            if (!sourceObserved) {
                // Read-only reconciliation of this exact partial borrow. Keep
                // acquisitionStatus/firstFailure unchanged; never acquire again.
                ports.requireAcceptedDeviceCurrent()
                status(VeilNativeMatrixSourceJni.current(selector))
                ports.requireAcceptedDeviceCurrent()
                sourceObserved = true
            }
            checkCurrent()
            courierInstallFailure?.let { throw it }
            if (courierRecord != null) {
                identity() // genuine account binding before any protected writer
                require(courierRecord.size in 1..16384)
                val digest = java.security.MessageDigest.getInstance("SHA-256").digest(courierRecord)
                try {
                    val old = courierInstallDigest
                    if (old != null) check(java.security.MessageDigest.isEqual(old, digest)) { "VEIL_MATRIX_COURIER_RECORD_CHANGED" }
                    else {
                        check(!initialized && courier == null) { "VEIL_MATRIX_COURIER_ALREADY_INITIALIZED" }
                        courierInstallDigest = digest.copyOf() // select before JNI; UNKNOWN never writes twice
                        val copy = courierRecord.copyOf()
                        try {
                            status(VeilNativeMatrixSourceJni.installCourierRecord(selector, copy))
                            checkCurrent()
                        } catch (failure: Throwable) { courierInstallFailure = failure; throw failure }
                        finally { copy.fill(0) }
                    }
                } finally { digest.fill(0) }
            }
            if (!initialized) {
                identity()
                if (courier == null) {
                val address = VeilNativeMatrixSourceJni.courierIdentity(selector).copyOf()
                require(address.size == 2)
                bounded(address[0], 2048); reference(address[1]); require(address[1].startsWith("@"))
                checkCurrent()
                val token = VeilNativeMatrixSourceJni.courierToken(selector)
                try {
                    require(token.size in 1..4096 && token.all { it.code in 33..126 })
                    checkCurrent()
                    courier = VeilMatrixCiphertextHttpTransport.create(address[0], token)
                    courierSender = address[1]
                } finally { token.fill('\u0000') }
                }
                checkCurrent()
                initialized = true
            }
        } catch (error: Throwable) { retain(error) }
    }
    internal fun originalCourier(): VeilMatrixCiphertextHttpTransport {
        checkCurrent(); check(initialized)
        return checkNotNull(courier)
    }
    override fun identity(): VeilMatrixProductBinding.Identity {
        checkCurrent()
        val values = VeilNativeMatrixSourceJni.identity(selector).copyOf()
        require(values.size == 3)
        reference(values[0]); bounded(values[1], 256); bounded(values[2], 512)
        val who = VeilMatrixProductBinding.Identity(values[0], values[1], values[2])
        val old = originalIdentity
        check(old == null || old.accountViewRef == who.accountViewRef) { "VEIL_MATRIX_SOURCE_ACCOUNT_REBOUND" }
        checkCurrent()
        if (old == null) originalIdentity = who
        return who
    }
    override fun routes(): List<VeilMatrixProductBinding.Route> {
        checkCurrent(); check(initialized)
        val values = VeilNativeMatrixSourceJni.routes(selector).copyOf()
        require(values.size <= 1500 && values.size % 6 == 0)
        val result = values.toList().chunked(6).map { item ->
            reference(item[0]); bounded(item[1], 256); bounded(item[2], 512)
            for (i in 3..5) reference(item[i])
            require(item[3].startsWith("!") && item[4].startsWith("@") && item[5].startsWith("@"))
            check(item[4] == courierSender) { "VEIL_MATRIX_SOURCE_COURIER_REBOUND" }
            VeilMatrixProductBinding.Route(item[0], item[1], item[2], item[3], item[4], item[5])
        }
        require(result.map { it.id }.distinct().size == result.size &&
            result.map { it.roomId }.distinct().size == result.size)
        checkCurrent()
        return result
    }
    override fun contacts(): List<VeilMatrixProductBinding.ContactEntry> {
        checkCurrent(); check(initialized)
        val values = VeilNativeMatrixSourceJni.contacts(selector).copyOf()
        require(values.size <= 2500 && values.size % 5 == 0)
        val result = values.toList().chunked(5).map { item ->
            reference(item[0]); peerAccountId(item[1]); bounded(item[2], 256)
            val publicIdentifier = item[3].takeUnless { it.isEmpty() }?.also { bounded(it, 512) }
            val conversation = item[4].takeUnless { it.isEmpty() }?.also(::reference)
            VeilMatrixProductBinding.ContactEntry(item[0], item[1], item[2], publicIdentifier, conversation)
        }
        require(result.map { it.id }.distinct().size == result.size && result.map { it.peerAccountId }.distinct().size == result.size)
        checkCurrent()
        return result
    }
    override fun invitations(): List<VeilMatrixProductBinding.Invitation> {
        checkCurrent(); check(initialized)
        val values = VeilNativeMatrixSourceJni.invitations(selector).copyOf()
        require(values.size <= 1000 && values.size % 5 == 0)
        val result = values.toList().chunked(5).map { item ->
            reference(item[0]); peerAccountId(item[1]); bounded(item[2], 256)
            val publicIdentifier = item[3].takeUnless { it.isEmpty() }?.also { bounded(it, 512) }
            val direction = when (item[4]) {
                "incoming" -> VeilMatrixProductBinding.ContactRequestDirection.INCOMING
                "outgoing" -> VeilMatrixProductBinding.ContactRequestDirection.OUTGOING
                else -> error("VEIL_CONTACT_DIRECTION_INVALID")
            }
            VeilMatrixProductBinding.Invitation(item[0], item[1], item[2], direction, publicIdentifier)
        }
        require(result.map { it.id }.distinct().size == result.size && result.map { it.peerAccountId }.distinct().size == result.size)
        require(result.count { it.direction == VeilMatrixProductBinding.ContactRequestDirection.INCOMING } <= 100 && result.count { it.direction == VeilMatrixProductBinding.ContactRequestDirection.OUTGOING } <= 100)
        checkCurrent()
        return result
    }
    override fun blockedContacts(): List<VeilMatrixProductBinding.BlockedContact> {
        checkCurrent(); check(initialized)
        val values = VeilNativeMatrixSourceJni.blockedContacts(selector).copyOf()
        require(values.size <= 1000 && values.size % 2 == 0)
        val result = values.toList().chunked(2).map { item ->
            peerAccountId(item[0]); bounded(item[1], 256)
            VeilMatrixProductBinding.BlockedContact(item[0], item[1])
        }
        require(result.map { it.peerAccountId }.distinct().size == result.size)
        checkCurrent(); return result
    }
    override fun contactActions(): Set<String> {
        checkCurrent(); check(initialized)
        val values = VeilNativeMatrixSourceJni.contactActions(selector).copyOf().toList()
        require(values.size <= 5 && values.distinct().size == values.size && values.all { it in setOf("requestContact", "acceptContact", "rejectContact", "blockContact", "unblockContact") })
        checkCurrent(); return values.toSet()
    }

    /** This concrete store uses only the SAME native protected store. In
     * particular it never issues the dormant Kotlin VeilNativeStore lease. */
    internal val recordStore: VeilMatrixProductBinding.Store = object : VeilMatrixProductBinding.Store {
        override fun <T> transaction(access: VeilMatrixProductBinding.RecordAccess, block: (VeilMatrixProductBinding.Records) -> T): T {
            checkCurrent(); check(transaction == null)
            val scope = RecordScope(access)
            transaction = scope // capture before native begin/partial acquisition
            val out = LongArray(1)
            var begun = false
            try {
                val code = try { VeilNativeMatrixSourceJni.beginRecords(selector, access.operationKind, out) }
                    finally { scope.selector = out[0]; out.fill(0) }
                status(code); require(scope.selector > 0); begun = true
                scope.current()
                val result = block(scope)
                scope.current()
                scope.finishSelected = true // no second commit/rollback after an uncertain finish
                status(VeilNativeMatrixSourceJni.finishRecords(selector, scope.selector, true))
                scope.closed = true
                transaction = null
                checkCurrent()
                return result
            } catch (primary: Throwable) {
                if (scope.firstFailure == null) scope.firstFailure = primary
                if (begun && !scope.finishSelected) {
                    scope.finishSelected = true
                    try {
                        status(VeilNativeMatrixSourceJni.finishRecords(selector, scope.selector, false))
                        scope.closed = true; transaction = null
                    } catch (cleanup: Throwable) {
                        if (cleanup !== primary) try { primary.addSuppressed(cleanup) } catch (_: Throwable) { }
                    }
                }
                retain(primary)
            } finally { scope.invocationActive = false }
        }
    }
    private inner class RecordScope(private val access: VeilMatrixProductBinding.RecordAccess) : VeilMatrixProductBinding.Records {
        var selector = 0L
        var invocationActive = true
        var observingOutcome = false
        var closed = false
        var finishSelected = false
        var firstFailure: Throwable? = null
        fun current() {
            worker()
            check(!closed && !finishSelected && transaction === this && selector > 0)
            // Validate this held transaction, never recursively enter SQL/current.
            status(VeilNativeMatrixSourceJni.currentRecords(this@VeilNativeMatrixSource.selector, selector))
        }
        private fun read(namespace: Int, id: String): JSONObject? {
            current(); reference(id)
            val size = length(VeilNativeMatrixSourceJni.readRecord(this@VeilNativeMatrixSource.selector,
                selector, namespace, id, byteArrayOf()), MAX_RECORD)
            current()
            if (size == 0) return null // authenticated absence, not a JNI failure
            val bytes = ByteArray(size)
            try {
                val written = length(VeilNativeMatrixSourceJni.readRecord(this@VeilNativeMatrixSource.selector,
                    selector, namespace, id, bytes), MAX_RECORD)
                require(written == size) { "VEIL_MATRIX_SOURCE_RECORD_CHANGED" }
                current()
                val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
                val parser = JSONTokener(text)
                val value = parser.nextValue()
                require(value is JSONObject && parser.nextClean() == '\u0000')
                return value
            } finally { bytes.fill(0) }
        }
        private fun write(namespace: Int, id: String, value: JSONObject) {
            current(); check(access == VeilMatrixProductBinding.RecordAccess.WRITE) { "VEIL_PRODUCT_RECORD_READ_ONLY" }; reference(id)
            val bytes = value.toString().toByteArray(Charsets.UTF_8)
            try {
                require(bytes.size in 1..MAX_RECORD)
                status(VeilNativeMatrixSourceJni.writeRecord(this@VeilNativeMatrixSource.selector,
                    selector, namespace, id, bytes))
                current()
            } finally { bytes.fill(0) }
        }
        override fun state() = read(STATE, "normal-product-v1")
        override fun state(value: JSONObject) = write(STATE, "normal-product-v1", value)
        override fun operation(id: String) = read(OPERATION, id)
        override fun operation(id: String, value: JSONObject) = write(OPERATION, id, value)
        override fun operations(): List<String> {
            current()
            val ids = VeilNativeMatrixSourceJni.recordIds(this@VeilNativeMatrixSource.selector,
                selector, OPERATION).copyOf().toList()
            require(ids.size <= 4096 && ids.distinct().size == ids.size)
            ids.forEach(::reference); current()
            return ids
        }
        override fun history(id: String) = read(STATE, id)
        override fun history(id: String, value: JSONObject) = write(STATE, id, value)
        override fun removeHistory(id: String) {
            current(); check(access == VeilMatrixProductBinding.RecordAccess.WRITE) { "VEIL_PRODUCT_RECORD_READ_ONLY" }; reference(id)
            status(VeilNativeMatrixSourceJni.removeRecord(this@VeilNativeMatrixSource.selector, selector, STATE, id))
            current()
        }
    }

    private class InitialPrekeyAttempt(val frame: ByteArray) {
        var output: Array<ByteArray>? = null
        var firstFailure: Throwable? = null
    }
    private val initialPrekeyAttempts = linkedMapOf<String, InitialPrekeyAttempt>()
    private var initialPrekeyConsumerActive = false

    /** Real fixed-purpose Native proof, not a DTO-created authority. Normal
     * HTTP still needs its independently recognized Source issuer/policy/current.
     * The synchronous consumer owns its original transport receipt before any
     * late fence. No producer retry, new nonce, new logical or replacement POST.
     */
    internal fun withInitialPrekeyDeviceProof(canonicalFrame: ByteArray, budgetMs: Long,
        consume: (Array<ByteArray>, () -> Unit) -> Unit) {
        worker()
        require(canonicalFrame.size in 1..16384 && budgetMs in 1L..30000L)
        val frame = canonicalFrame.copyOf()
        val id = java.security.MessageDigest.getInstance("SHA-256").digest(frame)
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        // Refuse a repeat BEFORE touching its successful output/first state.
        check(!initialPrekeyAttempts.containsKey(id)) { "VEIL_PREKEY_PROOF_ALREADY_SELECTED" }
        check(!initialPrekeyConsumerActive) { "VEIL_PREKEY_PROOF_REENTRANT" }
        check(initialPrekeyAttempts.size < 32) { "VEIL_PREKEY_PROOF_CAPACITY" }
        checkCurrent()
        val attempt = InitialPrekeyAttempt(frame)
        initialPrekeyAttempts[id] = attempt // original selected before Native effect
        try {
            val output = VeilNativePrekeyProofJni.produce(selector, frame, budgetMs)
            attempt.output = output // retain BEFORE length/current/foreign checks
            require(output.size == 3 && output[0].contentEquals(frame) &&
                output[1].size == 64 && output[2].size == 4627) { "VEIL_PREKEY_PROOF_OUTPUT_BINDING" }
            val current = {
                checkCurrent()
                status(VeilNativePrekeyProofJni.current(selector, frame))
                checkCurrent()
            }
            current()
            val copied = Array(3) { output[it].copyOf() }
            var callbackActive = true
            initialPrekeyConsumerActive = true
            try {
                consume(copied) {
                    check(callbackActive && initialPrekeyAttempts[id] === attempt) { "VEIL_PREKEY_PROOF_CALLBACK_ENDED" }
                    current()
                }
            } finally { callbackActive = false; initialPrekeyConsumerActive = false }
            current()
        } catch (failure: Throwable) {
            if (attempt.firstFailure == null) attempt.firstFailure = failure
            throw failure
        }
    }

    /** QUERY under original retained Source/UNKNOWN is intentionally not ordinary
     * checkCurrent(): no new signing/HTTP permission is inferred from these DATA.
     * Final Source close still belongs to the existing actual cleanup lifecycle.
     */
    internal fun retainedInitialPrekeyProof(originalNonce: ByteArray): ByteArray {
        worker()
        check(!closed && !closing && selector > 0 && sourceObserved) { "VEIL_MATRIX_SOURCE_ORIGINAL_REQUIRED" }
        require(originalNonce.size == 32)
        val result = VeilNativePrekeyProofJni.retained(selector, originalNonce.copyOf())
        require(result.size in 1..32768) { "VEIL_PREKEY_RETAINED_DATA_REQUIRED" }
        return result
    }

    private class InitialPrekeyRequestAttempt(val body: ByteArray, val transport: ByteArray) {
        var output: Array<ByteArray>? = null
        var firstFailure: Throwable? = null
    }
    private val initialPrekeyRequests = linkedMapOf<String, InitialPrekeyRequestAttempt>()

    private class InitialPrekeyReadAttempt(val body:ByteArray,val transport:ByteArray){
        var prepared:ByteArray?=null;var produced:ByteArray?=null;var retained:ByteArray?=null;var first:Throwable?=null
    }
    private val initialPrekeyReadRequests=linkedMapOf<String,InitialPrekeyReadAttempt>()
    private fun readRequestId(body:ByteArray,transport:ByteArray):String {
        fun hash(raw:ByteArray)=java.security.MessageDigest.getInstance("SHA-256").digest(raw).joinToString(""){"%02x".format(it.toInt()and 255)}
        return hash(body)+":"+hash(transport)
    }
    /** Same Source + independent fixed read purpose. No write proof or new Source. */
    internal fun withInitialPrekeyAuthorizationRead(body:ByteArray,transport:ByteArray,budgetMs:Long,
        consume:(ByteArray,ByteArray,ByteArray,()->Unit)->Unit){
        worker();require(body.size in 1..256&&transport.size in 1..8192&&budgetMs in 1L..30000L)
        val request=body.copyOf();val route=transport.copyOf();val id=readRequestId(request,route)
        check(!initialPrekeyReadRequests.containsKey(id)){"VEIL_PREKEY_READ_ORIGINAL_ALREADY_SELECTED"}
        check(!initialPrekeyConsumerActive&&initialPrekeyReadRequests.size<32){"VEIL_PREKEY_READ_BUSY_OR_CAPACITY"}
        checkCurrent();val attempt=InitialPrekeyReadAttempt(request,route);initialPrekeyReadRequests[id]=attempt
        initialPrekeyConsumerActive=true
        try{
            val prepared=VeilNativePrekeyRequestJni.prepareRead(selector,request,route,budgetMs)
            attempt.prepared=prepared // adopt before any parse/current/foreign boundary
            val(frame,nonce)=VeilNativePrekeyRequestJni.readPreparedData(prepared)
            checkCurrent() // preparation is DATA, not a completed proof
            val produced=VeilNativePrekeyRequestJni.produceRead(selector,nonce)
            attempt.produced=produced
            val proof=VeilNativePrekeyRequestJni.readProducedData(produced,frame,nonce)
            fun currentRead(){checkCurrent();status(VeilNativePrekeyRequestJni.currentRead(selector,frame,nonce));checkCurrent()}
            currentRead();var callback=true
            try{consume(proof.copyOf(),frame.copyOf(),nonce.copyOf()){
                check(callback&&initialPrekeyReadRequests[id]===attempt&&attempt.first==null){"VEIL_PREKEY_READ_CALLBACK_ENDED"}
                currentRead()
            }}finally{callback=false}
            currentRead()
        }catch(error:Throwable){if(attempt.first==null)attempt.first=error;throw error}
        finally{initialPrekeyConsumerActive=false}
    }
    /** Inventory DATA only, including partial UNKNOWN; never produces or sends. */
    internal fun retainedInitialPrekeyAuthorizationRead(body:ByteArray,transport:ByteArray):ByteArray?{
        worker();check(!closed&&!closing&&selector>0&&sourceObserved)
        val attempt=initialPrekeyReadRequests[readRequestId(body,transport)]?:return null
        val prepared=attempt.prepared?:return null
        val(_,nonce)=VeilNativePrekeyRequestJni.readPreparedData(prepared)
        val raw=VeilNativePrekeyRequestJni.retainedRead(selector,nonce);attempt.retained=raw
        VeilNativePrekeyRequestJni.readRetainedData(raw,nonce);return raw.copyOf()
    }

    /** Normal same-worker factory. The final effect body/transport are DATA;
     * Native supplies actual identity/device/current originals and both proofs.
     * The consumer must retain its own HTTP result before any late fence. */
    internal fun withInitialPrekeyAuthorize(effectBody: ByteArray, effectTransport: ByteArray,
        budgetMs: Long, consume: (Array<ByteArray>, () -> Unit) -> Unit) {
        worker()
        require(effectBody.size in 1..16384 && effectTransport.size in 1..8192 && budgetMs in 1L..30000L)
        val body = effectBody.copyOf()
        val transport = effectTransport.copyOf()
        fun hash(bytes: ByteArray) = java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        val id = hash(body) + ":" + hash(transport)
        check(!initialPrekeyRequests.containsKey(id)) { "VEIL_PREKEY_REQUEST_ALREADY_SELECTED" }
        check(!initialPrekeyConsumerActive) { "VEIL_PREKEY_REQUEST_REENTRANT" }
        check(initialPrekeyRequests.size < 32) { "VEIL_PREKEY_REQUEST_CAPACITY" }
        checkCurrent()
        val attempt = InitialPrekeyRequestAttempt(body, transport)
        initialPrekeyRequests[id] = attempt
        try {
            val output = VeilNativePrekeyRequestJni.prepareAuthorize(selector, body, transport, budgetMs)
            attempt.output = output // same original retained BEFORE any late fence
            require(output.size == 3 && output[0].size in 1..655360 &&
                output[1].size in 1..16384 && output[2].size == 32) { "VEIL_PREKEY_REQUEST_OUTPUT_BINDING" }
            val frame = output[1].copyOf()
            val current = {
                checkCurrent()
                status(VeilNativePrekeyProofJni.current(selector, frame))
                checkCurrent()
            }
            current()
            var callbackActive = true
            initialPrekeyConsumerActive = true
            try {
                consume(Array(3) { output[it].copyOf() }) {
                    check(callbackActive && initialPrekeyRequests[id] === attempt) { "VEIL_PREKEY_REQUEST_CALLBACK_ENDED" }
                    current()
                }
            } finally { callbackActive = false; initialPrekeyConsumerActive = false }
            current()
        } catch (failure: Throwable) {
            if (attempt.firstFailure == null) attempt.firstFailure = failure
            throw failure
        }
    }

    /** Read original DATA while UNKNOWN is retained; do not create a new nonce,
     * re-sign, re-authorize or repeat a result-unknown external POST. */
    internal fun retainedInitialPrekeyRequest(effectBody: ByteArray, effectTransport: ByteArray): ByteArray {
        worker()
        check(!closed && !closing && selector > 0 && sourceObserved) { "VEIL_MATRIX_SOURCE_ORIGINAL_REQUIRED" }
        require(effectBody.size in 1..16384 && effectTransport.size in 1..8192)
        val result = VeilNativePrekeyRequestJni.retained(selector, effectBody.copyOf(), effectTransport.copyOf())
        require(result.size in 52..1048576) { "VEIL_PREKEY_REQUEST_RETAINED_DATA_REQUIRED" }
        return result
    }

    override fun initialPublicBundle(): ByteArray {
        checkCurrent()
        var owned: ByteArray? = null
        try {
            owned = VeilNativeMatrixSourceJni.initialPublicBundle(selector)
            require(owned.size in 1..8192) { "VEIL_INITIAL_PUBLIC_BUNDLE_REQUIRED" }
            checkCurrent()
            return owned
        } catch (failure: Throwable) { owned?.fill(0); retain(failure) }
    }
    override fun initialSessionSendFrame(logical: ByteArray, peerBundle: ByteArray): ByteArray {
        checkCurrent()
        var frame: ByteArray? = null
        try {
            frame = ports.initialSessionFrame(logical, peerBundle)
            checkCurrent()
            return frame
        } catch (failure: Throwable) { frame?.fill(0); retain(failure) }
    }
    override fun initialSessionReceiveFrame(logical: ByteArray, preKey: ByteArray, ownBundle: ByteArray): ByteArray {
        checkCurrent()
        var frame: ByteArray? = null
        try {
            frame = ports.initialSessionReceiveFrame(logical, preKey, ownBundle)
            checkCurrent()
            return frame
        } catch (failure: Throwable) { frame?.fill(0); retain(failure) }
    }

    override fun prepareMessage(command: Map<String, Any?>, context: Map<String, Any?>,
                                logicalId: String, originalFrame: ByteArray,
                                capture: (VeilMatrixProductBinding.MessageAuthority) -> Unit) {
        checkCurrent(); require(command["type"] in setOf("sendMessage", "sendAttachment", "establishSession"))
        val route = routes().single { it.id == command["conversationId"] }
        val request = freezeRequest(command, context)
        require(request.second["accountViewRef"] == identity().accountViewRef)
        val original = MessageOriginal(logicalId, request.first, request.second, originalFrame, false)
        captureOriginal(original) { out ->
            original.borrowInputs { frame, commandBytes, contextBytes ->
                VeilNativeMatrixSourceJni.prepareMessage(selector, route.id, logicalId,
                    checkNotNull(frame), commandBytes, contextBytes, out)
            }
        }
        try { capture(original) } catch (primary: Throwable) { original.retain(primary) }
    }
    override fun prepareIncoming(route: VeilMatrixProductBinding.Route, eventId: String, logicalId: String,
                                 originalFrame: ByteArray,
                                 capture: (VeilMatrixProductBinding.MessageAuthority) -> Unit) {
        checkCurrent()
        require(routes().single { it.id == route.id } == route)
        reference(eventId); require(eventId.startsWith("$"))
        val original = MessageOriginal(logicalId, emptyMap(), emptyMap(), originalFrame, true)
        captureOriginal(original) { out ->
            original.borrowInputs { frame, _, _ ->
                VeilNativeMatrixSourceJni.prepareIncoming(selector, route.id, eventId, logicalId, checkNotNull(frame), out)
            }
        }
        try { capture(original) } catch (primary: Throwable) { original.retain(primary) }
    }
    override fun prepareContact(command: Map<String, Any?>, context: Map<String, Any?>,
                                capture: (VeilNativeMessageBusiness.Contact) -> Unit) {
        checkCurrent(); require(command["type"] in setOf("requestContact", "acceptContact", "rejectContact", "blockContact", "unblockContact"))
        require(command["type"] in contactActions()) { "VEIL_CURRENT_CONTACT_RELEASE_REQUIRED" }
        val request = freezeRequest(command, context)
        require(request.second["accountViewRef"] == identity().accountViewRef)
        if (command["type"] in setOf("acceptContact", "rejectContact")) require(invitations().any { it.id == command["requestId"] && it.direction == VeilMatrixProductBinding.ContactRequestDirection.INCOMING })
        if (command["type"] == "blockContact") require(contacts().any { it.peerAccountId == command["peerAccountId"] } || invitations().any { it.peerAccountId == command["peerAccountId"] })
        if (command["type"] == "unblockContact") require(blockedContacts().any { it.peerAccountId == command["peerAccountId"] })
        val original = ContactOriginal(request.first, request.second)
        captureOriginal(original) { out ->
            original.borrowInputs { _, commandBytes, contextBytes ->
                VeilNativeMatrixSourceJni.prepareContact(selector, commandBytes, contextBytes, out)
            }
        }
        try { capture(original) } catch (primary: Throwable) { original.retain(primary) }
    }
    private fun captureOriginal(original: Original, acquire: (LongArray) -> Int) {
        checkCurrent(); check(initialized && originals.isEmpty()) { "VEIL_MATRIX_SOURCE_ORIGINAL_RETAINED" }
        originals.add(original) // BEFORE JNI or any external capture callback
        val out = LongArray(1)
        try {
            val code = try { acquire(out) } finally { original.selector = out[0]; out.fill(0) }
            status(code); require(original.selector > 0)
            original.checkCurrent()
            val actual = VeilNativeMatrixSourceJni.originalReference(selector, original.selector)
            reference(actual)
            original.acceptReference(actual)
            original.checkCurrent()
        } catch (primary: Throwable) { original.retain(primary) }
    }
    private abstract inner class Original(
        val command: Map<String, Any?>, val context: Map<String, Any?>
    ) : VeilNativeMessageBusiness.Original {
        var selector = 0L
        var closed = false
        var closeSelected = false
        private var referenceValue: String? = null
        private var firstFailure: Throwable? = null
        val commandBytes = json(command).toByteArray(Charsets.UTF_8)
        val contextBytes = json(context).toByteArray(Charsets.UTF_8)
        override val reference: String get() { checkCurrent(); return checkNotNull(referenceValue) }
        open fun frameCopy(): ByteArray? = null
        fun <T> borrowInputs(block: (ByteArray?, ByteArray, ByteArray) -> T): T {
            val frame = frameCopy(); val commandCopy = commandBytes.copyOf(); val contextCopy = contextBytes.copyOf()
            try {
                val result = block(frame, commandCopy, contextCopy)
                require(commandCopy.contentEquals(commandBytes) && contextCopy.contentEquals(contextBytes)) {
                    "VEIL_MATRIX_SOURCE_INPUT_MUTATED"
                }
                frame?.let { value ->
                    val expected = frameCopy()
                    try { require(expected != null && value.contentEquals(expected)) { "VEIL_MATRIX_SOURCE_FRAME_MUTATED" } }
                    finally { expected?.fill(0) }
                }
                return result
            } finally { frame?.fill(0); commandCopy.fill(0); contextCopy.fill(0) }
        }
        fun belongsTo(candidate: VeilNativeMatrixSource) = this@VeilNativeMatrixSource === candidate
        fun capturedReference(): String? = referenceValue
        open fun acceptReference(value: String) { check(referenceValue == null); referenceValue = value }
        fun retain(primary: Throwable): Nothing {
            if (firstFailure == null) firstFailure = primary
            else if (firstFailure !== primary) try { firstFailure!!.addSuppressed(primary) } catch (_: Throwable) { }
            this@VeilNativeMatrixSource.retain(primary)
        }
        override fun checkCurrent() {
            this@VeilNativeMatrixSource.checkCurrent()
            check(!closed && selector > 0 && originals.contains(this)) { "VEIL_MATRIX_SOURCE_FOREIGN_ORIGINAL" }
            status(VeilNativeMatrixSourceJni.originalCurrent(this@VeilNativeMatrixSource.selector, selector))
            this@VeilNativeMatrixSource.checkCurrent()
        }
        override fun requireRequest(command: Map<String, Any?>, context: Map<String, Any?>) {
            checkCurrent(); require(this.command == command && this.context == context)
        }
        override fun completion(): VeilNativeMessageBusiness.Completion {
            checkCurrent()
            val value = VeilNativeMatrixSourceJni.completion(this@VeilNativeMatrixSource.selector, selector)
            if (value < 0) throw Refused(-value.toLong())
            val result = when (value) {
                0 -> VeilNativeMessageBusiness.Completion.PENDING
                1 -> VeilNativeMessageBusiness.Completion.COMMITTED
                2 -> VeilNativeMessageBusiness.Completion.ABORTED
                3 -> VeilNativeMessageBusiness.Completion.UNKNOWN
                else -> error("VEIL_MATRIX_SOURCE_COMPLETION_INVALID")
            }
            checkCurrent()
            return result
        }
        override fun close() {
            checkCurrent(); check(!closeSelected)
            check(completion() in setOf(VeilNativeMessageBusiness.Completion.COMMITTED, VeilNativeMessageBusiness.Completion.ABORTED))
            closeSelected = true
            try {
                status(VeilNativeMatrixSourceJni.closeOriginal(this@VeilNativeMatrixSource.selector, selector))
                closed = true; originals.remove(this)
                commandBytes.fill(0); contextBytes.fill(0); erase()
                this@VeilNativeMatrixSource.checkCurrent()
            } catch (primary: Throwable) { retain(primary) }
        }
        open fun erase() {}
    }
    private inner class MessageOriginal(
        val logicalId: String, command: Map<String, Any?>, context: Map<String, Any?>,
        originalFrame: ByteArray, val incoming: Boolean
    ) : Original(command, context), VeilMatrixProductBinding.MessageAuthority {
        var frame: ByteArray? = originalFrame.copyOf()
        init {
            try {
            val id = java.util.UUID.fromString(logicalId)
            require(id.version() == 4 && id.variant() == 2 && id.toString() == logicalId)
            val heldFrame = checkNotNull(frame)
            val initialSend = !incoming && heldFrame.size > 6 && heldFrame[6] == 4.toByte()
            if (!incoming) require(if (initialSend) command["type"] == "establishSession" else command["type"] in setOf("sendMessage", "sendAttachment")) {
                "VEIL_MATRIX_SOURCE_COMMAND_FRAME_FAMILY"
            }
            if (incoming && heldFrame.size > 6 && heldFrame[6] == 5.toByte()) {
                // DATA selects the separate validation path only. The original
                // Native/C source must still authorize this exact kind5 frame.
                VeilNativeProductPorts.validateInitialSessionReceiveFrame(heldFrame)
            } else if (initialSend) {
                // Only validate the submitted DATA family here. Native/C still
                // checks this exact control, actual purpose, peer and owner.
                VeilNativeProductPorts.validateInitialSessionFrame(heldFrame)
            } else {
                VeilNativeProductPorts.validateFrame(heldFrame, if (incoming) 2 else 1)
            }
            val expected = ByteBuffer.allocate(16).putLong(id.mostSignificantBits).putLong(id.leastSignificantBits).array()
            try { require(checkNotNull(frame).copyOfRange(8, 24).contentEquals(expected)) }
            finally { expected.fill(0) }
            if (!incoming && !initialSend) {
                val actual = checkNotNull(frame).copyOfRange(28, checkNotNull(frame).size)
                try {
                    val content = if (command["type"] == "sendAttachment") {
                        val decoded = VeilProductMessageContent.decode(actual)
                        require(decoded.body == command["caption"] && decoded.replyToMessageId == null && command["selectionReference"] == logicalId)
                        VeilSourceAttachmentContent.decode(checkNotNull(decoded.attachment)).use { descriptor ->
                            descriptor.matches(routes().single { it.id == command["conversationId"] }, logicalId, false)
                            VeilSourceAttachmentContent.message(command["caption"] as String, descriptor)
                        }
                    } else VeilProductMessageContent.encode(command["body"] as String, command["replyToMessageId"] as String?)
                    try { require(java.security.MessageDigest.isEqual(content, actual)) { "VEIL_MATRIX_SOURCE_COMMAND_FRAME_MISMATCH" } }
                    finally { content.fill(0) }
                } finally { actual.fill(0) }
            }
            } catch (failure: Throwable) { frame?.fill(0); frame = null; throw failure }
        }
        override fun frameCopy(): ByteArray = checkNotNull(frame).copyOf()
        override fun acceptReference(value: String) { require(value == logicalId); super.acceptReference(value) }
        override fun sessionRecords(): ByteArray {
            checkCurrent()
            val buffer = ByteArray(393216)
            try {
                val size = length(VeilNativeMatrixSourceJni.sessionRecords(this@VeilNativeMatrixSource.selector,
                    selector, buffer), buffer.size)
                require(size > 0)
                checkCurrent()
                return buffer.copyOfRange(0, size)
            } finally { buffer.fill(0) }
        }
        override fun requireCommittedOutput(output: VeilNativeMessageOutput) {
            checkCurrent(); require(output.direction == if (incoming) 2 else 1)
            val id = output.logicalId(); val body = output.body()
            try {
                val logical = java.util.UUID.fromString(logicalId)
                val expected = ByteBuffer.allocate(16).putLong(logical.mostSignificantBits).putLong(logical.leastSignificantBits).array()
                try { require(id.contentEquals(expected)) } finally { expected.fill(0) }
                status(VeilNativeMatrixSourceJni.requireCommittedOutput(this@VeilNativeMatrixSource.selector,
                    selector, id, output.direction, output.kind, body))
                checkCurrent()
            } finally { id.fill(0); body.fill(0) }
        }
        override fun erase() { frame?.fill(0); frame = null }
    }
    private inner class ContactOriginal(command: Map<String, Any?>, context: Map<String, Any?>) :
        Original(command, context), VeilNativeMessageBusiness.Contact {
        private var executeSelected = false
        override fun executeOriginal() {
            checkCurrent(); check(!executeSelected) { "VEIL_MATRIX_CONTACT_ORIGINAL_ALREADY_SELECTED" }
            executeSelected = true
            try {
                status(VeilNativeMatrixSourceJni.executeContact(this@VeilNativeMatrixSource.selector, selector))
                checkCurrent()
            } catch (primary: Throwable) { retain(primary) }
        }
    }
    /** Private inventory can dispose existing custody; it never enables a view,
     * account, current check or another operation. The supplier owns every bit. */
    internal data class CleanupInventory(val registered: Boolean, val sameThread: Boolean,
        val active: Boolean, val unknown: Boolean, val children: Long, val firstCause: Int,
        val rootRetained: Boolean, val contextRetained: Boolean, val drained: Boolean,
        val rustRecords: Boolean, val rustUncertain: Boolean) {
        val work: Boolean get() = active || children != 0L || rustRecords || unknown || rustUncertain
        val blockingCleanup: Boolean get() = active || children != 0L || rustRecords
    }
    internal fun cleanupInventoryForOwner(): CleanupInventory {
        worker()
        check(!closed && selector > 0) { "VEIL_MATRIX_SOURCE_ORIGINAL_REQUIRED" }
        check(VeilNativeMatrixSourceJni.abiVersion() == 2) { "VEIL_MATRIX_SOURCE_ABI_REQUIRED" }
        val out = LongArray(11)
        try {
            status(VeilNativeMatrixSourceJni.cleanupInventory(selector, out))
            for (i in intArrayOf(0, 1, 2, 3, 6, 7, 8, 9, 10)) require(out[i] in 0L..1L)
            require(out[1] == 1L && out[4] >= 0L && out[5] in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong())
            val value = CleanupInventory(out[0] == 1L, true, out[2] == 1L, out[3] == 1L,
                out[4], out[5].toInt(), out[6] == 1L, out[7] == 1L, out[8] == 1L,
                out[9] == 1L, out[10] == 1L)
            if (value.drained) require(!value.registered && !value.active && value.children == 0L &&
                !value.rootRetained && !value.contextRetained)
            else require(value.registered)
            return value
        } finally { out.fill(0) }
    }
    private fun localCleanupWork(): Boolean {
        if (initialPrekeyConsumerActive) return true // before any transaction/native observation
        if (transaction != null) {
            try { observeFinishedRecords() } catch (_: Throwable) { return true }
        }
        return transaction != null || originals.isNotEmpty() || courier?.hasRetainedWork() == true
    }
    override fun hasRetainedWork(): Boolean {
        worker()
        if (closed) return false
        if (closing || localCleanupWork()) return true
        return try { cleanupInventoryForOwner().work }
        catch (failure: Throwable) { try { retain(failure) } catch (_: Throwable) { }; true }
    }
    internal fun hasWorkBlockingOwnerClose(): Boolean {
        worker()
        if (closed) return false
        if (closing) return true
        // This is the explicit owner-close barrier, not normal status polling.
        // Drain the same directory child before its C child count blocks entry
        // into closeForOwner. Sticky errors stay recorded after physical drain.
        try { drainOwnDirectoryBeforeSourceClose() }
        catch (_: Throwable) { return true }
        if (localCleanupWork()) return true
        // Uncertainty remains an error. It does not itself manufacture an
        // active child; C may release custody once and still return UNKNOWN.
        return try { cleanupInventoryForOwner().blockingCleanup }
        catch (failure: Throwable) { try { retain(failure) } catch (_: Throwable) { }; true }
    }
    internal fun isClosedForOwner(): Boolean { worker(); return closed }
    internal fun closeForOwner() {
        worker()
        // The owner may continue later cleanup after this original was
        // actually disposed. A local no-op never calls native close again.
        if (closed) return
        if (closing) throw (firstFailure ?: IllegalStateException("VEIL_MATRIX_SOURCE_CLOSE_ALREADY_SELECTED"))
        val directoryError = drainOwnDirectoryBeforeSourceClose()
        check(!localCleanupWork()) { "VEIL_MATRIX_SOURCE_ORIGINAL_RETAINED" }
        val inventory = cleanupInventoryForOwner()
        check(!inventory.blockingCleanup) { "VEIL_MATRIX_SOURCE_ORIGINAL_RETAINED" }
        closing = true // selected before callbacks; never call original close twice
        try {
            courier?.close()
            // Formal Main/A24 close0 requires actual C disposal and no C/Rust
            // uncertainty. A successful close removes its native slot, so a
            // subsequent inventory lookup cannot be used as its readback.
            status(VeilNativeMatrixSourceJni.close(selector))
            closed = true; selector = 0L
            if (directoryError != null) throw directoryError
        } catch (primary: Throwable) { retain(primary) }
    }
    internal fun retainedFailure(): Throwable? { worker(); return firstFailure }

    companion object {
        private const val STATE = 1
        private const val OPERATION = 2
        private const val MAX_RECORD = 8 * 1024 * 1024
        /** ABI discovery is read-only and never evidence of authorization. */
        fun available(): Boolean = try { VeilNativeMatrixSourceJni.abiVersion() == 2 } catch (_: LinkageError) { false }
        fun capture(ports: VeilNativeProductPorts, retain: (VeilNativeMatrixSource) -> Unit): VeilNativeMatrixSource =
            capture(ports, null, retain)
        fun capture(ports: VeilNativeProductPorts, courierRecord: ByteArray?,
                    retain: (VeilNativeMatrixSource) -> Unit): VeilNativeMatrixSource {
            check(available()) { "VEIL_MATRIX_SOURCE_ABI_REQUIRED" }
            ports.requireAcceptedDeviceCurrent()
            val original = VeilNativeMatrixSource(ports)
            retain(original)
            original.initialize(courierRecord)
            return original
        }
        private fun freezeRequest(command: Map<String, Any?>, context: Map<String, Any?>): Pair<Map<String, Any?>, Map<String, Any?>> {
            // Reuse the actual normal request validator; no second command or grant format.
            VeilSocialMessagingCoordinator.Request.decodeSourceOriginal(json(context), json(command))
            return Collections.unmodifiableMap(LinkedHashMap(command)) to Collections.unmodifiableMap(LinkedHashMap(context))
        }
        private fun json(value: Map<String, Any?>): String = VeilSocialMessagingCoordinator.json(value)
        private fun bounded(value: String, maximum: Int) {
            require(value.isNotBlank() && value.length <= maximum && value.none { it.code < 32 || it.code == 127 })
            var i = 0
            while (i < value.length) {
                val c = value[i++]
                if (c.isHighSurrogate()) require(i < value.length && value[i++].isLowSurrogate())
                else require(!c.isLowSurrogate())
            }
        }
        private fun peerAccountId(value: String) = require(value.length in 1..256 && value.all { it.code in 33..126 })
        private fun reference(value: String) = bounded(value, 256)
    }
}
