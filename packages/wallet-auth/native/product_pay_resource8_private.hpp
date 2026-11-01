#pragma once
#include <node_api.h>
#include "product_pay_source_loan_private.hpp"
#include <memory>
namespace ynx::wallet::product {
class MainProductPeer;
// SAME ProductRoot only. No independent Root factory, runtime selector,
// renderer config, transport provider, or JS permission setter.
class ProductPayResource8 final {
 struct Impl;std::shared_ptr<Impl>impl_;explicit ProductPayResource8(std::shared_ptr<Impl>);
 public:~ProductPayResource8();
 static void capture(napi_env,const std::shared_ptr<OriginalProductRoot>&,
                     std::unique_ptr<ProductPayResource8>&out);
 napi_value resource_DATA(); // exact8 frozen private Main constructor input
 void install_main_inputs(napi_value same_native_owner);
 napi_value bind_original_main_reader(MainProductPeer&); // owned actual ready Promise
 napi_value invoke_bound_original(uint32_t,size_t,napi_value*,napi_value);
 napi_value retire_main_reader();napi_value join_main_reader();napi_value close_main_reader();
 void current();
 // Only Native backend calls this typed entry. requestPrivate alone always
 // refuses without this non-serializable actor-local one-use call slot.
 napi_value invoke_original(uint32_t operation,napi_value same_producer,
                            size_t argc,napi_value*args,napi_value original_current);
 void retire_native_only()noexcept;
 void retire();napi_value join();napi_value close();
 bool drain_original(); // same-owner drain only, never re-dispatch
 bool physically_closed()const noexcept;
};
}
