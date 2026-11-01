// Same Native Source4 -> fixed private factory -> opaque operation. No new
// Source/Root/slot/provider/key setter, generic purpose or JS approval flag.
#include "original-product-device-v4-factory.h"
struct DeviceV4NativeProof{
 napi_env env=nullptr;pthread_t thread{};ProductDeviceV4SourceOwner*parent=nullptr;DeviceV4HeldRead*held=nullptr;
 napi_ref parentObject=nullptr,heldObject=nullptr,context=nullptr,firstBox=nullptr,closeBox=nullptr;
 std::unique_ptr<ynx_auth_private::ProductDeviceV4ProofOperation>core;
 bool counted=false,failed=false,retired=false,closeSelected=false,closed=false;
 std::string firstCode;
};
static thread_local std::unordered_set<DeviceV4NativeProof*>deviceV4NativeProofs,deviceV4NativeProofDebts;
static const napi_type_tag deviceV4NativeProofTag={0x594e58445634504fULL,0x5052495641544534ULL};
static void DeviceV4ProofBox(napi_env env,napi_value value,napi_ref&ref){napi_value box=nullptr;if(napi_create_object(env,&box)!=napi_ok)return;napi_property_descriptor p={"cause",nullptr,nullptr,nullptr,nullptr,value,napi_default,nullptr};if(napi_define_properties(env,box,1,&p)==napi_ok)DeviceV4Keep(env,box,ref);}
static napi_value DeviceV4ProofCause(napi_env env,napi_ref ref){napi_value box=DeviceV4Ref(env,ref),cause=nullptr;if(box)napi_get_named_property(env,box,"cause",&cause);return cause;}
static void DeviceV4ProofFirst(DeviceV4NativeProof*p,const char*code){
 bool pending=false;napi_is_exception_pending(p->env,&pending);napi_value cause=nullptr;if(pending)napi_get_and_clear_last_exception(p->env,&cause);
 if(p->failed)return;p->failed=true;p->firstCode=code;if(!cause){cause=DeviceV4Error(p->env,code);if(cause&&p->core){const auto data=p->core->copyOriginalStatusDATA();napi_value v=nullptr;for(const auto&item:{std::pair<const char*,double>{"nativeResult",(double)data.result},{"nativeCleanup",(double)data.cleanup}}){napi_create_double(p->env,item.second,&v);napi_set_named_property(p->env,cause,item.first,v);}const auto exact=std::to_string(data.reportedLength);napi_create_string_utf8(p->env,exact.data(),exact.size(),&v);napi_set_named_property(p->env,cause,"reportedMemberLengthExact",v);if(data.reportedLength<=9007199254740991ULL){napi_create_double(p->env,(double)data.reportedLength,&v);napi_set_named_property(p->env,cause,"reportedMemberLength",v);}napi_get_boolean(p->env,data.helperSelected,&v);napi_set_named_property(p->env,cause,"helperSelected",v);}}if(cause)DeviceV4ProofBox(p->env,cause,p->firstBox);
}
static napi_value DeviceV4ProofThrowFirst(DeviceV4NativeProof*p){napi_value cause=DeviceV4ProofCause(p->env,p->firstBox);if(cause)napi_throw(p->env,cause);else DeviceV4Throw(p->env,p->firstCode.empty()?"PRODUCT_DEVICE_V4_PROOF_UNKNOWN":p->firstCode.c_str());return nullptr;}
static DeviceV4NativeProof*DeviceV4ProofOriginal(napi_env env,napi_value object){bool tagged=false;void*raw=nullptr;if(napi_check_object_type_tag(env,object,&deviceV4NativeProofTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,object,&raw)!=napi_ok)return nullptr;auto*p=static_cast<DeviceV4NativeProof*>(raw);return deviceV4NativeProofs.count(p)&&p->env==env&&pthread_equal(p->thread,pthread_self())&&pthread_main_np()?p:nullptr;}
static bool DeviceV4ProofCurrent(DeviceV4NativeProof*p){
 if(p->failed)return false;if(p->retired||p->closeSelected||!p->core||!p->held){DeviceV4ProofFirst(p,"PRODUCT_DEVICE_V4_PROOF_RETIRED");return false;}
 try{@try{
  if(!DeviceV4HeldCurrent(p->env,p->held)){DeviceV4ProofFirst(p,"PRODUCT_DEVICE_V4_PROOF_HELD_NOT_CURRENT");return false;}
  std::string e;if(!p->core->assertCurrent(e)){DeviceV4ProofFirst(p,e.empty()?"PRODUCT_DEVICE_V4_PROOF_CORE_NOT_CURRENT":e.c_str());return false;}
  if(!DeviceV4HeldCurrent(p->env,p->held)){DeviceV4ProofFirst(p,"PRODUCT_DEVICE_V4_PROOF_POST_HELD_NOT_CURRENT");return false;}return true;
 }@catch(id){DeviceV4ProofFirst(p,"PRODUCT_DEVICE_V4_PROOF_CURRENT_EXCEPTION");return false;}}
 catch(...){DeviceV4ProofFirst(p,"PRODUCT_DEVICE_V4_PROOF_CURRENT_CPP_EXCEPTION");return false;}
}
static void DeviceV4ProofRetire(DeviceV4NativeProof*p){if(p->retired)return;p->retired=true;if(p->core)p->core->retire();}
static bool DeviceV4ProofCloseUnknown(DeviceV4NativeProof*p,const char*code){if(!p->closeBox){napi_value cause=DeviceV4Error(p->env,code);if(cause)DeviceV4ProofBox(p->env,cause,p->closeBox);}deviceV4NativeProofDebts.insert(p);return false;}
static bool DeviceV4ProofClose(DeviceV4NativeProof*p){
 if(p->closeSelected)return p->closed;p->closeSelected=true;
 try{@try{DeviceV4ProofRetire(p);std::string e;if(p->core&&!p->core->close(e)){napi_value cause=DeviceV4Error(p->env,e.empty()?"PRODUCT_DEVICE_V4_PROOF_CLOSE_UNKNOWN":e.c_str());if(cause)DeviceV4ProofBox(p->env,cause,p->closeBox);deviceV4NativeProofDebts.insert(p);return false;}
  p->closed=true;if(p->counted&&p->parent){p->parent->proofs--;p->counted=false;}
  for(auto r:{p->parentObject,p->heldObject,p->context,p->firstBox})if(r)napi_delete_reference(p->env,r);p->parentObject=p->heldObject=p->context=p->firstBox=nullptr;p->parent=nullptr;p->held=nullptr;deviceV4NativeProofDebts.erase(p);return true;
 }@catch(id){return DeviceV4ProofCloseUnknown(p,"PRODUCT_DEVICE_V4_PROOF_CLOSE_EXCEPTION");}}catch(...){return DeviceV4ProofCloseUnknown(p,"PRODUCT_DEVICE_V4_PROOF_CLOSE_CPP_EXCEPTION");}
}
static void DeviceV4ProofFinalize(napi_env env,void*raw,void*){auto*p=static_cast<DeviceV4NativeProof*>(raw);if(!deviceV4NativeProofs.count(p))return;if(!DeviceV4ProofClose(p))return;deviceV4NativeProofs.erase(p);if(p->closeBox)napi_delete_reference(env,p->closeBox);delete p;}
static napi_value DeviceV4ProofMethod(napi_env env,napi_callback_info info){
 size_t count=1;napi_value arg=nullptr,self=nullptr;void*method=nullptr;if(napi_get_cb_info(env,info,&count,&arg,&self,&method)!=napi_ok||count)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_ARGUMENTS_INVALID");auto*p=DeviceV4ProofOriginal(env,self);if(!p)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ORIGINAL_PROOF_REQUIRED");
 try{@try{switch((uintptr_t)method){
  case 1:{// Capture/read public original even for failed, retired or closed op.
   auto raw=p->core?p->core->copyOriginalMemberDATA():std::vector<unsigned char>{};if(raw.size()>98304)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_MEMBER_BOUND");napi_value result=nullptr;if(napi_create_buffer_copy(env,raw.size(),raw.empty()?nullptr:raw.data(),nullptr,&result)!=napi_ok)return nullptr;return result;}
  case 2:if(DeviceV4ProofCurrent(p))return DeviceV4Undefined(env);return DeviceV4ProofThrowFirst(p);
  case 3:DeviceV4ProofRetire(p);return DeviceV4Undefined(env);
  case 4:{std::string error;if(!p->retired||(p->core&&!p->core->join(error)))return DeviceV4Throw(env,error.empty()?"PRODUCT_DEVICE_V4_PROOF_JOIN_PENDING":error.c_str());return DeviceV4Undefined(env);}
  case 5:if(DeviceV4ProofClose(p))return DeviceV4Undefined(env);{napi_value e=DeviceV4ProofCause(env,p->closeBox);if(e)napi_throw(env,e);else DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_CLOSE_UNKNOWN");return nullptr;}
 }}@catch(id){DeviceV4ProofFirst(p,"PRODUCT_DEVICE_V4_PROOF_METHOD_EXCEPTION");return DeviceV4ProofThrowFirst(p);}}
 catch(...){DeviceV4ProofFirst(p,"PRODUCT_DEVICE_V4_PROOF_METHOD_CPP_EXCEPTION");return DeviceV4ProofThrowFirst(p);}
 return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_METHOD_UNKNOWN");
}
static NSData*DeviceV4UnsignedOriginal(napi_env env,napi_value value){
 if(!DeviceV4PlainFrozen(env,value,21))return nil;NSMutableDictionary*d=[NSMutableDictionary new];
 for(const char*key:{"version","sessionBinding","productId","clientId","applicationId","bundleId","packageId","origin","callback","account","canonicalOwner","deviceId","deviceRegistrationId","deviceRegistrationRevision","deviceRegistrationDigest","method","path","bodyDigest","nonce","issuedAt","expiresAt"}){
  napi_value v=DeviceV4DataProperty(env,value,key);napi_valuetype type;if(!v||napi_typeof(env,v,&type)!=napi_ok)return nil;NSString*k=[NSString stringWithUTF8String:key];if(type==napi_null){d[k]=NSNull.null;continue;}if(type!=napi_string)return nil;size_t size=0;if(napi_get_value_string_utf8(env,v,nullptr,0,&size)!=napi_ok||size>4096)return nil;std::vector<char>raw(size+1);size_t got=0;if(napi_get_value_string_utf8(env,v,raw.data(),raw.size(),&got)!=napi_ok||got!=size)return nil;NSString*s=[[NSString alloc]initWithBytes:raw.data() length:size encoding:NSUTF8StringEncoding];if(!s)return nil;d[k]=s;
 }NSData*raw=[NSJSONSerialization dataWithJSONObject:d options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];return raw.length&&raw.length<=16384?raw:nil;
}
static napi_value DeviceV4ProduceHTTPProof(napi_env env,napi_callback_info info){
 size_t count=4;napi_value args[4]{},self=nullptr;if(napi_get_cb_info(env,info,&count,args,&self,nullptr)!=napi_ok||count!=3)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_ARGUMENTS_INVALID");auto*source=DeviceV4Original(env,self);if(!source)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ORIGINAL_SOURCE_REQUIRED");
 DeviceV4NativeProof*adopted=nullptr;napi_value adoptedObject=nullptr;
 try{@try{
  auto*held=DeviceV4Held(env,args[1],source);bool same=false;if(!held)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SAME_HELD_REQUIRED");if(napi_strict_equals(env,args[2],DeviceV4Ref(env,held->context),&same)!=napi_ok||!same)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SAME_ABORT_CONTEXT_REQUIRED");
  if(!DeviceV4HeldCurrent(env,held))return nullptr;if(source->proofs||deviceV4NativeProofs.size()>=256)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_BUSY_OR_CAPACITY");
  if(!DeviceV4PlainFrozen(env,args[0],3))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_INPUT_REQUIRED");napi_value version=DeviceV4DataProperty(env,args[0],"version"),network=DeviceV4DataProperty(env,args[0],"networkId"),value=DeviceV4DataProperty(env,args[0],"unsigned");
  napi_valuetype type;if(!version||!network||!value||napi_typeof(env,version,&type)!=napi_ok||type!=napi_string)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_VERSION_REQUIRED");char text[66]{};size_t length=0;if(napi_get_value_string_utf8(env,version,text,sizeof(text),&length)!=napi_ok||length!=1||text[0]!='4')return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_VERSION_REQUIRED");
  size_t networkLength=0;if(napi_typeof(env,network,&type)!=napi_ok||type!=napi_string||napi_get_value_string_utf8(env,network,nullptr,0,&networkLength)!=napi_ok||networkLength!=64||napi_get_value_string_utf8(env,network,text,sizeof(text),&length)!=napi_ok||length!=64||![[NSString stringWithUTF8String:text]isEqual:held->scope[@"expected"][@"networkId"]])return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_NETWORK_BINDING");
  NSData*raw=DeviceV4UnsignedOriginal(env,value);if(!raw)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_UNSIGNED_REQUIRED");
  // Establish actual tagged wrapper and same parent/context custody BEFORE
  // invoking any slot/factory effect. Late failures return this failed op,
  // never throw away an unreturnable partial (including frozen abort reasons).
  auto*p=new(std::nothrow)DeviceV4NativeProof;if(!p)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_CAPACITY");p->env=env;p->thread=pthread_self();p->parent=source;p->held=held;
  auto dispose=[env](DeviceV4NativeProof*q){for(auto r:{q->parentObject,q->heldObject,q->context})if(r)napi_delete_reference(env,r);delete q;};std::unique_ptr<DeviceV4NativeProof,decltype(dispose)>guard(p,dispose);
  if(!DeviceV4Keep(env,self,p->parentObject)||!DeviceV4Keep(env,args[1],p->heldObject)||!DeviceV4Keep(env,args[2],p->context))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_CAPTURE_UNKNOWN");napi_value result=nullptr;
  if(napi_create_object(env,&result)!=napi_ok||napi_type_tag_object(env,result,&deviceV4NativeProofTag)!=napi_ok)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_WRAP_UNKNOWN");
  const char*names[]={"readOriginalMember","assertCurrent","retire","join","close"};for(uintptr_t i=0;i<5;i++){napi_property_descriptor d={names[i],nullptr,DeviceV4ProofMethod,nullptr,nullptr,nullptr,napi_default,(void*)(i+1)};if(napi_define_properties(env,result,1,&d)!=napi_ok)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_METHODS_UNKNOWN");}
  if(napi_object_freeze(env,result)!=napi_ok)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_FREEZE_UNKNOWN");deviceV4NativeProofs.insert(p);if(napi_wrap(env,result,p,DeviceV4ProofFinalize,nullptr,nullptr)!=napi_ok){deviceV4NativeProofs.erase(p);return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PROOF_WRAP_UNKNOWN");}guard.release();source->proofs++;p->counted=true;adopted=p;adoptedObject=result;
  std::string error;p->core=ynx_auth_private::ProductDeviceV4Factory::produce(source->source,raw,error); // adopt first
  if(!p->core||!error.empty())DeviceV4ProofFirst(p,error.empty()?"PRODUCT_DEVICE_V4_FACTORY_PARTIAL_UNKNOWN":error.c_str());
  if(!p->failed)DeviceV4ProofCurrent(p);
  // The SDK now owns SAME op before its active/current checks throw. Its
  // finally path can capture original public bytes and retire/join/close it.
  return result;
 }@catch(id){if(adopted){DeviceV4ProofFirst(adopted,"PRODUCT_DEVICE_V4_PRODUCER_NATIVE_EXCEPTION");return adoptedObject;}return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_NATIVE_EXCEPTION");}}
 catch(...){if(adopted){DeviceV4ProofFirst(adopted,"PRODUCT_DEVICE_V4_PRODUCER_CPP_EXCEPTION");return adoptedObject;}return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_PRODUCER_CPP_EXCEPTION");}
}
static bool DeviceV4DefineProducerMethod(napi_env env,napi_value object){napi_property_descriptor d={"produceHTTPProof",nullptr,DeviceV4ProduceHTTPProof,nullptr,nullptr,nullptr,napi_default,nullptr};return napi_define_properties(env,object,1,&d)==napi_ok;}
static void DeviceV4ProofEnvCleanup(void*raw){auto env=(napi_env)raw;for(auto*p:deviceV4NativeProofs)if(p->env==env)try{@try{DeviceV4ProofRetire(p);DeviceV4ProofClose(p);}@catch(id){deviceV4NativeProofDebts.insert(p);}}catch(...){deviceV4NativeProofDebts.insert(p);}}
static bool DeviceV4ProofEnvInitialize(napi_env env){return napi_add_env_cleanup_hook(env,DeviceV4ProofEnvCleanup,env)==napi_ok;}
