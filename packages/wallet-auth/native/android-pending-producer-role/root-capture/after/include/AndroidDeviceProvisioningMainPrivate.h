#ifndef YNX_AUTH_ANDROID_DEVICE_PROVISIONING_MAIN_PRIVATE_V1_H
#define YNX_AUTH_ANDROID_DEVICE_PROVISIONING_MAIN_PRIVATE_V1_H
#include "AndroidDeviceProvisioningPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Fixed Main-owned SAME-image inputs. Main alone implements these strong
 * bodies against its real Rc<Attempt>/normal PendingSourceRequest inventory.
 * Auth supplies no installer/callback table and no production PUBLIC fallback.
 * Actual peer need not possess a fresh Social joint profile or DEVICE signing
 * guard: creation must not depend on the device that is about to be created.
 */
typedef struct ynx_auth_android_device_main_review_v1 ynx_auth_android_device_main_review_v1;
typedef struct ynx_auth_android_device_main_query_v1 ynx_auth_android_device_main_query_v1;
#define YNX_AUTH_ANDROID_DEVICE_MAIN_PEER_DATA_MAX_V1 2097152u
typedef struct {
 uint32_t version,size;
 ynx_auth_android_provision_bytes_v1 account_issuer,account_subject,session,family,generation;
 ynx_auth_android_provision_bytes_v1 original_operation,original_nonce,original_request;
 ynx_auth_android_provision_bytes_v1 original_current,original_root,original_registration,original_status;
 int64_t not_before_ms,expires_ms;
} ynx_auth_android_device_main_peer_data_v1;
typedef struct {
 uint32_t version,size;
 ynx_auth_android_provision_bytes_v1 network,account,stable_device_identity;
 ynx_auth_android_provision_bytes_v1 reviewed_intent_original,original_operation,original_request,original_decision;
 int64_t not_before_ms,expires_ms;
} ynx_auth_android_device_main_review_data_v1;
typedef struct {
 uint32_t version,size;
 ynx_auth_android_provision_bytes_v1 original_operation,account,network;
 int64_t not_before_ms,expires_ms;
} ynx_auth_android_device_main_query_data_v1;

/* Main creates peer only from the actual normal PendingSourceRequest's SAME
 * Attempt/live Source-backed bootstrap, on its original actor. There is no
 * public acquire-from-raw/expected DTO ABI. Auth may RETAIN only a genuine peer
 * already passed by the normal Main controller; every nonnull partial is owned.
 * peer current is Attempt.recheck/live, NOT recheck_original_account requiring
 * the fresh Social Source. These peer facts alone never approve key creation.
 * release drops ONLY this extra peer borrow, never retires/closes the original
 * Main Attempt. physical_done denotes this owned borrow's release only.
 * copy bounds each whole original to262144 and aggregate<=2097152, retaining
 * full existing E8/N1 members rather than trimming a signed frame to64KiB.
 * Existing canonical body<=65536/member<=262144 schema checks are NOT relaxed.
 * original_request is the original signed request binding/body, NOT HTTP
 * Authorization/Cookie headers, bearer credentials or private material.
 * peer.original_operation is original account/bootstrap provenance; it is
 * NOT a newly allocated DEVICE creation operation or a creator permission.
 */
void ynx_auth_android_device_main_peer_retain_v1(ynx_auth_android_device_main_peer_v1*,ynx_auth_android_device_main_peer_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_main_peer_current_v1(ynx_auth_android_device_main_peer_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_main_peer_copy_v1(ynx_auth_android_device_main_peer_v1*,uint8_t*,size_t,ynx_auth_android_device_main_peer_data_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_main_peer_release_v1(ynx_auth_android_device_main_peer_v1**,ynx_auth_android_provision_drain_v1*);

/* source is comparison-only genuine Auth holder. Main may read its bounded
 * intent through the Auth API, but must locate the EXISTING normal native
 * review and original user decision for SAME terms/account/network/window.
 * Do not synthesize approval from Source terms, true, ACCOUNT_OBSERVED,
 * LOCAL_KEYS_AUTHENTICATED, a JS argument, storage binding or Source presence.
 * No UI is launched by this ABI. If actual review/decision is absent: refuse.
 * review.original_operation is Main's SAME dedicated DEVICE operation from
 * its normal durable-before-Core journal, not a reused login/runtime-startup
 * operation. Capture never generates/rekeys/retries that operation. Main owns
 * the original operation's allocation and durable once fence, not Auth.
 */
void ynx_auth_android_device_main_review_capture_v1(ynx_auth_android_device_main_peer_v1*,ynx_auth_android_device_source_v1*,ynx_auth_android_device_main_review_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_main_review_current_v1(ynx_auth_android_device_main_review_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_main_review_copy_v1(ynx_auth_android_device_main_review_v1*,uint8_t*,size_t,ynx_auth_android_device_main_review_data_v1*,ynx_auth_android_provision_failure_v1*);
/* Assert the SAME original actual native decision, not an approval Boolean
 * argument. Auth also independently enforces Source authority+exact intent. */
void ynx_auth_android_device_main_review_assert_creation_v1(ynx_auth_android_device_main_review_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_main_review_release_v1(ynx_auth_android_device_main_review_v1**,ynx_auth_android_provision_drain_v1*);

/* Existing Main original-operation holder only. No operation/nonce/path input
 * and no reconstruct from untrusted JSON. Query cannot dispatch Core or sign. */
void ynx_auth_android_device_main_query_capture_v1(ynx_auth_android_device_main_peer_v1*,ynx_auth_android_device_main_query_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_main_query_current_v1(ynx_auth_android_device_main_query_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_main_query_copy_v1(ynx_auth_android_device_main_query_v1*,uint8_t*,size_t,ynx_auth_android_device_main_query_data_v1*,ynx_auth_android_provision_failure_v1*);
/* SAME actual original-operation record's PUBLIC projection bytes and state.
 * No second store/path guess, synthesized original, raw Core80/40 memory,
 * private PKCS8/alias secrets or fresh registration claim. If no result exists,
 * original_result is empty and state UNKNOWN; keep original operation/window.
 * Query authority still comes independently from Auth's own query Source.
 * This extra read-only getter does not change any existing view layout.
 */
void ynx_auth_android_device_main_query_copy_public_result_v1(ynx_auth_android_device_main_query_v1*,uint8_t*,size_t,ynx_auth_android_provision_query_data_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_auth_android_device_main_query_release_v1(ynx_auth_android_device_main_query_v1**,ynx_auth_android_provision_drain_v1*);
#ifdef __cplusplus
}
#endif
#endif
