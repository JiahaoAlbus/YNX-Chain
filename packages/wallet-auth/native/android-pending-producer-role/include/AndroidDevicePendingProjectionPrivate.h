#pragma once
#include "AndroidDeviceProvisioningEvaluatorPrivate.h"
#include "AndroidDeviceRegistrationPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
// Private SAME-capture detached DATA, not a new Source installer or schema.
// The original verified watermark stays separate from immutable pending scope.
typedef struct {
 uint32_t version,size;
 ynx_auth_android_pending_review_data_v1 review;
 ynx_auth_android_provision_bytes_v1 previous_canonical;
} ynx_auth_android_pending_projection_data_v1;
void ynx_auth_android_device_evaluator_open_pending_fixed_v1(ynx_auth_android_device_evaluator_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_evaluator_copy_pending_projection_v1(ynx_auth_android_device_evaluator_v1*,ynx_auth_android_device_capture_v1*SAMEcapture,uint8_t*,size_t,ynx_auth_android_pending_projection_data_v1*,ynx_auth_android_provision_failure_v1*);
#ifdef __cplusplus
}
#endif
