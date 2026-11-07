#pragma once
#include "MobileSelectedOriginalPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Additive PRIVATE Native inventory boundary. It never constructs receipt,
 * Root, account, reviewed operation or a permission from DATA. Native producer
 * owns SAME opaque RegisteredReceiptOwner/receipt/reader/H/deadline until drain.
 * All functions are original-actor-only; no JS reference or public setter. */
typedef struct {uint32_t present;int32_t code;} YNXMobileRegisteredFailureV2;
enum {YNX_MOBILE_REGISTERED_READY_V2=1,YNX_MOBILE_REGISTERED_NOT_READY_V2=2,YNX_MOBILE_REGISTERED_FAILED_V2=3};
typedef struct {
 uint32_t version,size,phase;
 YNXMobileRegisteredFailureV2 failure,pending_cause;
} YNXMobileRegisteredPhaseV2;
typedef struct {
 uint32_t version,size,physical_done;
 YNXMobileRegisteredFailureV2 first_failure,cleanup_failure;
} YNXMobileRegisteredDrainV2;
/* Adopt nonnull partial BEFORE phase/failure, including failure.present/code0.
 * NOT_READY is not a failure or READY: SAME selected owner remains retained.
 * Explicit resume only: no second acquire/recapture H, renewal, alternate row,
 * UI claim/review/43/restore. Only genuine initial/readiness flow may select the
 * existing account; selection is DATA, not Source/restore permission. */
YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_acquire_v2(YNXMobilePQSelectedOriginal**);
YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_resume_v2(YNXMobilePQSelectedOriginal*);
/* Pending current uses Auth currentOriginalReceiptSourceFence (Root/Source/
 * clock only), NEVER engine.readCaptured or receipt implicit resume. Once READY,
 * current MUST also verify genuine same receipt ledger continuation/current. */
YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_current_v2(YNXMobilePQSelectedOriginal*);
YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_read_v2(YNXMobilePQSelectedOriginal*,YNXMobilePQSelectedOriginalDATA*);
YNXMobileRegisteredFailureV2 ynx_mobile_pq_registered_account_retire_v2(YNXMobilePQSelectedOriginal*);
YNXMobileRegisteredDrainV2 ynx_mobile_pq_registered_account_join_v2(YNXMobilePQSelectedOriginal*);
YNXMobileRegisteredDrainV2 ynx_mobile_pq_registered_account_close_v2(YNXMobilePQSelectedOriginal*);
YNXMobileRegisteredFailureV2 ynx_mobile_pq_registered_account_release_closed_v2(YNXMobilePQSelectedOriginal*);
/* FAILED always has failure.present=1 even code0. READY/NOT_READY must have
 * failure absent. pending_cause never changes failure presence. physical_done
 * is independent of sticky first/cleanup causes; an error is not a close ACK.
 * Unknown selected close is not retried or replaced; same-owner join can only
 * advance genuine remaining drain stages. */
#ifdef __cplusplus
}
#endif
