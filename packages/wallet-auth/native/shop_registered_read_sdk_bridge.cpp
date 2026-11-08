// Private strong SDK consumer. No registration, callback, locator or Source setter.
#include "ShopV4RegisteredHolderPrivate.h"
#include "ShopSDKNamespaceBootstrapPrivate.hpp"
#include <node_api.h>
#include <memory>
#include <algorithm>
#include <new>
#include <string>
#include <vector>
#include <unordered_set>
#include <thread>
#include <mutex>
#include <cmath>
#include <cstring>
#include <limits>
using ynx::auth::shop::v4::OriginalShopSDKNamespaceLoan;
using S=ynx_auth_shop_status_v1;
struct BridgeState {
 napi_env env=nullptr;std::thread::id thread=std::this_thread::get_id();
 bool failed=false,retired=false,closed=false;int32_t code=0;bool unknown=false;
 napi_ref cause=nullptr;
 S status(bool done=false)const{return {failed?1u:0u,code,unknown?1u:0u,done?1u:0u};}
 void remember(S s){unknown=unknown||s.unknown!=0;if(s.error_present&&!failed){failed=true;code=s.first_code;}}
 void refuse(){remember({1,0,1,0});}
 void error(napi_value value){if(failed)return;failed=true;unknown=true;
  napi_valuetype t;if(napi_typeof(env,value,&t)==napi_ok&&t==napi_number){double n=0;
   if(napi_get_value_double(env,value,&n)==napi_ok&&std::isfinite(n)&&std::floor(n)==n&&n>=INT32_MIN&&n<=INT32_MAX){code=static_cast<int32_t>(n);unknown=false;}}
  napi_value box;if(napi_create_object(env,&box)==napi_ok&&napi_set_named_property(env,box,"original",value)==napi_ok)napi_create_reference(env,box,1,&cause);
 }
 bool check(napi_status s){if(s==napi_ok)return true;bool pending=false;napi_is_exception_pending(env,&pending);
  if(pending){napi_value original;if(napi_get_and_clear_last_exception(env,&original)==napi_ok)error(original);else refuse();}else refuse();return false;}
 bool actor(napi_env e)const{return env==e&&thread==std::this_thread::get_id();}
};
struct ynx_sdk_shop_registered_read_v4:BridgeState {
 ynx_auth_shop_product_source_borrow_v4*source=nullptr;
 std::shared_ptr<OriginalShopSDKNamespaceLoan>ns;
 napi_ref namespaceRef=nullptr,capture=nullptr,create=nullptr,then=nullptr,loan=nullptr;
 ynx_sdk_shop_get_proof_v4*proof=nullptr;bool releaseChosen=false,releaseDone=false,namespaceCloseChosen=false,namespaceDone=false,refsDropChosen=false;
};
struct ynx_sdk_shop_get_proof_v4:BridgeState {
 ynx_sdk_shop_registered_read_v4*parent=nullptr;
 napi_ref promise=nullptr;bool settled=false,fulfilled=false,completionKnown=false,closeChosen=false,dispatched=false;
 std::string path,header;int64_t issued=0,expires=0;
};
namespace {
// Entries are retained as closed tombstones: this private ABI has no release_closed.
std::mutex inventoryMutex;
std::unordered_set<ynx_sdk_shop_registered_read_v4*>reads;
std::unordered_set<ynx_sdk_shop_get_proof_v4*>proofs;
constexpr size_t historicalCap=4096,activeCap=64,environmentCap=16;
size_t activeReads=0,activeProofs=0;
struct Environment {napi_env env;bool active;};
std::vector<Environment>environments;
void closed(ynx_sdk_shop_registered_read_v4&r){r.closed=true;std::lock_guard<std::mutex>lock(inventoryMutex);--activeReads;}
void closed(ynx_sdk_shop_get_proof_v4&p){p.closed=true;std::string{}.swap(p.header);std::string{}.swap(p.path);std::lock_guard<std::mutex>lock(inventoryMutex);--activeProofs;}

void environmentClosed(void*data){std::lock_guard<std::mutex>lock(inventoryMutex);for(auto&i:environments)if(i.env==data){i.active=false;}}
S foreign(){return {1,0,1,0};}
bool environment(napi_env env){std::lock_guard<std::mutex>lock(inventoryMutex);for(const auto&i:environments)if(i.env==env)return i.active;
 if(environments.size()>=environmentCap)return false;try{environments.push_back({env,true});}catch(...){return false;}
 if(napi_add_env_cleanup_hook(env,environmentClosed,env)!=napi_ok){environments.pop_back();return false;}return true;}

bool held(napi_env e,ynx_sdk_shop_registered_read_v4*r){std::lock_guard<std::mutex>lock(inventoryMutex);return r&&reads.count(r)&&r->actor(e)&&std::any_of(environments.begin(),environments.end(),[e](const auto&i){return i.env==e&&i.active;});}
bool held(napi_env e,ynx_sdk_shop_get_proof_v4*p){std::lock_guard<std::mutex>lock(inventoryMutex);return p&&proofs.count(p)&&p->actor(e)&&std::any_of(environments.begin(),environments.end(),[e](const auto&i){return i.env==e&&i.active;});}
bool ref(BridgeState&s,napi_value v,napi_ref&out){return s.check(napi_create_reference(s.env,v,1,&out));}
napi_value value(BridgeState&s,napi_ref r){napi_value v=nullptr;if(!r||!s.check(napi_get_reference_value(s.env,r,&v)))s.refuse();return v;}
bool call(BridgeState&s,napi_value receiver,napi_value fn,size_t n,napi_value*args,napi_value*out){
 return s.check(napi_call_function(s.env,receiver,fn,n,args,out));}
bool method(BridgeState&s,napi_value receiver,const char*name,napi_value*out){napi_value fn=nullptr;
 return s.check(napi_get_named_property(s.env,receiver,name,&fn))&&call(s,receiver,fn,0,nullptr,out);}
bool undefined(BridgeState&s,napi_value v){napi_valuetype t;if(!s.check(napi_typeof(s.env,v,&t)))return false;if(t!=napi_undefined){s.refuse();return false;}return true;}
bool text(BridgeState&s,napi_value v,std::string&out,size_t cap){size_t n=0;
 if(!s.check(napi_get_value_string_utf8(s.env,v,nullptr,0,&n))||n>cap){s.refuse();return false;}
 std::vector<char>b(n+1);size_t actual=0;if(!s.check(napi_get_value_string_utf8(s.env,v,b.data(),b.size(),&actual))||actual!=n){s.refuse();return false;}
 out.assign(b.data(),n);if(out.find('\0')!=std::string::npos){s.refuse();return false;}return true;}
bool propertyText(BridgeState&s,napi_value v,const char*k,std::string&out,size_t cap){napi_value x;return s.check(napi_get_named_property(s.env,v,k,&x))&&text(s,x,out,cap);}
bool number(BridgeState&s,napi_value v,const char*k,int64_t&out){napi_value x;double n;
 if(!s.check(napi_get_named_property(s.env,v,k,&x))||!s.check(napi_get_value_double(s.env,x,&n)))return false;
 if(!std::isfinite(n)||std::floor(n)!=n||std::abs(n)>9007199254740991.0){s.refuse();return false;}out=static_cast<int64_t>(n);return true;}
S current(ynx_sdk_shop_registered_read_v4&r,ynx_auth_shop_product_source_borrow_v4*s){
 if(r.closed||r.retired||r.source!=s){r.refuse();return r.status();}
 r.remember(ynx_auth_shop_product_source_current_v4(r.env,s));if(r.failed)return r.status();
 if(!r.ns){r.refuse();return r.status();}r.remember(r.ns->current());if(r.failed)return r.status();
 napi_value result;if(method(r,value(r,r.loan),"assertCurrent",&result))undefined(r,result);
 r.remember(ynx_auth_shop_product_source_current_v4(r.env,s));return r.status();}
bool set(BridgeState&s,napi_value o,const char*k,napi_value v){return s.check(napi_set_named_property(s.env,o,k,v));}
napi_value string(BridgeState&s,ynx_auth_shop_span_v1 v,const std::vector<uint8_t>&buf){
 napi_value out=nullptr;const auto begin=reinterpret_cast<uintptr_t>(buf.data()),p=reinterpret_cast<uintptr_t>(v.bytes);
 if(!v.length||v.length>buf.size()||p<begin||p-begin>buf.size()-v.length){s.refuse();return nullptr;}
 if(!s.check(napi_create_string_utf8(s.env,reinterpret_cast<const char*>(v.bytes),v.length,&out)))return nullptr;return out;}
napi_value scope(ynx_sdk_shop_registered_read_v4&r){std::vector<uint8_t>buf(32768);ynx_auth_shop_product_scope_data_v4 d{};
 r.remember(ynx_auth_shop_product_source_copy_scope_v4(r.env,r.source,buf.data(),buf.size(),&d));
 if(r.failed)return nullptr;if(d.version!=1||d.size!=sizeof(d)||d.operation_count>16||d.product_count>64){r.refuse();return nullptr;}
 napi_value o,v,ops,products;if(!r.check(napi_create_object(r.env,&o))||!r.check(napi_create_uint32(r.env,1,&v))||!set(r,o,"version",v))return nullptr;
 if(!set(r,o,"networkId",string(r,d.network_id,buf))||!set(r,o,"account",string(r,d.account,buf))||!set(r,o,"protectedResourceRef",string(r,d.protected_resource_ref,buf)))return nullptr;
 if(!r.check(napi_create_array_with_length(r.env,d.operation_count,&ops))||!r.check(napi_create_array_with_length(r.env,d.product_count,&products)))return nullptr;
 for(uint32_t i=0;i<d.operation_count;i++)if(!r.check(napi_set_element(r.env,ops,i,string(r,d.operations[i],buf))))return nullptr;
 for(uint32_t i=0;i<d.product_count;i++){napi_value p;if(!r.check(napi_create_object(r.env,&p))||!set(r,p,"productId",string(r,d.products[i].product_id,buf))||!set(r,p,"sourceOrder",string(r,d.products[i].source_order,buf))||!r.check(napi_set_element(r.env,products,i,p)))return nullptr;}
 if(!set(r,o,"operations",ops)||!set(r,o,"products",products))return nullptr;return o;
}
napi_value settle(napi_env e,napi_callback_info info,bool ok){size_t n=1;napi_value args[1],result;void*data=nullptr;
 if(napi_get_cb_info(e,info,&n,args,nullptr,&data)!=napi_ok)return nullptr;auto*p=static_cast<ynx_sdk_shop_get_proof_v4*>(data);
 if(!held(e,p))return nullptr;p->settled=true;p->completionKnown=ok;
 try{if(ok){std::string name;bool valid=n==1&&propertyText(*p,args[0],"proofHeaderName",name,128)&&name=="x-ynx-product-session-proof-v4"&&propertyText(*p,args[0],"proofHeader",p->header,YNX_SHOP_V4_HEADER_MAX)&&number(*p,args[0],"issuedAtMs",p->issued)&&number(*p,args[0],"expiresAtMs",p->expires);
  if(!valid||p->header.empty()||p->issued>=p->expires)p->refuse();else p->fulfilled=true;
 }else{if(n)p->error(args[0]);else p->refuse();p->unknown=true;}}catch(...){p->refuse();}
 // Rejection alone never proves physical custody closed; retained UNKNOWN stays debt.
 napi_get_undefined(e,&result);return result;
}
napi_value resolved(napi_env e,napi_callback_info i){return settle(e,i,true);}
napi_value rejected(napi_env e,napi_callback_info i){return settle(e,i,false);}
void drop(BridgeState&s,napi_ref&r){if(r&&s.check(napi_delete_reference(s.env,r)))r=nullptr;}
}
extern "C" {
ynx_sdk_shop_registered_read_acquisition_v4 ynx_sdk_shop_registered_read_capture_for_product_child_v4(void*env,void*read,ynx_auth_shop_product_source_borrow_v4*s){
 if(!environment(static_cast<napi_env>(env)))return {nullptr,foreign()};
 auto*r=new(std::nothrow) ynx_sdk_shop_registered_read_v4;if(!r)return {nullptr,foreign()};r->env=static_cast<napi_env>(env);r->source=s;try{std::lock_guard<std::mutex>lock(inventoryMutex);if(reads.size()>=historicalCap||activeReads>=activeCap){delete r;return {nullptr,foreign()};}reads.insert(r);++activeReads;}catch(...){delete r;return {nullptr,foreign()};}
 // Publish the owner even when namespace acquisition or subsequent NAPI work fails.
 try{r->remember(ynx_auth_shop_product_source_current_v4(env,s));if(!r->failed){auto a=ynx::auth::shop::v4::borrow_original_shop_sdk_namespace_for_source(r->env,s);r->ns=std::move(a.owner);r->remember(a.status);}
  if(!r->failed&&r->ns){napi_value ns=nullptr,fn[2]={nullptr,nullptr};S status=r->ns->copy_original_refs(&ns,fn);
   if(ns)ref(*r,ns,r->namespaceRef);if(fn[0])ref(*r,fn[0],r->capture);if(fn[1])ref(*r,fn[1],r->create);r->remember(status);
   if(!r->failed){napi_value originalThen=nullptr;S thenStatus=r->ns->copy_original_promise_then(&originalThen);if(originalThen)ref(*r,originalThen,r->then);r->remember(thenStatus);if(!r->then)r->refuse();}
   if(!r->failed){r->remember(r->ns->current());napi_value d=scope(*r),loan=nullptr,args[2]={static_cast<napi_value>(read),d};
    if(!r->failed&&call(*r,value(*r,r->namespaceRef),value(*r,r->capture),2,args,&loan)&&loan)ref(*r,loan,r->loan);
    if(!r->failed)current(*r,s);}
  }else if(!r->failed)r->refuse();
 }catch(...){r->refuse();}return {r,r->status()};
}
S ynx_sdk_shop_registered_read_current_for_product_child_v4(void*e,ynx_sdk_shop_registered_read_v4*r,ynx_auth_shop_product_source_borrow_v4*s){if(!held(static_cast<napi_env>(e),r))return foreign();return current(*r,s);}
S ynx_sdk_shop_registered_read_original_device_source_v4(void*e,ynx_sdk_shop_registered_read_v4*r,void**out){if(out)*out=nullptr;if(!out||!held(static_cast<napi_env>(e),r))return foreign();
 if(current(*r,r->source).error_present)return r->status();napi_value v=nullptr;if(method(*r,value(*r,r->loan),"readOriginalNativeDeviceSource",&v))*out=v;current(*r,r->source);return r->status();}
ynx_sdk_shop_get_proof_acquisition_v4 ynx_sdk_shop_registered_read_begin_original_get_for_product_child_v4(void*e,ynx_sdk_shop_registered_read_v4*r,ynx_auth_shop_product_source_borrow_v4*s,ynx_auth_shop_span_v1 order){
 if(!held(static_cast<napi_env>(e),r))return {nullptr,foreign()};if(r->proof)return {r->proof,foreign()};
 auto*p=new(std::nothrow) ynx_sdk_shop_get_proof_v4;if(!p)return {nullptr,foreign()};p->env=r->env;p->parent=r;r->proof=p;try{std::lock_guard<std::mutex>lock(inventoryMutex);if(proofs.size()>=historicalCap||activeProofs>=activeCap){r->proof=nullptr;delete p;return {nullptr,foreign()};}proofs.insert(p);++activeProofs;}catch(...){r->proof=nullptr;delete p;return {nullptr,foreign()};}
 try{p->remember(current(*r,s));if(!p->failed){if(!order.bytes||!order.length||order.length>4096){p->refuse();return {p,p->status()};}
  p->path="/v5/shop/source/shop.order/invoice-intents/";p->path.append(reinterpret_cast<const char*>(order.bytes),order.length);
  napi_value path,args[2],promise=nullptr;if(!p->check(napi_create_string_utf8(p->env,p->path.data(),p->path.size(),&path)))return {p,p->status()};args[0]=value(*r,r->loan);args[1]=path;
  p->dispatched=true;
  if(call(*p,value(*r,r->namespaceRef),value(*r,r->create),2,args,&promise)&&promise){ref(*p,promise,p->promise);bool isPromise=false;if(!p->check(napi_is_promise(p->env,promise,&isPromise))||!isPromise){p->refuse();return {p,p->status()};}
   napi_value yes,no,then,ignored;if(p->check(napi_create_function(p->env,"fulfilled",NAPI_AUTO_LENGTH,resolved,p,&yes))&&p->check(napi_create_function(p->env,"rejected",NAPI_AUTO_LENGTH,rejected,p,&no))&&(then=value(*r,r->then))!=nullptr){napi_value callbacks[2]={yes,no};call(*p,promise,then,2,callbacks,&ignored);}
  }else p->refuse();p->remember(current(*r,s));}
 }catch(...){p->refuse();}return {p,p->status()};
}
S ynx_sdk_shop_get_proof_current_for_product_child_v4(void*e,ynx_sdk_shop_get_proof_v4*p,ynx_sdk_shop_registered_read_v4*r,ynx_auth_shop_product_source_borrow_v4*s){if(!held(static_cast<napi_env>(e),p)||!held(static_cast<napi_env>(e),r)||p->parent!=r)return foreign();if(p->retired||p->closed)p->refuse();p->remember(current(*r,s));return p->status();}
S ynx_sdk_shop_get_proof_copy_original_v4(void*e,ynx_sdk_shop_get_proof_v4*p,uint8_t*buf,size_t cap,ynx_sdk_shop_get_proof_original_v4*out){if(!out||!held(static_cast<napi_env>(e),p))return foreign();*out={1,sizeof(*out),0,0,{nullptr,0},0,0};
 if(p->closed)return foreign();
 if(p->fulfilled){if(!buf||cap<p->header.size())return foreign();std::memcpy(buf,p->header.data(),p->header.size());out->header_original={buf,p->header.size()};out->issued_at_ms=p->issued;out->expires_at_ms=p->expires;out->ready=1;}
 return p->status();}
S ynx_sdk_shop_get_proof_retire_v4(void*e,ynx_sdk_shop_get_proof_v4*p){if(!held(static_cast<napi_env>(e),p))return foreign();p->retired=true;return p->status(p->closed);}
S ynx_sdk_shop_get_proof_join_v4(void*e,ynx_sdk_shop_get_proof_v4*p){if(!held(static_cast<napi_env>(e),p))return foreign();return p->status(!p->dispatched||(p->settled&&p->completionKnown));}
S ynx_sdk_shop_get_proof_close_v4(void*e,ynx_sdk_shop_get_proof_v4*p){if(!held(static_cast<napi_env>(e),p))return foreign();p->retired=true;if(p->closed)return p->status(true);
 if(!p->dispatched){if(p->closeChosen)return p->status(false);p->closeChosen=true;drop(*p,p->cause);if(p->cause){p->unknown=true;return p->status(false);}closed(*p);return p->status(true);}
 if(!p->settled)return p->status(false);if(p->closeChosen)return p->status(false);p->closeChosen=true;
 if(!p->completionKnown){p->unknown=true;return p->status(false);}drop(*p,p->promise);drop(*p,p->cause);if(p->promise||p->cause){p->unknown=true;return p->status(false);}closed(*p);return p->status(true);}
S ynx_sdk_shop_registered_read_retire_v4(void*e,ynx_sdk_shop_registered_read_v4*r){if(!held(static_cast<napi_env>(e),r))return foreign();r->retired=true;return r->status(r->closed);}
S ynx_sdk_shop_registered_read_join_v4(void*e,ynx_sdk_shop_registered_read_v4*r){if(!held(static_cast<napi_env>(e),r))return foreign();return r->status(!r->proof||r->proof->closed);}
S ynx_sdk_shop_registered_read_close_v4(void*e,ynx_sdk_shop_registered_read_v4*r){if(!held(static_cast<napi_env>(e),r))return foreign();r->retired=true;if(r->closed)return r->status(true);if(r->proof&&!r->proof->closed)return r->status(false);
 if(!r->releaseChosen){r->releaseChosen=true;if(r->loan){napi_value result;if(!method(*r,value(*r,r->loan),"release",&result))return r->status(false);if(!undefined(*r,result))return r->status(false);}r->releaseDone=true;}
 if(!r->releaseDone)return r->status(false);
 if(r->ns&&!r->namespaceDone){if(r->namespaceCloseChosen)return r->status(false);S s=r->ns->close();r->namespaceCloseChosen=s.physical_done||s.unknown;r->remember(s);r->namespaceDone=s.physical_done!=0;if(!r->namespaceDone)return r->status(false);}
 if(!r->refsDropChosen){r->refsDropChosen=true;drop(*r,r->loan);drop(*r,r->create);drop(*r,r->capture);drop(*r,r->then);drop(*r,r->namespaceRef);drop(*r,r->cause);}
 if(r->loan||r->create||r->capture||r->then||r->namespaceRef||r->cause){r->unknown=true;return r->status(false);}closed(*r);return r->status(true);}
}
