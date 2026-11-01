#include "pay_native_actual_context_private.hpp"
#include "pay_root_transport_loan_private.hpp"
#include <mutex>
#include <unordered_set>
struct ynx_wallet_pay_actual_context_v1 final {
 std::shared_ptr<ynx::wallet::pay::OriginalRootSource>root;
 std::shared_ptr<ynx::wallet::pay::MainNativeEpoch>main;
 ynx::wallet::pay::Binding binding;bool query;
 ynx_wallet_pay_root_transport_loan_v1*loan=nullptr;
 ynx_link_private_client_source_fence_v1 original_fence{};
 ynx_wallet_pay_source_lease_v1*source=nullptr;
 uint64_t references=1;bool retired=false,closed=false,adopt_selected=false;int32_t first=0,close_first=0;
 ynx_wallet_pay_actual_context_v1(std::shared_ptr<ynx::wallet::pay::OriginalRootSource>r,std::shared_ptr<ynx::wallet::pay::MainNativeEpoch>m,const ynx::wallet::pay::Binding&b,bool q):root(std::move(r)),main(std::move(m)),binding(b),query(q){}
};
namespace {
std::mutex mutex;std::unordered_set<ynx_wallet_pay_actual_context_v1*>inventory;
auto*known(void*raw){auto*p=static_cast<ynx_wallet_pay_actual_context_v1*>(raw);return p&&inventory.count(p)?p:nullptr;}
int32_t current(ynx_wallet_pay_actual_context_v1*p){if(!p)return 2;if(p->closed||p->retired||p->first)return p->first?p->first:1;const bool ok=p->root&&p->main&&p->loan&&p->original_fence.ctx&&p->original_fence.current&&p->main->current()&&p->root->current_native()==0&&p->root->matches_original_binding(p->binding,p->query)&&p->original_fence.current(p->original_fence.ctx)==0&&p->main->current();if(!ok){p->first=1;p->retired=true;return 1;}return 0;}
int32_t retain(void*raw){try{std::lock_guard<std::mutex>lock(mutex);auto*p=known(raw);auto status=current(p);if(status)return status;if(p->references==UINT64_MAX)return 2;p->references++;return 0;}catch(...){return 1;}}
void release(void*raw){try{std::lock_guard<std::mutex>lock(mutex);auto*p=known(raw);if(p&&!p->closed&&p->references>1)p->references--;/* First Native reference belongs to owner.close, not a foreign drop. */}catch(...){}}
}
namespace ynx::wallet::pay {
int32_t capture_original_pay_actual_context(std::shared_ptr<OriginalRootSource>root,std::shared_ptr<MainNativeEpoch>main,const Binding&binding,bool query,ynx_wallet_pay_actual_context_v1**out)noexcept{if(!out||*out)return 2;try{validate_binding(binding);if(!root||!main)return 1;auto*p=new ynx_wallet_pay_actual_context_v1(std::move(root),std::move(main),binding,query);{std::lock_guard<std::mutex>lock(mutex);inventory.insert(p);}*out=p;const auto status=capture_original_pay_root_transport(p->root,p->binding,p->query,&p->loan);if(status){p->first=status;p->retired=true;return status;}if(ynx_wallet_pay_root_transport_fence_v1(p->loan,&p->original_fence)!=0){p->first=1;p->retired=true;return 1;}return ynx_wallet_pay_ctx_current_v1(p);}catch(...){return 1;}}
}
extern "C" int32_t ynx_wallet_pay_ctx_current_v1(void*raw){try{std::lock_guard<std::mutex>lock(mutex);return current(known(raw));}catch(...){return 1;}}
extern "C" int32_t ynx_wallet_pay_ctx_get_original_loan_v1(ynx_wallet_pay_actual_context_v1*raw,ynx_wallet_pay_root_transport_loan_v1**out){if(!out)return 2;*out=nullptr;try{std::lock_guard<std::mutex>lock(mutex);auto*p=known(raw);auto status=current(p);if(status)return status;*out=p->loan;return 0;}catch(...){return 1;}}
extern "C" int32_t ynx_wallet_pay_ctx_get_fence_v1(ynx_wallet_pay_actual_context_v1*raw,ynx_link_private_client_source_fence_v1*out){if(!out)return 2;*out={};try{std::lock_guard<std::mutex>lock(mutex);auto*p=known(raw);auto status=current(p);if(status)return status;*out={p,ynx_wallet_pay_ctx_current_v1,retain,release};return 0;}catch(...){return 1;}}
extern "C" int32_t ynx_wallet_pay_source_adopt_registration_v1(ynx_wallet_pay_actual_context_v1*raw,ynx_link_private_client_registration_borrow_v1*borrow,ynx_wallet_pay_source_lease_v1**out){if(!out||*out||!borrow)return 2;try{std::lock_guard<std::mutex>lock(mutex);auto*p=known(raw);auto status=current(p);if(status)return status;if(p->adopt_selected)return 1;p->adopt_selected=true;status=ynx::wallet::pay::borrow_original_pay_source_lease(p->root,p->main,borrow,p->binding,p->query,out);if(*out)p->source=*out;return status;}catch(...){return 1;}}
extern "C" void ynx_wallet_pay_ctx_retire_v1(ynx_wallet_pay_actual_context_v1*raw){try{std::lock_guard<std::mutex>lock(mutex);if(auto*p=known(raw)){if(p->closed)return;p->retired=true;if(p->main)p->main->retire();if(p->loan)ynx_wallet_pay_root_transport_retire_v1(p->loan);}}catch(...){}}
extern "C" int32_t ynx_wallet_pay_ctx_close_v1(ynx_wallet_pay_actual_context_v1*raw){try{std::lock_guard<std::mutex>lock(mutex);auto*p=known(raw);if(!p)return 2;if(p->closed)return p->close_first;p->retired=true;if(p->main)p->main->retire();if(p->loan)ynx_wallet_pay_root_transport_retire_v1(p->loan);if(p->references!=1){if(!p->close_first)p->close_first=5;return p->close_first;}if(p->source&&!ynx_wallet_pay_source_lease_drained_v1(p->source)){if(!p->close_first)p->close_first=5;return p->close_first;}if(p->loan){auto code=ynx_wallet_pay_root_transport_close_v1(p->loan);if(code&&!p->close_first)p->close_first=code;if(!ynx_wallet_pay_root_transport_closed_v1(p->loan))return p->close_first?p->close_first:5;p->loan=nullptr;}p->root.reset();p->main.reset();p->closed=true;return p->close_first;}catch(...){return 1;}}
extern "C" int32_t ynx_wallet_pay_ctx_closed_v1(ynx_wallet_pay_actual_context_v1*raw){try{std::lock_guard<std::mutex>lock(mutex);auto*p=known(raw);return p&&p->closed?1:0;}catch(...){return 0;}}
