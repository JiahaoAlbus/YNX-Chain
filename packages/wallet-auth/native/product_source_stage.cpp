#include "product_original_assembly_private.hpp"
#include "product_root_private.hpp"
#include <node_api.h>
#include <thread>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <stdexcept>
// Replaces the historical all-unavailable stage only in a matching successor.
// Qualification, Main capture and reader acquisition are real independent ANDs.
namespace {
using namespace ynx::wallet::product;
const napi_type_tag source_tag={0x954a0df436f9e2a1ULL,0x975b51fa8ca10430ULL};
struct Owner {napi_env env;std::thread::id actor;std::shared_ptr<OriginalProductRoot>root;std::unique_ptr<OriginalReadAssembly>assembly;napi_ref first=nullptr;bool retired=false,joined=false,closed=false;int close_first=0;};
std::mutex mutex;std::unordered_map<napi_env,std::unordered_set<Owner*>>inventory;
void ok(napi_status s){if(s!=napi_ok)throw std::runtime_error("PRODUCT_STAGE_NAPI_FAILURE");}
napi_value undefined(napi_env e){napi_value v;ok(napi_get_undefined(e,&v));return v;}
napi_value text(napi_env e,const char*s){napi_value v;ok(napi_create_string_utf8(e,s,NAPI_AUTO_LENGTH,&v));return v;}
void prop(napi_env e,napi_value o,const char*k,napi_value v){napi_property_descriptor d={k,nullptr,nullptr,nullptr,nullptr,v,napi_default,nullptr};ok(napi_define_properties(e,o,1,&d));}
napi_value error(napi_env e,const char*c){napi_value v;ok(napi_create_error(e,nullptr,text(e,c),&v));prop(e,v,"code",text(e,c));return v;}
napi_value first(Owner&o){napi_value box,value;ok(napi_get_reference_value(o.env,o.first,&box));ok(napi_get_named_property(o.env,box,"value",&value));return value;}
void remember(Owner&o,napi_value value){if(o.first)return;napi_value box;ok(napi_create_object(o.env,&box));prop(o.env,box,"value",value);ok(napi_create_reference(o.env,box,1,&o.first));}
Owner& checked(napi_env e,napi_value self){bool tag=false;void*raw=nullptr;ok(napi_check_object_type_tag(e,self,&source_tag,&tag));if(!tag||napi_unwrap(e,self,&raw)!=napi_ok||!raw)throw std::runtime_error("PRODUCT_SOURCE_NATIVE_OWNER_REQUIRED");std::lock_guard<std::mutex>l(mutex);auto*o=static_cast<Owner*>(raw);auto i=inventory.find(e);if(i==inventory.end()||!i->second.count(o)||o->env!=e||o->actor!=std::this_thread::get_id())throw std::runtime_error("PRODUCT_SOURCE_NATIVE_OWNER_REQUIRED");return*o;}
napi_value promise(napi_env e,bool failed,napi_value value){napi_value p;napi_deferred d;ok(napi_create_promise(e,&d,&p));ok(failed?napi_reject_deferred(e,d,value):napi_resolve_deferred(e,d,value));return p;}
void retire(Owner&o){o.retired=true;if(o.assembly)o.assembly->retire();else if(o.root)retire_original_product_root(o.root);}
void finalize(napi_env e,void*raw,void*){auto*o=static_cast<Owner*>(raw);o->retired=true;retire_original_product_root(o->root);if(o->assembly)o->assembly->retire_native_only();
 {std::lock_guard<std::mutex>l(mutex);auto i=inventory.find(e);if(i!=inventory.end())i->second.erase(o);}
 // The real assembly/root destructors retain their own unresolved debt. GC
 // never fabricates completed join/close, frees a pending child or dispatches.
 if(o->first)napi_delete_reference(e,o->first);delete o;
}
napi_value method(napi_env e,napi_callback_info info){size_t n=1;napi_value a[1],self;void*data=nullptr;napi_get_cb_info(e,info,&n,a,&self,&data);
 try{auto&o=checked(e,self);if(n)throw std::runtime_error("PRODUCT_SOURCE_ZERO_ARGUMENTS");auto op=reinterpret_cast<uintptr_t>(data);
  if(op==0){if(o.first){napi_throw(e,first(o));return nullptr;}if(o.retired||!o.assembly)throw std::runtime_error("PRODUCT_SOURCE_NOT_CURRENT");o.assembly->current();return undefined(e);}
  if(op==1){retire(o);return undefined(e);}
  if(op==2){if(o.assembly)return o.assembly->join();retire(o);o.joined=true;return promise(e,false,undefined(e));}
  if(op==3){
   if(o.assembly)return o.assembly->close();
   if(!o.joined)throw std::runtime_error("PRODUCT_SOURCE_JOIN_REQUIRED");
   if(!o.closed){int c=o.root?close_original_product_root(o.root):0;o.closed=!o.root||original_product_root_closed(o.root);if((c||!o.closed)&&!o.close_first)o.close_first=c?c:1;}
   // Failure of acquisition is not a failure to physically release its partial.
   // Actual cleanup errors remain sticky, including repeated close calls.
   if(!o.closed||o.close_first)return promise(e,true,error(e,"PRODUCT_SOURCE_ROOT_CLOSE_UNCONFIRMED"));
   return promise(e,false,undefined(e));
  }
  if(op==4){if(o.assembly)o.assembly->assert_safe_to_close();else if(!o.closed)throw std::runtime_error("PRODUCT_SOURCE_CLOSE_UNCONFIRMED");return undefined(e);}
  throw std::runtime_error("PRODUCT_SOURCE_METHOD_INVALID");
 }catch(const std::exception&x){bool pending=false;napi_is_exception_pending(e,&pending);if(!pending)napi_throw(e,error(e,x.what()));return nullptr;}
}
napi_value acquire(napi_env e,napi_callback_info info){size_t n=1;napi_value args[1];napi_get_cb_info(e,info,&n,args,nullptr,nullptr);if(n){napi_throw(e,error(e,"PRODUCT_SOURCE_ZERO_ARGUMENTS"));return nullptr;}
 Owner*o=nullptr;napi_value owner=nullptr;
 try{
  o=new Owner{e,std::this_thread::get_id(),{},{},nullptr,false,false,false,0};ok(napi_create_object(e,&owner));ok(napi_type_tag_object(e,owner,&source_tag));ok(napi_wrap(e,owner,o,finalize,nullptr,nullptr));{std::lock_guard<std::mutex>l(mutex);inventory[e].insert(o);}
  const char*names[]={"current","retire","join","close","assertSafeToClose"};for(uintptr_t i=0;i<5;++i){napi_property_descriptor d={names[i],nullptr,method,nullptr,nullptr,nullptr,napi_default,reinterpret_cast<void*>(i)};ok(napi_define_properties(e,owner,1,&d));}
  auto acquired=acquire_original_product_root();o->root=std::move(acquired.owner); // before status
  if(acquired.error||!o->root){auto cause=error(e,"PRODUCT_SOURCE_ROOT_NOT_SUPPLIED");if(!acquired.cause.empty())prop(e,cause,"reason",text(e,acquired.cause.c_str()));remember(*o,cause);throw std::runtime_error("PRODUCT_SOURCE_CAPTURE_FAILED");}
  OriginalReadAssembly::capture(e,owner,o->root,o->assembly); // partial before error
  o->assembly->install(owner);ok(napi_object_freeze(e,owner));o->assembly->current();
  return owner; // VALID Root/Main/readers are not unconditionally retired
 }catch(const std::exception&x){
  if(!o||!owner){napi_throw(e,error(e,"PRODUCT_SOURCE_ALLOCATION_FAILED"));return nullptr;}
  bool pending=false;napi_is_exception_pending(e,&pending);napi_value cause;
  if(pending)napi_get_and_clear_last_exception(e,&cause);else if(o->assembly&&o->assembly->has_first_error())cause=o->assembly->first_error();else cause=error(e,x.what());
  remember(*o,cause);try{retire(*o);}catch(...){ }
  auto failure=error(e,"PRODUCT_SOURCE_CAPTURE_FAILED");prop(e,failure,"partial",owner);prop(e,failure,"cause",first(*o));napi_throw(e,failure);return nullptr;
 }
}
napi_value recognized(napi_env e,napi_callback_info info){size_t n=2;napi_value a[2],out;napi_get_cb_info(e,info,&n,a,nullptr,nullptr);bool yes=false;if(n==1)try{(void)checked(e,a[0]);yes=true;}catch(...){ }napi_get_boolean(e,yes,&out);return out;}
void cleanup(void*raw){auto e=static_cast<napi_env>(raw);std::lock_guard<std::mutex>l(mutex);auto i=inventory.find(e);if(i!=inventory.end()){for(auto*o:i->second){o->retired=true;retire_original_product_root(o->root);if(o->assembly)o->assembly->retire_native_only();}inventory.erase(i);}}
}
extern "C" napi_value RegisterOriginalProductSource(napi_env e,napi_value exports){
 {std::lock_guard<std::mutex>l(mutex);if(inventory.count(e)){napi_throw(e,error(e,"PRODUCT_SOURCE_ALREADY_REGISTERED"));return nullptr;}inventory.emplace(e,std::unordered_set<Owner*>{});}
 napi_add_env_cleanup_hook(e,cleanup,e);napi_property_descriptor d[]={{"acquireOriginalProductSource",nullptr,acquire,nullptr,nullptr,nullptr,napi_default,nullptr},{"isOriginalProductSource",nullptr,recognized,nullptr,nullptr,nullptr,napi_default,nullptr}};return napi_define_properties(e,exports,2,d)==napi_ok?exports:nullptr;
}
#ifdef YNX_PRODUCT_SOURCE_STANDALONE
NAPI_MODULE_INIT(){return RegisterOriginalProductSource(env,exports);}
#endif
