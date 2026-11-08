#ifndef YNX_AUTH_ANDROID_DEVICE_PROJECTION_PRIVATE_V1_H
#define YNX_AUTH_ANDROID_DEVICE_PROJECTION_PRIVATE_V1_H
#include "AndroidDeviceProvisioningEvaluatorPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Detached DATA from the sole SDK result on Main's SAME private JSI object.
 * No parser, callback, Root/Source factory or approval installer. */
typedef struct {
 uint32_t version,size,kind,reserved;
 int64_t not_before_ms,expires_at_ms;
 ynx_auth_android_provision_bytes_v1 network,account,stable_device_identity,intent_original;
 ynx_auth_android_provision_bytes_v1 source_id,instance_id,source_generation;
 /* source_generation is Source qualification only. DEVICE generation and
  * canonical 0x owner come separately from the actual verified intent/record. */
 ynx_auth_android_provision_bytes_v1 device_generation,canonical_owner,registration_original;
 ynx_auth_android_provision_bytes_v1 comparison_purpose,comparison_source_id,comparison_instance_id,comparison_source_generation,comparison_issuer,comparison_subject;
 ynx_auth_android_provision_bytes_v1 primary_issuer,primary_subject,previous_canonical;
 ynx_auth_android_device_public_pair_v1 public_pair;
} ynx_auth_android_device_projection_data_v1;
/* SAME evaluator/capture as the preceding collect, whose original owner must
 * remain held through this call. current pre/post, all spans in caller buffer.
 * Kind1 provisioning, kind2 independently registered, kind3 read permission.
 * primary namespace/publicpair only kind2; query never invents deviceGeneration
 * or an original outcome. No effect retry/registration permission from DATA. */
void ynx_auth_android_device_evaluator_copy_projection_v1(ynx_auth_android_device_evaluator_v1*,ynx_auth_android_device_capture_v1*,uint8_t*,size_t,ynx_auth_android_device_projection_data_v1*,ynx_auth_android_provision_failure_v1*);
#ifdef __cplusplus
}
#endif
#endif
