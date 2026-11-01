#ifndef YNX_ACCOUNT_MIGRATION_CABI_V1_H
#define YNX_ACCOUNT_MIGRATION_CABI_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define YNX_ACCOUNT_MIGRATION_ABI_V1 1u
#define YNX_ACCOUNT_MIGRATION_WHOLE_CAPACITY_V1 98304u
#define YNX_ACCOUNT_MIGRATION_MESSAGE_MAX_V1 4096u
#define YNX_ACCOUNT_MIGRATION_POLICY_MAX_V1 8388608u
#define YNX_ACCOUNT_MIGRATION_CURRENT_PROOF_MAX_V1 131072u

typedef struct { const uint8_t *bytes; size_t length; } YNXAccountMigrationBytesV1;
typedef struct {
    /* Independently selected original network raw32 and canonical 0x42 owner.
     * This does not authenticate an RPC source or an approval on its own. */
    YNXAccountMigrationBytesV1 network_id;
    YNXAccountMigrationBytesV1 owner;
    /* Canonical uint64 decimal text, no trailing NUL. Nonce may be "0";
     * new_revision and execution_height must be positive. */
    YNXAccountMigrationBytesV1 new_revision;
    YNXAccountMigrationBytesV1 current_nonce;
    YNXAccountMigrationBytesV1 execution_height;
    /* Proposed full pair, not the current pair. */
    YNXAccountMigrationBytesV1 pk_a;
    YNXAccountMigrationBytesV1 pk_b;
} YNXAccountMigrationExpectedV1;
typedef struct {
    uint32_t abi_version;
    size_t struct_size;
    /* Exact canonical YNX-ACCOUNT-REGISTRATION/v1 E15 intent. */
    YNXAccountMigrationBytesV1 message_original;
    /* Complete canonical existing owner WalletPolicyProjection DATA. */
    YNXAccountMigrationBytesV1 policy_original;
    /* Before first PQ activation: compressed secp256k1 key + canonical low-S
     * DER over SHA256(full intent), with current_pq_proof empty. After first
     * activation: BOTH classic spans empty; current_pq_proof must authorize
     * this same intent with the CURRENT full pair/ACCOUNT-MIGRATION purpose.
     * Empty spans read no address. Terminal revocation/pending rotation fail. */
    YNXAccountMigrationBytesV1 classic_public_key;
    YNXAccountMigrationBytesV1 classic_signature;
    YNXAccountMigrationBytesV1 current_pq_proof;
    YNXAccountMigrationExpectedV1 expected;
    /* Synchronous original Auth custody borrow of the PROPOSED pair only.
     * No private span belongs in Node/renderer/IPC. Caller clears its borrow. */
    YNXAccountMigrationBytesV1 pkcs8_a; /* 54 */
    YNXAccountMigrationBytesV1 pkcs8_b; /* 150 */
    YNXAccountMigrationBytesV1 pk_a;    /* 2592 */
    YNXAccountMigrationBytesV1 pk_b;    /* 64 */
} YNXAccountMigrationRequestV1;

enum YNXAccountMigrationResultV1 {
    YNX_MIGRATION_OK_V1=0, YNX_MIGRATION_INVALID_ARGUMENT_V1=1,
    YNX_MIGRATION_BOUNDS_V1=2, YNX_MIGRATION_OVERLAP_V1=3,
    YNX_MIGRATION_CAPACITY_V1=4, YNX_MIGRATION_PUBLIC_BINDING_V1=5,
    YNX_MIGRATION_KEY_MATERIAL_V1=6, YNX_MIGRATION_SIGNING_V1=7,
    YNX_MIGRATION_OUTPUT_VALIDATION_V1=8, YNX_MIGRATION_CLEANUP_V1=9,
    YNX_MIGRATION_INTERNAL_V1=10
};
enum YNXAccountMigrationCleanupV1 {
    YNX_MIGRATION_CLEANUP_UNKNOWN_V1=0,
    YNX_MIGRATION_CLEANUP_NOT_REQUIRED_V1=1,
    /* Known owned copies Clear, key Destroy and batch Discard completed.
     * Not physical erasure of Go/CIRCL heaps/stacks or caller's borrow. */
    YNX_MIGRATION_CLEANUP_LOGICAL_COMPLETE_V1=2,
    YNX_MIGRATION_CLEANUP_FAILED_V1=3
};

/* Fixed ML-DSA-87 AND SLH-DSA-SHA2-256f, ACCOUNT-MIGRATION, N=1 WholeWire.
 * First verify complete policy/intent/network/owner/revision/currentNonce+1,
 * ActivateAt>actualH and CURRENT lawful classic/PQ authority before importing
 * the new private pair. After signing, original AdmitMigration re-verifies
 * CURRENT authority and BOTH proposed signatures. No state is committed.
 *
 * Return only newKeyWholeProof to the existing reviewed migration transport
 * assembler/journal. This is neither a TX-BATCH/INITIAL substitute, a current
 * pair signer, account/Root grant, fee/nonce reservation, broadcast nor finality.
 * Main/Auth retains authentic current Source, explicit original review/approval,
 * custody and once checks before/after, immediately captures the original result
 * before late checks, and preserves UNKNOWN without another signing attempt.
 * Native chain identity is already bound by the original raw genesis hash in
 * the unchanged RegistrationIntent; this API invents no unsigned chain override.
 *
 * No purpose/provider/randomness/algorithm override, callback, key export or
 * generic raw-sign interface. Live stable/aligned/sized caller allocations and
 * no concurrent mutation are required; arbitrary pointer validity is not proved.
 * Output buffer/length/cleanup must be mutually disjoint and disjoint from the
 * request and every nonempty input. Public inputs may alias one another; the
 * two PKCS8 private spans may alias one another. No nonempty public input may
 * overlap either PKCS8 span, even partially: reject before any public copy,
 * string conversion, private read or output write. Empty spans read no address.
 * Initialize length0 and cleanupUNKNOWN. Layout rejection writes nothing.
 * Admitted failure length0
 * leaves buffer untouched. Success copies only length bytes after cleanup and
 * leaves unused capacity untouched. Allocate exactly98304; no sizing/sign retry.
 */
int32_t YNXAccountMigrationPossessionSignV1(YNXAccountMigrationRequestV1 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);
#ifdef __cplusplus
}
#endif
#endif
