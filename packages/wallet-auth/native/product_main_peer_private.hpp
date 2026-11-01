#pragma once
#include <node_api.h>
#include <memory>
#include <thread>
#include <string>
#include "pay_native_namespace_bootstrap_private.hpp"

namespace ynx::wallet::product {
struct MainContextDATA {std::string network_id,account;};
// Original Main context custody, NOT an independent ProductSource Root grant.
// Only capture() obtains a peer through the already-completed fixed namespace.
// There is no peer/path/provider/namespace setter or constructor accepting DTO.
class MainProductPeer final {
 napi_env env_;
 std::thread::id actor_;
 ynx::wallet::pay::MainNamespaceBorrow namespace_;
 napi_ref namespace_ref_=nullptr,peer_ref_=nullptr;
 bool retired_=false;
 explicit MainProductPeer(napi_env);
 napi_value invoke(const char*,size_t,napi_value*);
 public:
 ~MainProductPeer();
 MainProductPeer(const MainProductPeer&)=delete;
 MainProductPeer&operator=(const MainProductPeer&)=delete;
 // out adopts allocated peer and any Main error.partial before failure.
 static void capture(napi_env,napi_value same_native_owner,std::unique_ptr<MainProductPeer>&out);
 napi_value pay_preparation_reader(); // fixed Main zeroarg getter; not a provider
 void current();
 MainContextDATA read_context(); // public identity DATA, never qualification
 napi_value shop_original(napi_value order_id,napi_value combined_current);
 napi_value cloud_locator(napi_value original_ref,napi_value combined_current);
 // These return Main's actual Promise. Caller must retain self through exact
 // settlement; a returned Promise is not evidence of completed drain/close.
 napi_value retire_on_actor();
 napi_value join_on_actor();
 napi_value close_on_actor();
};
}
