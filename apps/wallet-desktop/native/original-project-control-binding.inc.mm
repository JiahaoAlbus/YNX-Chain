// Same original Main addon TU only. Never accepts a renderer descriptor,
// caller-selected Source, signer, module path or key. Recognition is type/env/
// thread ownership only, NOT proof that current/approval/signing was admitted.
#import "original-project-control-review.h"
#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI) && YNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI != 1
#error YNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI_REQUIRES_ONE
#endif
struct WalletControlOwner {napi_env env=nullptr;pthread_t thread{};YNXOriginalProjectControlReview*__strong review=nil;bool busy=false,finalized=false,gone=false,admissionClosed=false;};
static const napi_type_tag walletControlTag={0x594e584354524c31ULL,0x4d41494e4f574e31ULL};
static std::unordered_set<WalletControlOwner*>walletControlOwners;
// The shared legacy DTO emitter uses non-enumerable properties. These public
// control records must survive Main's exact DATA capture/IPC/JSON journal.
// Emit own enumerable read-only values, without JSON/global JS callbacks.
static napi_value WalletControlPublic(napi_env env,id value,unsigned depth=0,size_t*budget=nullptr){
 size_t initial=131072;if(!budget)budget=&initial;if(depth>8)return Error(env,"CONTROL_PUBLIC_BOUND");napi_value out=nullptr;
 if([value isKindOfClass:NSString.class]){NSData*b=[value dataUsingEncoding:NSUTF8StringEncoding];if(!b||b.length>*budget)return Error(env,"CONTROL_PUBLIC_BOUND");*budget-=b.length;return napi_create_string_utf8(env,(const char*)b.bytes,b.length,&out)==napi_ok?out:nullptr;}
 if([value isKindOfClass:NSNumber.class]){if(CFGetTypeID((__bridge CFTypeRef)value)!=CFBooleanGetTypeID())return Error(env,"CONTROL_PUBLIC_NUMBER_REFUSED");return napi_get_boolean(env,[value boolValue],&out)==napi_ok?out:nullptr;}
 if(![value isKindOfClass:NSDictionary.class]||[value count]>32||napi_create_object(env,&out)!=napi_ok)return Error(env,"CONTROL_PUBLIC_SCHEMA");
 for(id key in value){if(![key isKindOfClass:NSString.class])return Error(env,"CONTROL_PUBLIC_KEY");NSData*b=[key dataUsingEncoding:NSUTF8StringEncoding];if(!b||!b.length||b.length>256||b.length>*budget||memchr(b.bytes,0,b.length))return Error(env,"CONTROL_PUBLIC_KEY");*budget-=b.length;std::string name((const char*)b.bytes,b.length);napi_value child=WalletControlPublic(env,value[key],depth+1,budget);if(!child)return nullptr;napi_property_descriptor d={name.c_str(),nullptr,nullptr,nullptr,nullptr,child,napi_enumerable,nullptr};if(napi_define_properties(env,out,1,&d)!=napi_ok)return nullptr;}
 return napi_object_freeze(env,out)==napi_ok?out:nullptr;
}
static WalletControlOwner*WalletControlOriginal(napi_env env,napi_value value){
 bool tag=false;void*raw=nullptr;if(!pthread_main_np()||napi_check_object_type_tag(env,value,&walletControlTag,&tag)!=napi_ok||!tag||napi_unwrap(env,value,&raw)!=napi_ok)return nullptr;
 auto*p=static_cast<WalletControlOwner*>(raw);return walletControlOwners.count(p)&&p->env==env&&!p->gone&&pthread_equal(p->thread,pthread_self())?p:nullptr;
}
static bool WalletControlTryClose(WalletControlOwner*p){@try{NSError*e=nil;return [p->review close:&e]&&!e;}@catch(NSException*){return false;}}
static void WalletControlCleanup(void*raw){auto*p=static_cast<WalletControlOwner*>(raw);if(!walletControlOwners.count(p))return;p->gone=true;bool closed=WalletControlTryClose(p);if(closed)p->admissionClosed=true;if(p->finalized&&closed){walletControlOwners.erase(p);delete p;}}
static void WalletControlFinalize(napi_env,void*raw,void*){auto*p=static_cast<WalletControlOwner*>(raw);if(!walletControlOwners.count(p))return;p->finalized=true;bool closed=WalletControlTryClose(p);if(closed)p->admissionClosed=true;if(closed&&(p->gone||napi_remove_env_cleanup_hook(p->env,WalletControlCleanup,p)==napi_ok)){walletControlOwners.erase(p);delete p;}}
enum class WalletControlMethod:uintptr_t {review=1,current,select,result,retire,save,close,proof,saveProof};
static napi_value WalletControlOperation(napi_env env,napi_callback_info info){
 napi_value self=nullptr,args[2];void*raw=nullptr;size_t count=2;if(napi_get_cb_info(env,info,&count,args,&self,&raw)!=napi_ok)return Error(env,"CONTROL_ARGUMENTS_INVALID");
 auto method=static_cast<WalletControlMethod>((uintptr_t)raw);size_t wanted=method==WalletControlMethod::select?2:method==WalletControlMethod::save?1:0;
 if(!IDEIdentityArgc(env,info,wanted,args,&self,&raw))return Error(env,"CONTROL_ARGUMENTS_INVALID");auto*p=WalletControlOriginal(env,self);if(!p||!p->review)return Error(env,"CONTROL_ORIGINAL_NATIVE_REQUIRED");if(p->busy)return Error(env,"CONTROL_NATIVE_BUSY");
 if(p->admissionClosed&&method!=WalletControlMethod::result&&method!=WalletControlMethod::proof&&method!=WalletControlMethod::close&&method!=WalletControlMethod::retire)return Error(env,"CONTROL_NATIVE_CLOSED");
 struct Busy{WalletControlOwner*p;Busy(WalletControlOwner*v):p(v){p->busy=true;}~Busy(){p->busy=false;}}busy(p);
 @try{try{
  NSError*e=nil;NSDictionary*result=nil;
  if(method==WalletControlMethod::review)result=[p->review copyOriginalReview:&e];
  else if(method==WalletControlMethod::result)result=[p->review copyOriginalDecision:&e];
  else if(method==WalletControlMethod::proof){NSData*bytes=[p->review copyOriginalApprovalProof:&e];if(e||!bytes.length||bytes.length>393216)return Error(env,IDEIdentityCode(e,"CONTROL_ORIGINAL_PROOF_UNAVAILABLE").c_str());void*copy=nullptr;napi_value buffer=nullptr,out=nullptr;if(napi_create_arraybuffer(env,bytes.length,&copy,&buffer)!=napi_ok)return nullptr;memcpy(copy,bytes.bytes,bytes.length);if(napi_create_typedarray(env,napi_uint8_array,bytes.length,buffer,0,&out)!=napi_ok)return nullptr;return out;}
  else if(method==WalletControlMethod::saveProof){if(![p->review saveOriginalApprovalResult:&e]||e)return Error(env,IDEIdentityCode(e,"CONTROL_ORIGINAL_PROOF_SAVE_UNKNOWN").c_str());return Undefined(env);}
  else if(method==WalletControlMethod::retire){[p->review retire];return Undefined(env);}
  else if(method==WalletControlMethod::current){if(![p->review assertCurrent:&e]||e)return Error(env,IDEIdentityCode(e,"CONTROL_CURRENT_REFUSED").c_str());return Undefined(env);}
  else if(method==WalletControlMethod::close){if(![p->review close:&e]||e)return Error(env,IDEIdentityCode(e,"CONTROL_CLOSE_PENDING").c_str());p->admissionClosed=true;return Undefined(env);}
  else if(method==WalletControlMethod::save){NSData*b=IDEIdentityString(env,args[0],65536);if(!b||![p->review saveOriginalLifecycle:b error:&e]||e)return Error(env,IDEIdentityCode(e,"CONTROL_SAVE_UNKNOWN").c_str());return Undefined(env);}
  else{
   NSData*idBytes=IDEIdentityString(env,args[0],256),*decisionBytes=IDEIdentityString(env,args[1],16);NSString*identifier=idBytes?[[NSString alloc]initWithData:idBytes encoding:NSUTF8StringEncoding]:nil,*decision=decisionBytes?[[NSString alloc]initWithData:decisionBytes encoding:NSUTF8StringEncoding]:nil;
   if(!identifier||!decision||![p->review selectOriginalDecision:identifier decision:decision error:&e]||e)return Error(env,IDEIdentityCode(e,"CONTROL_DECISION_UNKNOWN").c_str());
#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI)
   // The SAME original Native owner performs its sole approve effect. Never
   // pass a signer, Source, custody descriptor or key through JS. On failure
   // Main's kernel reads the SAME retained partial before inspecting this error.
   if([decision isEqual:@"approve"]&&(![p->review signOriginalApproval:&e]||e))return Error(env,IDEIdentityCode(e,"CONTROL_APPROVAL_OUTCOME_UNKNOWN").c_str());
#endif
   return Undefined(env);
  }
  return result&&!e?WalletControlPublic(env,result):Error(env,IDEIdentityCode(e,"CONTROL_ORIGINAL_RESULT_UNAVAILABLE").c_str());
 }catch(...){return Error(env,"CONTROL_NATIVE_EXCEPTION");}}@catch(NSException*){return Error(env,"CONTROL_NATIVE_EXCEPTION");}
}
static napi_value CaptureOriginalWalletProjectControlReview(napi_env env,napi_callback_info info){
 if(!IDEIdentityArgc(env,info,0,nullptr,nullptr,nullptr)||!pthread_main_np())return Error(env,"CONTROL_ARGUMENTS_INVALID");size_t held=0;for(auto*p:walletControlOwners)if(p->env==env&&!p->gone&&!p->admissionClosed)held++;if(held>=32)return Error(env,"CONTROL_NATIVE_CAPACITY");
 auto*p=new(std::nothrow)WalletControlOwner;if(!p)return Error(env,"CONTROL_NATIVE_CAPACITY");p->env=env;p->thread=pthread_self();walletControlOwners.insert(p);
 if(napi_add_env_cleanup_hook(env,WalletControlCleanup,p)!=napi_ok){walletControlOwners.erase(p);delete p;return Error(env,"CONTROL_ENV_CLEANUP_UNKNOWN");}napi_value result=nullptr;
 if(napi_create_object(env,&result)!=napi_ok||napi_type_tag_object(env,result,&walletControlTag)!=napi_ok||napi_wrap(env,result,p,WalletControlFinalize,nullptr,nullptr)!=napi_ok)return Error(env,"CONTROL_NATIVE_WRAP_UNKNOWN");
 const char*names[]={"copyOriginalReview","assertCurrent","selectOriginalDecision","copyOriginalDecision","retire","persistOriginalLifecycle","close","copyOriginalApprovalProof","saveOriginalApprovalResult"};
 for(uintptr_t i=0;i<9;i++){napi_property_descriptor d={names[i],nullptr,WalletControlOperation,nullptr,nullptr,nullptr,napi_default,(void*)(i+1)};if(napi_define_properties(env,result,1,&d)!=napi_ok)return Error(env,"CONTROL_NATIVE_METHODS_UNKNOWN");}
 if(napi_object_freeze(env,result)!=napi_ok)return Error(env,"CONTROL_NATIVE_FREEZE_UNKNOWN");NSError*e=nil;p->review=[YNXOriginalProjectControlReview captureOriginal:&e];
 // Return the actual partial owner even on capture refusal. Its own first
 // cause gates review/decision; Main retains it for cleanup, not reacquisition.
 return result;
}
static napi_value IsOriginalWalletProjectControlReview(napi_env env,napi_callback_info info){napi_value value=nullptr;if(!IDEIdentityArgc(env,info,1,&value,nullptr,nullptr))return Error(env,"CONTROL_ARGUMENTS_INVALID");napi_value result=nullptr;napi_get_boolean(env,WalletControlOriginal(env,value)!=nullptr,&result);return result;}
static bool RegisterOriginalProjectControlBinding(napi_env env,napi_value exports){
 napi_property_descriptor ds[]={{"captureOriginalWalletProjectControlReview",nullptr,CaptureOriginalWalletProjectControlReview,nullptr,nullptr,nullptr,napi_default,nullptr},{"isOriginalWalletProjectControlReview",nullptr,IsOriginalWalletProjectControlReview,nullptr,nullptr,nullptr,napi_default,nullptr}};return napi_define_properties(env,exports,2,ds)==napi_ok;
}
