#ifndef YNX_PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_V1_H
#define YNX_PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define YNX_PENDING_ORIGINAL_QUERY_ABI_V1 1u
#define YNX_PENDING_ORIGINAL_QUERY_MEMBER_CAPACITY_V1 98304u
typedef struct { const uint8_t *bytes; size_t length; } YNXPendingOriginalQueryBytesV1;
typedef struct {
    YNXPendingOriginalQueryBytesV1 network_id; /* raw32 */
    YNXPendingOriginalQueryBytesV1 owner; /* canonical lower 0x42 */
    YNXPendingOriginalQueryBytesV1 pk_a; /* original device pair, 2592 */
    YNXPendingOriginalQueryBytesV1 pk_b; /* 64 */
    YNXPendingOriginalQueryBytesV1 actor_digest; /* raw32 original actor */
    YNXPendingOriginalQueryBytesV1 service_origin; /* canonical HTTPS origin */
    YNXPendingOriginalQueryBytesV1 nonce; /* original proof nonce, 32..64 ASCII */
    YNXPendingOriginalQueryBytesV1 issued_at; /* exact ISO milliseconds */
    YNXPendingOriginalQueryBytesV1 expires_at; /* exact ISO milliseconds */
    /* Independently observed original Auth clock/Source bounds, safe uint53
     * milliseconds. These are verification inputs, not self-signed authority. */
    uint64_t at_ms;
    uint64_t source_issued_at_ms;
    uint64_t source_expires_at_ms;
} YNXPendingOriginalQueryExpectedV1;
typedef struct {
    uint32_t abi_version;
    size_t struct_size;
    /* Exact Auth query JSON3: operationId/originalRequestBodyDigest/version. */
    YNXPendingOriginalQueryBytesV1 query_original; /* 1..1024 */
    YNXPendingOriginalQueryBytesV1 registration_original; /* original JSON20 */
    YNXPendingOriginalQueryBytesV1 original_pair_post; /* original UTF8 <=393216 */
    YNXPendingOriginalQueryExpectedV1 expected;
    /* Synchronous Auth custody borrow; no callback, retention or key export. */
    YNXPendingOriginalQueryBytesV1 pkcs8_a; /* 54 */
    YNXPendingOriginalQueryBytesV1 pkcs8_b; /* 150 */
    YNXPendingOriginalQueryBytesV1 pk_a; /* 2592 */
    YNXPendingOriginalQueryBytesV1 pk_b; /* 64 */
} YNXPendingOriginalQueryRequestV1;
enum YNXPendingOriginalQueryResultV1 {
    YNX_PENDING_QUERY_OK_V1=0, YNX_PENDING_QUERY_ARGUMENT_V1=1,
    YNX_PENDING_QUERY_BOUNDS_V1=2, YNX_PENDING_QUERY_OVERLAP_V1=3,
    YNX_PENDING_QUERY_CAPACITY_V1=4, YNX_PENDING_QUERY_PUBLIC_BINDING_V1=5,
    YNX_PENDING_QUERY_KEY_MATERIAL_V1=6, YNX_PENDING_QUERY_SIGNING_V1=7,
    YNX_PENDING_QUERY_OUTPUT_VALIDATION_V1=8, YNX_PENDING_QUERY_CLEANUP_V1=9,
    YNX_PENDING_QUERY_INTERNAL_V1=10
};
enum YNXPendingOriginalQueryCleanupV1 {
    YNX_PENDING_QUERY_CLEANUP_UNKNOWN_V1=0,
    YNX_PENDING_QUERY_CLEANUP_NOT_REQUIRED_V1=1,
    YNX_PENDING_QUERY_CLEANUP_LOGICAL_COMPLETE_V1=2,
    YNX_PENDING_QUERY_CLEANUP_FAILED_V1=3
};
/* Fixed E13 / N1 index0 Member, ML-DSA-87 AND SLH-DSA-SHA2-256f, domain
 * YNX/PRODUCT-PAIR/PENDING-ORIGINAL-QUERY/V1 and purpose
 * product-device-pending-original-query-v1. Only POST
 * /v4/product-pairs/original-query. No sessionBinding or generic raw signer.
 * Original PAIR input is hashed, not transmitted by this callee. No HTTP/DB,
 * reserve, RNG challenge, completion, login, registration, Source, active-session
 * or GET permission is supplied. NOT_FOUND/UNKNOWN cannot authorize re-POST.
 * Original Auth independently verifies service origin, Source/current, clock,
 * actor, registered full pair and exact original operation before and after.
 * Nonce is base64url alphabet 32..64, no '='. UTC millisecond timestamps are
 * exact 24 bytes; 0<expiry-issued<=30000, issued<=at<expiry, with the whole
 * query window inside the original registration AND Source windows. The
 * normal service origin is https://wallet-auth.ynxweb4.com, independently
 * selected by Auth, never inferred from the registration's product origin.
 * Independently selected values may be equal; inequality is not required.
 *
 * Caller allocations must be live/aligned/stable/sized. No arbitrary pointer
 * provenance is verified. All outputs must be disjoint from request, ALL
 * inputs and each other. Public/PKCS8 overlap is rejected before any copy;
 * same-category read-only aliases are allowed. Layout rejection writes nothing.
 * Initialize length=0/cleanup=UNKNOWN. Allocate EXACTLY 98304; no sizing retry.
 * Once entered, retain any bounded public original BEFORE interpreting result
 * or cleanup. Late failed originals are UNKNOWN, never usable proof or retry
 * authority. Only OK plus LOGICAL_COMPLETE qualifies mathematical success.
 * Cleanup means owned Clear/imported Destroy/batch Discard, not physical Go/
 * CIRCL memory erasure. Caller remains responsible for clearing its own borrow.
 */
int32_t YNXProductPairPendingOriginalQuerySignV1(YNXPendingOriginalQueryRequestV1 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length, uint32_t *cleanup_status);
#ifdef __cplusplus
}
#endif
#endif
