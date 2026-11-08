#pragma once
#include "native/ShopOriginalPrivateClient.h"
#include "ShopSourceConstraintsPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
// PRIVATE Wallet retained-session consumption port, not a business issuer.
// P07 owns the genuine ShopSession issuer/custody using accepted V2 original
// challenge/complete/introspect/revoke/current. Wallet only holds the ORIGINAL
// authenticated result plus its protected approval context and synchronous
// retire association; neither account login nor guard nor Source epoch mints
// a ShopSession. No provider/JSON/namespace/path setter.
// Capture must retain that P07 original session for SAME acquired Auth Source
// and preserve the actual generation/TTL/subject/role. Source
// scope is comparison DATA, never a Main session authority or new capability.
typedef struct ynx_wallet_shop_session_v1 ynx_wallet_shop_session_v1;
typedef struct {ynx_wallet_shop_session_v1*owner;ynx_auth_shop_status_v1 status;} ynx_wallet_shop_session_acquisition_v1;
ynx_wallet_shop_session_acquisition_v1 ynx_wallet_shop_session_acquire_for_source_v1(void* actual_napi_env,ynx_auth_shop_original_client_v1*);
// Actor current is the real fixed Main/ShopSession current. Worker current is
// ONLY native atomic revocation + the SAME fixed monotonic TTL; it must never
// call JS/NAPI/Root/FD/IPC or renew the session. Main retirement synchronously
// invalidates this child before asynchronous disposal.
ynx_auth_shop_status_v1 ynx_wallet_shop_session_current_actor_v1(void* actual_napi_env,ynx_wallet_shop_session_v1*,ynx_auth_shop_original_client_v1*);
ynx_auth_shop_status_v1 ynx_wallet_shop_session_current_local_v1(ynx_wallet_shop_session_v1*,ynx_auth_shop_original_client_v1*);
// Per-order current binds actual session subject/realm/tenant/role/store to
// SAME Source's typed original constraints, not navigation or copied Shop DTO.
ynx_auth_shop_status_v1 ynx_wallet_shop_session_current_order_actor_v1(void* actual_napi_env,ynx_wallet_shop_session_v1*,ynx_auth_shop_original_client_v1*,ynx_auth_shop_span_v1 original_order);
ynx_auth_shop_status_v1 ynx_wallet_shop_session_retire_v1(ynx_wallet_shop_session_v1*);
ynx_auth_shop_status_v1 ynx_wallet_shop_session_close_v1(ynx_wallet_shop_session_v1*);
ynx_auth_shop_status_v1 ynx_wallet_shop_session_release_closed_v1(ynx_wallet_shop_session_v1*);
#ifdef __cplusplus
}
#endif
