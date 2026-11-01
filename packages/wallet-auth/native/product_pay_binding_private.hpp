#pragma once
#include "product_pay_resource8_private.hpp"
#include "product_main_peer_private.hpp"
namespace ynx::wallet::product {
// Independent backend-owned child. initialize never retires the entire genuine
// Product Root for a missing Pay resource/getter; only Pay calls refuse. Any
// allocated resource/provided original partial stays held for cleanup.
class ProductPayBinding final {
 struct Impl;std::shared_ptr<Impl>impl_;
 public:explicit ProductPayBinding(napi_env);~ProductPayBinding();
 void initialize(const std::shared_ptr<OriginalProductRoot>&,napi_value same_owner,MainProductPeer&);
 napi_value invoke(const std::string&,size_t,napi_value*,napi_value);
 void retire_native_only()noexcept;
 // Actual child first, then Main parent only on real successful settlement.
 napi_value retire_then_main();napi_value join_then_main();napi_value close_then_main();
 bool resource_physically_closed()const noexcept;
};
}
