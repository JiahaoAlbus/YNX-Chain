#pragma once
#include <node_api.h>
#include <memory>
#include <string>
#include "product_root_contract_private.hpp"
namespace ynx::wallet::product {
class OriginalProductRoot;
struct ProductAssemblyAccess;
class OriginalReadAssembly final {
 friend struct ProductAssemblyAccess;
 struct Impl;std::shared_ptr<Impl>impl_;
 explicit OriginalReadAssembly(std::shared_ptr<Impl>);
 public:
 ~OriginalReadAssembly();
 OriginalReadAssembly(const OriginalReadAssembly&)=delete;
 // SAME qualified root supplied by the original Native factory. No new Root
 // factory, caller Source JSON, session/JWT or protected path is accepted.
 static void capture(napi_env,napi_value same_native_owner,
    const std::shared_ptr<OriginalProductRoot>&,
    std::unique_ptr<OriginalReadAssembly>&out);
 void current();
 // Installs finite Native closures on this SAME owner; all callbacks hold
 // actual assembly state and cannot be rebound to a foreign receiver.
 void install(napi_value same_native_owner);
 void retire();
 // Finalizer/environment teardown only. Never invokes JS/Promise/Abort hooks;
 // native Root retirement is owned by the enclosing source stage.
 void retire_native_only() noexcept;
 napi_value join();
 napi_value close();
 void assert_safe_to_close();
 bool has_first_error()const;
 napi_value first_error()const; // may be null/false/undefined: presence separate
};
#ifdef YNX_PRODUCT_ASSEMBLY_PUBLIC_TEST_ONLY
namespace assembly_private {class Backend;}
// Explicit PUBLIC isolated test boundary; not compiled/exported in production.
void PUBLIC_adopt_product_assembly(napi_env,napi_value,
    std::unique_ptr<assembly_private::Backend>,std::unique_ptr<OriginalReadAssembly>&);
#endif
}
