#ifndef YNX_AI_MOBILE_V6_PRODUCER_PRIVATE_H
#define YNX_AI_MOBILE_V6_PRODUCER_PRIVATE_H
#include "MobileAITaskClientC.h"
#ifdef __cplusplus
extern "C" {
#endif
/* NEW SOLE CONTRACT, required strong bodies owned by original Native common.
 * Not supplied by Auth C17. Not public provider/FD/pointer registration.
 * All inputs come from installed same-runtime JSI intrinsic captures. */
typedef struct YNXAIMobileProducerV6 YNXAIMobileProducerV6;
typedef struct {
 uint32_t version,size;
 YNXAIMobileSpanV6 operation_id,action,method,path,task_id,task_revision,
 generation,step_id,run_id,creation_binding,body_original;
} YNXAIMobileIntentDATA6;
typedef struct {YNXAIMobileProducerV6*owner;YNXAIMobileFailureV6 failure;} YNXAIMobileProducerOwnedV6;
typedef struct {uint32_t version,size,kind,closed;YNXAIMobileFailureV6 original_failure,close_failure;} YNXAIMobileProducerStateV6;
/* Context/lifetime is a genuine Native ContextHostObject inventory created by
 * captureOriginalContextV6. C arguments are extracted ONLY inside the original
 * Native HostFunction after same-runtime/source/class registry checks.
 * Producer retains SAME context owner until all child owners close; no naked
 * borrowed pointer lifetime or caller-installed context. Never a caller
 * Context* cast or DTO address. These calls create real peer/context inventory.
 * acquire copies DATA only; no key/sign/Source grant. Source must be recognized
 * exact original Auth source, same installed runtime and original native actor. */
YNXAIMobileProducerOwnedV6 ynx_ai_mobile_packet_producer_acquire_v6(YNXAuthAIMobileOwnerV6*,YNXAIMobileSDKContext*same_captured_context,const YNXAIMobileIntentDATA6*);
YNXAIMobileProducerOwnedV6 ynx_ai_mobile_query_producer_acquire_v6(YNXAuthAIMobileOwnerV6*,YNXAIMobileSDKContext*same_captured_context,YNXAIMobileSpanV6 original_operation_id);
/* Borrow only SAME producer-owned actual ports; no public constructor/setter.
 * Query returns peer=NULL, context nonnull; packet requires both nonnull.
 * Context capture's cancellation only reduces authority. Borrowed pointers stay
 * valid until producer close, and all Auth child owners must close first. */
int32_t ynx_ai_mobile_producer_borrow_v6(YNXAIMobileProducerV6*,YNXAuthAIMobileOwnerV6*same_source,YNXAIMobileSDKPeer**,YNXAIMobileSDKContext**);
int32_t ynx_ai_mobile_producer_current_v6(YNXAIMobileProducerV6*);
/* Dispatch once, only exact same source/peer/context/review/proved operation.
 * Native inventory binds tuples during genuine prepare/produce, never through
 * caller registration. Auth produce(source,peer,ctx,review) uses arg4 review.
 * Strong body captures actual response for original response_acquire_v6 port.
 * No fetch callback/URL/headers/key/purpose setter. UNKNOWN never redispatches.
 * Original query producer CANNOT dispatch. Partial response remains retained. */
YNXAIMobileFailureV6 ynx_ai_mobile_producer_dispatch_once_v6(YNXAIMobileProducerV6*,YNXAuthAIMobileOwnerV6*same_source,YNXAuthAIMobileOwnerV6*same_review,YNXAuthAIMobileOwnerV6*same_operation);
int32_t ynx_ai_mobile_producer_request_cancel_v6(YNXAIMobileProducerV6*);
YNXAIMobileFailureV6 ynx_ai_mobile_producer_join_v6(YNXAIMobileProducerV6*);
YNXAIMobileFailureV6 ynx_ai_mobile_producer_close_v6(YNXAIMobileProducerV6*);
int32_t ynx_ai_mobile_producer_state_v6(YNXAIMobileProducerV6*,YNXAIMobileProducerStateV6*);
int32_t ynx_ai_mobile_producer_release_closed_v6(YNXAIMobileProducerV6*);
#ifdef __cplusplus
}
#endif
#endif
