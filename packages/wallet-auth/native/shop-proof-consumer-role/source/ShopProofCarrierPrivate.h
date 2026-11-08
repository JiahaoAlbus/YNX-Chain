#pragma once
#include "native/ShopOriginalPrivateClient.h"
#include "native/OriginalProductSessionProofV2Private.h"
#include "ShopMainProofPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
// Private SAME-runtime CPP-to-original-Go bridge. Never exposed as a NAPI
// function receiving JS header strings or a Source/Root/proof installer.
// Proof comes solely from held Main typed loan; no codec or signer here.
typedef struct ynx_auth_shop_proof_borrow_v1 ynx_auth_shop_proof_borrow_v1;
// No raw header input: only the recognized SAME proof loan's synchronous
// worker borrow. Tokens never cross process/Node/JSON or outlive this call.
// uint8_t* matches the existing Go export ABI; implementation copies it and
// never writes the original order input.
ynx_auth_shop_status_v1 ynx_auth_shop_original_client_read_with_proof_v1(ynx_auth_shop_original_client_v1*,uint8_t*,size_t,ynx_auth_shop_proof_borrow_v1*,ynx_auth_shop_original_response_v1**);
ynx_auth_shop_status_v1 ynx_auth_shop_proof_borrow_current_v1(ynx_auth_shop_proof_borrow_v1*,ynx_auth_shop_original_client_v1*);
ynx_auth_shop_status_v1 ynx_auth_shop_proof_borrow_copy_v1(ynx_auth_shop_proof_borrow_v1*,ynx_auth_shop_original_client_v1*,uint8_t*,size_t,ynx_wallet_shop_invoice_introspection_proof_data_v1*);
#ifdef __cplusplus
}
#endif
