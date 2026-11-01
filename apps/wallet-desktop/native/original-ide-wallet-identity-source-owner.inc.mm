// Included after original R91 Native helpers in the SAME module. Not a JS
// factory, interchangeable provider, approval permission or key exporter.
#import "../../../packages/wallet-auth/native/original-ide-wallet-identity-source.h"
#import "../../../packages/wallet-auth/native/original-ide-wallet-peer-launch.h"
struct IDEWalletSourceOwner{
 napi_env env=nullptr;pthread_t thread{};
 YNXOriginalIDEWalletIdentitySource*__strong source=nil;
 YNXOriginalIDEWalletPeerLaunch*__strong transport=nil;unsigned busy=0;
 NSDictionary*__strong terminalTransportStatus=nil;
 bool bound=false,retired=false,closed=false,closing=false,envCleanupInstalled=false;
 std::string first,closeFirst;
};
static const napi_type_tag ideWalletSourceTag={0x594e584944455753ULL,0x52434f574e455231ULL};
static std::unordered_set<IDEWalletSourceOwner*>ideWalletSources,ideWalletSourceDebts;
static bool IDEWalletFail(IDEWalletSourceOwner*p,const char*code){if(p->first.empty())p->first=code;return false;}
static IDEWalletSourceOwner*IDEWalletOriginal(napi_env env,napi_value value){bool tagged=false;void*raw=nullptr;if(!pthread_main_np()||napi_check_object_type_tag(env,value,&ideWalletSourceTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,value,&raw)!=napi_ok)return nullptr;auto*p=static_cast<IDEWalletSourceOwner*>(raw);return ideWalletSources.count(p)&&p->env==env&&pthread_equal(p->thread,pthread_self())?p:nullptr;}
static bool IDEWalletCurrent(IDEWalletSourceOwner*p,bool requireRequest){
 if(!p->first.empty()||p->retired||p->closing||!p->source)return false;
 if(requireRequest&&!p->bound)return IDEWalletFail(p,"AUTH_IDENTITY_WALLET_REQUEST_REQUIRED");
 NSError*error=nil;if(![p->source assertCurrent:&error]||error)return IDEWalletFail(p,IDEIdentityCode(error,"AUTH_IDENTITY_WALLET_SOURCE_NOT_CURRENT").c_str());if(p->transport&&(![p->transport assertCurrent:&error]||error))return IDEWalletFail(p,IDEIdentityCode(error,"AUTH_IDENTITY_WALLET_PEER_NOT_CURRENT").c_str());return p->first.empty()&&!p->retired&&!p->closing;
}
static bool IDEWalletClose(IDEWalletSourceOwner*p){
 if(p->busy)return false;if(p->closing)return p->closed;
 p->retired=true;[p->transport retire];[p->source retire];NSError*error=nil;
 if(p->transport&&![p->transport join:&error]){if(error&&p->closeFirst.empty())p->closeFirst=IDEIdentityCode(error,"AUTH_IDENTITY_WALLET_JOIN_UNKNOWN");return false;}
 if(p->source&&![p->source join:&error])return false;
 p->closing=true;error=nil;bool transportDone=!p->transport||[p->transport close:&error];
 if(!transportDone||error){p->closeFirst=IDEIdentityCode(error,"AUTH_IDENTITY_WALLET_TRANSPORT_CLOSE_UNKNOWN");ideWalletSourceDebts.insert(p);return false;}
 if(p->transport)p->terminalTransportStatus=[[p->transport status]copy];
 error=nil;bool done=!p->source||[p->source close:&error];
 if(!done||error){p->closeFirst=IDEIdentityCode(error,"AUTH_IDENTITY_WALLET_CLOSE_UNKNOWN");ideWalletSourceDebts.insert(p);return false;}
 p->source=nil;p->transport=nil;p->closed=true;ideWalletSourceDebts.erase(p);return true;
}
static void IDEWalletEnvironmentRetire(void*raw){auto*p=static_cast<IDEWalletSourceOwner*>(raw);if(!ideWalletSources.count(p))return;p->envCleanupInstalled=false;p->retired=true;[p->transport retire];[p->source retire];}
static void IDEWalletFinalize(napi_env,void*raw,void*){auto*p=static_cast<IDEWalletSourceOwner*>(raw);if(!ideWalletSources.count(p))return;if(!IDEWalletClose(p)){ideWalletSourceDebts.insert(p);return;}if(p->envCleanupInstalled&&napi_remove_env_cleanup_hook(p->env,IDEWalletEnvironmentRetire,p)!=napi_ok){p->closeFirst="AUTH_IDENTITY_WALLET_ENVIRONMENT_CLOSE_UNKNOWN";ideWalletSourceDebts.insert(p);return;}p->envCleanupInstalled=false;ideWalletSourceDebts.erase(p);ideWalletSources.erase(p);delete p;}
struct IDEWalletWork{IDEWalletSourceOwner*p;bool sending;ynx_auth_ide_identity_private::Frame frame{ynx_auth_ide_identity_private::Message::failure,0,{}};std::string failure;napi_async_work work=nullptr;napi_deferred deferred=nullptr;napi_ref self=nullptr;};
static napi_value IDEWalletErrorValue(napi_env env,const char*code){napi_value text,error;napi_create_string_utf8(env,code,NAPI_AUTO_LENGTH,&text);napi_create_error(env,nullptr,text,&error);napi_set_named_property(env,error,"code",text);return error;}
static void IDEWalletExecute(napi_env,void*raw){auto*w=static_cast<IDEWalletWork*>(raw);try{if(w->sending)[w->p->transport sendBytes:w->frame];else w->frame=[w->p->transport receiveBytes];}catch(const std::exception&e){w->failure=e.what();}catch(...){w->failure="AUTH_IDENTITY_WALLET_IO_UNKNOWN";}}
static void IDEWalletComplete(napi_env env,napi_status status,void*raw){
 std::unique_ptr<IDEWalletWork>w(static_cast<IDEWalletWork*>(raw));auto*p=w->p;napi_value result=Undefined(env);bool ok=false;
 @try{try{
  if(status!=napi_ok)IDEWalletFail(p,"AUTH_IDENTITY_WALLET_WORK_CANCELLED");if(!w->failure.empty())IDEWalletFail(p,w->failure.c_str());
  if(p->first.empty()){
   NSError*error=nil;if(!w->sending){p->bound=true;if(![p->transport captureRequest:std::move(w->frame) error:&error]||error)IDEWalletFail(p,IDEIdentityCode(error,"AUTH_IDENTITY_WALLET_REQUEST_REFUSED").c_str());}
   if(p->first.empty()&&IDEWalletCurrent(p,true)&&[p->transport assertCurrent:&error]&&!error){
    if(w->sending)ok=true;else{NSDictionary*packet=[p->transport copyCapturedRequest:&error];if(packet&&!error){result=IDEIdentityPublic(env,packet);ok=result&&IDEWalletCurrent(p,true);}else IDEWalletFail(p,IDEIdentityCode(error,"AUTH_IDENTITY_WALLET_REQUEST_CHANGED").c_str());}
   }
  }
 }catch(...){IDEWalletFail(p,"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION");}}@catch(NSException*){IDEWalletFail(p,"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION");}
 if(ok)napi_resolve_deferred(env,w->deferred,result);else{p->retired=true;[p->transport retire];[p->source retire];napi_reject_deferred(env,w->deferred,IDEWalletErrorValue(env,p->first.empty()?"AUTH_IDENTITY_WALLET_PEER_UNKNOWN":p->first.c_str()));}
 if(!p->busy)std::terminate();p->busy--;napi_delete_async_work(env,w->work);napi_delete_reference(env,w->self);
}
static napi_value IDEWalletQueue(napi_env env,napi_value self,IDEWalletSourceOwner*p,bool sending){
 auto*w=new(std::nothrow)IDEWalletWork{};if(!w)return Error(env,"AUTH_IDENTITY_WALLET_CAPACITY");w->p=p;w->sending=sending;if(sending)w->frame=[p->transport selectedDecision];
 napi_value promise,name;napi_create_string_utf8(env,"OriginalIDEWalletPeerIO",NAPI_AUTO_LENGTH,&name);
 if(napi_create_promise(env,&w->deferred,&promise)!=napi_ok||napi_create_reference(env,self,1,&w->self)!=napi_ok||napi_create_async_work(env,nullptr,name,IDEWalletExecute,IDEWalletComplete,w,&w->work)!=napi_ok){if(w->self)napi_delete_reference(env,w->self);delete w;IDEWalletFail(p,"AUTH_IDENTITY_WALLET_QUEUE_UNKNOWN");return Error(env,p->first.c_str());}
 p->busy++;if(napi_queue_async_work(env,w->work)!=napi_ok){p->busy--;napi_reject_deferred(env,w->deferred,IDEWalletErrorValue(env,"AUTH_IDENTITY_WALLET_QUEUE_UNKNOWN"));napi_delete_async_work(env,w->work);napi_delete_reference(env,w->self);delete w;IDEWalletFail(p,"AUTH_IDENTITY_WALLET_QUEUE_UNKNOWN");p->retired=true;[p->transport retire];[p->source retire];}return promise;
}
enum class IDEWalletMethod:uintptr_t{ready=1,bind,current,request,registration,retire,join,close,status,launch,receive,decision};
static napi_value IDEWalletOperation(napi_env env,napi_callback_info info){
 napi_value self,args[2];void*raw=nullptr;size_t count=2;if(napi_get_cb_info(env,info,&count,args,&self,&raw)!=napi_ok)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto method=static_cast<IDEWalletMethod>((uintptr_t)raw);
 if(!IDEIdentityArgc(env,info,(method==IDEWalletMethod::bind||method==IDEWalletMethod::decision)?2:0,args,&self,&raw))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*p=IDEWalletOriginal(env,self);if(!p)return Error(env,"AUTH_IDENTITY_WALLET_ORIGINAL_REQUIRED");
 @try{try{
  if(method==IDEWalletMethod::retire){p->retired=true;[p->transport retire];[p->source retire];return Undefined(env);}
  if(method==IDEWalletMethod::join){NSError*e=nil;if(!p->retired||p->busy||(p->transport&&![p->transport join:&e])||(p->source&&![p->source join:&e]))return Error(env,"AUTH_IDENTITY_WALLET_JOIN_PENDING");return Undefined(env);}
  if(method==IDEWalletMethod::close)return IDEWalletClose(p)?Undefined(env):Error(env,p->closeFirst.empty()?"AUTH_IDENTITY_WALLET_JOIN_PENDING":p->closeFirst.c_str());
  if(method==IDEWalletMethod::status)return IDEIdentityPublic(env,@{@"busy":@(p->busy),@"transport":p->transport?[p->transport status]:(p->terminalTransportStatus?:(id)NSNull.null),@"bound":@(p->bound),@"retired":@(p->retired),@"closed":@(p->closed),@"firstCause":p->first.empty()?(id)NSNull.null:[NSString stringWithUTF8String:p->first.c_str()],@"dataOnly":@YES,@"userApproved":@NO});
  if(!IDEWalletCurrent(p,method==IDEWalletMethod::current||method==IDEWalletMethod::request||method==IDEWalletMethod::decision))return Error(env,p->first.empty()?"AUTH_IDENTITY_WALLET_SOURCE_NOT_CURRENT":p->first.c_str());
  if(method==IDEWalletMethod::ready||method==IDEWalletMethod::current)return Undefined(env);
  if(method==IDEWalletMethod::launch){
   if(p->transport||p->bound)return IDEWalletFail(p,"AUTH_IDENTITY_WALLET_LAUNCH_ONCE"),Error(env,p->first.c_str());
   NSError*e=nil;p->transport=[YNXOriginalIDEWalletPeerLaunch captureSource:p->source error:&e];
   if(e||!p->transport||![p->transport launch:&e]||e)return IDEWalletFail(p,IDEIdentityCode(e,"AUTH_IDENTITY_WALLET_LAUNCH_UNKNOWN").c_str()),Error(env,p->first.c_str());return Undefined(env);
  }
  if(method==IDEWalletMethod::receive){if(!p->transport||p->bound||p->busy)return Error(env,"AUTH_IDENTITY_WALLET_REQUEST_ONCE");return IDEWalletQueue(env,self,p,false);}
  if(method==IDEWalletMethod::decision){
   if(!p->transport||p->busy)return Error(env,"AUTH_IDENTITY_WALLET_TRANSPORT_NOT_READY");
   NSData*k=IDEIdentityString(env,args[0],16);NSString*kind=k?[[NSString alloc]initWithData:k encoding:NSUTF8StringEncoding]:nil;napi_valuetype t;napi_typeof(env,args[1],&t);NSData*proof=nil;
   if(t!=napi_undefined){bool typed=false;napi_is_typedarray(env,args[1],&typed);if(!typed)return Error(env,"AUTH_IDENTITY_WALLET_PROOF_INVALID");napi_typedarray_type type;size_t size=0;void*bytes=nullptr;napi_value array;size_t offset=0;if(napi_get_typedarray_info(env,args[1],&type,&size,&bytes,&array,&offset)!=napi_ok||type!=napi_uint8_array||!size||size>262144)return Error(env,"AUTH_IDENTITY_WALLET_PROOF_INVALID");proof=[NSData dataWithBytes:bytes length:size];}
   NSError*e=nil;if(![p->transport selectDecision:kind proof:proof error:&e]||e)return IDEWalletFail(p,IDEIdentityCode(e,"AUTH_IDENTITY_WALLET_DECISION_REFUSED").c_str()),Error(env,p->first.c_str());return IDEWalletQueue(env,self,p,true);
  }
  NSError*e=nil;
  if(method==IDEWalletMethod::bind){
   if(p->transport||p->bound)return IDEWalletFail(p,"AUTH_IDENTITY_WALLET_REQUEST_ONCE"),Error(env,p->first.c_str());
   NSData*request=IDEIdentityString(env,args[0],16384);napi_valuetype t;napi_typeof(env,args[1],&t);NSData*invocation=t==napi_undefined?[NSData data]:IDEIdentityString(env,args[1],16384);
   p->bound=true;if(!request||!invocation||![p->source bindRequest:request invocation:invocation error:&e]||e)return IDEWalletFail(p,IDEIdentityCode(e,"AUTH_IDENTITY_WALLET_REQUEST_INVALID").c_str()),Error(env,p->first.c_str());
   return IDEWalletCurrent(p,true)?Undefined(env):Error(env,p->first.c_str());
  }
  if(method==IDEWalletMethod::request){NSData*request=[p->source copyRequest:&e];if(!request||e||!IDEWalletCurrent(p,true))return IDEWalletFail(p,IDEIdentityCode(e,"AUTH_IDENTITY_WALLET_REQUEST_CHANGED").c_str()),Error(env,p->first.c_str());napi_value value;if(napi_create_string_utf8(env,(const char*)request.bytes,request.length,&value)!=napi_ok)return Error(env,"AUTH_IDENTITY_WALLET_RESULT_ALLOCATION_UNKNOWN");return value;}
  if(method==IDEWalletMethod::registration){NSDictionary*registration=[p->source copyRegistration:&e];if(!registration||e||!IDEWalletCurrent(p,false))return IDEWalletFail(p,IDEIdentityCode(e,"AUTH_IDENTITY_WALLET_REGISTRATION_CHANGED").c_str()),Error(env,p->first.c_str());return IDEIdentityPublic(env,registration);}
  return Error(env,"AUTH_IDENTITY_METHOD_INVALID");
 }catch(...){IDEWalletFail(p,"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION");}}@catch(NSException*){IDEWalletFail(p,"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION");}return Error(env,p->first.c_str());
}
static napi_value AcquireOriginalIDEWalletIdentitySource(napi_env env,napi_callback_info info){
 if(!IDEIdentityArgc(env,info,0,nullptr,nullptr,nullptr)||!pthread_main_np())return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 if(ideWalletSources.size()>=32)return Error(env,"AUTH_IDENTITY_WALLET_CAPACITY");auto*p=new(std::nothrow)IDEWalletSourceOwner;if(!p)return Error(env,"AUTH_IDENTITY_WALLET_CAPACITY");p->env=env;p->thread=pthread_self();napi_value result;
 if(napi_create_object(env,&result)!=napi_ok||napi_type_tag_object(env,result,&ideWalletSourceTag)!=napi_ok){delete p;return nullptr;}
 ideWalletSources.insert(p);if(napi_wrap(env,result,p,IDEWalletFinalize,nullptr,nullptr)!=napi_ok){ideWalletSources.erase(p);delete p;return nullptr;}
 const char*names[]={"assertReady","bindRequest","current","copyRequestOriginal","copyRegistration","retire","join","close","status","launch","receiveRequest","sendDecision"};for(uintptr_t i=0;i<12;i++){napi_property_descriptor d={names[i],nullptr,IDEWalletOperation,nullptr,nullptr,nullptr,napi_default,(void*)(i+1)};if(napi_define_properties(env,result,1,&d)!=napi_ok)return result;}napi_object_freeze(env,result);
 if(napi_add_env_cleanup_hook(env,IDEWalletEnvironmentRetire,p)!=napi_ok){IDEWalletFail(p,"AUTH_IDENTITY_WALLET_ENVIRONMENT_CUSTODY_UNKNOWN");return result;}p->envCleanupInstalled=true;
 @try{try{NSError*e=nil;p->source=[YNXOriginalIDEWalletIdentitySource acquire:&e];if(e||!p->source)IDEWalletFail(p,IDEIdentityCode(e,"AUTH_IDENTITY_WALLET_SOURCE_UNAVAILABLE").c_str());else IDEWalletCurrent(p,false);}catch(...){IDEWalletFail(p,"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION");}}@catch(NSException*){IDEWalletFail(p,"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION");}return result;
}
static napi_value IsOriginalIDEWalletIdentitySource(napi_env env,napi_callback_info info){napi_value value,result;bool recognized=false;if(IDEIdentityArgc(env,info,1,&value,nullptr,nullptr))recognized=IDEWalletOriginal(env,value)!=nullptr;napi_get_boolean(env,recognized,&result);return result;}
