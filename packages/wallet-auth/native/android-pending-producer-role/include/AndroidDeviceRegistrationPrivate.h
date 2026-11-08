#pragma once
#include "AndroidDeviceProvisioningPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
// PRIVATE Android actor ABI. Same original SDK V4 registration/challenge
// domains, not a new registration wire or a caller Source/key installer.
typedef struct ynx_auth_android_pending_source_v1 ynx_auth_android_pending_source_v1;
typedef struct ynx_auth_android_pending_proof_v1 ynx_auth_android_pending_proof_v1;
typedef struct ynx_original_android_abort_context_v1 ynx_original_android_abort_context_v1;
enum {YNX_AUTH_ANDROID_DEVICE_REGISTRATION_POP_V1=1,YNX_AUTH_ANDROID_DEVICE_CHALLENGE_COMPLETION_V1=2};
typedef struct {
 uint32_t version,size,kind,reserved;
 ynx_auth_android_provision_bytes_v1 scope_original,registration_original,request_original,challenge_original;
 ynx_auth_android_provision_bytes_v1 pending_id,registration_digest,request_digest,approval_digest;
 ynx_auth_android_provision_bytes_v1 source_id,instance_id,source_generation,stable_device_identity;
 // Actual SAME sole-verified scope.expected values, not sourceGeneration or
 // C++ JSON parsing. Null bundle/package are null_mask bits0/1 respectively.
 // Origin and callback remain actual strings; never nullable aliases.
 ynx_auth_android_provision_bytes_v1 device_generation,account;
 ynx_auth_android_provision_bytes_v1 product_id,client_id,application_id,bundle_id,package_id,origin,callback,device_id;
 uint32_t null_mask,app_reserved;
 uint8_t network[32];uint8_t canonical_owner[42];uint8_t device_pk_a[2592],device_pk_b[64];
 int64_t not_before_ms,expires_at_ms;
} ynx_auth_android_pending_review_data_v1;
typedef struct {
 uint32_t version,size,entered,math_completed,recovered_original,member_present;
 int32_t original_core_code;uint32_t original_cleanup;
 uint64_t original_reported_length,retained_member_length;
 uint32_t durable_ack,unknown;
 ynx_auth_android_provision_failure_v1 first_failure;
} ynx_auth_android_pending_status_v1;

// Genuine independent pending purpose factory, zero caller input. Nonnull
// partial is adopted before presence/code0; Root[] refuses before Main/OS/UI.
void ynx_auth_android_pending_source_open_original_v1(ynx_auth_android_pending_source_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_pending_source_current_v1(ynx_auth_android_pending_source_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_pending_source_copy_review_v1(ynx_auth_android_pending_source_v1*,uint8_t*,size_t,ynx_auth_android_pending_review_data_v1*,ynx_auth_android_provision_failure_v1*);
// Fixed original Main-held userPQapprovalV4+currentPolicy, not creation grant.
// Returns their original canonical public bytes in caller storage. Main owns
// protected approval/custody and account policy; Source/math independently AND.
void ynx_auth_android_pending_source_copy_user_approval_v1(ynx_auth_android_pending_source_v1*,uint8_t*,size_t,ynx_auth_android_provision_bytes_v1*approval,ynx_auth_android_provision_bytes_v1*policy,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_pending_produce_registration_proof_v1(ynx_auth_android_pending_source_v1*,ynx_original_android_abort_context_v1*SAMEcontext,ynx_auth_android_pending_proof_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_pending_produce_challenge_proof_v1(ynx_auth_android_pending_source_v1*,ynx_original_android_abort_context_v1*SAMEcontext,ynx_auth_android_pending_proof_v1**,ynx_auth_android_provision_failure_v1*);
// Public original Member is read even after a late failure, BEFORE interpreting
// status/current. No member is success on its own. No private material output.
void ynx_auth_android_pending_proof_copy_member_v1(ynx_auth_android_pending_proof_v1*,uint8_t*,size_t,size_t*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_pending_proof_copy_status_v1(ynx_auth_android_pending_proof_v1*,ynx_auth_android_pending_status_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_pending_proof_current_v1(ynx_auth_android_pending_proof_v1*,ynx_auth_android_provision_failure_v1*);
// Any-thread revoke-only. No Root, Core, OS, close, permission or retry action.
void ynx_auth_android_pending_request_cancel_v1(ynx_auth_android_pending_source_v1*);
void ynx_auth_android_pending_source_retire_v1(ynx_auth_android_pending_source_v1*);
void ynx_auth_android_pending_source_join_v1(ynx_auth_android_pending_source_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_pending_source_close_v1(ynx_auth_android_pending_source_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_pending_source_release_closed_v1(ynx_auth_android_pending_source_v1**,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_pending_proof_retire_v1(ynx_auth_android_pending_proof_v1*);
void ynx_auth_android_pending_proof_join_v1(ynx_auth_android_pending_proof_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_pending_proof_close_v1(ynx_auth_android_pending_proof_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_pending_proof_release_closed_v1(ynx_auth_android_pending_proof_v1**,ynx_auth_android_provision_drain_v1*);
#ifdef __cplusplus
}
#endif
