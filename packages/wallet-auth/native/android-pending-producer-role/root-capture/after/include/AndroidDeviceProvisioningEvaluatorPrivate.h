#ifndef YNX_AUTH_ANDROID_DEVICE_EVALUATOR_PRIVATE_V1_H
#define YNX_AUTH_ANDROID_DEVICE_EVALUATOR_PRIVATE_V1_H
#include "AndroidDeviceProvisioningCapturePrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Fixed same-image evaluator, not a Source factory or permission. Its only
 * runtime/module/Core selection is compiled by Main and the sole SDK. */
typedef struct ynx_auth_android_device_evaluator_v1 ynx_auth_android_device_evaluator_v1;
#define YNX_AUTH_ANDROID_EVALUATOR_OUTPUT_MAX_V1 1048576u
#define YNX_AUTH_ANDROID_EVALUATOR_MATH_MAX_V1 256u
typedef struct {
 uint32_t version,size,entered;
 int32_t original_core_code;
 uint32_t bridge_rejection,reserved;
 /* Exact original result32 scalars, not a reconstructed verified Boolean. */
 uint32_t result_version,result_size,verified,member_count,index,cleanup_status;
 uint64_t result_reserved;
} ynx_auth_android_device_math_observation_v1;
/* Adopt every nonnull owner before interpreting the paired failure. No caller
 * runtime, provider, JS function, module, path, Root or callback is accepted. */
void ynx_auth_android_device_evaluator_open_fixed_v1(ynx_auth_android_device_evaluator_v1**,ynx_auth_android_provision_failure_v1*);
/* Auth capture3 are called on the SAME recognized capture, current before and
 * after actual collection. Output and math are detached DATA even on a late
 * error; used/count are actual lengths, never silent truncation. No output
 * becomes Root/Source/approval merely because Core code or this call is zero. */
void ynx_auth_android_device_evaluator_collect_v1(ynx_auth_android_device_evaluator_v1*,ynx_auth_android_device_capture_v1*,uint8_t*,size_t,size_t*,ynx_auth_android_device_math_observation_v1*,size_t,size_t*,ynx_auth_android_provision_failure_v1*);
/* A reentrant active call returns pending before any close dispatch. Main's
 * fixed close false means no physical close entered; the SAME owner may then
 * progress. Actual closed true is sticky; release never repeats a close. */
void ynx_auth_android_device_evaluator_close_v1(ynx_auth_android_device_evaluator_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_device_evaluator_release_closed_v1(ynx_auth_android_device_evaluator_v1**,ynx_auth_android_provision_drain_v1*);
#ifdef __cplusplus
}
#endif
#endif
