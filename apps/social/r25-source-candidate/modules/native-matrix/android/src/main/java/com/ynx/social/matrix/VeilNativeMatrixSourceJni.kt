package com.ynx.social.matrix

/** Private, same-worker bridge to the ORIGINAL accepted-device/source owner.
 * None of these methods is exported through Expo. Selectors are registry
 * locators, never capabilities. The supplier must check the original native
 * account, device, source, store, restore/revocation and current witnesses.
 *
 * ABI 2 does not create a root, key, grant, peer session or login. acquireOriginal
 * borrows the existing owner; repeated observation must name that same owner.
 * A nonzero acquired handle is published in out[0] BEFORE any fallible callback,
 * including on failure. A zero handle means this read-only borrow acquired no
 * child; it says nothing about other owners or prior business effects.
 * All arrays returned to Kotlin are independent caller-owned copies.
 *
 * Status methods: 0 = checked success, positive = native refusal. Length/count
 * methods: nonnegative result, negative = refusal. Metadata/array getters throw
 * on refusal, never return an empty success or null to hide a missing supplier.
 */
internal object VeilNativeMatrixSourceJni {
    @JvmStatic external fun abiVersion(): Int
    @JvmStatic external fun acquireOriginal(out: LongArray): Int
    @JvmStatic external fun current(source: Long): Int
    // Same SourceSlot/worker only. No endpoint/nonce/policy/key supplied by Java.
    @JvmStatic external fun openOwnDirectoryRead(source: Long): Int
    @JvmStatic external fun readOwnDirectoryData(source: Long): ByteArray
    @JvmStatic external fun closeOwnDirectoryRead(source: Long): Int
    // Read-only custody observation, not current/admission or read permission.
    @JvmStatic external fun ownDirectoryReadCleanupInventory(source: Long, output: LongArray): Int
    /** Same accepted/current device and authenticated held/read-only cold C5
     * canonical own bundle, PUBLIC DATA <=8192 only. Throws on missing/current/
     * revoked/UNKNOWN owner. No prekey publication, consumed-OTK republish,
     * Matrix device mapping, event/Prepared/session or Source authorization. */
    @JvmStatic external fun initialPublicBundle(source: Long): ByteArray
    // Exactly accountViewRef/displayName/publicIdentifier from original custody.
    @JvmStatic external fun identity(source: Long): Array<String>
    // Flattened groups of six: id,title,peerIdentifier,roomId,localSender,remoteSender.
    @JvmStatic external fun routes(source: Long): Array<String>
    // Flattened groups of five: relation id, canonical peerAccountId,
    // displayName, publicIdentifier, actual conversation id or empty.
    @JvmStatic external fun contacts(source: Long): Array<String>
    // Flattened triples: current incoming id, canonical peerAccountId, displayName.
    @JvmStatic external fun invitations(source: Long): Array<String>
    // Own actual protected block entries, pairs peerAccountId/displayName.
    @JvmStatic external fun blockedContacts(source: Long): Array<String>
    // Fresh same held/current signed ContactRelease DATA. Never execution rights.
    // Unavailable/expired Root produces no cached or inferred contact actions.
    @JvmStatic external fun contactActions(source: Long): Array<String>
    // Original courier's HTTPS base and authenticated Matrix sender, not SSO facts.
    /** DATA only, after actual acquire/current. Zero means protected WRITE4
     * commit plus independent READ3 readback; UNKNOWN must never be rewritten. */
    @JvmStatic external fun installCourierRecord(source: Long, utf8Original: ByteArray): Int
    @JvmStatic external fun courierIdentity(source: Long): Array<String>
    @JvmStatic external fun courierToken(source: Long): CharArray
    @JvmStatic external fun retainedWork(source: Long): Long
    /** Pure same-owner inventory, no business current or grant. Fresh zero11:
     * registered, sameThread, active, cUnknown, children, signed C first,
     * root, context, drained, Rust undrained records, Rust uncertainty.
     * Query0 is not disposal; registered+zero children is still a live borrow.
     */
    @JvmStatic external fun cleanupInventory(source: Long, output: LongArray): Int
    // Release this borrow only. Never close/replace accepted-device/session owners.
    @JvmStatic external fun close(source: Long): Int

    /** Same protected product store, no raw SQLite/lease/key export. Namespace
     * 1 = SOCIAL_PRODUCT_STATE, 2 = SOCIAL_PRODUCT_OPERATION; these are NOT the
     * Signal/native record-kind numbers. No other namespace is permitted.
     * Begin retains the original transaction in out[0] before any fallible step.
     * currentRecords checks the already held scope without opening nested SQL.
     * readRecord with output.size==0 returns exact size; 0 is authenticated absence.
     * Within this SAME transaction a copied record must have that exact size.
     * commit returns 0 only after actual durable protected commit/readback.
     * A failed finish is retained; the caller must never issue a second finish.
     */
    @JvmStatic external fun beginRecords(source: Long, operationKind: Int, out: LongArray): Int
    @JvmStatic external fun currentRecords(source: Long, transaction: Long): Int
    @JvmStatic external fun readRecord(source: Long, transaction: Long, namespace: Int,
                                     id: String, output: ByteArray): Long
    @JvmStatic external fun writeRecord(source: Long, transaction: Long, namespace: Int,
                                      id: String, plaintext: ByteArray): Int
    @JvmStatic external fun removeRecord(source: Long, transaction: Long, namespace: Int, id: String): Int
    @JvmStatic external fun recordIds(source: Long, transaction: Long, namespace: Int): Array<String>
    @JvmStatic external fun finishRecords(source: Long, transaction: Long, commit: Boolean): Int

    /** Captures an original; does NOT execute encryption, transmit, approve a
     * contact, or replace a retained request. Existing YNXM frames and normal
     * product command/context JSON are passed unchanged. Native must bind them
     * to the authenticated bilateral route and SAME original actual actor.
     * A retained logical/reference id must resolve to the exact existing
     * original, or refuse; it must never generate another operation on restart.
     * Source acquisition must not require a per-peer MessageOpen session first:
     * sessionRecords below supplies that original to the existing session port.
     */
    @JvmStatic external fun prepareMessage(source: Long, route: String, logicalId: String,
                                         frame: ByteArray, command: ByteArray, context: ByteArray,
                                         out: LongArray): Int
    @JvmStatic external fun prepareIncoming(source: Long, route: String, event: String, logicalId: String,
                                          frame: ByteArray, out: LongArray): Int
    @JvmStatic external fun prepareContact(source: Long, command: ByteArray, context: ByteArray,
                                         out: LongArray): Int
    @JvmStatic external fun originalCurrent(source: Long, original: Long): Int
    @JvmStatic external fun originalReference(source: Long, original: Long): String
    // Exact existing MessageOpen public records, never exported keys/ratchets.
    @JvmStatic external fun sessionRecords(source: Long, original: Long, output: ByteArray): Long
    // 0 pending, 1 committed, 2 aborted, 3 unknown; negative values are refusals.
    @JvmStatic external fun completion(source: Long, original: Long): Int
    /** Read/verify the SAME original native ratchet+output durable receipt and
     * independent committed readback before comparing these existing YNXO1
     * fields. Output bytes alone, HTTP success or a stored Boolean never prove it.
     */
    @JvmStatic external fun requireCommittedOutput(source: Long, original: Long, logicalId: ByteArray,
                                                 direction: Int, kind: Int, body: ByteArray): Int
    @JvmStatic external fun executeContact(source: Long, original: Long): Int
    // Retires only a verified terminal original; failure retains it and first cause.
    @JvmStatic external fun closeOriginal(source: Long, original: Long): Int

    /** Read-only lookup of an actual persisted original, kind 1=message/2=contact.
     * 1 is FINALIZED committed with original retire/close already established;
     * 2 is FINALIZED safe abort permitting a new draft. Pending=0, unknown=3,
     * refusal<0. Verify SAME account/purpose/reference, original signatures and
     * independent durable readback. Never infer it from product JSON, perform
     * acquire/sign/network/retire, or synthesize a replacement original.
     */
    /** Empty bytes prove authenticated absence; any refusal throws. */
    @JvmStatic external fun historicalRecord(source: Long, reference: String): ByteArray
    @JvmStatic external fun observeTerminal(source: Long, reference: String, kind: Int): Int
    /** Read only the SAME selected transaction's actual finish/readback. 1 is
     * committed AND ended, 2 rolled back AND ended, 0 still open, 3 unknown,
     * refusal<0. It must work under the original held transaction scope without
     * nested SQL; no second finish/rollback/cleanup is performed by this query.
     * This is an outcome observation, never a source/device authorization.
     */
    @JvmStatic external fun recordsOutcome(source: Long, transaction: Long): Int
}
