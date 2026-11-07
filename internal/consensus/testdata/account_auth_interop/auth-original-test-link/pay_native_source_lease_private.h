#ifndef YNX_WALLET_PAY_NATIVE_SOURCE_LEASE_PRIVATE_H
#define YNX_WALLET_PAY_NATIVE_SOURCE_LEASE_PRIVATE_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Auth-issued opaque original native Source borrow. Never pointer/JSON/Root
 * bool supplied by JavaScript or LINK. Binding is separately constrained DATA.
 * The actual Root/source verifier AND Main native retirement epoch must have
 * qualified the owner BEFORE Auth can issue a borrow. No Source4 alias. */
typedef struct ynx_wallet_pay_source_lease_v1 ynx_wallet_pay_source_lease_v1;
enum {YNX_PAY_SOURCE_CURRENT=0,YNX_PAY_SOURCE_DENIED=1,
 YNX_PAY_SOURCE_ARGUMENT=2,YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED=3,
 YNX_PAY_SOURCE_MAIN_EPOCH_NOT_SUPPLIED=4,YNX_PAY_SOURCE_CLOSED=5};

/* The first reference is returned by Auth's private native owner, not by LINK.
 * retain returns a NEW borrowed reference, adopted before interpreting status.
 * current is pure native: no NAPI/JS/TSFN, IO, HTTP, Store lock or callbacks to
 * caller code; it checks original native Root/source current/window AND the
 * actual Main native epoch/retirement. OS channel Current remains LINK-owned. */
int32_t ynx_wallet_pay_source_lease_retain_v1(ynx_wallet_pay_source_lease_v1*,ynx_wallet_pay_source_lease_v1**out);
int32_t ynx_wallet_pay_source_lease_current_v1(void*retained_actual_source_ctx);
void ynx_wallet_pay_source_lease_drop_v1(ynx_wallet_pay_source_lease_v1*);
/* Physical drain, not current/admission. UNKNOWN registration release is 0. */
int32_t ynx_wallet_pay_source_lease_drained_v1(ynx_wallet_pay_source_lease_v1*);
/* Exact original LINK CSourceFence callbacks, SAME ctx identity. Nonzero
 * retain acquires no borrow. release is paired only with a successful retain. */
int32_t ynx_wallet_pay_source_fence_retain_v1(void*retained_actual_source_ctx);
void ynx_wallet_pay_source_fence_release_v1(void*retained_actual_source_ctx);

/* Only lowers permission. P01's real Main guard/UI/account/parent-permission
 * retirement path must call this exact original child; no activate/reset exists.
 * Root/source issuer revocation independently retires its own native holder. */
void ynx_wallet_pay_source_lease_retire_v1(ynx_wallet_pay_source_lease_v1*);
#ifdef __cplusplus
}
#endif
#endif
