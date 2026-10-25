#ifndef YNX_ACCOUNT_INITIAL_CABI_V1_H
#define YNX_ACCOUNT_INITIAL_CABI_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define YNX_ACCOUNT_INITIAL_ABI_V1 1u
#define YNX_ACCOUNT_INITIAL_MEMBER_CAPACITY_V1 98304u
#define YNX_ACCOUNT_INITIAL_MESSAGE_MAX_V1 4096u
#define YNX_ACCOUNT_INITIAL_GENESIS_MAX_V1 67108864u

typedef struct { const uint8_t *bytes; size_t length; } YNXAccountInitialBytesV1;
typedef struct {
    /* Independent protected selection, NOT a pin obtained from genesis_original
     * or the submitted pair. Both hashes are raw32, owner lowercase 0x42. */
    YNXAccountInitialBytesV1 genesis_sha256;
    YNXAccountInitialBytesV1 network_id;
    YNXAccountInitialBytesV1 owner;
    uint64_t native_chain_id;
    /* Exact actual execution H: positive canonical decimal, no trailing NUL.
     * Key version is fixed 1; there is no active-policy or version override. */
    YNXAccountInitialBytesV1 execution_height;
    YNXAccountInitialBytesV1 pk_a;
    YNXAccountInitialBytesV1 pk_b;
} YNXAccountInitialExpectedV1;
typedef struct {
    uint32_t abi_version;
    size_t struct_size;
    /* Existing canonical YNX-ACCOUNT-REGISTRATION/v1 E15, prior0/new1/nonce1,
     * ActivateAt>H. Neither migration envelopes nor normal actions are allowed. */
    YNXAccountInitialBytesV1 message_original;
    /* Exact complete ORIGINAL public Comet Genesis JSON, not just a copied
     * pq_initial_accounts object. Raw-byte SHA must match independent pin. */
    YNXAccountInitialBytesV1 genesis_original;
    YNXAccountInitialExpectedV1 expected;
    /* Same-process synchronous original Auth custody borrow only. No private
     * span belongs in Node/renderer/IPC. Caller owns final borrow clearing. */
    YNXAccountInitialBytesV1 pkcs8_a; /* 54 */
    YNXAccountInitialBytesV1 pkcs8_b; /* 150 */
    YNXAccountInitialBytesV1 pk_a;    /* 2592 */
    YNXAccountInitialBytesV1 pk_b;    /* 64 */
} YNXAccountInitialRequestV1;

enum YNXAccountInitialResultV1 {
    YNX_INITIAL_OK_V1=0, YNX_INITIAL_INVALID_ARGUMENT_V1=1,
    YNX_INITIAL_BOUNDS_V1=2, YNX_INITIAL_OVERLAP_V1=3,
    YNX_INITIAL_CAPACITY_V1=4, YNX_INITIAL_PUBLIC_BINDING_V1=5,
    YNX_INITIAL_KEY_MATERIAL_V1=6, YNX_INITIAL_SIGNING_V1=7,
    YNX_INITIAL_OUTPUT_VALIDATION_V1=8, YNX_INITIAL_CLEANUP_V1=9,
    YNX_INITIAL_INTERNAL_V1=10
};
enum YNXAccountInitialCleanupV1 {
    YNX_INITIAL_CLEANUP_UNKNOWN_V1=0,
    YNX_INITIAL_CLEANUP_NOT_REQUIRED_V1=1,
    /* Owned copies Clear, key Destroy and batch Discard completed. NOT physical
     * erasure of Go/CIRCL stacks/heaps or of the caller's original borrow. */
    YNX_INITIAL_CLEANUP_LOGICAL_COMPLETE_V1=2,
    YNX_INITIAL_CLEANUP_FAILED_V1=3
};

/* Fixed ML-DSA-87 AND SLH-DSA-SHA2-256f / TX-BATCH / N=1,index0, revision1.
 * Only the pinned Genesis allowlist full pair is compared before private import;
 * the existing possession verifier checks both output signatures. This parser
 * does not authenticate the Genesis issuer, validate the complete migration,
 * check occupancy, grant an account/Root, allocate funds, persist or broadcast.
 * Main/Auth must authenticate and approve original Genesis/pin, original keys,
 * exact request/current/once before/after, immediately retain returned Member
 * before late checks, and preserve UNKNOWN without another signing attempt.
 * Node's actual independent bootstrap remains the registration authority.
 *
 * No purpose/provider/randomness/algorithm override, callback or key export.
 * All caller allocations must be live/aligned/sized/stable, with no concurrent
 * mutation. Arbitrary pointer validity is not checked. Output buffer, length and
 * cleanup must be mutually disjoint and disjoint from request and every input;
 * inputs may alias. Initialize length0/cleanupUNKNOWN. Layout rejection writes
 * nothing. Admitted failure length0 leaves member buffer untouched. Success
 * copies only length bytes after logical cleanup, leaving unused capacity
 * untouched. Allocate exactly98304; no sizing/signing retry. Only public DATA
 * is returned, no secret/handle, authority or finality assertion.
 */
int32_t YNXAccountInitialSignV1(YNXAccountInitialRequestV1 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);
#ifdef __cplusplus
}
#endif
#endif
