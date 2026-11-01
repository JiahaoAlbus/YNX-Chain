#include "product_main_peer_private.hpp"
#include "pay_root_main_code_private.hpp"
#include "product_root_contract_private.hpp"
#include <stdexcept>

namespace ynx::wallet::product {
namespace {
[[noreturn]]void deny(const char*c){throw std::runtime_error(c);}
napi_value get(napi_env e,napi_value o,const char*k){napi_value v;if(napi_get_named_property(e,o,k,&v)!=napi_ok)deny("PRODUCT_MAIN_PROPERTY_FAILED");return v;}
void undefined_result(napi_env e,napi_value v){napi_valuetype t;if(napi_typeof(e,v,&t)!=napi_ok||t!=napi_undefined)deny("PRODUCT_MAIN_CURRENT_RESULT");}
napi_value call(napi_env e,napi_value self,const char*k,size_t n,napi_value*a){napi_value result,fn=get(e,self,k);napi_valuetype type;if(napi_typeof(e,fn,&type)!=napi_ok||type!=napi_function)deny("PRODUCT_MAIN_CALLEE_NOT_SUPPLIED");if(napi_call_function(e,self,fn,n,a,&result)!=napi_ok)deny("PRODUCT_MAIN_ORIGINAL_FAILURE");return result;}
}
MainProductPeer::MainProductPeer(napi_env e):env_(e),actor_(std::this_thread::get_id()){}
MainProductPeer::~MainProductPeer(){
 // Only actor-side fully-drained owner may delete this child. A NativeSource
 // finalizer must keep it in debt inventory if the actual Main close is not
 // observed; this destructor is not a synthetic Main close.
 if(peer_ref_)napi_delete_reference(env_,peer_ref_);
 if(namespace_ref_)napi_delete_reference(env_,namespace_ref_);
}
void MainProductPeer::capture(napi_env e,napi_value owner,std::unique_ptr<MainProductPeer>&out){
 if(out)deny("PRODUCT_MAIN_OUT_NOT_EMPTY");
 out=std::unique_ptr<MainProductPeer>(new MainProductPeer(e));auto&p=*out;
 if(ynx::wallet::pay::borrow_initialized_original_main_namespace(e,p.namespace_)!=0)deny("PRODUCT_MAIN_NAMESPACE_NOT_CURRENT");
 if(napi_create_reference(e,p.namespace_.original,1,&p.namespace_ref_)!=napi_ok)deny("PRODUCT_MAIN_NAMESPACE_HOLD_FAILED");
 napi_value peer=nullptr;
 try{peer=call(e,p.namespace_.original,"captureOriginalWalletProductContextForNative",0,nullptr);}
 catch(...){
  bool pending=false;napi_is_exception_pending(e,&pending);
  if(pending){
   napi_value cause,partial;napi_get_and_clear_last_exception(e,&cause);
   // Original Main owns its error descriptor. Capture its partial before
   // rethrowing SAME original value, including falsy original causes.
   bool has=false;napi_valuetype cause_type;napi_typeof(e,cause,&cause_type);
   napi_value key;napi_create_string_utf8(e,"partial",NAPI_AUTO_LENGTH,&key);
   if(cause_type==napi_object&&napi_has_own_property(e,cause,key,&has)==napi_ok&&has&&napi_get_named_property(e,cause,"partial",&partial)==napi_ok){
    napi_valuetype type;napi_typeof(e,partial,&type);if(type==napi_object)napi_create_reference(e,partial,1,&p.peer_ref_);
   }
   napi_throw(e,cause);
  }throw;
 }
 if(napi_create_reference(e,peer,1,&p.peer_ref_)!=napi_ok)deny("PRODUCT_MAIN_PEER_HOLD_FAILED");
 napi_value recognized=call(e,p.namespace_.original,"isOriginalWalletProductContextForNative",1,&peer);bool genuine=false;
 if(napi_get_value_bool(e,recognized,&genuine)!=napi_ok||!genuine)deny("PRODUCT_MAIN_PEER_UNRECOGNIZED");
 napi_value args[]={peer,owner};
 undefined_result(e,call(e,p.namespace_.original,"associateOriginalWalletProductNativeRetirement",2,args));
 p.current();
}
napi_value MainProductPeer::invoke(const char*k,size_t n,napi_value*a){
 if(actor_!=std::this_thread::get_id()||!peer_ref_)deny("PRODUCT_MAIN_ACTOR_REQUIRED");
 napi_value peer;if(napi_get_reference_value(env_,peer_ref_,&peer)!=napi_ok)deny("PRODUCT_MAIN_PEER_LOST");
 return call(env_,peer,k,n,a);
}
void MainProductPeer::current(){
 if(actor_!=std::this_thread::get_id())deny("PRODUCT_MAIN_ACTOR_REQUIRED");
 if(retired_||!namespace_.epoch||!namespace_.epoch->current())deny("PRODUCT_MAIN_RETIRED");
 if(ynx::wallet::pay::original_pay_main_code_root_current(namespace_.code_root)!=0)deny("PRODUCT_MAIN_CODE_NOT_CURRENT");
 undefined_result(env_,invoke("current",0,nullptr));
}
MainContextDATA MainProductPeer::read_context(){
 current();auto value=invoke("readOriginalContextDATA",0,nullptr);
 napi_value keys;
 if(napi_get_all_property_names(env_,value,napi_key_own_only,napi_key_all_properties,napi_key_numbers_to_strings,&keys)!=napi_ok)deny("PRODUCT_MAIN_CONTEXT_KEYS");
 uint32_t count=0;if(napi_get_array_length(env_,keys,&count)!=napi_ok||count!=2)deny("PRODUCT_MAIN_CONTEXT_KEYS");
 auto string=[&](const char*k,size_t size){
  napi_value key;napi_create_string_utf8(env_,k,NAPI_AUTO_LENGTH,&key);bool own=false;
  if(napi_has_own_property(env_,value,key,&own)!=napi_ok||!own)deny("PRODUCT_MAIN_CONTEXT_KEYS");
  auto v=get(env_,value,k);napi_valuetype type;size_t bytes=0;
  if(napi_typeof(env_,v,&type)!=napi_ok||type!=napi_string||napi_get_value_string_utf8(env_,v,nullptr,0,&bytes)!=napi_ok||bytes!=size)deny("PRODUCT_MAIN_CONTEXT_VALUE");
  std::string result(bytes,'\0');size_t copied=0;if(napi_get_value_string_utf8(env_,v,result.data(),bytes+1,&copied)!=napi_ok||copied!=bytes)deny("PRODUCT_MAIN_CONTEXT_VALUE");return result;
 };
 MainContextDATA result{string("networkId",64),string("account",42)};
 if(!lowercase_hex(result.network_id,64)||result.account.substr(0,2)!="0x"||!lowercase_hex(result.account.substr(2),40))deny("PRODUCT_MAIN_CONTEXT_VALUE");
 current();return result;
}
napi_value MainProductPeer::shop_original(napi_value id,napi_value current_guard){current();napi_value args[]={id,current_guard};return invoke("readOriginalShopNativeInvoiceRequestDATA",2,args);}
napi_value MainProductPeer::cloud_locator(napi_value ref,napi_value current_guard){current();napi_value args[]={ref,current_guard};return invoke("readOriginalCloudBillLocator",2,args);}
napi_value MainProductPeer::pay_preparation_reader(){current();return invoke("captureOriginalPayPreparationReaderForNative",0,nullptr); /* caller adopts before post-current */}
napi_value MainProductPeer::retire_on_actor(){retired_=true;return invoke("retire",0,nullptr);}
napi_value MainProductPeer::join_on_actor(){if(!retired_)deny("PRODUCT_MAIN_RETIRE_REQUIRED");return invoke("join",0,nullptr);}
napi_value MainProductPeer::close_on_actor(){if(!retired_)deny("PRODUCT_MAIN_RETIRE_REQUIRED");return invoke("close",0,nullptr);}
}
