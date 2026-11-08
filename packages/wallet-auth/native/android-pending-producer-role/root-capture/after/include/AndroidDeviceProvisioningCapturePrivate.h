#ifndef YNX_AUTH_ANDROID_DEVICE_CAPTURE_PRIVATE_V1_H
#define YNX_AUTH_ANDROID_DEVICE_CAPTURE_PRIVATE_V1_H
#include "AndroidDeviceProvisioningPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Borrowed provisional capture, NOT a qualified Source or approval. Auth's
 * original Root/release/App/UID factory alone creates/owns this inventory.
 * There is deliberately no C open/register/from-JSON/setter for this type.
 * SDK/native evaluator must not call public Auth29 to create/current it.
 */
typedef struct ynx_auth_android_device_capture_v1 ynx_auth_android_device_capture_v1;
enum {YNX_AUTH_ANDROID_CAPTURE_PROVISION_V1=1,YNX_AUTH_ANDROID_CAPTURE_REGISTERED_V1=2,YNX_AUTH_ANDROID_CAPTURE_QUERY_V1=3};
#define YNX_AUTH_ANDROID_DEVICE_CAPTURE_BYTES_MAX_V1 2097152u
typedef struct {
 uint32_t version,size,kind,reserved;
 int64_t baseline_at_ms,current_at_ms,after_at_ms;
} ynx_auth_android_device_capture_info_v1;
/* These are Auth-owned strong bodies over the SAME actor/capture. current
 * checks actual held Root/material/process/UID/nonce/time/floor provenance;
 * it does NOT claim schema/signature/receiver/creation approval by itself.
 * No public global, callback provider, App boolean or supplied Source is read.
 */
void ynx_auth_android_device_capture_current_v1(ynx_auth_android_device_capture_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_capture_info_v1_read(ynx_auth_android_device_capture_v1*,ynx_auth_android_device_capture_info_v1*,ynx_auth_android_provision_failure_v1*);
/* Detached canonical JSON <=2MiB, exactly the sole SDK CapturedDATA schema:
 * input (original dispatch8), beforeRaw4/afterRaw4 (root/profile/current/subject),
 * currentRaw,nonce,baselineAtMs,currentAtMs,afterAtMs. Actual Auth IO/clock/nonce
 * captures fill it; no caller-provided batch becomes a recognized capture.
 * NO truncation. copied output remains DATA after a late failure.
 * The borrow is valid only during the owning fixed Source/math call; SDK must
 * not retain/close it, start a Source, fetch, replace the clock or mint a nonce.
 */
void ynx_auth_android_device_capture_copy_canonical_v1(ynx_auth_android_device_capture_v1*,uint8_t*,size_t,size_t*,ynx_auth_android_provision_failure_v1*);
#ifdef __cplusplus
}
#endif
#endif
