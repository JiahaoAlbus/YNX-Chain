#ifndef YNX_PRODUCT_DEVICE_REGISTRATION_CABI_V4_H
#define YNX_PRODUCT_DEVICE_REGISTRATION_CABI_V4_H

#include <stddef.h>
#include <stdint.h>

#define YNX_PRODUCT_DEVICE_VERSION_V4 4u
#define YNX_PRODUCT_DEVICE_ORIGINAL_MAX_V4 16384u
#define YNX_PRODUCT_DEVICE_MESSAGE_MAX_V4 16384u
#define YNX_PRODUCT_DEVICE_MEMBER_CAPACITY_V4 98304u

typedef struct { const uint8_t *bytes; size_t length; } YNXProductDeviceBytesV4;
typedef struct {
    YNXProductDeviceBytesV4 network_id; /* raw32 */
    YNXProductDeviceBytesV4 owner;      /* canonical lowercase 0x42 */
    YNXProductDeviceBytesV4 pk_a;       /* complete DEVICE ML-DSA-87 public2592 */
    YNXProductDeviceBytesV4 pk_b;       /* complete DEVICE SLH-DSA public64 */
} YNXProductDeviceExpectedV4;

typedef struct {
    uint32_t version;
    size_t struct_size;
    /* Original exact canonical UTF8 JSON20 from the sole SDK. The callee
     * validates all fields/nulls and constructs the fixed E5 itself. */
    YNXProductDeviceBytesV4 registration_original;
    YNXProductDeviceExpectedV4 expected;
    /* Original Auth Native synchronous custody borrow only; never JS/IPC.
     * These are the DEVICE pair, never an ACCOUNT approval/recovery pair. */
    YNXProductDeviceBytesV4 pkcs8_a; /* exact54 */
    YNXProductDeviceBytesV4 pkcs8_b; /* exact150 */
    YNXProductDeviceBytesV4 pk_a;    /* exact2592 */
    YNXProductDeviceBytesV4 pk_b;    /* exact64 */
} YNXProductSessionDeviceRegistrationRequestV4;

enum YNXProductDeviceResultV4 {
    YNX_PRODUCT_DEVICE_OK_V4 = 0,
    YNX_PRODUCT_DEVICE_INVALID_ARGUMENT_V4 = 1,
    YNX_PRODUCT_DEVICE_BOUNDS_V4 = 2,
    YNX_PRODUCT_DEVICE_OVERLAP_V4 = 3,
    YNX_PRODUCT_DEVICE_CAPACITY_V4 = 4,
    YNX_PRODUCT_DEVICE_PUBLIC_BINDING_V4 = 5,
    YNX_PRODUCT_DEVICE_KEY_MATERIAL_V4 = 6,
    YNX_PRODUCT_DEVICE_SIGNING_V4 = 7,
    YNX_PRODUCT_DEVICE_OUTPUT_VALIDATION_V4 = 8,
    YNX_PRODUCT_DEVICE_CLEANUP_V4 = 9,
    YNX_PRODUCT_DEVICE_INTERNAL_V4 = 10
};
enum YNXProductDeviceCleanupV4 {
    YNX_PRODUCT_DEVICE_CLEANUP_UNKNOWN_V4 = 0,
    YNX_PRODUCT_DEVICE_CLEANUP_NOT_REQUIRED_V4 = 1,
    YNX_PRODUCT_DEVICE_CLEANUP_LOGICAL_COMPLETE_V4 = 2,
    YNX_PRODUCT_DEVICE_CLEANUP_FAILED_V4 = 3
};

/* Fixed purpose PRODUCT-SESSION-DEVICE-REGISTRATION, fixed E5 domain
 * YNX-PRODUCT-SESSION-DEVICE-REGISTRATION/v4; N1/index0/empty BOTH paths,
 * ML-DSA-87+SHA3-512 AND SLH-DSA-SHA2-256f+SHA-512. Validates original20,
 * exact expected network/owner/full DEVICE pair and imported borrowed pair,
 * constructs its own message, and independently verifies BOTH signatures.
 * Result is public device proof-of-possession DATA. It is NOT account approval,
 * pairing/activation, a registered/current device, Root/Source admission,
 * permission, issuance, HTTP authorization, recovery, custody or durable once.
 * No key generation, randomness/provider/purpose/raw-message input, file,
 * network, management domain, callback or retained key/handle is accepted.
 *
 * EACH invocation reaches BatchSign at most once, with no retry. The callee
 * cannot prove cross-call/restart once. Original Auth Native MUST select the
 * protected device slot, validate original registration/current/revocation/
 * real clock/expiry and visible approval before AND after private entry, begin
 * its existing durable once token BEFORE entry, and retain the original public
 * outcome BEFORE interpreting rc/cleanup or a later policy/clock error. A
 * failure, UNKNOWN or cleanup failure never permits signing again. Account
 * full-AND approval remains a different fixed domain and a different pair.
 *
 * Caller owns aligned/live/immutable synchronous allocations. Arbitrary pointer
 * provenance, allocation bounds or lifetime cannot be authenticated. Nonempty
 * inputs require nonnull nonoverflowing ranges. Inputs may overlap each other;
 * buffer/length/cleanup outputs must be mutually disjoint and disjoint from
 * request and EVERY public/private input. Layout/extent/alignment failure writes
 * NOTHING and reads no private bytes. Initialize out_length=0/cleanup=UNKNOWN.
 * On admitted layout, initialize length0/cleanupNOT_REQUIRED before preflight.
 * Allocate exactly98304, with no sizing call or capacity fallback.
 *
 * An actual bounded encoded Member, if produced, is copied with its actual
 * length EVEN on postcondition/cleanup/panic failure. No wire leaves length0
 * and buffer unchanged; unused buffer capacity is untouched. Public partial
 * output is retained UNKNOWN, NOT a valid proof or permission to send. Preserve
 * the first failure code; cleanup separately reports all owned Clear/Destroy/
 * Discard attempts. LOGICAL_COMPLETE is not physical erasure of Go/CIRCL heaps
 * or the caller borrow. Only rcOK+cleanupLOGICAL_COMPLETE qualifies math success.
 */
#ifdef __cplusplus
extern "C" {
#endif
int32_t YNXProductSessionDeviceRegistrationSignV4(
    YNXProductSessionDeviceRegistrationRequestV4 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);
#ifdef __cplusplus
}
#define YNX_PD_STATIC_ASSERT static_assert
#else
#define YNX_PD_STATIC_ASSERT _Static_assert
#endif
YNX_PD_STATIC_ASSERT(sizeof(void *) == 8, "64-bit ABI only");
YNX_PD_STATIC_ASSERT(sizeof(YNXProductDeviceBytesV4) == 16, "span16");
YNX_PD_STATIC_ASSERT(sizeof(YNXProductDeviceExpectedV4) == 64, "expected64");
YNX_PD_STATIC_ASSERT(sizeof(YNXProductSessionDeviceRegistrationRequestV4) == 160, "registration160");
YNX_PD_STATIC_ASSERT(offsetof(YNXProductSessionDeviceRegistrationRequestV4, registration_original) == 16, "registration16");
YNX_PD_STATIC_ASSERT(offsetof(YNXProductSessionDeviceRegistrationRequestV4, expected) == 32, "expected32");
YNX_PD_STATIC_ASSERT(offsetof(YNXProductSessionDeviceRegistrationRequestV4, pkcs8_a) == 96, "private96");
#undef YNX_PD_STATIC_ASSERT
#endif
