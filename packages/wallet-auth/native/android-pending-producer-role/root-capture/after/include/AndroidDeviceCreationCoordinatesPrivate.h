#ifndef YNX_AUTH_ANDROID_DEVICE_CREATION_COORDINATES_PRIVATE_V1_H
#define YNX_AUTH_ANDROID_DEVICE_CREATION_COORDINATES_PRIVATE_V1_H
#include "AndroidDeviceProvisioningPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Public comparison DATA copied from SAME original provisioning kind1 Source
 * and SAME already-verified immutable intent. This is NOT a creation grant,
 * Source installer, Core invocation or a choice of generation/account. */
typedef struct {
 uint32_t version,size;
 ynx_auth_android_provision_bytes_v1 device_generation,canonical_owner;
} ynx_auth_android_device_creation_coordinates_v1;
#define YNX_AUTH_ANDROID_CREATION_COORDINATES_BYTES_MAX_V1 256u
/* device_generation is the intent's original DEVICE generation, NOT Source
 * qualification generation, peer generation or a default. canonical_owner is
 * the intent's original canonical 0x owner, NOT a cast of an ynx account.
 * Source current before/after, exact same intent snapshot, bounded caller
 * storage, no truncation. Paired first error includes presence/code0. Late
 * output remains DATA; caller must reject authority on ANY present failure.
 * Main must independently bind its actual slot/storage/peer/native approval
 * and durable-before-Core once fence. Missing coordinates never rearm creation.
 */
void ynx_auth_android_device_source_copy_creation_coordinates_v1(ynx_auth_android_device_source_v1*,uint8_t*,size_t,ynx_auth_android_device_creation_coordinates_v1*,ynx_auth_android_provision_failure_v1*);
#ifdef __cplusplus
}
#endif
#endif
