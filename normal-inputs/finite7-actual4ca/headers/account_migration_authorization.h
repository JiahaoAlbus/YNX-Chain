#ifndef YNX_ACCOUNT_MIGRATION_AUTHORIZATION_CABI_V1_H
#define YNX_ACCOUNT_MIGRATION_AUTHORIZATION_CABI_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define YNX_ACCOUNT_MIGRATION_AUTHORIZATION_ABI_V1 1u
#define YNX_ACCOUNT_MIGRATION_AUTHORIZATION_MEMBER_CAPACITY_V1 98304u
typedef struct { const uint8_t *bytes; size_t length; } YNXAccountMigrationAuthorizationBytesV1;
typedef struct {
    YNXAccountMigrationAuthorizationBytesV1 network_id; /* original raw32 */
    YNXAccountMigrationAuthorizationBytesV1 owner; /* canonical 0x42 */
    /* Canonical decimal uint64, no NUL. Current revision/H positive; current
     * nonce is the real ledger nonce, not an Auth approval/session counter. */
    YNXAccountMigrationAuthorizationBytesV1 current_revision;
    YNXAccountMigrationAuthorizationBytesV1 current_nonce;
    YNXAccountMigrationAuthorizationBytesV1 execution_height;
    YNXAccountMigrationAuthorizationBytesV1 current_pk_a; /* 2592 */
    YNXAccountMigrationAuthorizationBytesV1 current_pk_b; /* 64 */
} YNXAccountMigrationAuthorizationExpectedV1;
typedef struct {
    uint32_t abi_version;
    size_t struct_size;
    /* Complete canonical existing RegistrationIntent E15, <=4096 bytes. Its
     * proposed pair/revisions/nonce/ActivateAt are signed without substitution. */
    YNXAccountMigrationAuthorizationBytesV1 message_original;
    /* Complete canonical owner WalletPolicyProjection, <=8388608 bytes. */
    YNXAccountMigrationAuthorizationBytesV1 policy_original;
    YNXAccountMigrationAuthorizationExpectedV1 expected;
    /* Original synchronous Auth custody borrow of CURRENT pair only. No
     * private bytes in Node/renderer/IPC; caller clears its own borrow. */
    YNXAccountMigrationAuthorizationBytesV1 pkcs8_a; /* 54 */
    YNXAccountMigrationAuthorizationBytesV1 pkcs8_b; /* 150 */
    YNXAccountMigrationAuthorizationBytesV1 pk_a; /* 2592 */
    YNXAccountMigrationAuthorizationBytesV1 pk_b; /* 64 */
} YNXAccountMigrationAuthorizationRequestV1;

enum YNXAccountMigrationAuthorizationResultV1 {
    YNX_MIGRATION_AUTH_OK_V1=0, YNX_MIGRATION_AUTH_ARGUMENT_V1=1,
    YNX_MIGRATION_AUTH_BOUNDS_V1=2, YNX_MIGRATION_AUTH_OVERLAP_V1=3,
    YNX_MIGRATION_AUTH_CAPACITY_V1=4, YNX_MIGRATION_AUTH_PUBLIC_BINDING_V1=5,
    YNX_MIGRATION_AUTH_KEY_MATERIAL_V1=6, YNX_MIGRATION_AUTH_SIGNING_V1=7,
    YNX_MIGRATION_AUTH_OUTPUT_VALIDATION_V1=8, YNX_MIGRATION_AUTH_CLEANUP_V1=9,
    YNX_MIGRATION_AUTH_INTERNAL_V1=10
};
enum YNXAccountMigrationAuthorizationCleanupV1 {
    YNX_MIGRATION_AUTH_CLEANUP_UNKNOWN_V1=0,
    YNX_MIGRATION_AUTH_CLEANUP_NOT_REQUIRED_V1=1,
    YNX_MIGRATION_AUTH_CLEANUP_LOGICAL_COMPLETE_V1=2,
    YNX_MIGRATION_AUTH_CLEANUP_FAILED_V1=3
};

/* Fixed ML-DSA-87 AND SLH-DSA-SHA2-256f / ACCOUNT-MIGRATION / N=1,index0
 * MemberWire CURRENT authorization only. No classic fallback, proposed-pair
 * authorization, TX/INITIAL/raw-purpose selector, callback or private export.
 * Original network/intent/revision/currentNonce+1/ActivateAt>H/pending/revoked
 * checks and exact current full-pair policy match precede all private reads.
 * Original ValidateMigrationAuthorization verifies both returned signatures.
 * The new pair's independent Whole possession and original atomic node fee/
 * nonce/policy commit are STILL required. This API neither admits nor submits.
 *
 * Main/Auth must authenticate independently selected Source/policy/network/
 * owner/H/nonce/current pair, explicitly approve this exact intent, and retain
 * separate review/custody/current/once guards before/after. Capture returned
 * Member and firstCause/cleanup debt before late checks; UNKNOWN never permits
 * re-signing. No authority, funds, installation or finality is asserted.
 *
 * Live aligned/stable/sized allocations, no concurrent mutation are caller
 * preconditions. Outputs are disjoint from request, all inputs and each other.
 * Public/public and private/private aliasing is allowed; public/PKCS8 overlap
 * is rejected BEFORE any copy/private read/output write. Layout errors write
 * nothing. Initialize out_length=0/cleanup=UNKNOWN. Admitted failures expose no
 * bytes and length0; success writes only length bytes after logical cleanup.
 * Logical Clear/Destroy/Discard is not physical provider/heap/stack erasure.
 * Allocate exactly98304, no sizing/signing retry. No key/handle is retained.
 */
int32_t YNXAccountMigrationAuthorizationSignV1(
    YNXAccountMigrationAuthorizationRequestV1 *request, uint8_t *caller_buffer,
    size_t capacity, size_t *out_length, uint32_t *cleanup_status);
#ifdef __cplusplus
}
#endif
#endif
