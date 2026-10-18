#ifndef YNX_MESSAGE_PLATFORM_OWNER_H
#define YNX_MESSAGE_PLATFORM_OWNER_H
/* Private original facts, not a capability, trust root or enrolled provider. */
#include "linux/ynx_tpm2_esys_owner.h"
typedef struct { const uint8_t *raw; size_t size; } ynx_message_bytes;
typedef struct {
 ynx_message_bytes object_public,salt_public,ak_public,counter_public;
 ynx_message_bytes object_policy,counter_policy,pcr_selection,pcr_digest;
 const ynx_tpm2_resource_selection *original;
} ynx_message_enrollment_public_input;
/* Full original MU decode/roundtrip/name/attribute checks. OK means only public
 * area consistency, never admission, hardware possession or independent floor.
 * No output owner and no resource/crypto command is dispatched here. */
int ynx_message_enrollment_validate_public(const ynx_message_enrollment_public_input *);
typedef struct {
 const ynx_message_enrollment_public_input *enrollment;
 ynx_message_bytes quote,quote_signature,nv_certification,nv_signature;
 const TPM2B_DATA *original_qualifying_data;
 uint64_t independently_expected_counter;
} ynx_message_attestation_input;
/* Independently check original signed TPMS_ATTEST, not an ESAPI success status.
 * Public mathematical verification does not establish an accepted domain/floor
 * or retirement. The expected floor must be held by the genuine provider. */
int ynx_message_enrollment_verify_attestations(const ynx_message_attestation_input *);
#endif
