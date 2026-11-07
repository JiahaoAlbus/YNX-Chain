#pragma once
#include "MobileAITaskPlatformPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Private bridge contract for the ORIGINAL installed SDK Native binding. Not
 * an invented JSI/global/NativeModules name or caller-installable callback.
 * Actual installation/provenance belongs to sole SDK/platform owner. */
typedef struct YNXAIMobileSDKPeer YNXAIMobileSDKPeer;
typedef struct YNXAIMobileSDKContext YNXAIMobileSDKContext;
typedef struct YNXAIMobilePrepared YNXAIMobilePrepared;
typedef struct YNXAIMobileApproval YNXAIMobileApproval;
typedef struct YNXAIMobileAgentOperation YNXAIMobileAgentOperation;
typedef struct YNXAIMobileResponse YNXAIMobileResponse;
typedef struct YNXAIMobileSigningCapture YNXAIMobileSigningCapture;
typedef struct {uint32_t version,size;YNXAIMobileSpanV6 operation_id,action,method,path,body_original;YNXAIMobileFailureV6 failure;} YNXAIMobilePeerDATA;
typedef struct {uint32_t version,size;YNXAIMobileSpanV6 unsigned_original,message_original;YNXAIMobileFailureV6 failure;} YNXAIMobilePreparedDATA;
typedef struct {uint32_t version,size;YNXAIMobileSpanV6 member_original;int32_t primitive_status;uint32_t cleanup_status;YNXAIMobileFailureV6 failure;} YNXAIMobileAgentOutcome;
typedef struct {uint32_t version,size,status;YNXAIMobileSpanV6 unsigned_original,message_original,member_original,body_original,business_receipt_original,outcome_metadata_original;YNXAIMobileFailureV6 failure;} YNXAIMobileResponseDATA;
/* Source uses the same recognized peer/context pointers throughout. Context
 * current is cancellation/lifetime ONLY, not a stale task-writer epoch. */
int32_t ynx_ai_mobile_peer_read_v6(YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*,YNXAIMobilePeerDATA*);
int32_t ynx_ai_mobile_peer_current_v6(YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*);
int32_t ynx_ai_mobile_context_current_v6(YNXAIMobileSDKContext*);
/* Sole codec owns35/E5. Root scope7 and nonce32/window are Auth originals;
 * returned loan is retained before rc/error; it must NOT mint Source/approve. */
int32_t ynx_ai_mobile_prepare_v6(YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*,YNXAIMobileSpanV6 scope_original,YNXAIMobileSpanV6 nonce32,uint64_t issued_ms,uint64_t expires_ms,YNXAIMobilePrepared**);
int32_t ynx_ai_mobile_prepared_read_v6(YNXAIMobilePrepared*,YNXAIMobilePreparedDATA*);
int32_t ynx_ai_mobile_prepared_current_v6(YNXAIMobilePrepared*,YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*);
void ynx_ai_mobile_prepared_retire_v6(YNXAIMobilePrepared*);
int32_t ynx_ai_mobile_prepared_join_v6(YNXAIMobilePrepared*);
int32_t ynx_ai_mobile_prepared_close_v6(YNXAIMobilePrepared*);
int32_t ynx_ai_mobile_prepared_release_closed_v6(YNXAIMobilePrepared*);
/* Sole fixed V6 codec DATA bridge: independently parse canonical35/16 and
 * reconstruct its exact E5 against ASCII networkId hex64. Request also checks
 * actual body bytes/route/closed body semantics. Zero means DATA equality only,
 * never Root/Source/UI/key authorization. No callback/provider input. */
int32_t ynx_ai_mobile_validate_request_message_v6(YNXAIMobileSpanV6 unsigned_original,YNXAIMobileSpanV6 network_hex,YNXAIMobileSpanV6 message_original,YNXAIMobileSpanV6 body_original);
int32_t ynx_ai_mobile_validate_response_message_v6(YNXAIMobileSpanV6 unsigned_original,YNXAIMobileSpanV6 network_hex,YNXAIMobileSpanV6 message_original);
/* UI uses only this genuine Auth signing-capture inventory, SAME review,
 * unsigned/digest/root, selected native account and current epoch. */
int32_t ynx_ai_mobile_approval_acquire_v6(YNXAIMobileSigningCapture*,YNXAIMobileApproval**);
int32_t ynx_ai_mobile_approval_current_v6(YNXAIMobileApproval*,YNXAIMobileSigningCapture*);
int32_t ynx_ai_mobile_approval_claim_v6(YNXAIMobileApproval*,YNXAIMobileSigningCapture*);
void ynx_ai_mobile_approval_retire_v6(YNXAIMobileApproval*);
int32_t ynx_ai_mobile_approval_join_v6(YNXAIMobileApproval*);
int32_t ynx_ai_mobile_approval_close_v6(YNXAIMobileApproval*);
int32_t ynx_ai_mobile_approval_release_closed_v6(YNXAIMobileApproval*);
/* Original dedicated-agent protected key/Core bridge, NEVER a generic signer.
 * Must use fixed PRODUCT-SESSION-AI-TASK-ACTION/35/E5/N1 and same capture;
 * no caller purpose, account/device/server pair, key path or provider. Missing
 * original Core typed signer is explicit NOT_SUPPLIED only at this branch. */
int32_t ynx_ai_mobile_agent_operation_acquire_v6(YNXAIMobileSigningCapture*,YNXAIMobileAgentOperation**);
int32_t ynx_ai_mobile_agent_operation_sign_once_v6(YNXAIMobileAgentOperation*);
int32_t ynx_ai_mobile_agent_operation_read_v6(YNXAIMobileAgentOperation*,YNXAIMobileAgentOutcome*);
void ynx_ai_mobile_agent_operation_retire_v6(YNXAIMobileAgentOperation*);
int32_t ynx_ai_mobile_agent_operation_join_v6(YNXAIMobileAgentOperation*);
int32_t ynx_ai_mobile_agent_operation_close_v6(YNXAIMobileAgentOperation*);
int32_t ynx_ai_mobile_agent_operation_release_closed_v6(YNXAIMobileAgentOperation*);
/* Read SAME actual private transport captured response: body_original is the
 * EXACT signed outer carrier. Native may leave metadata/receipt NULL0; Auth
 * authenticates16/E5/N1 over the full outer body, then sole-decodes its inner
 * business body/meta5/optional receipt. Optional Native side hints, if present,
 * must byte-equal carrier fields and never grant authority or Go provenance. */
int32_t ynx_ai_mobile_response_acquire_v6(YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*,YNXAIMobileResponse**);
int32_t ynx_ai_mobile_response_read_v6(YNXAIMobileResponse*,YNXAIMobileResponseDATA*);
void ynx_ai_mobile_response_retire_v6(YNXAIMobileResponse*);
int32_t ynx_ai_mobile_response_join_v6(YNXAIMobileResponse*);
int32_t ynx_ai_mobile_response_close_v6(YNXAIMobileResponse*);
int32_t ynx_ai_mobile_response_release_closed_v6(YNXAIMobileResponse*);
typedef struct {uint32_t version,size;YNXAIMobileSpanV6 unsigned_original,message_original,request_digest,agent_expected_original,root_original,enrollment_original,profile_original,current_original;} YNXAIMobileSigningOriginalDATA;
/* ACTUAL Auth implementations below; reads only from genuine capture token.
 * Full current may perform public Source I/O; call outside Core/Store locks.
 * Never reads43/DER or returns a permission boolean from received JSON. */
int32_t ynx_auth_ai_mobile_signing_capture_read_v6(YNXAIMobileSigningCapture*,YNXAIMobileSigningOriginalDATA*);
int32_t ynx_auth_ai_mobile_signing_capture_current_v6(YNXAIMobileSigningCapture*);
#ifdef __cplusplus
}
#endif
