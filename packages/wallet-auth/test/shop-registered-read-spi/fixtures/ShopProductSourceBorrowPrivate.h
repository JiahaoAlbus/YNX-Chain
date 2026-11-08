#pragma once
#include "native/ShopOriginalPrivateClient.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Opaque token recognized by Auth's SAME-process/env/actor inventory BEFORE
 * dereference. This is NOT ynx_auth_shop_original_client_v1 or a Go pointer.
 * No acquire/register/fromJSON/Source setter is exported. Only the actual Slot
 * initializer can hold an OriginalProductShopBorrow from SAME ProductOwner. */
typedef struct ynx_auth_shop_product_source_borrow_v4 ynx_auth_shop_product_source_borrow_v4;
typedef struct {ynx_auth_shop_span_v1 product_id,source_order;} ynx_auth_shop_product_reference_data_v4;
typedef struct {
 uint32_t version,size;
 ynx_auth_shop_span_v1 network_id,account,protected_resource_ref;
 uint32_t operation_count,product_count;
 ynx_auth_shop_span_v1 operations[16];
 ynx_auth_shop_product_reference_data_v4 products[64];
} ynx_auth_shop_product_scope_data_v4;
/* Source comparison DATA never establishes DEVICE/session/relation authority.
 * The SDK fixed bridge must independently recognize the genuine read/DEVICE/
 * current private inventories. ProductParent recognition is a separate AND;
 * it does not claim identity equality between two different purpose Sources.
 * No callback, header, URL, namespace or TTL input. No worker/JS fallback. */
ynx_auth_shop_status_v1 ynx_auth_shop_product_source_current_v4(void* actual_env,ynx_auth_shop_product_source_borrow_v4*);
ynx_auth_shop_status_v1 ynx_auth_shop_product_source_matches_parent_v4(void* actual_env,ynx_auth_shop_product_source_borrow_v4*,void* SAME_original_product_owner);
ynx_auth_shop_status_v1 ynx_auth_shop_product_source_copy_scope_v4(void* actual_env,ynx_auth_shop_product_source_borrow_v4*,uint8_t*buffer,size_t capacity,ynx_auth_shop_product_scope_data_v4*);
#ifdef __cplusplus
}
#endif
