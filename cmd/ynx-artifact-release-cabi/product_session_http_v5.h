#ifndef YNX_PRODUCT_SESSION_HTTP_V5_H
#define YNX_PRODUCT_SESSION_HTTP_V5_H
#include <stddef.h>
#include <stdint.h>

#define YNX_PRODUCT_SESSION_HTTP_V5_VERSION 5u
#define YNX_PRODUCT_SESSION_HTTP_V5_MESSAGE_MAX 16384u
#define YNX_PRODUCT_SESSION_HTTP_V5_BODY_MAX 68288512u
#define YNX_PRODUCT_SESSION_HTTP_V5_CONTENT_TYPE_MAX 99u
#define YNX_PRODUCT_SESSION_HTTP_V5_MEMBER_CAPACITY 98304u

typedef struct { const uint8_t *bytes; size_t length; } YNXProductSessionHTTPBytesV5;
typedef struct {
    YNXProductSessionHTTPBytesV5 network_id;
    YNXProductSessionHTTPBytesV5 owner;
    YNXProductSessionHTTPBytesV5 pk_a;
    YNXProductSessionHTTPBytesV5 pk_b;
} YNXProductSessionHTTPExpectedV5;
typedef struct {
    uint32_t version;
    size_t struct_size;
    YNXProductSessionHTTPBytesV5 unsigned_original;
    YNXProductSessionHTTPBytesV5 actual_body;
    YNXProductSessionHTTPBytesV5 actual_content_type;
    YNXProductSessionHTTPExpectedV5 expected;
    YNXProductSessionHTTPBytesV5 pkcs8_a;
    YNXProductSessionHTTPBytesV5 pkcs8_b;
    YNXProductSessionHTTPBytesV5 pk_a;
    YNXProductSessionHTTPBytesV5 pk_b;
} YNXProductSessionHTTPRequestV5;

enum YNXProductSessionHTTPResultV5 {
    YNX_HTTP_V5_OK=0, YNX_HTTP_V5_INVALID_ARGUMENT=1, YNX_HTTP_V5_BOUNDS=2,
    YNX_HTTP_V5_OVERLAP=3, YNX_HTTP_V5_CAPACITY=4, YNX_HTTP_V5_PUBLIC_BINDING=5,
    YNX_HTTP_V5_KEY_MATERIAL=6, YNX_HTTP_V5_SIGNING=7,
    YNX_HTTP_V5_OUTPUT_VALIDATION=8, YNX_HTTP_V5_CLEANUP=9, YNX_HTTP_V5_INTERNAL=10
};
enum YNXProductSessionHTTPCleanupV5 {
    YNX_HTTP_V5_CLEANUP_UNKNOWN=0, YNX_HTTP_V5_CLEANUP_NOT_REQUIRED=1,
    YNX_HTTP_V5_CLEANUP_LOGICAL_COMPLETE=2, YNX_HTTP_V5_CLEANUP_FAILED=3
};

/* Fixed POST /api/v1/ide/deployments; unsigned23 canonical JSON v5; exact
 * multipart/form-data; boundary=[A-Za-z0-9_-]{1,70}. Actual body is the complete
 * final binary HTTP body. Core computes SHA256/SHA3-512/SHA512 from that span,
 * compares the signed DTO and uses original shared E3 inside typed E6 v5.
 * Purpose is PRODUCT-SESSION-HTTP-PROOF, N1/index0, real two-signature AND.
 * Expected identity/full pair must come from the caller's independent original
 * registered device binding. This API does not acquire/approve that authority.
 *
 * All inputs are borrowed, immutable for the synchronous call; only actual
 * lengths are used, with no terminators. Full key sizes: DER54/150, public2592/64.
 * Output capacity must be exactly 98304 (no sizing/sign retry). All outputs must
 * be disjoint from the request, every input, and each other. Inputs may overlap.
 * Layout failure reads no private material and writes no outputs. After valid
 * layout, out_length=0 and cleanup=NOT_REQUIRED until the private phase.
 * An actual bounded public Member is copied BEFORE reporting failure/cleanup.
 * Preserve it and the exact original request on any failure/UNKNOWN; never
 * blindly re-sign. Only OK plus LOGICAL_COMPLETE is a valid mathematical result.
 * No Source/current/session/revoke/clock/once/user-approval/execPermit/HTTP effect
 * is granted. Logical Clear/Destroy/Discard is not OS custody/secure-heap proof.
 * V4 inputs and all other methods/paths are rejected, never downgraded.
 */
#ifdef __cplusplus
extern "C" {
#endif
int32_t YNXProductSessionHTTPProofSignV5(YNXProductSessionHTTPRequestV5 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length, uint32_t *cleanup_status);
#ifdef __cplusplus
}
#endif
#endif
