#pragma once
#include "pay_native_source_lease_private.h"
#include "pay_root_transport_loan_private.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_wallet_pay_actual_context_v1 ynx_wallet_pay_actual_context_v1;
/* No public constructor/config/Binding/Root setter. Normal Native captures
 * this from the genuine operational Root + SAME protected Main epoch only. */
int32_t ynx_wallet_pay_ctx_current_v1(void*);
int32_t ynx_wallet_pay_ctx_get_original_loan_v1(ynx_wallet_pay_actual_context_v1*,ynx_wallet_pay_root_transport_loan_v1**);
int32_t ynx_wallet_pay_ctx_get_fence_v1(ynx_wallet_pay_actual_context_v1*,ynx_link_private_client_source_fence_v1*);
/* EXACT same ctx's Root/Main/binding/query. Nonnull Source output adopts the
 * ONE registration borrow even if status is nonzero. Nil out means no adopt.
 * Call ONCE through actual Go startup TransferBorrowToNativeSource. */
int32_t ynx_wallet_pay_source_adopt_registration_v1(ynx_wallet_pay_actual_context_v1*,ynx_link_private_client_registration_borrow_v1*,ynx_wallet_pay_source_lease_v1**);
void ynx_wallet_pay_ctx_retire_v1(ynx_wallet_pay_actual_context_v1*);
int32_t ynx_wallet_pay_ctx_close_v1(ynx_wallet_pay_actual_context_v1*);
int32_t ynx_wallet_pay_ctx_closed_v1(ynx_wallet_pay_actual_context_v1*);
#ifdef __cplusplus
}
#endif
