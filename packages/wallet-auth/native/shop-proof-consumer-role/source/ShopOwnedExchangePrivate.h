#pragma once
#include "native/ShopOriginalPrivateClient.h"
#ifdef __cplusplus
extern "C" {
#endif
// Private cleanup-only progress for SAME original response. Not authority.
// true only while its actual LINK Join has not reached physical close; never
// permits another GET, acquisition, connection or selected UNKNOWN retry.
ynx_auth_shop_status_v1 ynx_auth_shop_original_response_drain_pending_v1(ynx_auth_shop_original_response_v1*,uint32_t*);
#ifdef __cplusplus
}
#endif
