#pragma once
#include <node_api.h>
#include <memory>
#include "product_root_contract_private.hpp"
namespace ynx::wallet::product {class OriginalProductRoot;}
namespace ynx::wallet::product::assembly_private {
// Internal original-callee adapters; no public registration/JSON/provider API.
class Permit {public:virtual void current()=0;virtual~Permit()=default;};
struct Completion {bool completed;const char*error;};
class Backend {public:
 virtual void initialize(napi_value same_owner)=0;
 virtual ProductScopeDATA scope()=0;
 virtual void current()=0;
 virtual std::shared_ptr<Permit>borrow(const std::string&,const ProductReference*)=0;
 virtual napi_value invoke(const std::string&,size_t,napi_value*,napi_value original_current,const ProductReference*)=0;
 virtual void retire_native_only()noexcept{}
 virtual napi_value retire()=0;
 virtual napi_value join()=0;
 virtual napi_value close()=0;
 virtual Completion finish_root_close()=0; // physical completion != first cause
 virtual~Backend()=default;
};
std::unique_ptr<Backend> make_normal_backend(napi_env,const std::shared_ptr<OriginalProductRoot>&);
}
