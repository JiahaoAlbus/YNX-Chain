#ifndef YNX_TRANSACTION_BATCH_CABI_V1_H
#define YNX_TRANSACTION_BATCH_CABI_V1_H

#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define YNX_TRANSACTION_BATCH_ABI_V1 1u
#define YNX_TRANSACTION_BATCH_MEMBER_CAPACITY_V1 98304u
#define YNX_TRANSACTION_BATCH_MESSAGE_MAX_V1 8192u
#define YNX_TRANSACTION_BATCH_POLICY_MAX_V1 8388608u

typedef struct { const uint8_t *bytes; size_t length; } YNXTransactionBytesV1;

/* Public DATA independently selected from Main's original reviewed policy.
 * Raw network32, canonical lowercase 0x owner42, positive canonical decimal
 * key_version/execution_height (no NUL), complete registered PKA2592/PKB64.
 * native_chain_id must equal the canonical execution message's chain ID.
 * Supplying matching DATA is not approval, a Root or a trusted current source. */
typedef struct {
    YNXTransactionBytesV1 network_id;
    YNXTransactionBytesV1 owner;
    uint64_t native_chain_id;
    YNXTransactionBytesV1 key_version;
    YNXTransactionBytesV1 execution_height;
    YNXTransactionBytesV1 pk_a;
    YNXTransactionBytesV1 pk_b;
} YNXTransactionExpectedV1;

typedef struct {
    uint32_t abi_version;
    size_t struct_size;
    /* Existing canonical YNX-NATIVE-TRANSFER/v2, YNX-NATIVE-ACTION/v1 or
     * YNX-ETHEREUM-VALUE/v1 bytes. The last profile permits only the existing
     * bounded simple integer-YNXT transfer; it is not signed Ethereum RLP. */
    YNXTransactionBytesV1 message_original;
    /* Exact original authorization.policy JSON object, without LF. The HTTP
     * projection uses lowercase hex networkId/pkA/pkB and decimal STRING
     * uint64s, not base64 or JSON numbers. All original owner records and the
     * optional revocation stay; no floating-point reconstruction is allowed. */
    YNXTransactionBytesV1 policy_original;
    YNXTransactionExpectedV1 expected;
    /* Synchronous same-process original Auth custody borrow. No secret enters
     * renderer/IPC or is retained/returned. Caller owns its final borrow wipe. */
    YNXTransactionBytesV1 pkcs8_a; /* exactly 54 */
    YNXTransactionBytesV1 pkcs8_b; /* exactly 150 */
    YNXTransactionBytesV1 pk_a;    /* exactly 2592 */
    YNXTransactionBytesV1 pk_b;    /* exactly 64 */
} YNXTransactionBatchRequestV1;

enum YNXTransactionBatchResultV1 {
    YNX_TRANSACTION_OK_V1 = 0,
    YNX_TRANSACTION_INVALID_ARGUMENT_V1 = 1,
    YNX_TRANSACTION_BOUNDS_V1 = 2,
    YNX_TRANSACTION_OVERLAP_V1 = 3,
    YNX_TRANSACTION_CAPACITY_V1 = 4,
    YNX_TRANSACTION_PUBLIC_BINDING_V1 = 5,
    YNX_TRANSACTION_KEY_MATERIAL_V1 = 6,
    YNX_TRANSACTION_SIGNING_V1 = 7,
    YNX_TRANSACTION_OUTPUT_VALIDATION_V1 = 8,
    YNX_TRANSACTION_CLEANUP_V1 = 9,
    YNX_TRANSACTION_INTERNAL_V1 = 10
};
enum YNXTransactionBatchCleanupV1 {
    YNX_TRANSACTION_CLEANUP_UNKNOWN_V1 = 0,
    YNX_TRANSACTION_CLEANUP_NOT_REQUIRED_V1 = 1,
    /* Owned copies Clear, imported key Destroy and batch Discard completed.
     * No physical erasure of Go/CIRCL stacks/heaps or caller borrow is claimed. */
    YNX_TRANSACTION_CLEANUP_LOGICAL_COMPLETE_V1 = 2,
    YNX_TRANSACTION_CLEANUP_FAILED_V1 = 3
};

/* Fixed ML-DSA-87 AND SLH-DSA-SHA2-256f / TX-BATCH / N=1,index=0.
 * Both full registered keys and canonical message bind the exact policy at H;
 * rotation and terminal revocation use the existing account resolver. Main/Auth
 * must authenticate the policy source, recheck current/review/custody/once
 * before/after, retain the original output before late lock/current checks,
 * separately approve broadcast, and preserve UNKNOWN without signing retries.
 * No purpose/provider/randomness/algorithm override, callback, RPC, key export,
 * nonce reservation, execution, BFT finality or authority is provided here.
 *
 * Caller allocations must be live, aligned, correctly sized and immutable
 * throughout the synchronous call; arbitrary pointer validity is not verified.
 * Output buffer/length/cleanup must be mutually disjoint and disjoint from the
 * request and all inputs. Inputs may overlap each other. Initialize length=0
 * and cleanup=UNKNOWN. Layout failures write nothing. Admitted failure sets
 * length=0 and leaves the member buffer untouched. Success copies only length
 * bytes after logical cleanup, leaving remaining capacity untouched. Allocate
 * exactly 98304; no sizing/signing retry. The output is public Member DATA.
 */
int32_t YNXTransactionBatchSignV1(YNXTransactionBatchRequestV1 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);

#ifdef __cplusplus
}
#endif
#endif
