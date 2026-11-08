#pragma once
#include "../ShopProofCarrierPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
ynx_auth_shop_status_v1 public_shop_proof_read(ynx_auth_shop_original_client_v1*,uint8_t*,size_t,const uint8_t*,size_t,ynx_auth_shop_original_response_v1**);
ynx_auth_shop_status_v1 public_shop_proof_close(void);
void public_shop_proof_revoke(void);
void public_shop_proof_counts(uint32_t[3]);
#ifdef __cplusplus
}
#endif
