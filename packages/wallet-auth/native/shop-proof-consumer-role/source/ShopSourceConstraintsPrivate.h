#pragma once
#include "native/ShopOriginalPrivateClient.h"
#ifdef __cplusplus
extern "C" {
#endif
// Copied ONLY from SAME held Go Source capture after full current before/after.
// Source epoch is not Main ShopSession generation. None of this DATA constructs
// or proves a session. No caller path/role/store/realm/provider setter.
typedef struct {
 uint32_t version,size,index,total;
 uint64_t source_epoch;
 ynx_auth_shop_span_v1 network_id,account,protected_resource_ref;
 ynx_auth_shop_span_v1 realm,tenant,actor,role,store_id,product_id,source_order;
} ynx_auth_shop_constraints_v1;
// index selects existing original readscope, not arbitrary Source orders.
// Returned spans remain held until client_release_closed. Do not free them.
ynx_auth_shop_status_v1 ynx_auth_shop_original_client_constraints_v1(ynx_auth_shop_original_client_v1*,uint32_t index,ynx_auth_shop_constraints_v1*);
#ifdef __cplusplus
}
#endif
