#ifndef YNX_PRODUCT_DEVICE_CHALLENGE_CABI_V4_H
#define YNX_PRODUCT_DEVICE_CHALLENGE_CABI_V4_H

#include "product_device_registration_v4.h"

typedef struct {
    uint32_t version;
    size_t struct_size;
    YNXProductDeviceBytesV4 registration_original; /* exact canonical JSON20 */
    YNXProductDeviceBytesV4 challenge_original;    /* exact canonical challenge */
    YNXProductDeviceExpectedV4 expected;          /* independent DEVICE pair */
    YNXProductDeviceBytesV4 pkcs8_a;
    YNXProductDeviceBytesV4 pkcs8_b;
    YNXProductDeviceBytesV4 pk_a;
    YNXProductDeviceBytesV4 pk_b;
} YNXProductSessionDeviceChallengeRequestV4;

/* Same fixed bounds, private borrow, EACH-call-once/partial/cleanup and output
 * contract as product_device_registration_v4.h. This separate export constructs
 * ONLY E5(YNX-PRODUCT-SESSION-DEVICE-CHALLENGE/v4,BE32(4),network,owner,
 * canonicalJSON({challenge:c,registration:r})) under the fixed purpose
 * PRODUCT-SESSION-DEVICE-CHALLENGE. It validates both exact typed originals,
 * matching registration ID/revision/digest/device/product tuple, checksummed
 * account owner, distinct typed ACCOUNT authorization data, all structural time
 * relations, expected full DEVICE pair and real full-AND N1 output. It does not
 * authenticate a server-issued challenge, ACCOUNT approval or live Source;
 * Auth MUST check those and current real time/once before and after this call.
 * The challenge's accountAuthorization pair is not the signing DEVICE pair.
 * Caller packages the original challenge and canonical base64url Member as
 * exact {challenge,deviceMember}; this function returns only original Member
 * bytes and never claims completion, a session or permission to submit it.
 */
#ifdef __cplusplus
extern "C" {
#endif
int32_t YNXProductSessionDeviceChallengeSignV4(
    YNXProductSessionDeviceChallengeRequestV4 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);
#ifdef __cplusplus
}
#define YNX_PDC_STATIC_ASSERT static_assert
#else
#define YNX_PDC_STATIC_ASSERT _Static_assert
#endif
YNX_PDC_STATIC_ASSERT(sizeof(YNXProductSessionDeviceChallengeRequestV4) == 176, "challenge176");
YNX_PDC_STATIC_ASSERT(offsetof(YNXProductSessionDeviceChallengeRequestV4, registration_original) == 16, "registration16");
YNX_PDC_STATIC_ASSERT(offsetof(YNXProductSessionDeviceChallengeRequestV4, challenge_original) == 32, "challenge32");
YNX_PDC_STATIC_ASSERT(offsetof(YNXProductSessionDeviceChallengeRequestV4, expected) == 48, "expected48");
YNX_PDC_STATIC_ASSERT(offsetof(YNXProductSessionDeviceChallengeRequestV4, pkcs8_a) == 112, "private112");
#undef YNX_PDC_STATIC_ASSERT
#endif
