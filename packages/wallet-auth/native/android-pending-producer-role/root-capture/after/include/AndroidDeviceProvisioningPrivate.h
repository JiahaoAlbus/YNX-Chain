#ifndef YNX_AUTH_ANDROID_DEVICE_PROVISIONING_PRIVATE_V1_H
#define YNX_AUTH_ANDROID_DEVICE_PROVISIONING_PRIVATE_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Private SAME-image actor-bound custody. Not a public Source/permission
 * installer. Core DEVICE is MLDSA87/SLH public2592/64, NOT Social33/2592.
 * No key material, keygen, signing, OS alias or caller-approved Boolean here.
 * Root-selected provisioning, primary DEVICE and query purposes are separate.
 */
#define YNX_AUTH_ANDROID_DEVICE_PROVISION_ABI_V1 1u
#define YNX_AUTH_ANDROID_DEVICE_PROVISION_DATA_MAX_V1 32768u
#define YNX_AUTH_ANDROID_DEVICE_PROVISION_APPROVAL_DATA_MAX_V1 1048576u
#define YNX_AUTH_ANDROID_DEVICE_PROVISION_REGISTERED_DATA_MAX_V1 524288u
#define YNX_AUTH_ANDROID_DEVICE_PROVISION_QUERY_DATA_MAX_V1 524288u
typedef struct ynx_auth_android_device_source_v1 ynx_auth_android_device_source_v1;
typedef struct ynx_auth_android_device_approval_v1 ynx_auth_android_device_approval_v1;
typedef struct ynx_auth_android_device_registered_v1 ynx_auth_android_device_registered_v1;
typedef struct ynx_auth_android_device_query_v1 ynx_auth_android_device_query_v1;
typedef struct ynx_auth_android_device_main_peer_v1 ynx_auth_android_device_main_peer_v1;
/* Presence is independent of code0. origin/platform_code are original facts,
 * not reconstructed from a later cleanup/copy error. arm64 layout24. */
typedef struct {uint32_t present;int32_t code;uint32_t origin;int64_t platform_code;} ynx_auth_android_provision_failure_v1;
typedef struct {ynx_auth_android_provision_failure_v1 failure;uint32_t unknown,physical_done;} ynx_auth_android_provision_drain_v1;
typedef struct {const uint8_t*bytes;size_t length;} ynx_auth_android_provision_bytes_v1;
typedef struct {
 uint32_t version,size;
 ynx_auth_android_provision_bytes_v1 network,account,stable_device_identity;
 ynx_auth_android_provision_bytes_v1 intent_original,source_id,instance_id,generation;
 int64_t not_before_ms,expires_ms;
} ynx_auth_android_provision_intent_v1;
typedef struct {
 uint32_t version,size;
 ynx_auth_android_provision_intent_v1 intent;
 ynx_auth_android_provision_bytes_v1 original_operation,original_request,original_decision;
} ynx_auth_android_provision_approval_data_v1;
typedef struct {uint32_t version,size;uint8_t pk_a[2592],pk_b[64];} ynx_auth_android_device_public_pair_v1;
typedef struct {
 uint32_t version,size;
 ynx_auth_android_provision_bytes_v1 original_operation,registration_original,account,network;
 int64_t not_before_ms,expires_ms;
} ynx_auth_android_provision_registered_data_v1;
enum {YNX_AUTH_ANDROID_DEVICE_ORIGINAL_UNKNOWN_V1=1,YNX_AUTH_ANDROID_DEVICE_ORIGINAL_PENDING_V1=2,YNX_AUTH_ANDROID_DEVICE_ORIGINAL_REGISTERED_HISTORY_V1=3,YNX_AUTH_ANDROID_DEVICE_ORIGINAL_FAILED_V1=4};
typedef struct {
 uint32_t version,size;
 ynx_auth_android_provision_bytes_v1 original_operation,original_result;
 uint32_t original_state,reserved;
 int64_t not_before_ms,expires_ms;
} ynx_auth_android_provision_query_data_v1;
/* original_state is an observed ORIGINAL public outcome/history, not a new
 * active registration, Source grant, finality or permission. Empty result
 * stays UNKNOWN; absence never rearms Core creation or proves no effect. */

/* Zero-caller-Source normal factory. Independent original purpose Source/math;
 * no expected DTO, loader callback, private path, Source, restore or Root input.
 * Adopt every nonnull partial BEFORE inspecting failure, even code0. */
void ynx_auth_android_device_source_open_original_v1(ynx_auth_android_device_source_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_source_current_v1(ynx_auth_android_device_source_v1*,ynx_auth_android_provision_failure_v1*);
/* All copy spans point into caller storage, never private owner/Root buffers.
 * Late error may retain detached bounded output, which is DATA not authority. */
void ynx_auth_android_device_source_copy_intent_v1(ynx_auth_android_device_source_v1*,uint8_t*,size_t,ynx_auth_android_provision_intent_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_source_retire_v1(ynx_auth_android_device_source_v1*);
void ynx_auth_android_device_source_join_v1(ynx_auth_android_device_source_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_device_source_close_v1(ynx_auth_android_device_source_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_device_source_release_closed_v1(ynx_auth_android_device_source_v1**,ynx_auth_android_provision_drain_v1*);

/* peer is a SAME original Main-owned retained Attempt, not a Source. Main's
 * fixed private body recognizes its inventory; callers cannot forge it with
 * raw JSON/expected facts or a true flag. Source and review authority are AND.
 * Capture finds an ALREADY genuine native review+decision for this intent;
 * it does not auto-approve, create a UI or invent a decision from terms. */
void ynx_auth_android_device_capture_creation_approval_v1(ynx_auth_android_device_source_v1*,ynx_auth_android_device_main_peer_v1*,ynx_auth_android_device_approval_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_approval_current_v1(ynx_auth_android_device_approval_v1*,ynx_auth_android_provision_failure_v1*);
/* Approval copy has its distinct1MiB bound for whole original request/decision;
 * source-intent stays32KiB, registered/query copies are bounded512KiB. Existing
 * original-schema/member validation still applies; transport size is NOT grant.
 */
void ynx_auth_android_device_approval_copy_v1(ynx_auth_android_device_approval_v1*,uint8_t*,size_t,ynx_auth_android_provision_approval_data_v1*,ynx_auth_android_provision_failure_v1*);
/* At most one entry. Reserve BEFORE foreign gate; lost/error ACK cannot rearm.
 * This never invokes Core. Main's durable-before-Core fence remains mandatory.
 * A failed/unknown entry permits only original reconciliation, never new keys. */
void ynx_auth_android_device_approval_enter_creation_once_v1(ynx_auth_android_device_approval_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_approval_retire_v1(ynx_auth_android_device_approval_v1*);
void ynx_auth_android_device_approval_join_v1(ynx_auth_android_device_approval_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_device_approval_close_v1(ynx_auth_android_device_approval_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_device_approval_release_closed_v1(ynx_auth_android_device_approval_v1**,ynx_auth_android_provision_drain_v1*);

/* Public pair is a constraint from the SAME Main operation's actual Core
 * result, not registration success. The collector independently acquires the
 * primary registered Source/current, compares exact original pair+terms and
 * operation. No caller-supplied registration/profile/session is accepted. */
void ynx_auth_android_device_registered_open_original_v1(ynx_auth_android_device_approval_v1*,const ynx_auth_android_device_public_pair_v1*,ynx_auth_android_device_registered_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_registered_current_v1(ynx_auth_android_device_registered_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_registered_copy_v1(ynx_auth_android_device_registered_v1*,uint8_t*,size_t,ynx_auth_android_provision_registered_data_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_registered_retire_v1(ynx_auth_android_device_registered_v1*);
void ynx_auth_android_device_registered_join_v1(ynx_auth_android_device_registered_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_device_registered_close_v1(ynx_auth_android_device_registered_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_device_registered_release_closed_v1(ynx_auth_android_device_registered_v1**,ynx_auth_android_provision_drain_v1*);

/* Cold query uses its OWN original query Source and genuine Main retained
 * original-operation holder. No reuse of expired creation Source, new nonce,
 * second create/sign, alias repair or manufactured "registered" outcome. */
void ynx_auth_android_device_query_open_original_v1(ynx_auth_android_device_main_peer_v1*,ynx_auth_android_device_query_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_query_current_v1(ynx_auth_android_device_query_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_query_copy_v1(ynx_auth_android_device_query_v1*,uint8_t*,size_t,ynx_auth_android_provision_query_data_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_query_retire_v1(ynx_auth_android_device_query_v1*);
void ynx_auth_android_device_query_join_v1(ynx_auth_android_device_query_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_device_query_close_v1(ynx_auth_android_device_query_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_auth_android_device_query_release_closed_v1(ynx_auth_android_device_query_v1**,ynx_auth_android_provision_drain_v1*);
/* Join-before-dispatch pending may be progressed on SAME owner. An actual
 * selected physical close/UNKNOWN is never repeated. Release_closed clears
 * caller slot only with verified physical_done, not merely error==0. */
#ifdef __cplusplus
}
#endif
#endif
