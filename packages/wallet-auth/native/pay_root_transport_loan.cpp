#include "pay_root_transport_loan_private.hpp"
#include <mutex>
#include <vector>
#include <memory>
#include <cstring>
#include <algorithm>
struct ynx_wallet_pay_root_transport_loan_v1 {
 std::shared_ptr<ynx::wallet::pay::OriginalRootSource>root;
 ynx::wallet::pay::Binding binding;bool query=false,retired=false,closed=false;
 uint64_t borrows=0;int32_t first=0,close_cause=0;
};
namespace {
std::mutex inventory_mutex;
// Pointer custody/tombstones ONLY. No selector/global binding lookup or mint.
std::vector<std::unique_ptr<ynx_wallet_pay_root_transport_loan_v1>>inventory;
auto*known(void*p){for(auto&x:inventory)if(x.get()==p)return x.get();return (ynx_wallet_pay_root_transport_loan_v1*)nullptr;}
int32_t current_locked(ynx_wallet_pay_root_transport_loan_v1*p){if(!p||p->closed||p->retired)return 5;if(p->first)return p->first;if(!p->root||p->root->current_native()!=0||!p->root->matches_original_binding(p->binding,p->query)){p->first=1;p->retired=true;return p->first;}return 0;}
int32_t pure_current(void*p){try{std::lock_guard<std::mutex>l(inventory_mutex);return current_locked(known(p));}catch(...){return 1;}}
int32_t pure_retain(void*p){try{std::lock_guard<std::mutex>l(inventory_mutex);auto*x=known(p);auto c=current_locked(x);if(c)return c;if(x->borrows==UINT64_MAX)return 1;++x->borrows;return 0;}catch(...){return 1;}}
void pure_release(void*p){try{std::lock_guard<std::mutex>l(inventory_mutex);auto*x=known(p);if(x&&x->borrows)--x->borrows;else if(x){x->first=1;x->retired=true;}}catch(...){/* retain original owner; never free/drop Root here */}}
template<size_t N>bool copy(char(&out)[N],const std::string&s){if(s.size()>=N)return false;memcpy(out,s.data(),s.size());out[s.size()]=0;return true;}
}
namespace ynx::wallet::pay {
int32_t capture_original_pay_root_transport(const std::shared_ptr<OriginalRootSource>&root,const Binding&b,bool query,ynx_wallet_pay_root_transport_loan_v1**out)noexcept{
 if(!out)return 2;*out=nullptr;
 try{auto p=std::make_unique<ynx_wallet_pay_root_transport_loan_v1>();p->root=root;p->binding=b;p->query=query;auto*raw=p.get();{std::lock_guard<std::mutex>l(inventory_mutex);inventory.push_back(std::move(p));*out=raw;}
  root_physical::TransportProfile profile;auto code=read_original_pay_root_transport_profile(root,b,query,profile);if(code){std::lock_guard<std::mutex>l(inventory_mutex);raw->first=code;raw->retired=true;}return code;
 }catch(...){if(out&&*out){try{std::lock_guard<std::mutex>l(inventory_mutex);if(auto*x=known(*out)){x->first=1;x->retired=true;}}catch(...){}}return 1;}
}
}
extern "C" int32_t ynx_wallet_pay_root_transport_profile_read_v1(ynx_wallet_pay_root_transport_loan_v1*p,ynx_wallet_pay_root_transport_profile_v1*out){
 if(!out)return 2;try{std::shared_ptr<ynx::wallet::pay::OriginalRootSource>root;ynx::wallet::pay::Binding binding;bool query;
  {std::lock_guard<std::mutex>l(inventory_mutex);auto*x=known(p);auto c=current_locked(x);if(c)return c;root=x->root;binding=x->binding;query=x->query;if(x->borrows==UINT64_MAX)return 1;++x->borrows;}
  struct Drop {void*p;~Drop(){pure_release(p);}}drop{p};
  ynx::wallet::pay::root_physical::TransportProfile data;auto c=ynx::wallet::pay::read_original_pay_root_transport_profile(root,binding,query,data);if(c)return c;
  ynx_wallet_pay_root_transport_profile_v1 result{};result.version=1;result.size=sizeof result;
  if(!copy(result.resource_ref,data.protected_resource_ref)||!copy(result.socket_path,data.socket_path)||!copy(result.service,data.service))return 2;
  result.peer_uid=data.peer_uid;result.peer_pid=data.peer_pid;result.timeout_ms=data.timeout_ms;result.maximum_header_bytes=data.maximum_header_bytes;result.maximum_response_bytes=data.maximum_response_bytes;
  for(size_t i=0;i<5;i++){auto&d=result.routes[i];const auto&s=data.routes[i];d.enabled=s.enabled;if(!copy(d.method,s.method)||!copy(d.path,s.path)||!copy(d.content_type,i<3?"application/json":""))return 2;d.maximum_body_bytes=s.maximum_body_bytes;d.timeout_ms=s.timeout_ms;}
  if(pure_current(p)!=0)return 1;*out=result;return 0;
 }catch(...){return 1;}
}
extern "C" int32_t ynx_wallet_pay_root_transport_fence_v1(ynx_wallet_pay_root_transport_loan_v1*p,ynx_link_private_client_source_fence_v1*out){if(!out)return 2;auto c=pure_current(p);if(c)return c;*out={p,pure_current,pure_retain,pure_release};return 0;}
extern "C" void ynx_wallet_pay_root_transport_retire_v1(ynx_wallet_pay_root_transport_loan_v1*p){try{std::lock_guard<std::mutex>l(inventory_mutex);if(auto*x=known(p))x->retired=true;}catch(...){}}
extern "C" int32_t ynx_wallet_pay_root_transport_close_v1(ynx_wallet_pay_root_transport_loan_v1*p){try{std::shared_ptr<ynx::wallet::pay::OriginalRootSource>released;{std::lock_guard<std::mutex>l(inventory_mutex);auto*x=known(p);if(!x)return 2;x->retired=true;if(x->closed)return x->close_cause;if(x->borrows){if(!x->close_cause)x->close_cause=5;return x->close_cause;}released=std::move(x->root);x->closed=true;return x->close_cause;}}catch(...){return 1;}}
extern "C" int32_t ynx_wallet_pay_root_transport_closed_v1(ynx_wallet_pay_root_transport_loan_v1*p){try{std::lock_guard<std::mutex>l(inventory_mutex);auto*x=known(p);return x&&x->closed?1:0;}catch(...){return 0;}}
