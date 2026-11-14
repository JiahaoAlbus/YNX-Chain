package com.ynx.social.matrix

/** Private SAME-worker bridge to the existing accepted Native Source.
 * PUBLIC proof bytes only; no root/key constructor, alias, domain or algorithm.
 * Native computes both local deadlines from budgetMs (1..30000), never Java time.
 * Missing/refused output throws with its actual status, never empty success.
 * This class is not an Expo/JS/user-facing API and does not open another owner.
 */
internal object VeilNativePrekeyProofJni {
    /** Exactly frame, classic64, ML-DSA-87 4627; all independent caller copies.
     * Calls the real fixed producer ONCE. Native holds originals/partial/first
     * before any VM failure; never retry this to repair VM or HTTP uncertainty. */
    @JvmStatic external fun produce(source: Long, canonicalFrame: ByteArray, budgetMs: Long): Array<ByteArray>
    /** 0 only for SAME completed proof/frame/window/current. No key dispatch. */
    @JvmStatic external fun current(source: Long, canonicalFrame: ByteArray): Int
    /** Read-only FIRST original nonce reconciliation, including UNKNOWN. Raw
     * YNXPKR1 state1/2/3 are DATA, not produce success or HTTP permission. */
    @JvmStatic external fun retained(source: Long, originalNonce: ByteArray): ByteArray
}
