#pragma once
#include "ShopMainSessionPrivate.h"
#include "native/OriginalProductSessionProofV2Private.h"
#ifdef __cplusplus
extern "C" {
#endif
// Required actual protected Main holder, not implemented by PUBLIC fixtures in
// production. No register/fromJSON/header/URL/scopes/provider input. The fixed
// branch is LEGACY V2 transport with session payload2/3 only. Normal V4 PQ GET
// reader/signature cannot satisfy this port or fall back from V4 to V2/P256.
// operation is readOriginalShopNativeInvoiceRequest; actual Main selects its
// registered POST /v2/product-sessions/introspect requiredScopes and uses the
// original SDK signer + sole decode/re-encode, not this transported GET frame.
typedef struct ynx_wallet_shop_invoice_introspection_proof_v1 ynx_wallet_shop_invoice_introspection_proof_v1;
typedef struct {ynx_wallet_shop_invoice_introspection_proof_v1*owner;ynx_auth_shop_status_v1 status;} ynx_wallet_shop_invoice_introspection_proof_acquisition_v1;
typedef struct {
 uint32_t version,size;
 ynx_original_product_session_proof_v2_header_data_v1 original;
 int64_t issued_at_ms,expires_at_ms;
} ynx_wallet_shop_invoice_introspection_proof_data_v1;
// SAME actual env/session/Source/order. Adopt every nonnull partial before
// presence/first0/unknown. Main holds an additional Source+Session child until
// closed; it never retires the original Main session. No fresh proof on retry.
ynx_wallet_shop_invoice_introspection_proof_acquisition_v1 ynx_wallet_shop_invoice_introspection_proof_acquire_v1(void*,ynx_wallet_shop_session_v1*,ynx_auth_shop_original_client_v1*,ynx_auth_shop_span_v1);
ynx_auth_shop_status_v1 ynx_wallet_shop_invoice_introspection_proof_current_actor_v1(void*,ynx_wallet_shop_invoice_introspection_proof_v1*,ynx_wallet_shop_session_v1*,ynx_auth_shop_original_client_v1*);
// Worker only: atomic original retire + SAME fixed monotonic proof window. No
// JS/NAPI/Root IO, fresh session expiry, refresh, signing or nonce generation.
ynx_auth_shop_status_v1 ynx_wallet_shop_invoice_introspection_proof_current_local_v1(ynx_wallet_shop_invoice_introspection_proof_v1*,ynx_wallet_shop_session_v1*,ynx_auth_shop_original_client_v1*);
// current pre/post; original header copied into caller buffer (<=16384), no
// truncation. issued/expires MUST come from THIS SAME sole-decoded/canonical-
// roundtrip original proof, not a second TTL field/caller or session current.
// Detached bounded output is retained even with late present first0. It is
// transport DATA, never a grant; header bytes may not change within this loan.
ynx_auth_shop_status_v1 ynx_wallet_shop_invoice_introspection_proof_copy_v1(void*,ynx_wallet_shop_invoice_introspection_proof_v1*,ynx_wallet_shop_session_v1*,ynx_auth_shop_original_client_v1*,uint8_t*,size_t,ynx_wallet_shop_invoice_introspection_proof_data_v1*);
ynx_auth_shop_status_v1 ynx_wallet_shop_invoice_introspection_proof_retire_v1(ynx_wallet_shop_invoice_introspection_proof_v1*);
// Join pending before physical close may progress SAME owner; unknown may not.
ynx_auth_shop_status_v1 ynx_wallet_shop_invoice_introspection_proof_join_v1(ynx_wallet_shop_invoice_introspection_proof_v1*);
// physical close is selected at most once; done and error/unknown independent.
ynx_auth_shop_status_v1 ynx_wallet_shop_invoice_introspection_proof_close_v1(ynx_wallet_shop_invoice_introspection_proof_v1*);
// Reference drop only AFTER actual physical close. This consumes the SAME child
// once, never its parent; done0/unknown is sticky, never a release retry.
ynx_auth_shop_status_v1 ynx_wallet_shop_invoice_introspection_proof_release_closed_v1(ynx_wallet_shop_invoice_introspection_proof_v1*);
#ifdef __cplusplus
}
static_assert(sizeof(ynx_wallet_shop_invoice_introspection_proof_data_v1)==40,"same original header16 + original times");
#endif
