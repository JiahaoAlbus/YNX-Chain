#pragma once
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
// PRIVATE same-process Source-owned client, NOT an externally serialized ID.
// Independent wallet-native-product-source-v1 Root/current and registered
// resource authorize the finite Shop read. No URL/path/account/provider setter.
typedef struct ynx_auth_shop_original_client_v1 ynx_auth_shop_original_client_v1;
typedef struct ynx_auth_shop_original_response_v1 ynx_auth_shop_original_response_v1;
typedef struct {uint32_t error_present;int32_t first_code;uint32_t unknown,physical_done;} ynx_auth_shop_status_v1;
typedef struct {ynx_auth_shop_original_client_v1*owner;ynx_auth_shop_status_v1 status;} ynx_auth_shop_acquisition_v1;
typedef struct {const uint8_t*bytes;size_t length;} ynx_auth_shop_span_v1;
typedef struct {uint32_t version,size,status_code;ynx_auth_shop_span_v1 method,path,content_type,body_original;} ynx_auth_shop_transport_v1;
// Nonnull owner is adopted before every status, including error_present/code0.
ynx_auth_shop_acquisition_v1 ynx_auth_shop_original_client_acquire_v1(void);
ynx_auth_shop_status_v1 ynx_auth_shop_original_client_current_v1(ynx_auth_shop_original_client_v1*);
// Existing ScopeDATA6 copied from SAME held Source, DATA only; no constructor.
ynx_auth_shop_status_v1 ynx_auth_shop_original_client_scope_v1(ynx_auth_shop_original_client_v1*,ynx_auth_shop_span_v1*);
ynx_auth_shop_status_v1 ynx_auth_shop_original_client_read_v1(ynx_auth_shop_original_client_v1*,uint8_t*order_id,size_t,ynx_auth_shop_original_response_v1**);
ynx_auth_shop_status_v1 ynx_auth_shop_original_response_copy_v1(ynx_auth_shop_original_response_v1*,ynx_auth_shop_transport_v1*);
ynx_auth_shop_status_v1 ynx_auth_shop_original_response_release_v1(ynx_auth_shop_original_response_v1*);
ynx_auth_shop_status_v1 ynx_auth_shop_original_client_retire_v1(ynx_auth_shop_original_client_v1*);
ynx_auth_shop_status_v1 ynx_auth_shop_original_client_join_v1(ynx_auth_shop_original_client_v1*,uint32_t timeout_ms);
ynx_auth_shop_status_v1 ynx_auth_shop_original_client_close_v1(ynx_auth_shop_original_client_v1*);
// Releases only after actual physical_done. UNKNOWN keeps SAME owner; it is
// never reclaimed by GC or replaced by another acquisition/GET/nonce.
ynx_auth_shop_status_v1 ynx_auth_shop_original_client_release_closed_v1(ynx_auth_shop_original_client_v1*);
#ifdef __cplusplus
}
#endif
