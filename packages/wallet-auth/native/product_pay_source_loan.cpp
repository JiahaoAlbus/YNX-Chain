#include "product_pay_source_loan_private.hpp"
#include "product_pay_routes_private.hpp"
#include "product_source_permission_private.hpp"
#include <atomic>
#include <mutex>
#include <algorithm>
#include <limits>
using namespace ynx::wallet::product;
struct ynx_product_pay_source_loan_v1 {
 std::atomic<ynx_product_pay_source_loan_v1*>next{nullptr};
 std::atomic<uint32_t>references{1},active{0};std::atomic<bool>retired{false};
 std::mutex actor;
 std::shared_ptr<OriginalProductRoot>root;
 std::shared_ptr<ProductPayResourceRoot>resource;
 std::shared_ptr<ynx_auth_private::ProductObservedPermission>permission;
 ProductPayResourceProfileDATA profile;uint32_t operation=0;
};
namespace {
// Non-reused tombstones prevent stale-pointer ABA and allow pure bounded
// atomic current with NO mutex/shared_ptr increments. Dead nodes keep no FD,
// permission or parent. Finite process lifetime cap denies further minting.
std::atomic<ynx_product_pay_source_loan_v1*>inventory{nullptr};
std::atomic<uint32_t>nodes{0};constexpr uint32_t maximum_nodes=65536;
ynx_product_pay_source_loan_v1*recognized(ynx_product_pay_source_loan_v1*p){
 for(auto*x=inventory.load(std::memory_order_acquire);x;x=x->next.load(std::memory_order_acquire))if(x==p)return x;
 return nullptr;
}
struct Activity {
 ynx_product_pay_source_loan_v1*p=nullptr;
 explicit Activity(ynx_product_pay_source_loan_v1*x){x=recognized(x);if(!x)return;
  x->active.fetch_add(1,std::memory_order_acq_rel);
  if(x->retired.load(std::memory_order_acquire)||!x->references.load(std::memory_order_acquire)){x->active.fetch_sub(1,std::memory_order_acq_rel);return;}p=x;}
 ~Activity(){if(p)p->active.fetch_sub(1,std::memory_order_acq_rel);}
};
ynx_product_pay_bytes_v1 bytes(const std::string&s){return{reinterpret_cast<const unsigned char*>(s.data()),s.size()};}
int current(ynx_product_pay_source_loan_v1*p){return p&&p->permission&&p->resource&&p->resource->current_no_io()==0&&p->permission->current_native()==0?0:1;}
}
namespace ynx::wallet::product {
int32_t borrow_original_product_pay_source(const std::shared_ptr<OriginalProductRoot>&root,
 const std::shared_ptr<ProductPayResourceRoot>&resource,uint32_t operation,ynx_product_pay_source_loan_v1**out)noexcept{
 if(!out||*out||!root||!resource||operation>=14||operation==YNX_PRODUCT_ORIGINAL_INTENT)return 1;
 try{
  ProductPayResourceProfileDATA profile;if(resource->copy_profile_DATA(profile))return 1;
  const auto*op=product_pay_routes_v1[operation].operation;
  if(std::find(profile.operations.begin(),profile.operations.end(),op)==profile.operations.end())return 1;
  std::shared_ptr<ynx_auth_private::ProductObservedPermission>permission;
  int32_t rc=borrow_original_product_read_permission(root,op,nullptr,permission);
  if(!permission)return 1;
  uint32_t used=nodes.load(std::memory_order_acquire);
  do{if(used>=maximum_nodes)return 1;}while(!nodes.compare_exchange_weak(used,used+1,std::memory_order_acq_rel));
  auto*p=new ynx_product_pay_source_loan_v1;p->root=root;p->resource=resource;p->permission=std::move(permission);p->profile=std::move(profile);p->operation=operation;
  auto*old=inventory.load(std::memory_order_relaxed);do{p->next.store(old,std::memory_order_relaxed);}while(!inventory.compare_exchange_weak(old,p,std::memory_order_release,std::memory_order_relaxed));
  *out=p; // partial custody BEFORE any late full/current failure
  if(rc||resource->current()||recheck_original_product_root(root)||current(p)){p->retired.store(true,std::memory_order_release);return 1;}
  return 0;
 }catch(...){return 1;}
}
}
extern "C" int32_t ynx_product_pay_source_profile_v1(ynx_product_pay_source_loan_v1*p,ynx_product_pay_profile_v1*out){
 if(!out)return 1;try{Activity held(p);if(!held.p)return 1;p=held.p;std::lock_guard<std::mutex>l(p->actor);
  if(p->resource->current()||recheck_original_product_root(p->root)||current(p))return 1;
  const auto&v=p->profile;ynx_product_pay_profile_v1 copy{};copy.version=1;copy.size=sizeof copy;
  copy.resource_ref=bytes(v.resource_ref);copy.network_id=bytes(v.network_id);copy.account=bytes(v.account);copy.epoch=bytes(v.epoch);copy.origin=bytes(v.origin);copy.socket=bytes(v.socket);copy.service=bytes(v.service);
  copy.peer_uid=v.peer_uid;copy.peer_pid=v.peer_pid;copy.timeout_ms=v.timeout_ms;copy.max_header_bytes=v.max_header_bytes;copy.max_response_bytes=v.max_response_bytes;
  copy.enabled_operations=uint32_t(1)<<p->operation;
  if(current(p)||p->resource->current())return 1;*out=copy;return 0;
 }catch(...){return 1;}
}
extern "C" int32_t ynx_product_pay_source_full_current_v1(ynx_product_pay_source_loan_v1*p){
 try{Activity held(p);if(!held.p)return 1;p=held.p;std::lock_guard<std::mutex>l(p->actor);
  if(p->resource->current()||recheck_original_product_root(p->root)||current(p)){p->retired.store(true,std::memory_order_release);return 1;}return 0;
 }catch(...){return 1;}
}
extern "C" int32_t ynx_product_pay_source_current_no_io_v1(ynx_product_pay_source_loan_v1*p){
 Activity held(p);if(!held.p)return 1;if(current(held.p)){held.p->retired.store(true,std::memory_order_release);return 1;}return 0;
}
extern "C" int32_t ynx_product_pay_source_retain_v1(ynx_product_pay_source_loan_v1*p){
 Activity held(p);if(!held.p)return 1;uint32_t n=p->references.load(std::memory_order_acquire);
 do{if(!n||n==UINT32_MAX)return 1;}while(!p->references.compare_exchange_weak(n,n+1,std::memory_order_acq_rel));return 0;
}
extern "C" int32_t ynx_product_pay_source_release_v1(ynx_product_pay_source_loan_v1*p){
 p=recognized(p);if(!p)return 1;try{std::lock_guard<std::mutex>l(p->actor);uint32_t n=p->references.load(std::memory_order_acquire);
  if(!n)return 1;if(n>1){p->references.fetch_sub(1,std::memory_order_acq_rel);return 0;}
  p->retired.store(true,std::memory_order_release);
  if(p->active.load(std::memory_order_acquire))return 2; // SAME debt; drain release only, no retry dispatch
  p->references.store(0,std::memory_order_release);p->permission.reset();p->resource.reset();p->root.reset();return 0;
 }catch(...){return 1;}
}
