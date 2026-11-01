#include "pay_native_source_lease_private.hpp"
#include "pay_native_runtime_private.hpp"
#include <mutex>
#include <unordered_set>

struct ynx_wallet_pay_source_lease_v1 final {
 std::shared_ptr<ynx::wallet::pay::OriginalRootSource>root;
 std::shared_ptr<ynx::wallet::pay::MainNativeEpoch>main;
 uint64_t references=1;
 bool closed=false;
 int32_t first=0;
 ynx_link_private_client_registration_borrow_v1*registration=nullptr;
 std::optional<ynx::wallet::pay::Binding>binding=std::nullopt;
 bool query=false;
};
namespace {std::mutex heldMutex;std::unordered_set<ynx_wallet_pay_source_lease_v1*>held;}
namespace ynx::wallet::pay {
int32_t borrow_original_pay_source_lease(std::shared_ptr<OriginalRootSource>root,std::shared_ptr<MainNativeEpoch>main,ynx_wallet_pay_source_lease_v1**out){
 if(!out)return YNX_PAY_SOURCE_ARGUMENT;*out=nullptr;
 if(!root)return YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED;
 if(!main)return YNX_PAY_SOURCE_MAIN_EPOCH_NOT_SUPPLIED;
 auto*p=new(std::nothrow)ynx_wallet_pay_source_lease_v1{std::move(root),std::move(main)};if(!p)return YNX_PAY_SOURCE_ARGUMENT;
 {std::lock_guard<std::mutex>lock(heldMutex);held.insert(p);}*out=p;return ynx_wallet_pay_source_lease_current_v1(p);
}
int32_t borrow_original_pay_source_lease(std::shared_ptr<OriginalRootSource>root,std::shared_ptr<MainNativeEpoch>main,ynx_link_private_client_registration_borrow_v1*registration,const Binding&binding,bool query,ynx_wallet_pay_source_lease_v1**out){
 if(!out)return YNX_PAY_SOURCE_ARGUMENT;*out=nullptr;if(!registration)return YNX_PAY_SOURCE_ARGUMENT;
 try{validate_binding(binding);}catch(...){return YNX_PAY_SOURCE_ARGUMENT;}
 if(!root)return YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED;if(!root->matches_original_binding(binding,query))return YNX_PAY_SOURCE_DENIED;
 const auto code=borrow_original_pay_source_lease(std::move(root),std::move(main),out);if(*out){std::lock_guard<std::mutex>lock(heldMutex);(*out)->registration=registration;(*out)->binding=binding;(*out)->query=query;}return code?code:ynx_wallet_pay_source_lease_current_v1(*out);
}
int32_t borrow_original_pay_runtime(ynx_wallet_pay_source_lease_v1*source,const Binding&constraint,bool query,ynx_link_private_client_registration_v1**out,ynx_link_private_client_source_fence_v1*fence)noexcept{
 if(!out||!fence)return YNX_PAY_SOURCE_ARGUMENT;*out=nullptr;*fence={};const auto status=ynx_wallet_pay_source_lease_current_v1(source);if(status)return status;
 std::lock_guard<std::mutex>lock(heldMutex);if(!source||!held.count(source)||source->closed||!source->registration||!source->binding||!(*source->binding==constraint)||source->query!=query||!source->root||!source->root->matches_original_binding(constraint,query))return YNX_PAY_SOURCE_ARGUMENT;
 if(ynx_link_private_client_registration_from_borrow_v1(source->registration,out)!=0||!*out){*out=nullptr;return YNX_PAY_SOURCE_DENIED;}*fence={source,ynx_wallet_pay_source_lease_current_v1,ynx_wallet_pay_source_fence_retain_v1,ynx_wallet_pay_source_fence_release_v1};return YNX_PAY_SOURCE_CURRENT;
}
}
extern "C" int32_t ynx_wallet_pay_source_lease_retain_v1(ynx_wallet_pay_source_lease_v1*p,ynx_wallet_pay_source_lease_v1**out){
 if(!out)return YNX_PAY_SOURCE_ARGUMENT;*out=nullptr;const auto status=ynx_wallet_pay_source_fence_retain_v1(p);if(status==YNX_PAY_SOURCE_CURRENT)*out=p;return status;
}
static int32_t source_current_impl(void*ctx){
 auto*p=static_cast<ynx_wallet_pay_source_lease_v1*>(ctx);std::shared_ptr<ynx::wallet::pay::OriginalRootSource>r;std::shared_ptr<ynx::wallet::pay::MainNativeEpoch>m;
 {std::lock_guard<std::mutex>lock(heldMutex);if(!p||!held.count(p))return YNX_PAY_SOURCE_ARGUMENT;if(p->closed)return YNX_PAY_SOURCE_CLOSED;if(p->first)return p->first;r=p->root;m=p->main;}
 if(!r)return YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED;if(!m)return YNX_PAY_SOURCE_MAIN_EPOCH_NOT_SUPPLIED;
 // The held mutex prevents the final Source drop from releasing this borrow
 // during its pure-native observed-current check. No Go/JS/OS call is made.
 {std::lock_guard<std::mutex>lock(heldMutex);if(p->closed)return YNX_PAY_SOURCE_CLOSED;if((p->binding&&!r->matches_original_binding(*p->binding,p->query))||(p->registration&&ynx_link_private_client_registration_borrow_current_v1(p->registration)!=0)){if(!p->first)p->first=YNX_PAY_SOURCE_DENIED;return p->first;}}
 const auto status=!m->current()?YNX_PAY_SOURCE_DENIED:r->current_native();const auto checked=status!=YNX_PAY_SOURCE_CURRENT?status:m->current()?YNX_PAY_SOURCE_CURRENT:YNX_PAY_SOURCE_DENIED;
 {std::lock_guard<std::mutex>lock(heldMutex);if(p->closed)return YNX_PAY_SOURCE_CLOSED;if(checked&&!p->first)p->first=checked;return p->first;}
}
extern "C" int32_t ynx_wallet_pay_source_lease_current_v1(void*ctx){try{return source_current_impl(ctx);}catch(...){return YNX_PAY_SOURCE_DENIED;}}
extern "C" void ynx_wallet_pay_source_lease_retire_v1(ynx_wallet_pay_source_lease_v1*p){std::shared_ptr<ynx::wallet::pay::MainNativeEpoch>m;{std::lock_guard<std::mutex>lock(heldMutex);if(!p||!held.count(p))return;m=p->main;}if(m)m->retire();}
static void source_drop_impl(ynx_wallet_pay_source_lease_v1*p){std::lock_guard<std::mutex>lock(heldMutex);if(!p||!held.count(p)||p->closed)return;if(--p->references==0){p->closed=true;if(p->registration){const auto released=ynx_link_private_client_registration_borrow_release_v1(p->registration);if(released!=0){if(!p->first)p->first=YNX_PAY_SOURCE_DENIED;return;}p->registration=nullptr;}p->root.reset();p->main.reset();}/* Keep address tombstone and failed release debt: never retry/free UNKNOWN. */}
extern "C" void ynx_wallet_pay_source_lease_drop_v1(ynx_wallet_pay_source_lease_v1*p){try{source_drop_impl(p);}catch(...){/* Preserve original custody, never throw through C or retry. */}}
static int32_t source_retain_impl(void*ctx){
 const auto status=ynx_wallet_pay_source_lease_current_v1(ctx);if(status!=YNX_PAY_SOURCE_CURRENT)return status;auto*p=static_cast<ynx_wallet_pay_source_lease_v1*>(ctx);
 std::lock_guard<std::mutex>lock(heldMutex);if(!p||!held.count(p)||p->closed||p->references==UINT64_MAX)return YNX_PAY_SOURCE_CLOSED;p->references++;return YNX_PAY_SOURCE_CURRENT;
}
extern "C" int32_t ynx_wallet_pay_source_fence_retain_v1(void*ctx){try{return source_retain_impl(ctx);}catch(...){return YNX_PAY_SOURCE_DENIED;}}
extern "C" void ynx_wallet_pay_source_fence_release_v1(void*ctx){ynx_wallet_pay_source_lease_drop_v1(static_cast<ynx_wallet_pay_source_lease_v1*>(ctx));}
extern "C" int32_t ynx_wallet_pay_source_lease_drained_v1(ynx_wallet_pay_source_lease_v1*p){try{std::lock_guard<std::mutex>lock(heldMutex);return p&&held.count(p)&&p->closed&&!p->registration&&!p->root&&!p->main?1:0;}catch(...){return 0;}}
