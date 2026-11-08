#pragma once
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
// PRIVATE actor-bound read holder, not a Root/DEVICE constructor from DATA.
// Darwin implementation uses the actual dedicated ObjC Source. Linux has its
// own Root-selected implementation; NEVER transfer these tokens between OSes,
// processes, environments, UIDs or actors. No signing/provisioning/query grant.
typedef struct ynx_auth_device_v4_source_v1 ynx_auth_device_v4_source_v1;
typedef struct ynx_auth_device_v4_view_v1 ynx_auth_device_v4_view_v1;
typedef struct {uint32_t present;int32_t code;uint32_t origin;int64_t platform_code;} ynx_auth_device_v4_failure_v1;
typedef struct {ynx_auth_device_v4_source_v1*owner;ynx_auth_device_v4_failure_v1 failure;} ynx_auth_device_v4_acquisition_v1;
typedef struct {ynx_auth_device_v4_view_v1*owner;ynx_auth_device_v4_failure_v1 failure;} ynx_auth_device_v4_view_acquisition_v1;
typedef struct {ynx_auth_device_v4_failure_v1 failure;uint32_t unknown,physical_done;} ynx_auth_device_v4_drain_v1;
typedef struct {ynx_auth_device_v4_failure_v1 failure;uint32_t reference_released;} ynx_auth_device_v4_reference_release_v1;
typedef struct {const uint8_t*bytes;size_t length;} ynx_auth_device_v4_bytes_v1;
// DATA only, valid while SAME view is held. Fixed expected17 order below.
// Current/read are full actor I/O gates, not Store-lock-safe atomic fences.
typedef struct {
 uint32_t version,size,null_mask;
 ynx_auth_device_v4_bytes_v1 expected[17];
 ynx_auth_device_v4_bytes_v1 context_original,registration_original,session_original;
 int64_t not_before_ms,expires_ms;
} ynx_auth_device_v4_view_data_v1;
// networkId,canonicalOwner,account,sessionBinding,productId,clientId,platform,
// applicationId,bundleId,packageId,origin,callback,deviceId,generation,
// registrationId,revision,registrationDigest. Null bits are not empty strings.
ynx_auth_device_v4_acquisition_v1 ynx_auth_device_v4_source_acquire_original_v1(void);
// Retain adopts SAME owner even with original failure. Release only THAT extra
// memory borrow; reference_released is NOT physical Source closure.
ynx_auth_device_v4_acquisition_v1 ynx_auth_device_v4_source_retain_v1(ynx_auth_device_v4_source_v1*);
ynx_auth_device_v4_reference_release_v1 ynx_auth_device_v4_source_release_reference_v1(ynx_auth_device_v4_source_v1*);
ynx_auth_device_v4_failure_v1 ynx_auth_device_v4_source_current_v1(ynx_auth_device_v4_source_v1*);
ynx_auth_device_v4_view_acquisition_v1 ynx_auth_device_v4_source_open_view_v1(ynx_auth_device_v4_source_v1*);
ynx_auth_device_v4_failure_v1 ynx_auth_device_v4_view_current_v1(ynx_auth_device_v4_view_v1*);
ynx_auth_device_v4_failure_v1 ynx_auth_device_v4_view_read_original_v1(ynx_auth_device_v4_view_v1*,ynx_auth_device_v4_view_data_v1*);
ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_view_release_v1(ynx_auth_device_v4_view_v1*);
// Thread-safe revoke-only; performs NO ObjC/Go/FS/current/close action.
void ynx_auth_device_v4_source_request_retire_v1(ynx_auth_device_v4_source_v1*);
ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_source_join_v1(ynx_auth_device_v4_source_v1*);
ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_source_close_v1(ynx_auth_device_v4_source_v1*);
ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_source_release_closed_v1(ynx_auth_device_v4_source_v1*);
#ifdef __cplusplus
}
#endif
