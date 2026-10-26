// Original Native Source acquisition/lifecycle stage. No device-current DTO,
// slot, signer, global revoke or public SDK factory is manufactured here.
#include <unordered_set>
#include <new>
#include <exception>
#include <utility>
struct ProductDeviceV4SourceOwner {
 napi_env env=nullptr;pthread_t thread{};
 YNXAuthIdentitySourceAuthority*__strong source=nil;
 napi_ref first=nullptr,closeCause=nullptr;
 bool failed=false,retired=false,closeSelected=false,closed=false;unsigned proofs=0;
};
static const napi_type_tag productDeviceV4SourceTag={0x594e584456345352ULL,0x434f574e45523031ULL};
static thread_local std::unordered_set<ProductDeviceV4SourceOwner*>productDeviceV4Sources,productDeviceV4SourceDebts;
static napi_value DeviceV4Undefined(napi_env env){napi_value v=nullptr;napi_get_undefined(env,&v);return v;}
static napi_value DeviceV4Error(napi_env env,const char*code){napi_value s=nullptr,e=nullptr;if(napi_create_string_utf8(env,code,NAPI_AUTO_LENGTH,&s)!=napi_ok||napi_create_error(env,nullptr,s,&e)!=napi_ok)return nullptr;napi_set_named_property(env,e,"code",s);return e;}
static napi_value DeviceV4Throw(napi_env env,const char*code){auto e=DeviceV4Error(env,code);if(e)napi_throw(env,e);return nullptr;}
static napi_value DeviceV4First(ProductDeviceV4SourceOwner*p,NSString*code){
 napi_value e=nullptr;if(p->failed){if(p->first)napi_get_reference_value(p->env,p->first,&e);return e;}p->failed=true;
 e=DeviceV4Error(p->env,(code?:@"PRODUCT_DEVICE_V4_SOURCE_UNKNOWN").UTF8String);
 if(e&&napi_create_reference(p->env,e,1,&p->first)!=napi_ok)return nullptr;return e;
}
static bool DeviceV4Current(ProductDeviceV4SourceOwner*p){
 if(p->failed)return false;
 if(p->retired||p->closeSelected||!p->source){DeviceV4First(p,@"PRODUCT_DEVICE_V4_SOURCE_RETIRED");return false;}
 try{@try{NSError*e=nil;if(![p->source assertOriginalProductSessionDeviceV4SourceCurrent:&e]||e){DeviceV4First(p,e.localizedDescription?:@"PRODUCT_DEVICE_V4_SOURCE_NOT_CURRENT");return false;}return true;}
 @catch(id){DeviceV4First(p,@"PRODUCT_DEVICE_V4_SOURCE_CURRENT_EXCEPTION");return false;}
 }catch(...){DeviceV4First(p,@"PRODUCT_DEVICE_V4_SOURCE_CURRENT_CPP_EXCEPTION");return false;}
}
static ProductDeviceV4SourceOwner*DeviceV4Original(napi_env env,napi_value object){
 bool tagged=false;void*raw=nullptr;
 if(napi_check_object_type_tag(env,object,&productDeviceV4SourceTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,object,&raw)!=napi_ok)return nullptr;
 auto*p=static_cast<ProductDeviceV4SourceOwner*>(raw);
 return productDeviceV4Sources.count(p)&&p->env==env&&pthread_equal(p->thread,pthread_self())&&pthread_main_np()?p:nullptr;
}
static void DeviceV4Retire(ProductDeviceV4SourceOwner*p){if(p->retired)return;p->retired=true;[p->source retire];}
static bool DeviceV4Close(ProductDeviceV4SourceOwner*p){
 if(p->closeSelected)return p->closed;
 NSError*e=nil;
 try{@try{
  DeviceV4Retire(p);
  if(p->proofs)return false;
  // A pending join has not selected close; never abandon the partial owner.
  if(p->source&&![p->source join:&e])return false;
  p->closeSelected=true;BOOL ok=!p->source||[p->source close:&e];
  if(!ok||e){auto cause=DeviceV4Error(p->env,(e.localizedDescription?:@"PRODUCT_DEVICE_V4_SOURCE_CLOSE_UNKNOWN").UTF8String);if(cause)napi_create_reference(p->env,cause,1,&p->closeCause);productDeviceV4SourceDebts.insert(p);return false;}
  p->closed=true;p->source=nil;productDeviceV4SourceDebts.erase(p);
  // Break acquisition-error -> partial -> native-ref cycle after real cleanup.
  if(p->first){napi_delete_reference(p->env,p->first);p->first=nullptr;}return true;
 }@catch(id){p->closeSelected=true;auto cause=DeviceV4Error(p->env,"PRODUCT_DEVICE_V4_SOURCE_CLOSE_EXCEPTION");if(cause)napi_create_reference(p->env,cause,1,&p->closeCause);productDeviceV4SourceDebts.insert(p);return false;}
 }catch(...){p->closeSelected=true;auto cause=DeviceV4Error(p->env,"PRODUCT_DEVICE_V4_SOURCE_CLOSE_CPP_EXCEPTION");if(cause)napi_create_reference(p->env,cause,1,&p->closeCause);productDeviceV4SourceDebts.insert(p);return false;}
}
static void DeviceV4Finalize(napi_env env,void*raw,void*){
 auto*p=static_cast<ProductDeviceV4SourceOwner*>(raw);if(!productDeviceV4Sources.count(p))return;
 if(!DeviceV4Close(p)){productDeviceV4SourceDebts.insert(p);return;}
 productDeviceV4Sources.erase(p);if(p->closeCause)napi_delete_reference(env,p->closeCause);delete p;
}
enum class DeviceV4SourceMethod:uintptr_t{current=1,retire,join,close,status};
static napi_value DeviceV4SourceOperation(napi_env env,napi_callback_info info){
 size_t count=1;napi_value arg=nullptr,self=nullptr;void*data=nullptr;
 if(napi_get_cb_info(env,info,&count,&arg,&self,&data)!=napi_ok||count)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ARGUMENTS_INVALID");
 auto*p=DeviceV4Original(env,self);if(!p)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ORIGINAL_SOURCE_REQUIRED");
 auto op=static_cast<DeviceV4SourceMethod>((uintptr_t)data);
 try{@try{
  if(op==DeviceV4SourceMethod::retire){DeviceV4Retire(p);return DeviceV4Undefined(env);}
  if(op==DeviceV4SourceMethod::join){NSError*e=nil;if(!p->retired||p->proofs||(p->source&&![p->source join:&e]))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_JOIN_PENDING");return DeviceV4Undefined(env);}
  if(op==DeviceV4SourceMethod::close){if(DeviceV4Close(p))return DeviceV4Undefined(env);napi_value cause=nullptr;if(p->closeCause)napi_get_reference_value(env,p->closeCause,&cause);if(cause)napi_throw(env,cause);else return DeviceV4Throw(env,p->closeSelected?"PRODUCT_DEVICE_V4_SOURCE_CLOSE_UNKNOWN":"PRODUCT_DEVICE_V4_SOURCE_JOIN_PENDING");return nullptr;}
  if(op==DeviceV4SourceMethod::status){napi_value result=nullptr,v=nullptr;napi_create_object(env,&result);for(const auto&item:{std::pair<const char*,bool>{"retired",p->retired},{"closed",p->closed},{"closeSelected",p->closeSelected},{"dataOnly",true},{"nativeAdmission",false},{"sourceAdmission",false}}){napi_get_boolean(env,item.second,&v);napi_set_named_property(env,result,item.first,v);}napi_object_freeze(env,result);return result;}
  if(op==DeviceV4SourceMethod::current){if(DeviceV4Current(p))return DeviceV4Undefined(env);napi_value e=nullptr;if(p->first)napi_get_reference_value(env,p->first,&e);if(e)napi_throw(env,e);else return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_UNKNOWN");return nullptr;}
 }@catch(id){auto e=DeviceV4First(p,@"PRODUCT_DEVICE_V4_SOURCE_NATIVE_EXCEPTION");if(e)napi_throw(env,e);return nullptr;}
 }catch(...){auto e=DeviceV4First(p,@"PRODUCT_DEVICE_V4_SOURCE_CPP_EXCEPTION");if(e)napi_throw(env,e);return nullptr;}
 return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_METHOD_INVALID");
}
#include "original-product-device-v4-source-read.inc.mm"
#ifdef YNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE
#include "original-product-device-v4-http-producer.inc.mm"
#endif
static napi_value DeviceV4AcquireSource(napi_env env,napi_callback_info info){
 size_t count=1;napi_value arg=nullptr;
 if(napi_get_cb_info(env,info,&count,&arg,nullptr,nullptr)!=napi_ok||count||!pthread_main_np())return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ARGUMENTS_OR_THREAD_INVALID");
 if(productDeviceV4Sources.size()>=32)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_CAPACITY");
 auto*p=new(std::nothrow)ProductDeviceV4SourceOwner;if(!p)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_CAPACITY");p->env=env;p->thread=pthread_self();napi_value result=nullptr;
 if(napi_create_object(env,&result)!=napi_ok||napi_type_tag_object(env,result,&productDeviceV4SourceTag)!=napi_ok||napi_wrap(env,result,p,DeviceV4Finalize,nullptr,nullptr)!=napi_ok){delete p;return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_WRAP_FAILED");}
 productDeviceV4Sources.insert(p);
 const char*names[]={"assertCurrent","retire","join","close","status"};
 for(uintptr_t i=0;i<5;i++){napi_property_descriptor d={names[i],nullptr,i==0?DeviceV4CurrentDispatch:DeviceV4SourceOperation,nullptr,nullptr,nullptr,napi_default,i==0?nullptr:(void*)(i+1)};if(napi_define_properties(env,result,1,&d)!=napi_ok)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_METHODS_FAILED");}if(!DeviceV4DefineReadMethods(env,result))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_METHODS_FAILED");
#ifdef YNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE
 if(!DeviceV4DefineProducerMethod(env,result))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_METHOD_FAILED");
#endif
 if(napi_object_freeze(env,result)!=napi_ok)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_FREEZE_FAILED");
 try{@try{NSError*e=nil;p->source=[YNXAuthIdentitySourceAuthority acquireOriginalProductSessionDeviceV4Source:&e];
  // Adopt SAME source before interpreting error, then fence after construction.
  if(e||!p->source)DeviceV4First(p,e.localizedDescription?:@"PRODUCT_DEVICE_V4_SOURCE_NOT_SUPPLIED");else DeviceV4Current(p);
 }@catch(id){DeviceV4First(p,@"PRODUCT_DEVICE_V4_SOURCE_ACQUIRE_EXCEPTION");}
 }catch(...){DeviceV4First(p,@"PRODUCT_DEVICE_V4_SOURCE_ACQUIRE_CPP_EXCEPTION");}
 if(p->failed){napi_value e=nullptr;if(p->first)napi_get_reference_value(env,p->first,&e);if(!e)e=DeviceV4Error(env,"PRODUCT_DEVICE_V4_SOURCE_FIRST_CAUSE_UNAVAILABLE");if(e){napi_set_named_property(env,e,"partial",result);napi_throw(env,e);}return nullptr;}
 return result;
}
static void DeviceV4SourceEnvRetire(void*env){for(auto*p:productDeviceV4Sources)if(p->env==env)try{@try{DeviceV4Retire(p);}@catch(id){productDeviceV4SourceDebts.insert(p);}}catch(...){productDeviceV4SourceDebts.insert(p);}}
static napi_value RegisterOriginalProductDeviceV4SourceStage(napi_env env,napi_value exports){
 if(!DeviceV4ReadInitialize(env))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ORIGINAL_INTRINSICS_REQUIRED");
 napi_property_descriptor d={"acquireOriginalProductSessionDeviceV4Source",nullptr,DeviceV4AcquireSource,nullptr,nullptr,nullptr,napi_default,nullptr};
 if(napi_add_env_cleanup_hook(env,DeviceV4SourceEnvRetire,env)!=napi_ok||napi_define_properties(env,exports,1,&d)!=napi_ok)return nullptr;
#ifdef YNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE
 // LIFO: finish owned proofs before retiring their original Source parent.
 if(!DeviceV4ProofEnvInitialize(env))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_ENV_CUSTODY_REQUIRED");
#endif
 return exports;
}
