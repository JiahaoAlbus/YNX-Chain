#pragma once
#include <node_api.h>
#include <memory>
#include "ShopProductSourceBorrowPrivate.h"
namespace ynx::auth::shop::v4 {
// Actual Root-selected canonical module + fixed two function references, not a
// caller namespace/callback/URI. CODE-only proof never substitutes Source math.
class OriginalShopSDKNamespaceLoan final {
 struct Impl;std::shared_ptr<Impl>p_;
 explicit OriginalShopSDKNamespaceLoan(std::shared_ptr<Impl>);
 friend struct ShopNamespaceAccess;
public:
 ~OriginalShopSDKNamespaceLoan(); // no hidden release/reimport on GC
 ynx_auth_shop_status_v1 current()noexcept;
 ynx_auth_shop_status_v1 copy_original_refs(napi_value*namespace_original,napi_value functions[2])noexcept;
 // Private bridge only: registration-time intrinsic from this SAME namespace
 // owner. Never read promise.then or accept a caller supplied function.
 // Nonnull output is retained before a possible late current error.
 ynx_auth_shop_status_v1 copy_original_promise_then(napi_value*out)noexcept;
 ynx_auth_shop_status_v1 close()noexcept; // ONLY this additional namespace loan
};
struct ShopSDKNamespaceAcquisition {std::shared_ptr<OriginalShopSDKNamespaceLoan>owner;ynx_auth_shop_status_v1 status;};
ShopSDKNamespaceAcquisition borrow_original_shop_sdk_namespace_for_source(napi_env,ynx_auth_shop_product_source_borrow_v4*)noexcept;
}
// Private normal fixed Native entry. prepare(owner) actual Root-selected import
// completes before unchanged initialize(owner,genuineRead). No URI/captureFn.
napi_value RegisterOriginalShopSDKNamespaceBootstrap(napi_env,napi_value);
