package com.ynx.social.matrix

import android.content.Context
import android.os.Build
import android.os.Process
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.channels.FileLock
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.nio.file.StandardOpenOption.*
import java.nio.file.attribute.PosixFilePermissions

/** Local PUBLIC pending candidates only. Not a grant, trust/rollback store or
 * private crypto storage. Paths are obtained ONLY from verified app Context.
 * Any unsupported force/atomic operation is UNKNOWN, never a fallback write.
 */
internal class VeilDeviceEnrollmentPendingStore private constructor(private val directory: Path) : AutoCloseable {
    internal enum class Status { FRESH, READY, RECONCILIATION_REQUIRED, UNKNOWN, CLOSED }
    internal class Entry(val snapshot: VeilDeviceEnrollmentCoordinator.Snapshot,
                         val request: ByteArray?, val proof: ByteArray?)
    private val thread = Thread.currentThread()
    private val journal = directory.resolve("pending-v1.bin")
    private val marker = directory.resolve("pending-v1.prepare")
    private val temp = directory.resolve("pending-v1.tmp")
    private var channel: FileChannel? = null
    private var lock: FileLock? = null
    private var entries = emptyList<Entry>()
    private var localIntent: VeilLocalGenesisProducer.Record? = null
    private var revision = 0L
    private var next = 1L
    private var current = Status.UNKNOWN
    private var borrowed = false
    private var coldBorrow: ColdBorrow? = null
    private var reopenedKey: Any? = null
    private var reopenedDigest: ByteArray? = null
    private var directoryKey: Any? = null
    private var lockKey: Any? = null
    private fun fileKey(path: Path): Any = checkNotNull(Files.readAttributes(path,
        java.nio.file.attribute.BasicFileAttributes::class.java, NOFOLLOW_LINKS).fileKey())
    private fun journalDigest(): ByteArray {
        requireOwnerFile(journal)
        val md = java.security.MessageDigest.getInstance("SHA-256")
        FileChannel.open(journal, READ, NOFOLLOW_LINKS).use { ch ->
            val size = ch.size(); require(size in 32..MAX_FILE_BYTES.toLong())
            val buffer = ByteBuffer.allocate(4096)
            var count = 0L
            while (true) {
                buffer.clear(); val n = ch.read(buffer); if (n < 0) break
                check(n > 0); count += n; check(count <= MAX_FILE_BYTES)
                md.update(buffer.array(), 0, n)
            }
            check(count == size)
        }
        return md.digest()
    }
    fun hasColdBorrow(): Boolean { owner(); return coldBorrow != null }
    fun retainedColdBorrow(): ColdBorrow? { owner(); return coldBorrow }
    fun acquireColdBorrow(): ColdBorrow {
        owner(); check(!borrowed && coldBorrow == null)
        check(current == Status.RECONCILIATION_REQUIRED)
        val record = checkNotNull(localIntent)
        check(record.phase == VeilLocalGenesisProducer.Phase.SUBMITTED && record.nativeIds != null)
        val lease = ColdBorrow(record, revision)
        // Retain before validation: a failed pin check must not lose ownership.
        coldBorrow = lease
        lease.revalidate()
        return lease
    }
    /** Private journal custody, never a Ticket, old command or authentication.
     * No native-dispatched release exists until its exact disposal ABI is bound. */
    inner class ColdBorrow internal constructor(private val record: VeilLocalGenesisProducer.Record,
        private val capturedRevision: Long) {
        private var active = false
        private var released = false
        private var nativeAttempted = false
        private var platformActive = false
        private var cleanupAttempted = false
        private var cleanupOutcome: VeilOwnKeyLocalStoreContext.Outcome? = null
        private var cleanupFailure: Throwable? = null
        private var primary: Throwable? = null
        private val outcomes = arrayOfNulls<VeilOwnKeyLocalStoreContext.Outcome>(3)
        private var outcomeCount = 0
        private fun retain(t: Throwable) {
            val first = primary
            if (first == null) primary = t else suppressCleanup(first, t)
        }
        fun retainedPrimary(): Throwable? { owner(); return primary }
        fun retainedOutcome(index: Int): VeilOwnKeyLocalStoreContext.Outcome? {
            owner(); require(index in outcomes.indices); return outcomes[index]
        }
        fun revalidate() {
            owner(); check(!released && coldBorrow === this)
            try {
                check(current == Status.RECONCILIATION_REQUIRED && localIntent === record && revision == capturedRevision)
                check(lock?.isValid == true && channel?.isOpen == true)
                check(fileKey(directory) == directoryKey && fileKey(directory.resolve("pending-v1.lock")) == lockKey)
                requireOwnerFile(directory.resolve("pending-v1.lock"))
                check(!Files.exists(marker, NOFOLLOW_LINKS) && !Files.exists(temp, NOFOLLOW_LINKS))
                check(fileKey(journal) == reopenedKey)
                val digest = journalDigest()
                try { check(digest.contentEquals(checkNotNull(reopenedDigest))) }
                finally { digest.fill(0) }
                check(fileKey(journal) == reopenedKey)
            } catch (t: Throwable) { retain(t); unknown(t); throw checkNotNull(primary) }
        }
        fun <T> withRecord(body: (VeilLocalGenesisProducer.Record) -> T): T {
            owner(); check(!active); primary?.let { throw it }; revalidate(); active = true
            var thrown: Throwable? = null
            try { return body(record) }
            catch (t: Throwable) { thrown = t; retain(t); throw t }
            finally {
                try { revalidate() } catch (t: Throwable) {
                    if (thrown == null) { active = false; throw t }
                    suppressCleanup(checkNotNull(thrown), t)
                } finally { active = false }
            }
        }
        /** Reserve bounded retention before invoking the actual platform port.
         * Outcome is saved before any postcheck can throw. No DTO authority. */
        fun retainPlatformOutcome(call: () -> VeilOwnKeyLocalStoreContext.Outcome): VeilOwnKeyLocalStoreContext.Outcome {
            owner(); check(active && !platformActive && !cleanupAttempted && outcomeCount < outcomes.size)
            primary?.let { throw it }
            revalidate()
            primary?.let { throw it }
            val slot = outcomeCount++
            platformActive = true
            try {
                val outcome = call(); outcomes[slot] = outcome
                outcome.primary()?.let { retain(it) }
                outcome.secondary()?.let { retain(it) }
                revalidate()
                primary?.let { throw it }
                return outcome
            } catch (t: Throwable) { retain(t); throw checkNotNull(primary) }
            finally { platformActive = false }
        }
        /** Cleanup-only dispatch can retain a prior cause, but cannot use the
         * failed business-effect port. Successful retirement skips active recheck. */
        fun <T> withCleanup(body: () -> T): T {
            owner(); check(!active && !released); revalidate(); active = true
            var thrown: Throwable? = null
            try { return body() }
            catch (t: Throwable) { thrown = t; retain(t); throw t }
            finally {
                try { if (!released) revalidate() }
                catch (t: Throwable) { if (thrown == null) throw t else suppressCleanup(checkNotNull(thrown), t) }
                finally { active = false }
            }
        }
        /** Not an arbitrary callback: close only the actual retained platform
         * owner, once. Ambiguous failure never retries an OS close. */
        fun closeRetainedPlatformOwner(): VeilOwnKeyLocalStoreContext.Outcome? {
            owner(); check(active && !platformActive && !released)
            if (cleanupAttempted) { cleanupFailure?.let { throw it }; return cleanupOutcome }
            val owners = outcomes.filterNotNull().mapNotNull { it.owner() }
            val platformOwner = owners.firstOrNull()
            check(owners.all { it === platformOwner })
            cleanupAttempted = true
            try {
                cleanupOutcome = platformOwner?.close()
                cleanupOutcome?.primary()?.let { retain(it) }
                cleanupOutcome?.secondary()?.let { retain(it) }
                if (platformOwner != null && cleanupOutcome?.status() != VeilOwnKeyLocalStoreContext.Status.CLOSED_LOCAL) {
                    val failure = primary ?: IllegalStateException("COLD_PLATFORM_CLOSE_UNRESOLVED")
                    retain(failure); cleanupFailure = failure; throw failure
                }
                return cleanupOutcome
            } catch (t: Throwable) { retain(t); cleanupFailure = checkNotNull(primary); throw checkNotNull(cleanupFailure) }
        }
        /** Invoked only by the private native-release callback after native
         * C-custody disposal. Ends this lease, never sets the journal READY. */
        fun finishNativeCleanup() {
            owner(); check(active && nativeAttempted && cleanupAttempted && !released)
            cleanupFailure?.let { throw it }
            revalidate()
            released = true; coldBorrow = null
        }
        fun markNativeAttempted() { owner(); check(active); revalidate(); nativeAttempted = true }
        fun releaseUnsubmitted() {
            owner(); check(!active && !nativeAttempted && outcomeCount == 0)
            primary?.let { throw it }; revalidate()
            released = true; coldBorrow = null
        }
    }
    internal var lastFailureClass: String? = null
        private set

    init {
        try {
            if (!Files.exists(directory, NOFOLLOW_LINKS)) Files.createDirectory(directory,
                PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")))
            check(Files.isDirectory(directory, NOFOLLOW_LINKS) && !Files.isSymbolicLink(directory))
            check(Files.getPosixFilePermissions(directory, NOFOLLOW_LINKS) == PosixFilePermissions.fromString("rwx------"))
            // Also force the parent namespace entry, not only the new child's
            // contents. Unsupported directory force stays UNKNOWN on every open.
            FileChannel.open(directory.parent, READ).use { it.force(true) }
            val lockPath = directory.resolve("pending-v1.lock")
            if (Files.exists(lockPath, NOFOLLOW_LINKS)) requireOwnerFile(lockPath)
            channel = FileChannel.open(lockPath, setOf(CREATE, WRITE, NOFOLLOW_LINKS), ownerMode())
            requireOwnerFile(lockPath)
            lock = channel!!.tryLock() ?: error("VEIL_PENDING_STORE_BUSY")
            directoryKey = fileKey(directory); lockKey = fileKey(lockPath)
            syncDirectory()
            if (Files.exists(marker, NOFOLLOW_LINKS) || Files.exists(temp, NOFOLLOW_LINKS)) {
                current = Status.UNKNOWN // preserve unfinished files; no automatic cleanup/retry
            } else if (Files.exists(journal, NOFOLLOW_LINKS)) {
                entries = readImage()
                current = Status.RECONCILIATION_REQUIRED // even an empty reopened image is NOT an original receipt
            } else current = Status.FRESH
        } catch (failure: Throwable) {
            unknown(failure)
            if (failure !is Exception) {
                cleanupFailedConstruction(failure)
                throw failure
            }
        }
    }
    // A failed constructor has no caller-visible owner that can call close().
    // Always attempt both resource releases; secondary errors cannot replace
    // the exact fatal primary, including a failure while adding suppression.
    private fun suppressCleanup(primary: Throwable, secondary: Throwable) {
        if (secondary !== primary) try { primary.addSuppressed(secondary) } catch (_: Throwable) { }
    }
    private fun cleanupFailedConstruction(primary: Throwable) {
        try { wipe(entries) } catch (secondary: Throwable) { suppressCleanup(primary, secondary) }
        entries = emptyList()
        try { lock?.release() } catch (secondary: Throwable) { suppressCleanup(primary, secondary) }
        try { channel?.close() } catch (secondary: Throwable) { suppressCleanup(primary, secondary) }
        finally { lock = null; channel = null; current = Status.CLOSED }
    }
    private fun requireOwnerFile(path: Path) {
        check(Files.isRegularFile(path, NOFOLLOW_LINKS) && !Files.isSymbolicLink(path))
        check(Files.getPosixFilePermissions(path, NOFOLLOW_LINKS) == PosixFilePermissions.fromString("rw-------"))
    }
    private fun owner() {
        check(Thread.currentThread() === thread) { "VEIL_PENDING_STORE_WRONG_THREAD" }
        check(current != Status.CLOSED) { "VEIL_PENDING_STORE_CLOSED" }
    }
    fun status(): Status { owner(); return current }
    fun nextSequence(): Long { owner(); return next }
    fun recoveredCount(): Int { owner(); return entries.size }
    fun localIntentRecord(): VeilLocalGenesisProducer.Record? { owner(); return localIntent }
    /** Resume only a durable PREPARED intent that never crossed the Native
     * submission barrier. This is local setup bookkeeping, never a receipt,
     * key restore, device grant or reconciliation of an attempted operation. */
    fun resumePreparedLocalIntent(record: VeilLocalGenesisProducer.Record) {
        owner()
        // Caller/lifecycle rejection must not poison an already successful store.
        check(current == Status.RECONCILIATION_REQUIRED && !borrowed && coldBorrow == null)
        check(entries.isEmpty() && localIntent === record &&
            record.phase == VeilLocalGenesisProducer.Phase.PREPARED && record.nativeIds == null)
        try {
            check(lock?.isValid == true && channel?.isOpen == true)
            check(fileKey(directory) == directoryKey && fileKey(directory.resolve("pending-v1.lock")) == lockKey)
            requireOwnerFile(directory.resolve("pending-v1.lock"))
            check(!Files.exists(marker, NOFOLLOW_LINKS) && !Files.exists(temp, NOFOLLOW_LINKS))
            check(fileKey(journal) == reopenedKey)
            val digest = journalDigest()
            try { check(digest.contentEquals(checkNotNull(reopenedDigest))) }
            finally { digest.fill(0) }
            check(fileKey(journal) == reopenedKey)
            // No disk write, alias change or key/provider operation is performed.
            current = Status.READY
        } catch (failure: Throwable) { unknown(failure); throw failure }
    }
    private fun unknown(failure: Throwable) { current = Status.UNKNOWN; lastFailureClass = failure.javaClass.name }
    private fun wipe(values: List<Entry>) { for (e in values) { e.request?.fill(0); e.proof?.fill(0) } }

    /** Copies only bounded PUBLIC reconciliation candidates. Original Ticket
     * identity is deliberately absent. Clones are disposed after this synchronous
     * owner-thread callback, cannot authorize anything; no JS bridge is exposed.
     */
    fun withRecoveryRecords(body: (List<Entry>) -> Unit) {
        owner(); check(!borrowed && coldBorrow == null) { "VEIL_PENDING_STORE_NESTED_BORROW" }
        // Fixed bounded ownership slots are PRIVATE, never the callback view.
        // Each allocation lands directly in its slot before another allocation,
        // Entry construction or list insertion can fail. A mutable/captured view
        // cannot remove a buffer from this ledger; caller-made copies are not ours.
        val cleanup = arrayOfNulls<ByteArray>(entries.size * 2)
        val view = ArrayList<Entry>(entries.size)
        var primary: Throwable? = null
        try {
            var offset = 0
            for (e in entries) {
                cleanup[offset] = e.request?.copyOf()
                cleanup[offset + 1] = e.proof?.copyOf()
                val entry = Entry(e.snapshot, cleanup[offset], cleanup[offset + 1])
                view.add(entry)
                offset += 2
            }
            borrowed = true
            try { body(view) } finally { borrowed = false }
        } catch (failure: Throwable) {
            primary = failure
            throw failure
        } finally {
            var cleanupFailure = primary
            var index = 0
            while (index < cleanup.size) {
                try { cleanup[index]?.fill(0) }
                catch (secondary: Throwable) {
                    val first = cleanupFailure
                    if (first == null) cleanupFailure = secondary else suppressCleanup(first, secondary)
                } finally { cleanup[index] = null }
                index++
            }
            if (primary == null) cleanupFailure?.let { throw it }
        }
    }
    private fun syncDirectory() { FileChannel.open(directory, READ).use { it.force(true) } }
    private fun createForced(path: Path, bytes: ByteArray) {
        FileChannel.open(path, setOf(CREATE_NEW, WRITE, NOFOLLOW_LINKS), ownerMode()).use { out ->
            requireOwnerFile(path)
            val buffer = ByteBuffer.wrap(bytes)
            while (buffer.hasRemaining()) check(out.write(buffer) > 0)
            out.force(true)
        }
    }
    /** Real local atomic snapshot commit. A false result is sticky UNKNOWN and
     * may mean either pre-write or post-replacement failure. Never auto retries.
     */
    fun replace(nextSequence: Long, input: List<Entry>): Boolean = replaceImage(nextSequence, input, localIntent)
    fun replaceLocalIntent(nextSequence: Long, input: List<Entry>, candidate: VeilLocalGenesisProducer.Record): Boolean {
        owner()
        val old = localIntent
        check(if (old == null) candidate.phase == VeilLocalGenesisProducer.Phase.PREPARED
            else if (old.phase == VeilLocalGenesisProducer.Phase.PREPARED)
                candidate == old.copy(phase = VeilLocalGenesisProducer.Phase.SUBMITTED)
            else old.nativeIds == null && candidate.nativeIds != null &&
                candidate == old.copy(nativeIds = candidate.nativeIds)) { "LOCAL_INTENT_IMMUTABLE_TRANSITION" }
        return replaceImage(nextSequence, input, candidate)
    }
    private fun replaceImage(nextSequence: Long, input: List<Entry>, intent: VeilLocalGenesisProducer.Record?): Boolean {
        owner(); check(!borrowed && coldBorrow == null) { "VEIL_PENDING_COLD_BORROW_ACTIVE" }
        if (current != Status.FRESH && current != Status.READY) return false
        var encoded: ByteArray? = null
        try {
            check(lock?.isValid == true)
            check(!Files.exists(marker, NOFOLLOW_LINKS) && !Files.exists(temp, NOFOLLOW_LINKS))
            if (Files.exists(journal, NOFOLLOW_LINKS)) requireOwnerFile(journal)
            require(nextSequence >= next)
            val nextRevision = Math.addExact(revision, 1)
            encoded = encode(nextRevision, nextSequence, input, intent)
            createForced(marker, "YNX-PENDING-INCOMPLETE/V1\n".toByteArray(Charsets.US_ASCII))
            syncDirectory()
            createForced(temp, encoded)
            Files.move(temp, journal, ATOMIC_MOVE, REPLACE_EXISTING)
            syncDirectory()
            Files.delete(marker)
            syncDirectory()
            // Do not retain duplicate writer input buffers or restore Tickets.
            wipe(entries); entries = emptyList()
            revision = nextRevision; next = nextSequence; localIntent = intent; current = Status.READY
            return true
        } catch (failure: Throwable) {
            unknown(failure)
            if (failure !is Exception) throw failure
            return false
        } finally { encoded?.fill(0) }
    }
    private fun validate(nextSequence: Long, input: List<Entry>) {
        require(nextSequence >= 1 && input.size <= 32)
        var previous = 0L; var payloadTotal = 0L
        for (e in input) {
            val s = e.snapshot
            require(s.schemaVersion == 1 && s.sequence > previous && s.sequence < nextSequence)
            previous = s.sequence
            require(s.createdAtElapsedMillis >= 0 && s.expiresAtElapsedMillis > s.createdAtElapsedMillis &&
                s.expiresAtElapsedMillis - s.createdAtElapsedMillis <= 120000)
            require(e.request == null || e.request.size in 1..4096)
            require(e.proof == null || e.proof.size in 1..8192)
            require(e.proof == null || e.request != null)
            payloadTotal += (e.request?.size ?: 0) + (e.proof?.size ?: 0)
            require(payloadTotal <= 393216)
            // Shape associations remain non-authoritative. Terminal states never
            // retain candidates and are NEVER interpreted as authorization.
            if (s.phase !in setOf(VeilDeviceEnrollmentCoordinator.Phase.CHALLENGE_STAGED_UNTRUSTED,
                    VeilDeviceEnrollmentCoordinator.Phase.APPROVAL_STAGED_UNTRUSTED)) {
                require(e.request == null && e.proof == null)
            }
            if (s.phase == VeilDeviceEnrollmentCoordinator.Phase.APPROVAL_STAGED_UNTRUSTED) require(e.proof != null)
            if (s.phase == VeilDeviceEnrollmentCoordinator.Phase.CHALLENGE_STAGED_UNTRUSTED) require(e.request != null && e.proof == null)
        }
    }
    private fun encode(rev: Long, nextSequence: Long, input: List<Entry>, intent: VeilLocalGenesisProducer.Record?): ByteArray {
        validate(nextSequence, input)
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            out.write("YNXEPJ01".toByteArray(Charsets.US_ASCII)); out.writeInt(4)
            out.writeLong(rev); out.writeLong(nextSequence); out.writeInt(input.size)
            for (e in input) {
                val s = e.snapshot; out.writeLong(s.sequence)
                for (v in listOf(s.association.device.owner, s.association.device.device,
                    s.association.device.socialIdentityFingerprint, s.association.device.keyAlias,
                    s.association.sourceIdentity, s.association.storeIdentity, s.association.restoreIdentity,
                    s.intendedApproval.name, s.phase.name, s.reason.name)) text(out, v)
                out.writeLong(s.association.minimumGeneration); out.writeLong(s.createdAtElapsedMillis); out.writeLong(s.expiresAtElapsedMillis)
                for (v in listOf(e.request, e.proof)) { out.writeInt(v?.size ?: 0); if (v != null) out.write(v) }
                check(bytes.size() <= MAX_FILE_BYTES)
            }
            out.writeByte(if (intent == null) 0 else 1)
            if (intent != null) {
                out.writeInt(3); out.writeInt(intent.initializationProfile); text(out, intent.slot); text(out, intent.intentHex); text(out, intent.alias)
                out.writeLong(intent.storageGeneration); out.writeInt(intent.authWindowSeconds)
                out.writeByte(if (intent.phase == VeilLocalGenesisProducer.Phase.PREPARED) 1 else 2)
                val association = intent.association()
                try { out.writeInt(association.size); out.write(association) } finally { association.fill(0) }
                out.writeByte(if (intent.nativeIds == null) 0 else 1)
                intent.nativeIds?.copyBytes()?.let { ids ->
                    try { out.write(ids) } finally { ids.fill(0) }
                }
            }
        }
        return bytes.toByteArray().also { require(it.size <= MAX_FILE_BYTES) }
    }
    private fun text(out: DataOutputStream, value: String) {
        require(value.length in 1..512 && value.all { it.code in 33..126 })
        val b = value.toByteArray(Charsets.US_ASCII); out.writeInt(b.size); out.write(b)
    }
    private fun text(input: DataInputStream): String {
        val size = input.readInt(); require(size in 1..512 && input.available() >= size)
        val bytes = ByteArray(size).also { input.readFully(it) }
        require(bytes.all { it.toInt() in 33..126 }); return bytes.toString(Charsets.US_ASCII)
    }
    private fun readImage(): List<Entry> {
        requireOwnerFile(journal)
        val imageKey = fileKey(journal)
        val raw = FileChannel.open(journal, READ, NOFOLLOW_LINKS).use { ch ->
            val size = ch.size(); require(size in 32..MAX_FILE_BYTES.toLong())
            val buffer = ByteBuffer.allocate(size.toInt())
            while (buffer.hasRemaining()) check(ch.read(buffer) > 0)
            check(ch.read(ByteBuffer.allocate(1)) == -1); buffer.array()
        }
        val owned = ArrayList<Entry>()
        try {
            DataInputStream(ByteArrayInputStream(raw)).use { input ->
                val magic = ByteArray(8).also { input.readFully(it) }
                require(magic.contentEquals("YNXEPJ01".toByteArray(Charsets.US_ASCII)))
                val version = input.readInt(); require(version in 1..4)
                val rev = input.readLong(); val seq = input.readLong(); val count = input.readInt()
                require(rev >= 1 && seq >= 1 && count in 0..32)
                repeat(count) {
                    val id = input.readLong()
                    val device = VeilDeviceBinding(text(input), text(input), text(input), text(input))
                    val source = text(input); val store = text(input); val restore = text(input)
                    val approval = VeilDeviceApproval.valueOf(text(input))
                    val phase = VeilDeviceEnrollmentCoordinator.Phase.valueOf(text(input))
                    val reason = VeilDeviceEnrollmentCoordinator.Reason.valueOf(text(input))
                    val assoc = VeilDeviceEnrollmentCoordinator.Association(device, source, store, restore, input.readLong())
                    val created = input.readLong(); val expires = input.readLong()
                    var request: ByteArray? = null; var proof: ByteArray? = null
                    try {
                        fun candidate(limit: Int): ByteArray? {
                            val n = input.readInt(); require(n in 0..limit && input.available() >= n)
                            return if (n == 0) null else ByteArray(n).also { input.readFully(it) }
                        }
                        request = candidate(4096); proof = candidate(8192)
                        owned.add(Entry(VeilDeviceEnrollmentCoordinator.Snapshot(1, id, assoc, approval, phase, reason, created, expires), request, proof))
                    } catch (failure: Throwable) { request?.fill(0); proof?.fill(0); throw failure }
                }
                var restored: VeilLocalGenesisProducer.Record? = null
                if (version >= 2) {
                    val tag = input.readUnsignedByte(); require(tag == 0 || tag == 1)
                    if (tag == 1) {
                        require(input.readInt() == when (version) { 4 -> 3; 3 -> 2; else -> 1 })
                        val profile = if (version >= 4) input.readInt() else 1
                        require(profile in 1..2)
                        val slot = text(input); val id = text(input); val alias = text(input)
                        val generation = input.readLong(); val window = input.readInt()
                        val phase = when (input.readUnsignedByte()) {
                            1 -> VeilLocalGenesisProducer.Phase.PREPARED
                            2 -> VeilLocalGenesisProducer.Phase.SUBMITTED
                            else -> error("LOCAL_INTENT_PHASE_INVALID")
                        }
                        restored = VeilLocalGenesisProducer.Record(slot, id, alias, generation, window, phase, initializationProfile = profile)
                        val n = input.readInt(); require(n in 1..4096 && input.available() >= n)
                        val actual = ByteArray(n).also { input.readFully(it) }
                        val expected = restored.association()
                        try { require(actual.contentEquals(expected)) { "LOCAL_INTENT_ASSOCIATION_MISMATCH" } }
                        finally { actual.fill(0); expected.fill(0) }
                        if (version >= 3) {
                            val idsTag = input.readUnsignedByte(); require(idsTag == 0 || idsTag == 1)
                            if (idsTag == 1) {
                                require(input.available() >= 32)
                                val ids = ByteArray(32)
                                try { input.readFully(ids); restored = restored.copy(nativeIds = VeilLocalGenesisProducer.NativeIds(ids)) }
                                finally { ids.fill(0) }
                            }
                        }
                    }
                }
                require(input.available() == 0); validate(seq, owned)
                revision = rev; next = seq; localIntent = restored
            }
            check(fileKey(journal) == imageKey)
            reopenedKey = imageKey
            reopenedDigest = java.security.MessageDigest.getInstance("SHA-256").digest(raw)
            return owned
        } catch (failure: Throwable) { wipe(owned); throw failure }
        finally { raw.fill(0) }
    }
    override fun close() {
        check(Thread.currentThread() === thread); check(!borrowed && coldBorrow == null) { "VEIL_PENDING_COLD_BORROW_ACTIVE" }
        if (current == Status.CLOSED) return
        wipe(entries); entries = emptyList()
        var primary: Throwable? = null
        try { lock?.release() } catch (failure: Throwable) { primary = failure }
        try { channel?.close() } catch (failure: Throwable) {
            if (primary == null) primary = failure else if (primary !== failure) primary.addSuppressed(failure)
        } finally { current = Status.CLOSED; lock = null; channel = null }
        primary?.let { throw it }
    }
    companion object {
        const val MAX_FILE_BYTES = 512 * 1024
        private fun ownerMode() = PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"))
        fun openAppPrivate(context: Context): VeilDeviceEnrollmentPendingStore {
            check(Build.VERSION.SDK_INT >= 26) { "VEIL_PENDING_PLATFORM_UNAVAILABLE" }
            // Use the same fixed product-container qualifier as the key/store
            // producer, including M1 QA. Never accept a caller-selected path,
            // package, shared UID, device-protected Context or copied namespace.
            VeilAppIsolation.requireOwnedPackage(context)
            val parent = context.noBackupFilesDir.toPath()
            check(Files.isDirectory(parent, NOFOLLOW_LINKS))
            return VeilDeviceEnrollmentPendingStore(parent.resolve("veil-v2-device-enrollment-pending"))
        }
    }
}
