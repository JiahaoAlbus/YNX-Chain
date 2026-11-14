package com.ynx.social.matrix

import java.security.MessageDigest
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.util.UUID

/**
 * Isolated new-core checkpoint CANDIDATE, NOT a runtime-complete store or trust factory.
 * This class has no SessionCipher callback, key, plaintext, JS bridge or network implementation.
 * Main must supply independently admitted authorization, real durable transactions, authenticated
 * CAS receipts and an anchor with the claimed rollback protection. SQLite/Keystore alone do not
 * establish that protection. Default dependencies fail closed.
 */
internal class VeilCheckpointCommit(
  private val producer: DurableProducer = UnavailableProducer,
  private val anchor: AnchorCas = UnavailableAnchor,
  private val receipts: CasReceiptVerifier = UnavailableVerifier,
) {
  companion object {
    const val RUNTIME_COMPLETE = false
    const val MAX_CANDIDATE_BYTES = 64 * 1024 * 1024
    const val MAX_RECEIPT_BYTES = 32768
    private fun fail(code: String): Nothing = throw IllegalStateException(code)
    private fun text(value: String, maximum: Int) {
      require(value.length in 1..maximum && value.all { it.code in 33..126 })
    }
    private fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
      .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun hash(value: String) {
      require(value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' })
    }
  }

  data class Binding(val owner: String, val device: String, val identityFingerprint: String, val keyAlias: String) {
    init {
      listOf(owner, device, identityFingerprint, keyAlias).forEach { text(it, 512) }
      require(keyAlias.startsWith("ynx.social.veil.v2.") && keyAlias.length <= 200)
    }
    override fun toString() = "VeilCheckpointBinding[redacted]"
  }

  data class Checkpoint(val revision: Long, val ciphertextStateSha256: String) {
    init { require(revision >= 0); hash(ciphertextStateSha256) }
    override fun toString() = "VeilCheckpoint[redacted]"
  }

  /** All fields are bound by a verified receipt; the exact bytes are retained by the producer. */
  data class Commitment(
    val binding: Binding,
    val operation: UUID,
    val base: Checkpoint,
    val next: Checkpoint,
    val candidateCipherSha256: String,
    val authorizationGeneration: Long,
  ) {
    init {
      require(operation != UUID(0, 0) && authorizationGeneration >= 0)
      require(next.revision == Math.addExact(base.revision, 1))
      hash(candidateCipherSha256)
    }
    /** Local metadata fingerprint, NOT an authenticator, receipt, wire format or new cipher. */
    fun fingerprint(): String {
      val bytes = ByteArrayOutputStream()
      DataOutputStream(bytes).use { out ->
        fun field(value: String) {
          val encoded = value.toByteArray(Charsets.UTF_8)
          out.writeInt(encoded.size); out.write(encoded)
        }
        field("YNX/SOCIAL/CHECKPOINT-CANDIDATE/V1")
        field(binding.owner); field(binding.device); field(binding.identityFingerprint); field(binding.keyAlias)
        out.writeLong(operation.mostSignificantBits); out.writeLong(operation.leastSignificantBits)
        out.writeLong(base.revision); field(base.ciphertextStateSha256)
        out.writeLong(next.revision); field(next.ciphertextStateSha256)
        field(candidateCipherSha256); out.writeLong(authorizationGeneration)
      }
      return digest(bytes.toByteArray())
    }
    override fun toString() = "VeilCheckpointCommitment[redacted]"
  }

  enum class Phase { PREPARED, CAS_REQUESTED, ANCHORED, COMMIT_REQUESTED, COMMITTED }
  enum class Decision { APPLIED, DEFINITELY_NOT_APPLIED }
  enum class Progress { PREPARED_DURABLE, NEEDS_EXACT_CAS_RETRY, ANCHORED_DURABLE, COMMITTED_EXACT }

  /** Only already sealed, bounded native candidate bytes. No application result is stored here. */
  class Intent private constructor(
    val commitment: Commitment,
    val phase: Phase,
    private val candidate: ByteArray,
    private val receipt: ByteArray?,
  ) {
    companion object {
      fun prepared(commitment: Commitment, sealedCandidate: ByteArray): Intent {
        require(sealedCandidate.size in 1..MAX_CANDIDATE_BYTES)
        val frozen = sealedCandidate.copyOf()
        if (digest(frozen) != commitment.candidateCipherSha256) fail("VEIL_CHECKPOINT_CANDIDATE_MISMATCH")
        return Intent(commitment, Phase.PREPARED, frozen, null)
      }
      /** Producer rehydrates exact persisted metadata/bytes, not a source of authorization. */
      fun restore(commitment: Commitment, phase: Phase, sealedCandidate: ByteArray, proof: ByteArray?): Intent {
        val prepared = prepared(commitment, sealedCandidate)
        require(proof == null || proof.size in 1..MAX_RECEIPT_BYTES)
        return prepared.move(phase, proof)
      }
    }
    fun candidateCiphertext(): ByteArray = candidate.copyOf()
    fun receiptProof(): ByteArray? = receipt?.copyOf()
    fun checkExact() {
      if (candidate.size !in 1..MAX_CANDIDATE_BYTES || digest(candidate) != commitment.candidateCipherSha256)
        fail("VEIL_CHECKPOINT_CANDIDATE_MISMATCH")
      if ((phase >= Phase.ANCHORED) != (receipt != null)) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
    }
    internal fun move(phase: Phase, proof: ByteArray? = receipt): Intent =
      Intent(commitment, phase, candidate, proof?.copyOf()).also { it.checkExact() }
    override fun toString() = "VeilCheckpointIntent[$phase; ciphertext/metadata redacted]"
  }

  /** Actual producer must persist before returning. Exceptions can mean an UNKNOWN commit. */
  interface DurableProducer {
    fun <T> shortTransaction(block: (ShortTransaction) -> T): T
    /** Must assert the calling thread holds neither a SQLite transaction nor a lease scope. */
    fun requireOutsideTransaction()
  }

  fun interface AuthorizationGuard { fun recheck() }

  interface ShortTransaction {
    /** Independent current native trust; never infer approval from the supplied Commitment. */
    fun authorize(commitment: Commitment): AuthorizationGuard
    /** Run again at the real final commit boundary, after handles freeze. No private IO then. */
    fun guardCommit(guard: AuthorizationGuard)
    fun read(operation: UUID): Intent?
    fun localCheckpoint(binding: Binding): Checkpoint
    /** Must compare phase AND complete immutable intent; never replace another intent.
     * Prepared intent must live outside business-record checkpoint hashing, avoiding a circular
     * next-state digest. Validate the sealed candidate's mapping to base/next before persistence.
     */
    fun put(expected: Intent?, next: Intent)
    /** Atomic application of the exact sealed candidate and its expected next-state digest.
     * Recompute actual resulting business checkpoint before commit; no re-encryption callback.
     */
    fun publishExact(intent: Intent)
    /** Durable operation marker binding op/base/next/digest/gen, atomically written with publish. */
    fun isPublishedExactly(commitment: Commitment): Boolean
  }

  interface AnchorCas {
    /** Idempotent by complete Commitment/op; request contains metadata only. */
    fun compareAndSwap(commitment: Commitment): ByteArray
    /** Resolve this exact op; unknown/timeout is an error, never implicit NOT_APPLIED. */
    fun lookup(commitment: Commitment): ByteArray
  }

  fun interface CasReceiptVerifier {
    /** Verify issuer/authenticity, complete tuple, decision, freshness and authoritative op history.
     * A digest equality, HTTP 200, TLS alone or caller-created receipt is NOT this verification.
     * DEFINITELY_NOT_APPLIED must safely allow an idempotent retry despite in-flight requests.
     */
    fun verify(proof: ByteArray, expected: Commitment): Decision
  }

  private object UnavailableProducer : DurableProducer {
    override fun <T> shortTransaction(block: (ShortTransaction) -> T): T = fail("VEIL_CHECKPOINT_DURABLE_PRODUCER_UNAVAILABLE")
    override fun requireOutsideTransaction(): Unit = fail("VEIL_CHECKPOINT_DURABLE_PRODUCER_UNAVAILABLE")
  }
  private object UnavailableAnchor : AnchorCas {
    override fun compareAndSwap(commitment: Commitment): ByteArray = fail("VEIL_CHECKPOINT_ANCHOR_UNAVAILABLE")
    override fun lookup(commitment: Commitment): ByteArray = fail("VEIL_CHECKPOINT_ANCHOR_UNAVAILABLE")
  }
  private object UnavailableVerifier : CasReceiptVerifier {
    override fun verify(proof: ByteArray, expected: Commitment): Decision = fail("VEIL_CHECKPOINT_RECEIPT_VERIFIER_UNAVAILABLE")
  }

  private val transactionActive = ThreadLocal.withInitial { false }
  private fun <T> short(block: (ShortTransaction) -> T): T {
    check(transactionActive.get() == false) { "VEIL_CHECKPOINT_NESTED_TRANSACTION" }
    transactionActive.set(true)
    try { return producer.shortTransaction(block) }
    finally { transactionActive.remove() }
  }
  private fun authorized(tx: ShortTransaction, value: Intent) {
    value.checkExact()
    val guard = tx.authorize(value.commitment)
    guard.recheck(); tx.guardCommit(guard)
  }
  private fun load(tx: ShortTransaction, operation: UUID): Intent =
    (tx.read(operation) ?: fail("VEIL_CHECKPOINT_EXACT_INTENT_REQUIRED")).also {
      if (it.commitment.operation != operation) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
      authorized(tx, it)
    }
  private fun same(a: Intent, b: Intent) {
    if (a.commitment != b.commitment) fail("VEIL_CHECKPOINT_OPERATION_REUSE")
    a.checkExact(); b.checkExact()
  }
  private fun base(tx: ShortTransaction, value: Intent) {
    if (tx.localCheckpoint(value.commitment.binding) != value.commitment.base)
      fail("VEIL_CHECKPOINT_RECOVERY_REQUIRED")
  }
  private fun verify(proof: ByteArray, commitment: Commitment): Decision {
    if (proof.size !in 1..MAX_RECEIPT_BYTES) fail("VEIL_CHECKPOINT_RECEIPT_REJECTED")
    val snapshot = proof.copyOf()
    try { return receipts.verify(snapshot, commitment) }
    finally { snapshot.fill(0) }
  }
  private fun verifyApplied(value: Intent) {
    val proof = value.receiptProof() ?: fail("VEIL_CHECKPOINT_RECEIPT_REQUIRED")
    try {
      if (verify(proof, value.commitment) != Decision.APPLIED) fail("VEIL_CHECKPOINT_RECEIPT_REJECTED")
    } finally { proof.fill(0) }
  }
  private fun network(request: () -> ByteArray): ByteArray {
    check(transactionActive.get() == false) { "VEIL_CHECKPOINT_NETWORK_IN_TRANSACTION" }
    producer.requireOutsideTransaction()
    return request()
  }

  /** Durable PREPARED is not a send result. Failure/UNKNOWN: recover by op, never regenerate. */
  fun prepare(commitment: Commitment, sealedCandidate: ByteArray): Progress {
    val candidate = Intent.prepared(commitment, sealedCandidate)
    return short { tx ->
      authorized(tx, candidate)
      val existing = tx.read(commitment.operation)
      if (existing != null) { same(existing, candidate); authorized(tx, existing) }
      else { base(tx, candidate); tx.put(null, candidate) }
      Progress.PREPARED_DURABLE
    }
  }

  /** PREPARED submits once; CAS_REQUESTED only resolves original op after timeout/reboot. */
  fun advance(operation: UUID): Progress {
    val starting = short { tx ->
      val original = load(tx, operation)
      if (original.phase == Phase.PREPARED) {
        base(tx, original); tx.put(original, original.move(Phase.CAS_REQUESTED))
      }
      original
    }
    if (starting.phase >= Phase.ANCHORED) return commitExact(starting)
    val proof = network {
      if (starting.phase == Phase.PREPARED) anchor.compareAndSwap(starting.commitment)
      else anchor.lookup(starting.commitment)
    }
    return accept(starting, proof)
  }

  /** Explicit retry permitted only after an independently authenticated NOT_APPLIED resolution. */
  fun retryExactCas(operation: UUID): Progress {
    val original = short { tx -> load(tx, operation).also {
      if (it.phase != Phase.CAS_REQUESTED) fail("VEIL_CHECKPOINT_CAS_RETRY_REJECTED")
      base(tx, it)
    } }
    val proof = network { anchor.lookup(original.commitment) }
    val decision = try { verify(proof, original.commitment) } finally { proof.fill(0) }
    if (decision == Decision.APPLIED) return advance(operation)
    // Reauthorize after lookup. Request still uses the original tuple, never a new candidate.
    short { tx -> val current = load(tx, operation); same(current, original)
      if (current.phase != Phase.CAS_REQUESTED) fail("VEIL_CHECKPOINT_CAS_RETRY_REJECTED")
      base(tx, current)
    }
    return accept(original, network { anchor.compareAndSwap(original.commitment) })
  }

  private fun accept(original: Intent, proof: ByteArray): Progress {
    try {
      if (verify(proof, original.commitment) == Decision.DEFINITELY_NOT_APPLIED)
        return Progress.NEEDS_EXACT_CAS_RETRY
      val anchored = short { tx ->
        val current = load(tx, original.commitment.operation); same(current, original)
        if (current.phase >= Phase.ANCHORED) { verifyApplied(current); current }
        else {
          if (current.phase != Phase.CAS_REQUESTED) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
          base(tx, current)
          current.move(Phase.ANCHORED, proof).also { tx.put(current, it) }
        }
      }
      return commitExact(anchored)
    } finally { proof.fill(0) }
  }

  private fun commitExact(original: Intent): Progress {
    short { tx ->
      val current = load(tx, original.commitment.operation); same(current, original); verifyApplied(current)
      if (current.phase == Phase.ANCHORED) {
        base(tx, current); tx.put(current, current.move(Phase.COMMIT_REQUESTED))
      } else if (current.phase < Phase.COMMIT_REQUESTED) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
    }
    // Separate short transaction: UNKNOWN local commit always reopens the same durable intent.
    return short { tx ->
      val current = load(tx, original.commitment.operation); same(current, original); verifyApplied(current)
      if (current.phase == Phase.COMMITTED) {
        if (!tx.isPublishedExactly(current.commitment)) fail("VEIL_CHECKPOINT_RECOVERY_REQUIRED")
      } else {
        if (current.phase != Phase.COMMIT_REQUESTED) fail("VEIL_CHECKPOINT_INTENT_REJECTED")
        if (!tx.isPublishedExactly(current.commitment)) {
          base(tx, current); tx.publishExact(current)
        }
        if (tx.localCheckpoint(current.commitment.binding) != current.commitment.next ||
          !tx.isPublishedExactly(current.commitment)) fail("VEIL_CHECKPOINT_RECOVERY_REQUIRED")
        tx.put(current, current.move(Phase.COMMITTED))
      }
      Progress.COMMITTED_EXACT
    }
  }
}
