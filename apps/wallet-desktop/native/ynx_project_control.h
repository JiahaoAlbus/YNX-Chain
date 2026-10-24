#ifndef YNX_PROJECT_CONTROL_CABI_V1_H
#define YNX_PROJECT_CONTROL_CABI_V1_H

#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define YNX_PROJECT_CONTROL_ABI_V1 1u
#define YNX_PROJECT_CONTROL_MEMBER_CAPACITY_V1 98304u
#define YNX_PROJECT_CONTROL_PRINCIPAL_MAX_V1 8192u
#define YNX_PROJECT_CONTROL_COMMAND_MAX_V1 8192u
#define YNX_PROJECT_CONTROL_DECISION_MAX_V1 4096u

typedef struct { const uint8_t *bytes; size_t length; } YNXProjectControlBytesV1;

/* Public context independently selected by Main's original protected
 * Source/current/review path. Matching DATA does not grant any authority.
 * Text spans contain exact UTF-8, no trailing NUL; decimal spans are canonical.
 * Network is raw 32 bytes; owner is 42-byte lowercase 0x hex. */
typedef struct {
    YNXProjectControlBytesV1 network_id;
    YNXProjectControlBytesV1 owner;
    YNXProjectControlBytesV1 key_version;
    YNXProjectControlBytesV1 execution_height;
    YNXProjectControlBytesV1 caller_identity;
    YNXProjectControlBytesV1 source_current_ref;
    YNXProjectControlBytesV1 pk_a;
    YNXProjectControlBytesV1 pk_b;
} YNXProjectControlExpectedV1;

typedef struct {
    uint32_t abi_version;
    size_t struct_size;
    YNXProjectControlBytesV1 principal_original; /* exact existing Go7 JSON */
    YNXProjectControlBytesV1 command_original;   /* exact existing Go15 JSON */
    YNXProjectControlBytesV1 decision_original;  /* exact canonical decision11 */
    YNXProjectControlExpectedV1 expected;
    /* Protected Main clock observation, not decision.issuedAtMs. Main must
     * recheck clock, current, exact capture and once before/after this call. */
    uint64_t observed_at_ms;
    /* Same-process synchronous KEY7 borrow; never IPC/Node/renderer fields.
     * Main alone obtains genuine custody and owns final borrowed-span wipe.
     * No provider, purpose, randomness, algorithm or callback is selectable. */
    YNXProjectControlBytesV1 pkcs8_a; /* exactly 54 */
    YNXProjectControlBytesV1 pkcs8_b; /* exactly 150 */
    YNXProjectControlBytesV1 pk_a;    /* exactly 2592 */
    YNXProjectControlBytesV1 pk_b;    /* exactly 64 */
} YNXProjectControlRequestV1;

enum YNXProjectControlResultV1 {
    YNX_CONTROL_OK_V1 = 0,
    YNX_CONTROL_INVALID_ARGUMENT_V1 = 1,
    YNX_CONTROL_BOUNDS_V1 = 2,
    YNX_CONTROL_OVERLAP_V1 = 3,
    YNX_CONTROL_CAPACITY_V1 = 4,
    YNX_CONTROL_PUBLIC_BINDING_V1 = 5,
    YNX_CONTROL_KEY_MATERIAL_V1 = 6,
    YNX_CONTROL_SIGNING_V1 = 7,
    YNX_CONTROL_OUTPUT_VALIDATION_V1 = 8,
    YNX_CONTROL_CLEANUP_V1 = 9,
    YNX_CONTROL_INTERNAL_V1 = 10
};
enum YNXProjectControlCleanupV1 {
    YNX_CONTROL_CLEANUP_UNKNOWN_V1 = 0,
    YNX_CONTROL_CLEANUP_NOT_REQUIRED_V1 = 1,
    /* Explicit owned copies Clear'ed, imported handle Destroy'ed and batch
     * Discard'ed without cleanup panic. No retained key/handle. This is NOT
     * physical erasure of Go/CIRCL stacks/heaps or borrowed Main material. */
    YNX_CONTROL_CLEANUP_LOGICAL_COMPLETE_V1 = 2,
    YNX_CONTROL_CLEANUP_FAILED_V1 = 3
};

/* Fixed IDE-PROJECT-CONTROL / E13 / N=1,index=0 operation. Only approve/reject
 * decision11 may be signed; cancellation signs nothing. Reject never authorizes
 * an effect. This returns public memberOriginal, not an Auth Source/Root grant.
 * Main retains real current/ACL/custody/review/once/durable UNKNOWN ownership.
 *
 * Caller allocations must be live, sized, aligned and stable throughout the
 * synchronous call. No concurrent input mutation. Arbitrary pointer validity,
 * allocation provenance/size and page permissions cannot be checked here.
 * All three output ranges must be disjoint from each other, request and every
 * input; inputs may overlap each other. Extent overflow/overlap is rejected
 * before writes/private reads. Initialize length=0 and cleanup=UNKNOWN first.
 * Layout failures leave all outputs untouched. Admitted failures set length=0
 * and leave member buffer untouched. Success writes only length bytes after
 * logical cleanup; remaining capacity is untouched. Allocate exactly 98304;
 * no sizing/signing retry. Unknown/failed cleanup releases no signature and
 * must retain Main's once/UNKNOWN record rather than automatically re-sign.
 */
int32_t YNXProjectControlSignV1(YNXProjectControlRequestV1 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);

#ifdef __cplusplus
}
#endif
#endif
