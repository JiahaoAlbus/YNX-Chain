// Included ONLY by the original SDK Main-role hook, in its original NAPI TU.
// No signer/provider callbacks, public owner descriptors or secret exports.
#import "original-artifact-publisher-store.h"
struct WalletPublisherApprovalOwner {
 napi_env env=nullptr;pthread_t thread{};napi_ref parent=nullptr;
 YNXOriginalArtifactReleaseApproval*__strong approval=nil;
 bool busy=false,retired=false,closed=false,finalized=false,environmentGone=false;
 std::string first,closeFirst;
};
static const napi_type_tag walletPublisherApprovalTag={0x594e585055424c49ULL,0x5348415050525631ULL};
static std::unordered_set<WalletPublisherApprovalOwner*>walletPublisherApprovals;
// A closed/failed child retains its original parent reference as a bounded
// once tombstone until environment teardown. Closing/reopening a review must
// never mint another decision/signing window for that same original request.
static bool WalletPublisherFail(WalletPublisherApprovalOwner*p,const char*code){if(p->first.empty())p->first=code;return false;}
static WalletPublisherApprovalOwner*WalletPublisherOriginal(napi_env env,napi_value value){
 bool tagged=false;void*raw=nullptr;
 if(!pthread_main_np()||napi_check_object_type_tag(env,value,&walletPublisherApprovalTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,value,&raw)!=napi_ok)return nullptr;
 auto*p=static_cast<WalletPublisherApprovalOwner*>(raw);
 return walletPublisherApprovals.count(p)&&p->env==env&&!p->environmentGone&&pthread_equal(p->thread,pthread_self())?p:nullptr;
}
static IDEWalletSourceOwner*WalletPublisherParent(WalletPublisherApprovalOwner*p,unsigned expectedBusy=0){
 napi_value parent=nullptr;
 if(!p->parent||napi_get_reference_value(p->env,p->parent,&parent)!=napi_ok)return nullptr;
 auto*original=IDEWalletOriginal(p->env,parent);
 if(!original||original->busy!=expectedBusy||original->closed||original->closing||original->retired||!original->bound||!original->transport||!original->first.empty())return nullptr;
 return original;
}
static bool WalletPublisherCurrent(WalletPublisherApprovalOwner*p,IDEWalletSourceOwner*held){
 if(p->retired||p->closed||!p->first.empty()||!p->approval)return false;
 auto*parent=WalletPublisherParent(p,1);
 if(!parent||parent!=held||!IDEWalletCurrent(parent,true))return WalletPublisherFail(p,"WALLET_PUBLISHER_ORIGINAL_PARENT_NOT_CURRENT");
 return true;
}
static bool WalletPublisherClose(WalletPublisherApprovalOwner*p){
 if(p->busy)return false;p->retired=true;[p->approval retire];if(p->closed)return true;
 NSError*error=nil;
 if(p->approval&&(![p->approval close:&error]||error)){
  if(error&&p->closeFirst.empty())p->closeFirst=IDEIdentityCode(error,"WALLET_PUBLISHER_CLOSE_UNKNOWN");
  return false;
 }
 p->closed=true;p->approval=nil;return true;
}
static void WalletPublisherEnvironmentRetire(void*raw){
 auto*p=static_cast<WalletPublisherApprovalOwner*>(raw);if(!walletPublisherApprovals.count(p))return;
 p->environmentGone=true;p->retired=true;[p->approval retire];WalletPublisherClose(p);
 if(p->parent){napi_delete_reference(p->env,p->parent);p->parent=nullptr;}
 // A pending wrapper finalizer still owns its data pointer. Cleanup debt is
 // retained, not erased merely to make environment shutdown appear clean.
 if(p->finalized&&p->closed){walletPublisherApprovals.erase(p);delete p;}
}
static void WalletPublisherFinalize(napi_env,void*raw,void*){
 auto*p=static_cast<WalletPublisherApprovalOwner*>(raw);if(!walletPublisherApprovals.count(p))return;
 p->finalized=true;WalletPublisherClose(p);
 if(p->environmentGone&&p->closed){walletPublisherApprovals.erase(p);delete p;}
}
enum class WalletPublisherMethod:uintptr_t {review=1,approve,current,retire,close};
static napi_value WalletPublisherOperation(napi_env env,napi_callback_info info){
 napi_value self=nullptr,args[1];void*raw=nullptr;size_t count=1;
 if(napi_get_cb_info(env,info,&count,args,&self,&raw)!=napi_ok)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto method=static_cast<WalletPublisherMethod>((uintptr_t)raw);
 if(!IDEIdentityArgc(env,info,method==WalletPublisherMethod::approve||method==WalletPublisherMethod::current?1:0,args,&self,&raw))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto*p=WalletPublisherOriginal(env,self);if(!p)return Error(env,"WALLET_PUBLISHER_ORIGINAL_APPROVAL_REQUIRED");
 if(p->busy)return Error(env,"WALLET_PUBLISHER_APPROVAL_BUSY");
 if(method==WalletPublisherMethod::retire){p->retired=true;[p->approval retire];return Undefined(env);}
 if(method==WalletPublisherMethod::close)return WalletPublisherClose(p)?Undefined(env):Error(env,p->closeFirst.empty()?"WALLET_PUBLISHER_CLOSE_PENDING":p->closeFirst.c_str());
 auto*parent=WalletPublisherParent(p);
 if(!parent)return WalletPublisherFail(p,"WALLET_PUBLISHER_ORIGINAL_PARENT_NOT_CURRENT"),Error(env,p->first.c_str());
 struct ParentBusy {IDEWalletSourceOwner*p;explicit ParentBusy(IDEWalletSourceOwner*v):p(v){p->busy++;}~ParentBusy(){p->busy--;}}parentBusy(parent);
 struct Busy {WalletPublisherApprovalOwner*p;explicit Busy(WalletPublisherApprovalOwner*v):p(v){p->busy=true;}~Busy(){p->busy=false;}}busy(p);
 @try{try{
  if(!WalletPublisherCurrent(p,parent))return Error(env,p->first.empty()?"WALLET_PUBLISHER_APPROVAL_RETIRED":p->first.c_str());
  NSError*error=nil;NSDictionary*review=nil;
  if(method==WalletPublisherMethod::review)review=[p->approval copyOriginalReview:&error];
  else {
   NSData*bytes=IDEIdentityString(env,args[0],128);NSString*identifier=bytes?[[NSString alloc]initWithData:bytes encoding:NSUTF8StringEncoding]:nil;
   if(!identifier)return Error(env,"WALLET_PUBLISHER_APPROVAL_ID_INVALID");
   BOOL ok=method==WalletPublisherMethod::approve?[p->approval approveOriginalReview:identifier error:&error]:[p->approval assertOriginalApprovalCurrent:identifier error:&error];
   if(!ok||error)return WalletPublisherFail(p,IDEIdentityCode(error,"WALLET_PUBLISHER_APPROVAL_REFUSED").c_str()),Error(env,p->first.c_str());
   review=[p->approval copyOriginalReview:&error];
  }
  if(!review||error)return WalletPublisherFail(p,IDEIdentityCode(error,"WALLET_PUBLISHER_REVIEW_UNAVAILABLE").c_str()),Error(env,p->first.c_str());
  napi_value result=IDEIdentityPublic(env,review);
  if(!result)return nullptr;
  if(!WalletPublisherCurrent(p,parent))return Error(env,p->first.c_str());
  return result;
 }catch(...){WalletPublisherFail(p,"WALLET_PUBLISHER_NATIVE_EXCEPTION");}}@catch(NSException*){WalletPublisherFail(p,"WALLET_PUBLISHER_NATIVE_EXCEPTION");}
 return Error(env,p->first.c_str());
}
static napi_value CaptureOriginalWalletPublisherApproval(napi_env env,napi_callback_info info){
 napi_value parentValue=nullptr;if(!IDEIdentityArgc(env,info,1,&parentValue,nullptr,nullptr)||!pthread_main_np())return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto*original=IDEWalletOriginal(env,parentValue);
 if(!original||original->busy||original->closed||original->closing||original->retired||!original->bound||!original->transport||!original->first.empty())return Error(env,"WALLET_PUBLISHER_ORIGINAL_PARENT_REQUIRED");
 size_t count=0;for(auto*held:walletPublisherApprovals){if(held->env!=env||held->environmentGone)continue;count++;if(Same(env,held->parent,parentValue))return Error(env,"WALLET_PUBLISHER_APPROVAL_CAPTURE_ONCE");}
 if(count>=32)return Error(env,"WALLET_PUBLISHER_APPROVAL_CAPACITY");
 auto*p=new(std::nothrow)WalletPublisherApprovalOwner;if(!p)return Error(env,"WALLET_PUBLISHER_APPROVAL_CAPACITY");p->env=env;p->thread=pthread_self();
 // Own the actual parent JS reference BEFORE any Source callback, then copy
 // the strong actual Native parents. Never save an unowned raw parent pointer.
 if(napi_create_reference(env,parentValue,1,&p->parent)!=napi_ok){delete p;return Error(env,"WALLET_PUBLISHER_PARENT_RETAIN_UNKNOWN");}
 walletPublisherApprovals.insert(p);
 if(napi_add_env_cleanup_hook(env,WalletPublisherEnvironmentRetire,p)!=napi_ok){WalletPublisherFail(p,"WALLET_PUBLISHER_ENVIRONMENT_CUSTODY_UNKNOWN");return Error(env,p->first.c_str());}
 napi_value result=nullptr;
 if(napi_create_object(env,&result)!=napi_ok||napi_type_tag_object(env,result,&walletPublisherApprovalTag)!=napi_ok||napi_wrap(env,result,p,WalletPublisherFinalize,nullptr,nullptr)!=napi_ok){WalletPublisherFail(p,"WALLET_PUBLISHER_WRAP_UNKNOWN");return Error(env,p->first.c_str());}
 const char*names[]={"copyOriginalReview","approveOriginalReview","assertOriginalApprovalCurrent","retire","close"};
 for(uintptr_t i=0;i<5;i++){napi_property_descriptor d={names[i],nullptr,WalletPublisherOperation,nullptr,nullptr,nullptr,napi_default,(void*)(i+1)};if(napi_define_properties(env,result,1,&d)!=napi_ok){WalletPublisherFail(p,"WALLET_PUBLISHER_METHODS_UNKNOWN");return nullptr;}}
 if(napi_object_freeze(env,result)!=napi_ok){WalletPublisherFail(p,"WALLET_PUBLISHER_FREEZE_UNKNOWN");return nullptr;}
 struct ParentBusy {IDEWalletSourceOwner*p;explicit ParentBusy(IDEWalletSourceOwner*v):p(v){p->busy++;}~ParentBusy(){p->busy--;}}busy(original);
 @try{try{
  YNXOriginalIDEWalletIdentitySource*source=original->source;YNXOriginalIDEWalletPeerLaunch*transport=original->transport;
  if(!IDEWalletCurrent(original,true))WalletPublisherFail(p,"WALLET_PUBLISHER_ORIGINAL_PARENT_NOT_CURRENT");
  else {NSError*error=nil;p->approval=[YNXOriginalArtifactReleaseApproval captureWalletSource:source transport:transport error:&error];if(error||!p->approval)WalletPublisherFail(p,IDEIdentityCode(error,"WALLET_PUBLISHER_CAPTURE_UNKNOWN").c_str());else if(!IDEWalletCurrent(original,true))WalletPublisherFail(p,"WALLET_PUBLISHER_ORIGINAL_PARENT_POST_CURRENT");}
 }catch(...){WalletPublisherFail(p,"WALLET_PUBLISHER_NATIVE_EXCEPTION");}}@catch(NSException*){WalletPublisherFail(p,"WALLET_PUBLISHER_NATIVE_EXCEPTION");}
 // Partial owner is returned for explicit cleanup; its retained first cause
 // prevents all business methods. No acquire replacement on failure.
 return result;
}
static bool RegisterOriginalArtifactPublisherBinding(napi_env env,napi_value exports){
 napi_property_descriptor d={"captureOriginalWalletPublisherApproval",nullptr,CaptureOriginalWalletPublisherApproval,nullptr,nullptr,nullptr,napi_default,nullptr};
 return napi_define_properties(env,exports,1,&d)==napi_ok;
}
