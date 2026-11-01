#include "original-wallet-main-namespace-private.h"
#include <atomic>
#include <thread>
#include <new>
struct ynx_wallet_main_namespace_owner_v1 {
 napi_env env; std::thread::id actor=std::this_thread::get_id();
 const ynx_wallet_main_namespace_root_loan_v1 root;
 napi_ref ns=nullptr,refs[4]={},first=nullptr;
 std::atomic<bool> retired{false};bool failed=false,joined=false,closed=false,rootRetired=false,rootClosed=false;unsigned active=0;
 explicit ynx_wallet_main_namespace_owner_v1(napi_env e,ynx_wallet_main_namespace_root_loan_v1*r):env(e),root(*r){}
};
namespace {
using O=ynx_wallet_main_namespace_owner_v1;
struct Active{O*p;explicit Active(O*v):p(v){p->active++;}~Active(){p->active--;}};
bool actor(O*p,napi_env e){return p&&p->env==e&&p->actor==std::this_thread::get_id();}
void remember(O*p){bool pending=false;if(napi_is_exception_pending(p->env,&pending)!=napi_ok||!pending)return;napi_value v,box;if(napi_get_and_clear_last_exception(p->env,&v)!=napi_ok)return;if(p->first)return;if(napi_create_object(p->env,&box)==napi_ok&&napi_set_named_property(p->env,box,"cause",v)==napi_ok)napi_create_reference(p->env,box,1,&p->first);}
int bad(O*p){p->failed=true;p->retired=true;remember(p);return -1;}
bool get(O*p,napi_value&ns,napi_value f[4]){if(napi_get_reference_value(p->env,p->ns,&ns)!=napi_ok)return false;for(int i=0;i<4;i++)if(napi_get_reference_value(p->env,p->refs[i],&f[i])!=napi_ok)return false;return true;}
int current(O*p,napi_env e){if(!actor(p,e)||p->closed||p->retired||p->failed)return -1;napi_value ns,f[4];if(!get(p,ns,f))return bad(p);try{if(p->root.assert_current(p->root.context,e,ns,f)!=0)return bad(p);}catch(...){return bad(p);}bool pending=false;if(napi_is_exception_pending(e,&pending)!=napi_ok||pending||p->retired)return bad(p);return 0;}
}
extern "C" int32_t ynx_wallet_main_namespace_hold_v1(napi_env e,napi_value ns,ynx_wallet_main_namespace_root_loan_v1*r,O**out){
 if(!out||*out)return -1;
 if(!e||!ns||!r||r->version!=1||!r->context||!r->assert_current||!r->retire||!r->join||!r->close)return -1;
 O*p=new(std::nothrow)O(e,r);if(!p)return -1;*out=p;Active guard(p);
 const char*names[]={"captureOriginalWalletPayContextForNative","isOriginalWalletPayContextForNative","associateOriginalWalletPayNativeRetirement","copyOriginalWalletPayNativeDeadline"};
 try{
  // Root validates namespace identity BEFORE any namespace property access.
  napi_value empty[4]={};if(p->root.assert_current(p->root.context,e,ns,empty)!=0)return bad(p);bool pending=false;if(napi_is_exception_pending(e,&pending)!=napi_ok||pending||p->retired)return bad(p);
  if(napi_create_reference(e,ns,1,&p->ns)!=napi_ok)return bad(p);
  for(int i=0;i<4;i++){napi_value f;napi_valuetype t;if(napi_get_named_property(e,ns,names[i],&f)!=napi_ok||napi_typeof(e,f,&t)!=napi_ok||t!=napi_function||napi_create_reference(e,f,1,&p->refs[i])!=napi_ok)return bad(p);}
  return current(p,e);
 }catch(...){return bad(p);}
}
extern "C" int32_t ynx_wallet_main_namespace_borrow_v1(O*p,napi_env e,napi_value*out,napi_value f[4]){if(!actor(p,e)||p->active||!out||!f)return -1;Active guard(p);*out=nullptr;for(int i=0;i<4;i++)f[i]=nullptr;if(current(p,e))return -1;napi_value ns,local[4];if(!get(p,ns,local))return bad(p);if(current(p,e))return -1;*out=ns;for(int i=0;i<4;i++)f[i]=local[i];return 0;}
extern "C" int32_t ynx_wallet_main_namespace_recheck_v1(O*p,napi_env e){if(!actor(p,e)||p->active)return -1;Active guard(p);return current(p,e);}
extern "C" void ynx_wallet_main_namespace_retire_v1(O*p){if(p)p->retired=true;}
extern "C" int32_t ynx_wallet_main_namespace_join_v1(O*p,napi_env e){if(!actor(p,e)||p->active)return -1;Active guard(p);p->retired=true;if(p->closed||p->joined)return 0;try{if(!p->rootRetired){p->rootRetired=true;p->root.retire(p->root.context);bool pending=false;if(napi_is_exception_pending(e,&pending)!=napi_ok||pending){remember(p);return -1;}}int status=p->root.join(p->root.context);bool pending=false;if(napi_is_exception_pending(e,&pending)!=napi_ok||pending){remember(p);return -1;}if(status!=0)return -1;p->joined=true;return 0;}catch(...){remember(p);return -1;}}
extern "C" int32_t ynx_wallet_main_namespace_close_v1(O*p,napi_env e){if(!actor(p,e)||p->active)return -1;Active guard(p);p->retired=true;if(p->closed)return 0;if(!p->joined)return -1;try{if(!p->rootClosed){int status=p->root.close(p->root.context);if(status==0)p->rootClosed=true;bool pending=false;if(napi_is_exception_pending(e,&pending)!=napi_ok||pending){remember(p);return -1;}if(status!=0)return -1;}for(auto&r:p->refs)if(r){if(napi_delete_reference(e,r)!=napi_ok)return -1;r=nullptr;}if(p->ns){if(napi_delete_reference(e,p->ns)!=napi_ok)return -1;p->ns=nullptr;}if(p->first){if(napi_delete_reference(e,p->first)!=napi_ok)return -1;p->first=nullptr;}p->closed=true;return 0;}catch(...){remember(p);return -1;}}
extern "C" int32_t ynx_wallet_main_namespace_failure_v1(O*p,napi_env e,napi_value*out){if(!actor(p,e)||!out||!p->first)return -1;napi_value b;if(napi_get_reference_value(e,p->first,&b)!=napi_ok)return -1;return napi_get_named_property(e,b,"cause",out)==napi_ok?0:-1;}
extern "C" int32_t ynx_wallet_main_namespace_dispose_v1(O*p){if(!p||p->actor!=std::this_thread::get_id()||p->active||!p->closed)return -1;delete p;return 0;}
