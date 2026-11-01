// Private source4 data/current bridge. No slot/signing callback/provider setter.
#include <unordered_map>
#include <memory>
struct DeviceV4ReadIntrinsics{napi_ref proxy=nullptr,frozen=nullptr,descriptor=nullptr,prototype=nullptr,aborted=nullptr,reason=nullptr;};
static thread_local std::unordered_map<napi_env,DeviceV4ReadIntrinsics>deviceV4ReadIntrinsics;
static napi_value DeviceV4Ref(napi_env env,napi_ref ref){napi_value v=nullptr;if(ref)napi_get_reference_value(env,ref,&v);return v;}
static bool DeviceV4Keep(napi_env env,napi_value v,napi_ref&ref){return napi_create_reference(env,v,1,&ref)==napi_ok;}
static bool DeviceV4ReadRefuse(napi_env env,const char*code){bool pending=false;napi_is_exception_pending(env,&pending);if(!pending)DeviceV4Throw(env,code);return false;}
static napi_value DeviceV4ReadSourceRefuse(ProductDeviceV4SourceOwner*p,NSString*code){napi_value e=DeviceV4First(p,code);if(e)napi_throw(p->env,e);else DeviceV4Throw(p->env,"PRODUCT_DEVICE_V4_SOURCE_UNKNOWN");return nullptr;}
static bool DeviceV4CallBool(napi_env env,napi_ref ref,napi_value receiver,napi_value arg,bool&result){napi_value v=nullptr;return napi_call_function(env,receiver,DeviceV4Ref(env,ref),arg?1:0,arg?&arg:nullptr,&v)==napi_ok&&napi_get_value_bool(env,v,&result)==napi_ok;}
static napi_value DeviceV4DataProperty(napi_env env,napi_value value,const char*name){
 napi_value key=nullptr,d=nullptr,result=nullptr;auto&i=deviceV4ReadIntrinsics.at(env);napi_create_string_utf8(env,name,NAPI_AUTO_LENGTH,&key);napi_value args[]={value,key};
 if(napi_call_function(env,DeviceV4Undefined(env),DeviceV4Ref(env,i.descriptor),2,args,&d)!=napi_ok)return nullptr;
 bool own=false;if(napi_has_own_property(env,d,([](napi_env e){napi_value k=nullptr;napi_create_string_utf8(e,"value",5,&k);return k;})(env),&own)!=napi_ok||!own)return nullptr;
 if(napi_get_named_property(env,d,"value",&result)!=napi_ok)return nullptr;return result;
}
static bool DeviceV4PlainFrozen(napi_env env,napi_value v,size_t fields){
 auto it=deviceV4ReadIntrinsics.find(env);if(it==deviceV4ReadIntrinsics.end())return false;auto&i=it->second;bool yes=false;
 if(!DeviceV4CallBool(env,i.proxy,DeviceV4Undefined(env),v,yes)||yes||!DeviceV4CallBool(env,i.frozen,DeviceV4Undefined(env),v,yes)||!yes)return false;
 napi_value prototype=nullptr,keys=nullptr;uint32_t size=0;
 return napi_get_prototype(env,v,&prototype)==napi_ok&&napi_strict_equals(env,prototype,DeviceV4Ref(env,i.prototype),&yes)==napi_ok&&yes&&napi_get_all_property_names(env,v,napi_key_own_only,napi_key_all_properties,napi_key_numbers_to_strings,&keys)==napi_ok&&napi_get_array_length(env,keys,&size)==napi_ok&&size==fields;
}
static bool DeviceV4SignalCurrent(napi_env env,napi_value signal){
 auto&i=deviceV4ReadIntrinsics.at(env);bool proxy=false,aborted=false;
 if(!DeviceV4CallBool(env,i.proxy,DeviceV4Undefined(env),signal,proxy)||proxy)return DeviceV4ReadRefuse(env,"PRODUCT_DEVICE_V4_ORIGINAL_ABORT_SIGNAL_REQUIRED");
 if(!DeviceV4CallBool(env,i.aborted,signal,nullptr,aborted))return DeviceV4ReadRefuse(env,"PRODUCT_DEVICE_V4_ORIGINAL_ABORT_SIGNAL_REQUIRED");
 if(!aborted)return true;napi_value reason=nullptr;
 if(napi_call_function(env,signal,DeviceV4Ref(env,i.reason),0,nullptr,&reason)==napi_ok)napi_throw(env,reason);return false;
}
static NSDictionary*DeviceV4ExpectedOriginal(napi_env env,napi_value expected){
 if(!DeviceV4PlainFrozen(env,expected,17))return nil;NSMutableDictionary*d=[NSMutableDictionary new];
 for(const char*key:{"networkId","canonicalOwner","account","sessionBinding","productId","clientId","platform","applicationId","bundleId","packageId","origin","callback","deviceId","generation","registrationId","revision","registrationDigest"}){
  napi_value v=DeviceV4DataProperty(env,expected,key);napi_valuetype type;if(!v||napi_typeof(env,v,&type)!=napi_ok)return nil;
  NSString*k=[NSString stringWithUTF8String:key];if(type==napi_null){d[k]=NSNull.null;continue;}if(type!=napi_string)return nil;
  size_t size=0;if(napi_get_value_string_utf8(env,v,nullptr,0,&size)!=napi_ok||size>4096)return nil;std::vector<char>bytes(size+1);size_t copied=0;if(napi_get_value_string_utf8(env,v,bytes.data(),bytes.size(),&copied)!=napi_ok||copied!=size)return nil;
  NSString*s=[[NSString alloc]initWithBytes:bytes.data() length:size encoding:NSUTF8StringEncoding];if(!s)return nil;d[k]=s;
 }return[d copy];
}
struct DeviceV4HeldRead{ProductDeviceV4SourceOwner*parent=nullptr;NSDictionary*__strong scope=nil;napi_ref parentObject=nullptr,context=nullptr,signal=nullptr,firstCause=nullptr;std::string failed;};
static thread_local std::unordered_set<DeviceV4HeldRead*>deviceV4HeldReads;
static const napi_type_tag deviceV4HeldReadTag={0x594e584445564834ULL,0x5052495641544531ULL};
static void DeviceV4ReadRelease(napi_env env,DeviceV4HeldRead*h){for(auto r:{h->parentObject,h->context,h->signal,h->firstCause})if(r)napi_delete_reference(env,r);h->scope=nil;delete h;}
static void DeviceV4ReadFinalize(napi_env env,void*raw,void*){auto*h=static_cast<DeviceV4HeldRead*>(raw);if(deviceV4HeldReads.erase(h))DeviceV4ReadRelease(env,h);}
static DeviceV4HeldRead*DeviceV4Held(napi_env env,napi_value object,ProductDeviceV4SourceOwner*p){bool tagged=false;void*raw=nullptr;if(napi_check_object_type_tag(env,object,&deviceV4HeldReadTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,object,&raw)!=napi_ok)return nullptr;auto*h=static_cast<DeviceV4HeldRead*>(raw);return deviceV4HeldReads.count(h)&&h->parent==p?h:nullptr;}
static bool DeviceV4HeldRefuse(napi_env env,DeviceV4HeldRead*h,NSString*code){napi_value e=nullptr;if(h->failed.empty()){h->failed=(code?:@"PRODUCT_DEVICE_V4_HELD_UNKNOWN").UTF8String;e=DeviceV4Error(env,h->failed.c_str());if(e)DeviceV4Keep(env,e,h->firstCause);}else e=DeviceV4Ref(env,h->firstCause);if(e)napi_throw(env,e);else DeviceV4Throw(env,h->failed.c_str());return false;}
static bool DeviceV4HeldCurrent(napi_env env,DeviceV4HeldRead*h){
 if(!h->failed.empty())return DeviceV4HeldRefuse(env,h,nil);
 if(!DeviceV4SignalCurrent(env,DeviceV4Ref(env,h->signal)))return false;
 if(!DeviceV4Current(h->parent)){napi_value e=DeviceV4Ref(env,h->parent->first);if(e)napi_throw(env,e);else DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_UNKNOWN");return false;}
 NSError*error=nil;NSDictionary*scope=[h->parent->source copyOriginalProductSessionDeviceV4Scope:&error];
 if(error||!scope||![scope isEqual:h->scope])return DeviceV4HeldRefuse(env,h,error.localizedDescription?:@"PRODUCT_DEVICE_V4_SOURCE_SCOPE_CHANGED");
 return DeviceV4SignalCurrent(env,DeviceV4Ref(env,h->signal));
}
static napi_value DeviceV4ContextDATA(napi_env env,NSDictionary*context){
 if(![context isKindOfClass:NSDictionary.class]||context.count!=12)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_CONTEXT_INVALID");napi_value result=nullptr;if(napi_create_object(env,&result)!=napi_ok)return nullptr;
 for(NSString*key in context){napi_value value=nullptr;id raw=context[key];if([key isEqual:@"scopes"]){if(![raw isKindOfClass:NSArray.class]||[raw count]>8)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_CONTEXT_INVALID");if(napi_create_array_with_length(env,[raw count],&value)!=napi_ok)return nullptr;unsigned at=0;for(id s in raw){napi_value item=nullptr;if(![s isKindOfClass:NSString.class]||napi_create_string_utf8(env,[s UTF8String],[s lengthOfBytesUsingEncoding:NSUTF8StringEncoding],&item)!=napi_ok||napi_set_element(env,value,at++,item)!=napi_ok)return nullptr;}napi_object_freeze(env,value);}else if(![raw isKindOfClass:NSString.class]||napi_create_string_utf8(env,[raw UTF8String],[raw lengthOfBytesUsingEncoding:NSUTF8StringEncoding],&value)!=napi_ok)return nullptr;if(napi_set_named_property(env,result,key.UTF8String,value)!=napi_ok)return nullptr;}
 if(napi_object_freeze(env,result)!=napi_ok)return nullptr;return result;
}
static napi_value DeviceV4ReadCurrent(napi_env env,napi_callback_info info){
 napi_value args[3]{},self=nullptr;size_t count=3;if(napi_get_cb_info(env,info,&count,args,&self,nullptr)!=napi_ok||count!=2)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ARGUMENTS_INVALID");auto*p=DeviceV4Original(env,self);if(!p)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ORIGINAL_SOURCE_REQUIRED");
 try{@try{
  NSDictionary*expected=DeviceV4ExpectedOriginal(env,args[0]);if(!expected||!DeviceV4PlainFrozen(env,args[1],1))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_EXPECTED_OR_ABORT_CONTEXT_REQUIRED");
  napi_value signal=DeviceV4DataProperty(env,args[1],"signal");if(!signal||!DeviceV4SignalCurrent(env,signal))return nullptr;
  if(deviceV4HeldReads.size()>=256)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_HELD_CAPACITY");
  if(!DeviceV4Current(p))return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_SOURCE_UNKNOWN");NSError*error=nil;NSDictionary*scope=[p->source copyOriginalProductSessionDeviceV4Scope:&error];
  if(error||!scope)return DeviceV4ReadSourceRefuse(p,error.localizedDescription?:@"PRODUCT_DEVICE_V4_SOURCE_SCOPE_REQUIRED");
  if(![scope[@"expected"]isEqual:expected])return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_EXPECTED_BINDING_MISMATCH");
  auto*h=new(std::nothrow)DeviceV4HeldRead;if(!h)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_HELD_CAPACITY");h->parent=p;h->scope=scope;
  auto release=[env](DeviceV4HeldRead*held){DeviceV4ReadRelease(env,held);};std::unique_ptr<DeviceV4HeldRead,decltype(release)>guard(h,release);
  if(!DeviceV4Keep(env,self,h->parentObject)||!DeviceV4Keep(env,args[1],h->context)||!DeviceV4Keep(env,signal,h->signal))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_HELD_CAPTURE_UNKNOWN");
  if(!DeviceV4HeldCurrent(env,h))return nullptr;
  napi_value held=nullptr;if(napi_create_object(env,&held)!=napi_ok||napi_type_tag_object(env,held,&deviceV4HeldReadTag)!=napi_ok)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_HELD_WRAP_UNKNOWN");
  deviceV4HeldReads.insert(h);if(napi_wrap(env,held,h,DeviceV4ReadFinalize,nullptr,nullptr)!=napi_ok){deviceV4HeldReads.erase(h);return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_HELD_WRAP_UNKNOWN");}guard.release();if(napi_object_freeze(env,held)!=napi_ok)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_HELD_FREEZE_UNKNOWN");return held;
 }@catch(id){return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_READ_CURRENT_EXCEPTION");}}catch(...){return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_READ_CURRENT_CPP_EXCEPTION");}
}
static napi_value DeviceV4ReadOriginal(napi_env env,napi_callback_info info){
 napi_value args[3]{},self=nullptr;void*mode=nullptr;size_t count=3;if(napi_get_cb_info(env,info,&count,args,&self,&mode)!=napi_ok)return nullptr;auto*p=DeviceV4Original(env,self);if(!p)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ORIGINAL_SOURCE_REQUIRED");auto kind=(uintptr_t)mode;
 try{@try{
  if(kind==3){if(count)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ARGUMENTS_INVALID");NSError*e=nil;NSDictionary*s=[p->source copyOriginalProductSessionDeviceV4Scope:&e];if(e||!s||!DeviceV4Current(p))return DeviceV4ReadSourceRefuse(p,e.localizedDescription?:@"PRODUCT_DEVICE_V4_CONTEXT_NOT_CURRENT");napi_value result=DeviceV4ContextDATA(env,s[@"context"]);if(!DeviceV4Current(p))return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_CONTEXT_NOT_CURRENT");return result;}
  if(count!=(kind==0?2u:1u))return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ARGUMENTS_INVALID");auto*h=DeviceV4Held(env,args[0],p);if(!h)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SAME_HELD_REQUIRED");
  if(kind==0){bool same=false;if(napi_strict_equals(env,args[1],DeviceV4Ref(env,h->context),&same)!=napi_ok||!same)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SAME_ABORT_CONTEXT_REQUIRED");}
  if(!DeviceV4HeldCurrent(env,h))return nullptr;napi_value result=nullptr;
  if(kind==0)result=DeviceV4Undefined(env);else{NSString*raw=h->scope[kind==1?@"registrationOriginal":@"sessionOriginal"];NSData*data=[raw dataUsingEncoding:NSUTF8StringEncoding];if(!data||!data.length||data.length>16384)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ORIGINAL_CAPACITY");if(kind==1){if(napi_create_buffer_copy(env,data.length,data.bytes,nullptr,&result)!=napi_ok)return nullptr;}else if(napi_create_string_utf8(env,(const char*)data.bytes,data.length,&result)!=napi_ok)return nullptr;}
  if(!DeviceV4HeldCurrent(env,h))return nullptr;return result;
 }@catch(id){return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_ORIGINAL_READ_EXCEPTION");}}catch(...){return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_ORIGINAL_READ_CPP_EXCEPTION");}
}
static napi_value DeviceV4CurrentDispatch(napi_env env,napi_callback_info info){size_t count=3;napi_value args[3]{},self=nullptr;if(napi_get_cb_info(env,info,&count,args,&self,nullptr)!=napi_ok)return nullptr;if(!count){auto*p=DeviceV4Original(env,self);if(!p)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ORIGINAL_SOURCE_REQUIRED");if(DeviceV4Current(p))return DeviceV4Undefined(env);napi_value e=DeviceV4Ref(env,p->first);if(e)napi_throw(env,e);else DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_UNKNOWN");return nullptr;}return DeviceV4ReadOriginal(env,info);}
static bool DeviceV4DefineReadMethods(napi_env env,napi_value object){
 napi_property_descriptor methods[]={{"readCurrent",nullptr,DeviceV4ReadCurrent,nullptr,nullptr,nullptr,napi_default,nullptr},{"readRegistrationOriginal",nullptr,DeviceV4ReadOriginal,nullptr,nullptr,nullptr,napi_default,(void*)1},{"readSessionOriginal",nullptr,DeviceV4ReadOriginal,nullptr,nullptr,nullptr,napi_default,(void*)2},{"readContext",nullptr,DeviceV4ReadOriginal,nullptr,nullptr,nullptr,napi_default,(void*)3}};return napi_define_properties(env,object,4,methods)==napi_ok;
}
static void DeviceV4ReadEnvCleanup(void*raw){auto env=(napi_env)raw;auto it=deviceV4ReadIntrinsics.find(env);if(it==deviceV4ReadIntrinsics.end())return;for(auto r:{it->second.proxy,it->second.frozen,it->second.descriptor,it->second.prototype,it->second.aborted,it->second.reason})if(r)napi_delete_reference(env,r);deviceV4ReadIntrinsics.erase(it);}
static bool DeviceV4ReadInitialize(napi_env env){
 if(deviceV4ReadIntrinsics.count(env))return false;
 napi_value global=nullptr,object=nullptr,signal=nullptr,process=nullptr,getBuiltin=nullptr,util=nullptr,types=nullptr,name=nullptr,v=nullptr,proto=nullptr;napi_get_global(env,&global);DeviceV4ReadIntrinsics i;
 auto capture=[&](napi_value from,const char*key,napi_ref&ref){return napi_get_named_property(env,from,key,&v)==napi_ok&&DeviceV4Keep(env,v,ref);};
 if(napi_get_named_property(env,global,"Object",&object)!=napi_ok||!capture(object,"isFrozen",i.frozen)||!capture(object,"getOwnPropertyDescriptor",i.descriptor)||!capture(object,"prototype",i.prototype)||napi_get_named_property(env,global,"AbortSignal",&signal)!=napi_ok||napi_get_named_property(env,signal,"prototype",&proto)!=napi_ok)goto failed;
 for(const auto&entry:{std::pair<const char*,napi_ref*>{"aborted",&i.aborted},{"reason",&i.reason}}){napi_create_string_utf8(env,entry.first,NAPI_AUTO_LENGTH,&name);napi_value args[]={proto,name};if(napi_call_function(env,object,DeviceV4Ref(env,i.descriptor),2,args,&v)!=napi_ok||!capture(v,"get",*entry.second))goto failed;}
 if(napi_get_named_property(env,global,"process",&process)!=napi_ok||napi_get_named_property(env,process,"getBuiltinModule",&getBuiltin)!=napi_ok)goto failed;napi_create_string_utf8(env,"node:util",9,&name);
 if(napi_call_function(env,process,getBuiltin,1,&name,&util)!=napi_ok||napi_get_named_property(env,util,"types",&types)!=napi_ok||!capture(types,"isProxy",i.proxy))goto failed;
 deviceV4ReadIntrinsics.emplace(env,i);if(napi_add_env_cleanup_hook(env,DeviceV4ReadEnvCleanup,env)!=napi_ok){DeviceV4ReadEnvCleanup(env);return false;}return true;
 failed:for(auto r:{i.proxy,i.frozen,i.descriptor,i.prototype,i.aborted,i.reason})if(r)napi_delete_reference(env,r);return false;
}
