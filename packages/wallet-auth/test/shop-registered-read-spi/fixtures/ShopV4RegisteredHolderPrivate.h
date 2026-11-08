#pragma once
#include "ShopProductSourceBorrowPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Fixed SDK private bridge: REQUIRED strong implementation, not a public
 * setter, JS callback, arbitrary holder, header, URL, scopes or TTL input.
 * capture is called ONLY by the original normal factory holding genuineRead.
 * It must use captureOriginalRegisteredClientReadHolder(read) and compare SAME
 * Source account/network/order constraints with the sole account codec and
 * original registered device/session inventory. A plain shape is insufficient.
 * No implementation is supplied by the PUBLIC mechanism fixture. */
typedef struct ynx_sdk_shop_registered_read_v4 ynx_sdk_shop_registered_read_v4;
typedef struct ynx_sdk_shop_get_proof_v4 ynx_sdk_shop_get_proof_v4;
typedef struct {ynx_sdk_shop_registered_read_v4* owner;ynx_auth_shop_status_v1 status;} ynx_sdk_shop_registered_read_acquisition_v4;
typedef struct {ynx_sdk_shop_get_proof_v4* owner;ynx_auth_shop_status_v1 status;} ynx_sdk_shop_get_proof_acquisition_v4;
typedef struct {
 uint32_t version,size,ready,reserved;
 ynx_auth_shop_span_v1 header_original;
 int64_t issued_at_ms,expires_at_ms;
} ynx_sdk_shop_get_proof_original_v4;
enum {YNX_SHOP_V4_HEADER_MAX=196608,YNX_SHOP_V4_TOTAL_HEADERS_MAX=262144};
/* NEW typed SAME ProductSource child cohort, NOT the old Go C Source pointer.
 * Fixed bridge independently checks genuine read/device/current inventories
 * plus Source scope6 network/account/op/selected-shop-order DATA. This Source
 * is separately recognized against SAME ProductParent; no equality of two
 * different-purpose Source objects or ResourceRef=>SourceID is asserted. */
ynx_sdk_shop_registered_read_acquisition_v4 ynx_sdk_shop_registered_read_capture_for_product_child_v4(void* actual_env,void* genuine_read,ynx_auth_shop_product_source_borrow_v4*);
ynx_auth_shop_status_v1 ynx_sdk_shop_registered_read_current_for_product_child_v4(void*,ynx_sdk_shop_registered_read_v4*,ynx_auth_shop_product_source_borrow_v4*);
/* Fixed zeroarg loan.readOriginalNativeDeviceSource() read, not caller input.
 * Borrowed SAME-env napi_value in out, valid while this genuine holder lives.
 * Nonnull output must be adopted before late error. Auth retains a NAPI ref;
 * it never closes or retires the original DEVICE Source. */
ynx_auth_shop_status_v1 ynx_sdk_shop_registered_read_original_device_source_v4(void*actual_env,ynx_sdk_shop_registered_read_v4*,void**out_original_napi_device_source);
/* Schedules original createBusinessProof ONCE. Bridge derives the fixed GET
 * path /v5/shop/source/shop.order/invoice-intents/<originalOrder>, body='', and
 * its independently registered scopes. No POST introspect or V2 fallback.
 * Reserve/adopt the proof child before awaiting. A later copy merely observes
 * the SAME promise/result; it cannot call createBusinessProof again. */
ynx_sdk_shop_get_proof_acquisition_v4 ynx_sdk_shop_registered_read_begin_original_get_for_product_child_v4(void*,ynx_sdk_shop_registered_read_v4*,ynx_auth_shop_product_source_borrow_v4*,ynx_auth_shop_span_v1 original_order);
ynx_auth_shop_status_v1 ynx_sdk_shop_get_proof_current_for_product_child_v4(void*,ynx_sdk_shop_get_proof_v4*,ynx_sdk_shop_registered_read_v4*,ynx_auth_shop_product_source_borrow_v4*);
/* ready=0 means known pending, not permission. Only a SAME sole decoded and
 * canonical-roundtripped V4 result may set ready=1. Times MUST be decoded from
 * that original header; session-current never renews them. Output is detached
 * into caller buffer even on late error. No C++ JSON/base64/crypto parser. */
ynx_auth_shop_status_v1 ynx_sdk_shop_get_proof_copy_original_v4(void*,ynx_sdk_shop_get_proof_v4*,uint8_t*,size_t,ynx_sdk_shop_get_proof_original_v4*);
ynx_auth_shop_status_v1 ynx_sdk_shop_get_proof_retire_v4(void*,ynx_sdk_shop_get_proof_v4*);
ynx_auth_shop_status_v1 ynx_sdk_shop_get_proof_join_v4(void*,ynx_sdk_shop_get_proof_v4*);
ynx_auth_shop_status_v1 ynx_sdk_shop_get_proof_close_v4(void*,ynx_sdk_shop_get_proof_v4*);
ynx_auth_shop_status_v1 ynx_sdk_shop_registered_read_retire_v4(void*,ynx_sdk_shop_registered_read_v4*);
ynx_auth_shop_status_v1 ynx_sdk_shop_registered_read_join_v4(void*,ynx_sdk_shop_registered_read_v4*);
ynx_auth_shop_status_v1 ynx_sdk_shop_registered_read_close_v4(void*,ynx_sdk_shop_registered_read_v4*);
/* Each close releases ONLY this additional SDK child, never global read or
 * original DEVICE/current. done and first0 are independent. Join known-pending
 * may progress; a selected close without done becomes sticky UNKNOWN. */
#ifdef __cplusplus
}
static_assert(sizeof(ynx_sdk_shop_get_proof_original_v4)==48,"V4 original snapshot48, not V2 snapshot40");
#endif
