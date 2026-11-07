#ifndef YNX_PRODUCT_SESSION_HTTP_PROOF_CABI_V4_H
#define YNX_PRODUCT_SESSION_HTTP_PROOF_CABI_V4_H

#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define YNX_PRODUCT_SESSION_HTTP_VERSION_V4 4u
#define YNX_PRODUCT_SESSION_HTTP_MESSAGE_MAX_V4 16384u
#define YNX_PRODUCT_SESSION_HTTP_MEMBER_CAPACITY_V4 98304u

typedef struct { const uint8_t *bytes; size_t length; } YNXProductSessionHTTPBytesV4;

/* Public DATA independently selected by the original Auth device owner.
 * network_id is raw32; owner is canonical lowercase 0x42; the two public keys
 * are the COMPLETE separately registered device pair, never an account/BIRTH
 * pair selected by a renderer. Matching bytes do not authenticate that owner. */
typedef struct {
    YNXProductSessionHTTPBytesV4 network_id;
    YNXProductSessionHTTPBytesV4 owner;
    YNXProductSessionHTTPBytesV4 pk_a;
    YNXProductSessionHTTPBytesV4 pk_b;
} YNXProductSessionHTTPExpectedV4;

typedef struct {
    uint32_t version;     /* exactly YNX_PRODUCT_SESSION_HTTP_VERSION_V4 */
    size_t struct_size;   /* exactly sizeof(YNXProductSessionHTTPRequestV4) */
    /* Exact SDK49 canonical unsigned21 JSON bytes, no LF or NUL. This entry
     * builds the EXISTING E5 itself; it never signs caller-selected raw E5,
     * purpose, algorithm, account policy, ledger nonce or execution height. */
    YNXProductSessionHTTPBytesV4 unsigned_original;
    YNXProductSessionHTTPExpectedV4 expected;
    /* Synchronous same-process original Auth custody borrow only. Nothing
     * private crosses JS/IPC, is returned, or is retained after this call. */
    YNXProductSessionHTTPBytesV4 pkcs8_a; /* exactly 54 */
    YNXProductSessionHTTPBytesV4 pkcs8_b; /* exactly 150 */
    YNXProductSessionHTTPBytesV4 pk_a;    /* exactly 2592 */
    YNXProductSessionHTTPBytesV4 pk_b;    /* exactly 64 */
} YNXProductSessionHTTPRequestV4;

enum YNXProductSessionHTTPResultV4 {
    YNX_PRODUCT_SESSION_HTTP_OK_V4 = 0,
    YNX_PRODUCT_SESSION_HTTP_INVALID_ARGUMENT_V4 = 1,
    YNX_PRODUCT_SESSION_HTTP_BOUNDS_V4 = 2,
    YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4 = 3,
    YNX_PRODUCT_SESSION_HTTP_CAPACITY_V4 = 4,
    YNX_PRODUCT_SESSION_HTTP_PUBLIC_BINDING_V4 = 5,
    YNX_PRODUCT_SESSION_HTTP_KEY_MATERIAL_V4 = 6,
    YNX_PRODUCT_SESSION_HTTP_SIGNING_V4 = 7,
    YNX_PRODUCT_SESSION_HTTP_OUTPUT_VALIDATION_V4 = 8,
    YNX_PRODUCT_SESSION_HTTP_CLEANUP_V4 = 9,
    YNX_PRODUCT_SESSION_HTTP_INTERNAL_V4 = 10
};
enum YNXProductSessionHTTPCleanupV4 {
    YNX_PRODUCT_SESSION_HTTP_CLEANUP_UNKNOWN_V4 = 0,
    YNX_PRODUCT_SESSION_HTTP_CLEANUP_NOT_REQUIRED_V4 = 1,
    /* Explicit owned material Clear, imported key Destroy and batch Discard
     * completed. This is NOT physical erasure of Go/CIRCL heaps or the borrow. */
    YNX_PRODUCT_SESSION_HTTP_CLEANUP_LOGICAL_COMPLETE_V4 = 2,
    YNX_PRODUCT_SESSION_HTTP_CLEANUP_FAILED_V4 = 3
};

/* Fixed PRODUCT-SESSION-HTTP-PROOF / E5(version4) / N=1,index=0, empty paths,
 * ML-DSA-87 AND SLH-DSA-SHA2-256f. Output is public Member DATA only. This does
 * not validate an original expected17/context12/registration20/session4 Source,
 * admit a device slot, check current/revoke/scopes/clock, consume durable once,
 * approve HTTP, issue a session, perform network I/O or grant Root authority.
 * The original Auth owner must perform all those checks and independently bind
 * the full request and registered device pair BEFORE private entry and AFTER,
 * retain the bounded original outcome BEFORE interpreting result/cleanup or
 * late/current errors,
 * and preserve its first UNKNOWN without re-signing. No custody callback or
 * caller-selectable path/provider/randomness/purpose is accepted here.
 *
 * Caller allocations must be live, aligned, immutable and correctly sized for
 * the synchronous call. Arbitrary pointer provenance cannot be verified. All
 * output ranges must be mutually disjoint and disjoint from request/ALL input
 * spans. Inputs may overlap each other. Extent/alignment/layout failures write
 * nothing and do not read private bytes. Initialize length=0/cleanup=UNKNOWN.
 * After layout admission the bounded actual public outcome, if any, is copied
 * with its length EVEN WHEN result or cleanup reports failure. No wire means
 * length=0 and member bytes unchanged. Unused capacity is never written. A
 * nonzero result with length>0 is an UNKNOWN original to preserve, NOT a proof
 * of valid signatures, approval, a usable HTTP header or permission to send.
 * Only result=OK AND cleanup=LOGICAL_COMPLETE qualifies mathematical success.
 * First failure result is retained even if cleanup also fails; cleanup reports
 * its separate actual state. Allocate exactly 98304; no sizing call, generic
 * purpose fallback or signing retry. Public outcome retention exports no key.
 */
int32_t YNXProductSessionHTTPProofSignV4(YNXProductSessionHTTPRequestV4 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);

#ifdef __cplusplus
}
#endif
#endif
