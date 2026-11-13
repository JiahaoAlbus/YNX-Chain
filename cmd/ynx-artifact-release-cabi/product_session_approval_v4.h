#ifndef YNX_PRODUCT_SESSION_APPROVAL_CABI_V4_H
#define YNX_PRODUCT_SESSION_APPROVAL_CABI_V4_H
#include <stddef.h>
#include <stdint.h>
#define YNX_PRODUCT_SESSION_APPROVAL_VERSION_V4 4u
#define YNX_PRODUCT_SESSION_APPROVAL_E5_MAX_V4 16384u
#define YNX_PRODUCT_SESSION_APPROVAL_MEMBER_CAPACITY_V4 98304u

typedef struct { const uint8_t *bytes; size_t length; } YNXProductSessionApprovalBytesV4;
typedef struct {
    YNXProductSessionApprovalBytesV4 network_id; /* raw32 */
    YNXProductSessionApprovalBytesV4 owner;      /* canonical lowercase 0x42 */
    YNXProductSessionApprovalBytesV4 pk_a;       /* ACCOUNT ML-DSA-87 public2592 */
    YNXProductSessionApprovalBytesV4 pk_b;       /* ACCOUNT SLH-SHA2-256f public64 */
    YNXProductSessionApprovalBytesV4 key_revision; /* canonical positive decimal uint64 */
} YNXProductSessionApprovalExpectedV4;
typedef struct {
    uint32_t version;
    size_t struct_size;
    /* Sole SDK fixed E5: exact domain, BE32(4), network32, owner42,
     * canonical JSON {approval:unsigned,request:request}. The callee strictly
     * parses/reconstructs that typed body; this is NOT arbitrary message input. */
    YNXProductSessionApprovalBytesV4 e5_original;
    YNXProductSessionApprovalExpectedV4 expected;
    /* Protected same-account synchronous borrow. Never DEVICE or TX custody. */
    YNXProductSessionApprovalBytesV4 pkcs8_a; /* canonical seed DER54 */
    YNXProductSessionApprovalBytesV4 pkcs8_b; /* canonical raw DER150 */
    YNXProductSessionApprovalBytesV4 pk_a;    /* full supplied ACCOUNT public2592 */
    YNXProductSessionApprovalBytesV4 pk_b;    /* full supplied ACCOUNT public64 */
} YNXProductSessionApprovalRequestV4;

enum YNXProductSessionApprovalResultV4 {
    YNX_PRODUCT_SESSION_APPROVAL_OK_V4 = 0,
    YNX_PRODUCT_SESSION_APPROVAL_INVALID_ARGUMENT_V4 = 1,
    YNX_PRODUCT_SESSION_APPROVAL_BOUNDS_V4 = 2,
    YNX_PRODUCT_SESSION_APPROVAL_OVERLAP_V4 = 3,
    YNX_PRODUCT_SESSION_APPROVAL_CAPACITY_V4 = 4,
    YNX_PRODUCT_SESSION_APPROVAL_PUBLIC_BINDING_V4 = 5,
    YNX_PRODUCT_SESSION_APPROVAL_KEY_MATERIAL_V4 = 6,
    YNX_PRODUCT_SESSION_APPROVAL_SIGNING_V4 = 7,
    YNX_PRODUCT_SESSION_APPROVAL_OUTPUT_VALIDATION_V4 = 8,
    YNX_PRODUCT_SESSION_APPROVAL_CLEANUP_V4 = 9,
    YNX_PRODUCT_SESSION_APPROVAL_INTERNAL_V4 = 10
};
enum YNXProductSessionApprovalCleanupV4 {
    YNX_PRODUCT_SESSION_APPROVAL_CLEANUP_UNKNOWN_V4 = 0,
    YNX_PRODUCT_SESSION_APPROVAL_CLEANUP_NOT_REQUIRED_V4 = 1,
    YNX_PRODUCT_SESSION_APPROVAL_CLEANUP_LOGICAL_COMPLETE_V4 = 2,
    YNX_PRODUCT_SESSION_APPROVAL_CLEANUP_FAILED_V4 = 3
};

/* Fixed PRODUCT-SESSION-APPROVAL / YNX-PRODUCT-SESSION-APPROVAL/v4, N=1,
 * index=0, empty BOTH paths. Full ML-DSA-87+SHA3-512 AND SLH-DSA-SHA2-256f+
 * SHA-512. Validates E5/closed canonical request+unsigned approval, request
 * digest, request/approval binding, account alias, complete expected ACCOUNT
 * pair and revision. Import recomputes both public keys and complete SLH root.
 * Independently verifies the resulting typed Member and BOTH signatures.
 *
 * This detached primitive is mathematics only. Expected DATA does NOT prove
 * policy registration/current, Root/Source/device admission, registry scopes,
 * actual clock, review, permission, custody or durable once. Original Wallet/
 * Auth must authenticate its held typed plan, same-account backup binding,
 * request/registration/policy/current, original window and real approval before
 * and after entry; acknowledge durable ENTERED and claim once before key loan.
 * No acquisition fallback, generic purpose/provider, TX/DEVICE fallback,
 * clock sampling, network or retained handle. At most ONE BatchSign per call;
 * any failure/UNKNOWN/late failure forbids automatic retry or a new attempt.
 *
 * All memory is live/aligned/immutable for this synchronous call. The callee
 * cannot authenticate arbitrary pointer provenance or actual allocation size.
 * Nonempty ranges must be nonnull and nonoverflowing. Outputs must be mutually
 * disjoint and disjoint from request and every input. Private DER ranges must
 * be disjoint from request and all public input ranges. Disjoint subranges of
 * the SAME allocation are valid; public-public and private-private aliases are
 * allowed. Layout rejection writes NOTHING and reads no private bytes.
 * Initialize length0/cleanupUNKNOWN. Accepted layout initializes
 * length0/cleanupNOT_REQUIRED; exact capacity98304, no sizing/retry call.
 *
 * Retain/adopt the actual bounded public Member and length BEFORE interpreting
 * result or cleanup, including a late postcondition/panic/cleanup failure. No
 * produced Member means length0 and unchanged buffer; unused tail unchanged.
 * Original first failure wins; cleanup is independently reported. Clear of
 * owned buffers, imported key Destroy and batch Discard all run on success or
 * failure. LOGICAL_COMPLETE does NOT guarantee physical Go/CIRCL erasure or
 * clear the caller borrow. Native owns its decoder/loan wipe and physical debt.
 * Only OK + LOGICAL_COMPLETE is mathematical success, never permission to send.
 */
#ifdef __cplusplus
extern "C" {
#endif
int32_t YNXProductSessionApprovalSignV4(
    YNXProductSessionApprovalRequestV4 *request, uint8_t *caller_buffer,
    size_t capacity, size_t *out_length, uint32_t *cleanup_status);
#ifdef __cplusplus
}
#define YNX_PSA_STATIC_ASSERT static_assert
#else
#define YNX_PSA_STATIC_ASSERT _Static_assert
#endif
YNX_PSA_STATIC_ASSERT(sizeof(void *) == 8, "64-bit ABI only");
YNX_PSA_STATIC_ASSERT(sizeof(YNXProductSessionApprovalBytesV4) == 16, "span16");
YNX_PSA_STATIC_ASSERT(sizeof(YNXProductSessionApprovalExpectedV4) == 80, "expected80");
YNX_PSA_STATIC_ASSERT(sizeof(YNXProductSessionApprovalRequestV4) == 176, "request176");
YNX_PSA_STATIC_ASSERT(offsetof(YNXProductSessionApprovalRequestV4, e5_original) == 16, "e5offset16");
YNX_PSA_STATIC_ASSERT(offsetof(YNXProductSessionApprovalRequestV4, expected) == 32, "expectedOffset32");
YNX_PSA_STATIC_ASSERT(offsetof(YNXProductSessionApprovalRequestV4, pkcs8_a) == 112, "privateOffset112");
#undef YNX_PSA_STATIC_ASSERT
#endif
