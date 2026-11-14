package com.ynx.social.matrix

import android.security.keystore.KeyInfo
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import java.io.DataOutputStream
import java.io.OutputStream
import java.util.UUID

/** Checked SQL capability candidate; NOT runtimecomplete, trust, or an independent anchor.
 * Raw DB/Cursor never crosses this contract. Main implements the private SQLite executor.
 * Producer lifecycle is never passed to business/auth callbacks. Missing providers fail closed.
 */
internal class VeilCheckpointSqlite(
  private val binding: VeilCheckpointCommit.Binding,
  private val bridge: NativeStoreBridge? = null,
  private val authorization: Authorization? = null,
  private val business: BusinessCiphertext? = null,
  private val receipts: VeilCheckpointCommit.CasReceiptVerifier? = null,
) : VeilCheckpointCommit.DurableProducer {
  companion object {
    const val RUNTIME_COMPLETE = false
    private const val INTENTS = "veil_checkpoint_intents_v1"
    private const val CHUNKS = "veil_checkpoint_chunks_v1"
    private const val MARKERS = "veil_checkpoint_committed_ops_v1"
    private const val PART = 65536
    private const val MAX_BYTES = 64 * 1024 * 1024
    private const val MAX_ROWS = 128
    private val columns = listOf("op", "owner", "device", "identity_fp", "key_alias", "base_rev", "base_hash", "next_rev", "next_hash", "cipher_hash", "auth_gen", "phase", "candidate_bytes", "chunk_count", "receipt")
    private val headerBudget = Budget(1, 15, 32768, 32768, 512, 4096)
    private val aggregateBudget = Budget(1, 3, 0, 0, 0, 0)
    private fun fail(code: String): Nothing = throw IllegalStateException(code)
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
      .joinToString("") { "%02x".format(it.toInt() and 255) }

    /** Local auxiliary-state fingerprint, NOT a new wire format or authenticated anchor.
     * Main's privileged frozen verifier uses this SAME function with its PRIVATE read-only
     * snapshot executor. That executor must never escape into a business/auth callback.
     */
    fun auxiliaryFingerprint(sql: SqlPort): String {
      val digest = MessageDigest.getInstance("SHA-256")
      val output = DataOutputStream(object : OutputStream() {
        override fun write(value: Int) { digest.update(value.toByte()) }
        override fun write(value: ByteArray, offset: Int, length: Int) { digest.update(value, offset, length) }
      })
      fun table(name: String, statement: String, budget: Budget) {
        output.writeUTF(name)
        val rows = sql.query(statement, emptyList(), budget).also { it.validate(budget) }
        output.writeInt(rows.size)
        for (i in 0 until rows.size) {
          val row = rows.row(i); output.writeInt(row.size)
          for (j in 0 until row.size) when (val value = row.value(j)) {
            is Value.Integer -> { output.writeByte(1); output.writeLong(value.number) }
            is Value.Text -> { output.writeByte(2); val b = value.text.toByteArray(Charsets.UTF_8); output.writeInt(b.size); output.write(b) }
            is Value.Blob -> { output.writeByte(3); val b = value.copy(); output.writeInt(b.size); output.write(b) }
            Value.Null -> output.writeByte(0)
          }
        }
      }
      table(INTENTS, "SELECT ${columns.joinToString(",")} FROM $INTENTS ORDER BY op", Budget(MAX_ROWS, 15, 32768, MAX_ROWS * 32768, 512, MAX_ROWS * 4096))
      table(CHUNKS, "SELECT op,part,bytes FROM $CHUNKS ORDER BY op,part", Budget(1152, 3, PART, MAX_BYTES, 36, 1152 * 36))
      table(MARKERS, "SELECT op,commitment_hash FROM $MARKERS ORDER BY op", Budget(MAX_ROWS, 2, 0, 0, 64, MAX_ROWS * 100))
      output.flush()
      return digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
  }

  sealed class Value {
    class Integer(val number: Long) : Value()
    class Text(val text: String) : Value()
    class Blob(bytes: ByteArray) : Value() {
      init {
        // Global sealed-row ceiling BEFORE ownership copy; callers retain tighter budgets.
        if (bytes.size > 8 * 1024 * 1024 + 28) fail("VEIL_CHECKPOINT_SQL_BLOB_BOUND")
      }
      private val bytes = bytes.copyOf()
      val size: Int get() = bytes.size
      fun copy(): ByteArray = bytes.copyOf()
    }
    object Null : Value()
    override fun toString() = "CheckedSqlValue[redacted]"
  }
  data class NamedValue(val column: String, val value: Value)
  data class Budget(val maxRows: Int, val maxColumns: Int, val maxBlobCell: Int, val maxBlobTotal: Int, val maxTextCell: Int, val maxTextTotal: Int) {
    init { require(listOf(maxRows, maxColumns, maxBlobCell, maxBlobTotal, maxTextCell, maxTextTotal).all { it >= 0 }) }
  }
  class Row internal constructor(values: List<Value>) {
    private val cells = values.toTypedArray()
    val size get() = cells.size
    fun value(column: Int): Value = cells[column]
    fun integer(column: Int) = (value(column) as? Value.Integer)?.number ?: fail("VEIL_CHECKPOINT_INTENT_REJECTED")
    fun text(column: Int, maximum: Int): String = ((value(column) as? Value.Text)?.text ?: fail("VEIL_CHECKPOINT_INTENT_REJECTED")).also {
      if (it.length !in 1..maximum || it.any { ch -> ch.code !in 33..126 }) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
    }
    fun blob(column: Int) = (value(column) as? Value.Blob)?.copy() ?: fail("VEIL_CHECKPOINT_CANDIDATE_MISMATCH")
  }
  class Snapshot private constructor(rows: List<List<Value>>) {
    private val rows = rows.map { Row(it) }.toTypedArray()
    val size get() = rows.size
    fun row(index: Int): Row = rows[index]
    fun validate(budget: Budget) {
      if (size > budget.maxRows) fail("VEIL_CHECKPOINT_SQL_SNAPSHOT_BUDGET")
      var blobs = 0L; var texts = 0L
      for (row in rows) {
        if (row.size > budget.maxColumns) fail("VEIL_CHECKPOINT_SQL_SNAPSHOT_BUDGET")
        for (i in 0 until row.size) when (val value = row.value(i)) {
          is Value.Blob -> { if (value.size > budget.maxBlobCell) fail("VEIL_CHECKPOINT_SQL_SNAPSHOT_BUDGET"); blobs += value.size }
          is Value.Text -> { if (value.text.length > budget.maxTextCell) fail("VEIL_CHECKPOINT_SQL_SNAPSHOT_BUDGET"); texts += value.text.length }
          else -> Unit
        }
      }
      if (blobs > budget.maxBlobTotal || texts > budget.maxTextTotal) fail("VEIL_CHECKPOINT_SQL_SNAPSHOT_BUDGET")
    }
    companion object {
      /** Main checks budget while reading, before materializing BLOBs; closes Cursor before return.
       * Values are immutable and Blob copies its input. No lazy rows, Cursor or callbacks.
       */
      fun bounded(rows: List<List<Value>>, budget: Budget): Snapshot {
        if (rows.size > budget.maxRows || rows.any { it.size > budget.maxColumns }) fail("VEIL_CHECKPOINT_SQL_SNAPSHOT_BUDGET")
        return Snapshot(rows).also { it.validate(budget) }
      }
    }
  }

  interface SqlPort {
    /** Trusted constant SQL + bound immutable arguments; fully materialized bounded snapshot. */
    fun query(statement: String, arguments: List<Value>, budget: Budget): Snapshot
    fun executeSchema(statement: String)
    fun insert(table: String, values: List<NamedValue>): Long
    fun update(table: String, values: List<NamedValue>, where: String, arguments: List<Value>): Int
  }
  interface AuthorizationOnly { fun checkLive() }
  interface BusinessScope { val sql: SqlPort; fun checkLive() }
  interface ProducerLifecycle {
    /** PRIVATE producer-only lifecycle. All operations enforce native thread/scope/DB identity. */
    fun begin()
    fun inTransaction(): Boolean
    /** Privileged read-only defense after freeze/guards; no callbacks or raw handle return. */
    fun verifyFrozenState(binding: VeilCheckpointCommit.Binding, expectedBusiness: VeilCheckpointCommit.Checkpoint, expectedAuxiliarySha256: String)
    fun endSuccessful()
    /** Cleanup remains allowed after freeze/lease expiry, ONLY on owning native thread. */
    fun rollbackAndEnd()
  }
  interface ProducerScope {
    fun authorizationOnly(): AuthorizationOnly
    /** Main's concrete SQL port also checks lifetime/thread/lease/freeze AT EACH OPERATION. */
    fun checkedSql(): SqlPort
    fun lifecycle(): ProducerLifecycle
    /** Invalidate ALL regular SQL ports, including auxiliary access and previously captured ports. */
    fun freezeSqlAndBusinessHandles()
    /** Consume attempt BEFORE effect, retaining consumption if effect throws. No repeat/recursion. */
    fun commitOnce(effect: () -> Unit)
  }
  interface NativeStoreBridge {
    /** Original NativeStore lock + authority lease, same DB. No nested transaction or advance.
     * Only this producer receives ProducerScope. No raw DB/Cursor appears in any contract.
     */
    fun <T> withScope(binding: VeilCheckpointCommit.Binding, block: (ProducerScope) -> T): T
    /** Reject calling-thread SQLite transaction even outside mutex/lease, without opening DB. */
    fun requireOutsideTransaction()
  }
  fun interface Authorization {
    fun authorize(capability: AuthorizationOnly, commitment: VeilCheckpointCommit.Commitment): VeilCheckpointCommit.AuthorizationGuard
  }
  interface BusinessCiphertext {
    fun checkpoint(scope: BusinessScope, binding: VeilCheckpointCommit.Binding): VeilCheckpointCommit.Checkpoint
    fun validateMapping(scope: BusinessScope, intent: VeilCheckpointCommit.Intent)
    fun applyExact(scope: BusinessScope, intent: VeilCheckpointCommit.Intent)
    fun verifyPublishedExact(scope: BusinessScope, commitment: VeilCheckpointCommit.Commitment)
  }

  private val active = ThreadLocal.withInitial { false }
  override fun requireOutsideTransaction() {
    check(active.get() == false) { "VEIL_CHECKPOINT_NETWORK_IN_TRANSACTION" }
    (bridge ?: fail("VEIL_CHECKPOINT_SQLITE_BRIDGE_UNAVAILABLE")).requireOutsideTransaction()
  }
  private fun requireKey() {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val key = store.getKey(binding.keyAlias, null) as? SecretKey ?: fail("VEIL_CHECKPOINT_KEYSTORE_KEY_UNAVAILABLE")
    if (key.algorithm != "AES") fail("VEIL_CHECKPOINT_KEYSTORE_POLICY_REJECTED")
    val info = SecretKeyFactory.getInstance("AES", "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java) as? KeyInfo
      ?: fail("VEIL_CHECKPOINT_KEYSTORE_POLICY_REJECTED")
    if (info.keySize != 256 || !info.isUserAuthenticationRequired) fail("VEIL_CHECKPOINT_KEYSTORE_POLICY_REJECTED")
  }
  private class Gate(val auth: AuthorizationOnly, val lifecycle: ProducerLifecycle) {
    private val thread = Thread.currentThread()
    var live = true
    var frozen = false
    fun use() {
      check(live && !frozen && Thread.currentThread() === thread) { "VEIL_CHECKPOINT_SQL_ACCESS_REJECTED" }
      auth.checkLive()
      check(lifecycle.inTransaction()) { "VEIL_CHECKPOINT_TRANSACTION_INACTIVE" }
    }
  }
  private class CheckedSql(private val delegate: SqlPort, private val gate: Gate) : SqlPort {
    override fun query(statement: String, arguments: List<Value>, budget: Budget): Snapshot {
      gate.use(); val result = delegate.query(statement, arguments.toList(), budget); gate.use(); result.validate(budget); return result
    }
    override fun executeSchema(statement: String) { gate.use(); delegate.executeSchema(statement); gate.use() }
    override fun insert(table: String, values: List<NamedValue>): Long { gate.use(); val n = delegate.insert(table, values.toList()); gate.use(); return n }
    override fun update(table: String, values: List<NamedValue>, where: String, arguments: List<Value>): Int {
      gate.use(); val n = delegate.update(table, values.toList(), where, arguments.toList()); gate.use(); return n
    }
  }
  override fun <T> shortTransaction(block: (VeilCheckpointCommit.ShortTransaction) -> T): T {
    val owner = bridge ?: fail("VEIL_CHECKPOINT_SQLITE_BRIDGE_UNAVAILABLE")
    val trust = authorization ?: fail("VEIL_CHECKPOINT_AUTHORIZATION_UNAVAILABLE")
    val records = business ?: fail("VEIL_CHECKPOINT_BUSINESS_PRODUCER_UNAVAILABLE")
    check(active.get() == false) { "VEIL_CHECKPOINT_NESTED_TRANSACTION" }; active.set(true)
    var committed = false; var bridgeResult: Any? = null
    try {
      val delivered = owner.withScope(binding) { scope ->
        val nativeAuth = scope.authorizationOnly(); nativeAuth.checkLive(); requireKey(); nativeAuth.checkLive()
        val life = scope.lifecycle()
        val gate = Gate(nativeAuth, life)
        // Even retained AuthorizationOnly cannot be used after this producer callback exits.
        val authOnly = object : AuthorizationOnly {
          override fun checkLive() {
            check(gate.live && Thread.currentThread() === producerThread) { "VEIL_CHECKPOINT_AUTH_SCOPE_REJECTED" }
            nativeAuth.checkLive()
          }
          private val producerThread = Thread.currentThread()
        }
        val sql = CheckedSql(scope.checkedSql(), gate)
        val businessScope = object : BusinessScope { override val sql = sql; override fun checkLive() = gate.use() }
        var ended = false; var attempted = false; var primary: Throwable? = null; var resultToDispose: Any? = null
        var started = false
        try {
          life.begin(); started = true
          val tx = Transaction(sql, businessScope, authOnly, gate, trust, records)
          val before = records.checkpoint(businessScope, binding)
          schema(sql); budget(sql)
          val result = block(tx); resultToDispose = result
          val expected = tx.checkFinalState(before)
          val auxiliary = auxiliaryFingerprint(sql)
          gate.frozen = true
          scope.freezeSqlAndBusinessHandles()
          var effectRan = false
          scope.commitOnce {
            check(!effectRan) { "VEIL_CHECKPOINT_COMMIT_EFFECT_REUSED" }; effectRan = true
            authOnly.checkLive(); tx.finalGuards(); authOnly.checkLive()
            life.verifyFrozenState(binding, expected, auxiliary)
            authOnly.checkLive()
            attempted = true; life.endSuccessful(); ended = true; committed = true
          }
          check(ended) { "VEIL_CHECKPOINT_COMMIT_EFFECT_MISSING" }
          resultToDispose = null; bridgeResult = result; result
        } catch (failure: Throwable) {
          gate.frozen = true
          val error = if (attempted) IllegalStateException("VEIL_CHECKPOINT_SQLITE_COMMIT_UNKNOWN", failure) else failure
          primary = error; discard(resultToDispose, error); throw error
        } finally {
          gate.frozen = true
          try {
            if (started && !ended) try { life.rollbackAndEnd() } catch (cleanup: Throwable) {
              val error = primary
              if (error != null) { if (cleanup !== error) error.addSuppressed(cleanup) }
              else throw IllegalStateException("VEIL_CHECKPOINT_SQLITE_COMMIT_UNKNOWN", cleanup)
            }
          } finally { gate.live = false }
        }
      }
      bridgeResult = null; return delivered
    } catch (failure: Throwable) {
      val error = if (committed && failure.message != "VEIL_CHECKPOINT_SQLITE_COMMIT_UNKNOWN")
        IllegalStateException("VEIL_CHECKPOINT_SQLITE_COMMIT_UNKNOWN", failure) else failure
      discard(bridgeResult, error); throw error
    } finally { active.remove() }
  }
  private fun discard(value: Any?, error: Throwable) {
    try { when (value) { is ByteArray -> value.fill(0); is AutoCloseable -> value.close() } }
    catch (cleanup: Throwable) { if (cleanup !== error) error.addSuppressed(cleanup) }
  }
  private fun schema(sql: SqlPort) {
    sql.executeSchema("CREATE TABLE IF NOT EXISTS $INTENTS (op TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, device TEXT NOT NULL, identity_fp TEXT NOT NULL, key_alias TEXT NOT NULL, base_rev INTEGER NOT NULL, base_hash TEXT NOT NULL, next_rev INTEGER NOT NULL, next_hash TEXT NOT NULL, cipher_hash TEXT NOT NULL, auth_gen INTEGER NOT NULL, phase TEXT NOT NULL, candidate_bytes INTEGER NOT NULL, chunk_count INTEGER NOT NULL, receipt BLOB)")
    sql.executeSchema("CREATE TABLE IF NOT EXISTS $CHUNKS (op TEXT NOT NULL, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(op,part))")
    sql.executeSchema("CREATE TABLE IF NOT EXISTS $MARKERS (op TEXT PRIMARY KEY NOT NULL, commitment_hash TEXT NOT NULL)")
  }
  private fun budget(sql: SqlPort) {
    val totals = sql.query("SELECT COUNT(*),COALESCE(SUM(candidate_bytes),0) FROM $INTENTS", emptyList(), aggregateBudget).row(0)
    check(totals.integer(0) in 0..MAX_ROWS && totals.integer(1) in 0..MAX_BYTES.toLong()) { "VEIL_CHECKPOINT_STAGING_BUDGET_REJECTED" }
    val chunks = sql.query("SELECT COUNT(*),COALESCE(SUM(length(bytes)),0) FROM $CHUNKS", emptyList(), aggregateBudget).row(0)
    check(chunks.integer(0) in 0..1152 && chunks.integer(1) in 0..MAX_BYTES.toLong()) { "VEIL_CHECKPOINT_STAGING_BUDGET_REJECTED" }
    val markers = sql.query("SELECT COUNT(*) FROM $MARKERS", emptyList(), aggregateBudget).row(0)
    check(markers.integer(0) in 0..MAX_ROWS) { "VEIL_CHECKPOINT_STAGING_BUDGET_REJECTED" }
  }
  private inner class Transaction(val sql: SqlPort, val scope: BusinessScope, val auth: AuthorizationOnly, val gate: Gate,
    val trust: Authorization, val records: BusinessCiphertext) : VeilCheckpointCommit.ShortTransaction {
    val guards = mutableListOf<VeilCheckpointCommit.AuthorizationGuard>()
    var published: VeilCheckpointCommit.Commitment? = null
    fun admit(c: VeilCheckpointCommit.Commitment) { val g = authorize(c); g.recheck(); guardCommit(g) }
    override fun authorize(commitment: VeilCheckpointCommit.Commitment): VeilCheckpointCommit.AuthorizationGuard {
      gate.use(); if (commitment.binding != binding) fail("VEIL_CHECKPOINT_BINDING_MISMATCH"); return trust.authorize(auth, commitment)
    }
    override fun guardCommit(guard: VeilCheckpointCommit.AuthorizationGuard) { gate.use(); guards.add(guard) }
    fun finalGuards() { check(gate.frozen && gate.live); guards.forEach { it.recheck() } }
    override fun localCheckpoint(binding: VeilCheckpointCommit.Binding): VeilCheckpointCommit.Checkpoint {
      gate.use(); if (binding != this@VeilCheckpointSqlite.binding) fail("VEIL_CHECKPOINT_BINDING_MISMATCH")
      return records.checkpoint(scope, binding).also { gate.use() }
    }
    fun checkFinalState(before: VeilCheckpointCommit.Checkpoint): VeilCheckpointCommit.Checkpoint {
      val expected = published?.next ?: before
      if (localCheckpoint(binding) != expected) fail("VEIL_CHECKPOINT_CANDIDATE_MISMATCH")
      published?.let { c ->
        val i = read(c.operation) ?: fail("VEIL_CHECKPOINT_EXACT_INTENT_REQUIRED")
        if (i.commitment != c || i.phase != VeilCheckpointCommit.Phase.COMMITTED || !isPublishedExactly(c)) fail("VEIL_CHECKPOINT_ATOMIC_PUBLISH_REQUIRED")
      }
      return expected
    }
    override fun read(operation: UUID): VeilCheckpointCommit.Intent? {
      gate.use()
      val rows = sql.query("SELECT ${columns.joinToString(",")} FROM $INTENTS WHERE op=?", listOf(Value.Text(operation.toString())), headerBudget)
      if (rows.size == 0) return null
      check(rows.size == 1) { "VEIL_CHECKPOINT_INTENT_REJECTED" }; val r = rows.row(0)
      val c = VeilCheckpointCommit.Commitment(VeilCheckpointCommit.Binding(r.text(1,512), r.text(2,512), r.text(3,512), r.text(4,200)),
        UUID.fromString(r.text(0,36)), VeilCheckpointCommit.Checkpoint(r.integer(5),r.text(6,64)),
        VeilCheckpointCommit.Checkpoint(r.integer(7),r.text(8,64)),r.text(9,64),r.integer(10))
      if (c.operation != operation || r.text(0,36) != operation.toString()) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
      admit(c)
      val phase = VeilCheckpointCommit.Phase.valueOf(r.text(11,32)); val length = r.integer(12); val count = r.integer(13)
      if (length !in 1..MAX_BYTES.toLong() || count != (length + PART - 1) / PART) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
      val proof = if (r.value(14) == Value.Null) null else r.blob(14)
      val candidate = ByteArray(length.toInt())
      try {
        val chunks = sql.query("SELECT part,bytes FROM $CHUNKS WHERE op=? ORDER BY part", listOf(Value.Text(operation.toString())), Budget(1024,2,PART,MAX_BYTES,0,0))
        if (chunks.size.toLong() != count) fail("VEIL_CHECKPOINT_CANDIDATE_MISMATCH")
        var offset = 0
        for (index in 0 until chunks.size) {
          val row = chunks.row(index); val part = row.blob(1)
          if (row.integer(0) != index.toLong() || part.size != minOf(PART,candidate.size-offset)) fail("VEIL_CHECKPOINT_CANDIDATE_MISMATCH")
          part.copyInto(candidate,offset); offset += part.size
        }
        return VeilCheckpointCommit.Intent.restore(c,phase,candidate,proof).also { gate.use() }
      } finally { candidate.fill(0); proof?.fill(0) }
    }
    fun applied(i: VeilCheckpointCommit.Intent) {
      val verifier = receipts ?: fail("VEIL_CHECKPOINT_RECEIPT_VERIFIER_UNAVAILABLE")
      val proof = i.receiptProof() ?: fail("VEIL_CHECKPOINT_RECEIPT_REQUIRED")
      try { if (proof.size !in 1..32768 || verifier.verify(proof,i.commitment) != VeilCheckpointCommit.Decision.APPLIED) fail("VEIL_CHECKPOINT_RECEIPT_REJECTED") }
      finally { proof.fill(0) }
    }
    override fun put(expected: VeilCheckpointCommit.Intent?, next: VeilCheckpointCommit.Intent) {
      gate.use(); next.checkExact(); admit(next.commitment); val current = read(next.commitment.operation)
      if (expected == null) {
        if (current != null || next.phase != VeilCheckpointCommit.Phase.PREPARED) fail("VEIL_CHECKPOINT_OPERATION_REUSE")
        if (localCheckpoint(binding) != next.commitment.base) fail("VEIL_CHECKPOINT_RECOVERY_REQUIRED")
        records.validateMapping(scope,next); gate.use(); insert(next)
      } else {
        if (current == null || !equal(current,expected) || next.commitment != current.commitment ||
          !next.candidateCiphertext().contentEquals(current.candidateCiphertext()) || next.phase.ordinal != current.phase.ordinal+1) fail("VEIL_CHECKPOINT_OPERATION_REUSE")
        if (next.phase >= VeilCheckpointCommit.Phase.ANCHORED) applied(next)
        if (current.phase >= VeilCheckpointCommit.Phase.ANCHORED && !equalProof(current.receiptProof(),next.receiptProof())) fail("VEIL_CHECKPOINT_RECEIPT_REJECTED")
        if (next.phase == VeilCheckpointCommit.Phase.COMMITTED && !isPublishedExactly(next.commitment)) fail("VEIL_CHECKPOINT_RECOVERY_REQUIRED")
        val proof = next.receiptProof()
        val values = listOf(NamedValue("phase",Value.Text(next.phase.name)),NamedValue("receipt",proof?.let { Value.Blob(it) } ?: Value.Null))
        if (sql.update(INTENTS,values,"op=? AND phase=?",listOf(Value.Text(next.commitment.operation.toString()),Value.Text(current.phase.name))) != 1) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
      }
      budget(sql); gate.use()
    }
    fun insert(i: VeilCheckpointCommit.Intent) {
      val c=i.commitment; val b=i.candidateCiphertext()
      try {
        val count=(b.size+PART-1)/PART
        val header = listOf<Value>(Value.Text(c.operation.toString()),Value.Text(c.binding.owner),Value.Text(c.binding.device),Value.Text(c.binding.identityFingerprint),Value.Text(c.binding.keyAlias),
          Value.Integer(c.base.revision),Value.Text(c.base.ciphertextStateSha256),Value.Integer(c.next.revision),Value.Text(c.next.ciphertextStateSha256),Value.Text(c.candidateCipherSha256),
          Value.Integer(c.authorizationGeneration),Value.Text(i.phase.name),Value.Integer(b.size.toLong()),Value.Integer(count.toLong()),Value.Null)
        if (sql.insert(INTENTS,columns.zip(header).map { NamedValue(it.first,it.second) }) == -1L) fail("VEIL_CHECKPOINT_SQLITE_WRITE_REJECTED")
        for (part in 0 until count) {
          val piece=b.copyOfRange(part*PART,minOf(b.size,(part+1)*PART))
          if (sql.insert(CHUNKS,listOf(NamedValue("op",Value.Text(c.operation.toString())),NamedValue("part",Value.Integer(part.toLong())),NamedValue("bytes",Value.Blob(piece)))) == -1L) fail("VEIL_CHECKPOINT_SQLITE_WRITE_REJECTED")
        }
      } finally { b.fill(0) }
    }
    override fun publishExact(intent: VeilCheckpointCommit.Intent) {
      gate.use(); admit(intent.commitment); applied(intent)
      if (published != null) fail("VEIL_CHECKPOINT_MULTIPLE_PUBLICATION_REJECTED")
      val original=read(intent.commitment.operation) ?: fail("VEIL_CHECKPOINT_EXACT_INTENT_REQUIRED")
      if (!equal(original,intent) || intent.phase != VeilCheckpointCommit.Phase.COMMIT_REQUESTED) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
      if (isPublishedExactly(intent.commitment) || localCheckpoint(binding) != intent.commitment.base) fail("VEIL_CHECKPOINT_RECOVERY_REQUIRED")
      records.validateMapping(scope,original); gate.use(); records.applyExact(scope,original); gate.use()
      if (localCheckpoint(binding) != intent.commitment.next) fail("VEIL_CHECKPOINT_CANDIDATE_MISMATCH")
      records.verifyPublishedExact(scope,intent.commitment); gate.use()
      if (sql.insert(MARKERS,listOf(NamedValue("op",Value.Text(intent.commitment.operation.toString())),NamedValue("commitment_hash",Value.Text(intent.commitment.fingerprint())))) == -1L) fail("VEIL_CHECKPOINT_SQLITE_WRITE_REJECTED")
      published=intent.commitment
    }
    override fun isPublishedExactly(commitment: VeilCheckpointCommit.Commitment): Boolean {
      gate.use(); admit(commitment)
      val rows=sql.query("SELECT commitment_hash FROM $MARKERS WHERE op=?",listOf(Value.Text(commitment.operation.toString())),Budget(1,1,0,0,64,64))
      if (rows.size == 0) return false
      if (rows.row(0).text(0,64) != commitment.fingerprint()) fail("VEIL_CHECKPOINT_OPERATION_REUSE")
      val i=read(commitment.operation) ?: fail("VEIL_CHECKPOINT_EXACT_INTENT_REQUIRED")
      if (i.commitment != commitment || i.phase < VeilCheckpointCommit.Phase.COMMIT_REQUESTED) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
      applied(i); records.verifyPublishedExact(scope,commitment); gate.use(); return true
    }
  }
  private fun equalProof(a: ByteArray?,b: ByteArray?) = if(a==null || b==null) a==null && b==null else a.contentEquals(b)
  private fun equal(a: VeilCheckpointCommit.Intent,b: VeilCheckpointCommit.Intent) = a.commitment==b.commitment && a.phase==b.phase && a.candidateCiphertext().contentEquals(b.candidateCiphertext()) && equalProof(a.receiptProof(),b.receiptProof())
}
