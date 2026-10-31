// Private SAME-addon bridge. Fixed module comes only from held Source release;
// no loader/path/predicate/current callback is accepted from JS.
struct ProvisioningV4ModuleLoader{napi_ref createRequire=nullptr,promiseThen=nullptr;};
static thread_local std::unordered_map<napi_env,ProvisioningV4ModuleLoader>provisioningV4ModuleLoaders;
struct ProvisioningV4Composition;
struct ProvisioningV4Approval {
 napi_env env=nullptr;ProvisioningV4SourceNapi*parent=nullptr;
 napi_ref parentObject=nullptr,peer=nullptr,reader=nullptr,current=nullptr,recheck=nullptr;
 bool retired=false,closed=false,failed=false,recheckPending=false,rechecked=false,attempted=false;std::string first;
 std::shared_ptr<ProvisioningV4Composition>composition;
 ynx_auth_private::DeviceProvisioningWindowFence window;
};
static thread_local std::unordered_set<ProvisioningV4Approval*>provisioningV4Approvals;
static thread_local std::unordered_set<ProvisioningV4Approval*>provisioningV4ApprovalDebts;
static const napi_type_tag provisioningV4ApprovalTag={0x594e5850524f5641ULL,0x5050524f56414c34ULL};
static napi_value ProvisioningV4Invoke(napi_env env,napi_ref fn,napi_value peer){napi_value out=nullptr;if(napi_call_function(env,DeviceV4Undefined(env),DeviceV4Ref(env,fn),1,&peer,&out)!=napi_ok)return nullptr;return out;}
static bool ProvisioningV4String(napi_env env,napi_value object,const char*key,std::string&out,size_t max){auto v=DeviceV4DataProperty(env,object,key);napi_valuetype type;size_t n=0;if(!v||napi_typeof(env,v,&type)!=napi_ok||type!=napi_string||napi_get_value_string_utf8(env,v,nullptr,0,&n)!=napi_ok||!n||n>max)return false;std::vector<char>b(n+1);size_t copied=0;if(napi_get_value_string_utf8(env,v,b.data(),b.size(),&copied)!=napi_ok||copied!=n)return false;out.assign(b.data(),n);return out.find('\0')==std::string::npos;}
static bool ProvisioningV4ApprovalCurrent(ProvisioningV4Approval*a){
 const auto refuse=[a](const char*code){a->failed=true;if(a->first.empty())a->first=code;return false;};
 if(a->closed||a->retired||a->failed||!a->parent||!ProvisioningV4Current(a->parent))return false;
 try{@try{
  const auto intent=ProvisioningV4Intent(a->parent->scope);a->window.check(intent);
  auto peer=DeviceV4Ref(a->env,a->peer);if(!ProvisioningV4Invoke(a->env,a->current,peer))return refuse("DEVICE_PROVISIONING_APPROVAL_MAIN_CURRENT");
  auto view=ProvisioningV4Invoke(a->env,a->reader,peer);if(!view||!DeviceV4PlainFrozen(a->env,view,3))return refuse("DEVICE_PROVISIONING_APPROVAL_VIEW");
  auto decision=DeviceV4DataProperty(a->env,view,"decision"),selected=DeviceV4DataProperty(a->env,view,"selectedAccountDATA"),local=DeviceV4DataProperty(a->env,view,"localSelectionOnly");bool only=false;
  if(!decision||!selected||!local||napi_get_value_bool(a->env,local,&only)!=napi_ok||!only||!DeviceV4PlainFrozen(a->env,decision,8)||!DeviceV4PlainFrozen(a->env,selected,2))return refuse("DEVICE_PROVISIONING_APPROVAL_SHAPE");
  std::string purpose,terms,stable,issued,expires,network,account;
  if(!ProvisioningV4String(a->env,decision,"purpose",purpose,64)||purpose!="device.create"||!ProvisioningV4String(a->env,decision,"approvedTerms",terms,16384)||terms!=intent.approvedTerms||!ProvisioningV4String(a->env,decision,"stableDeviceIdentity",stable,1024)||stable!=intent.stableDeviceIdentity||!ProvisioningV4String(a->env,decision,"issuedAt",issued,64)||!ProvisioningV4String(a->env,decision,"expiresAt",expires,64)||!ProvisioningV4String(a->env,selected,"networkId",network,64)||network!=intent.network||!ProvisioningV4String(a->env,selected,"account",account,42))return refuse("DEVICE_PROVISIONING_APPROVAL_BINDING");
  NSData*bytes=[NSData dataWithBytes:terms.data() length:terms.size()];NSDictionary*t=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];if(![t isKindOfClass:NSDictionary.class]||![t[@"canonicalOwner"]isEqual:[NSString stringWithUTF8String:account.c_str()]])return refuse("DEVICE_PROVISIONING_APPROVAL_ACCOUNT");
  // The original Main reader checks both review digest binds. Native separately
  // checks exact terms and independent Source account/network; no JSON grant.
  NSISO8601DateFormatter*f=[NSISO8601DateFormatter new];f.formatOptions=NSISO8601DateFormatWithInternetDateTime|NSISO8601DateFormatWithFractionalSeconds;NSDate*i=[f dateFromString:[NSString stringWithUTF8String:issued.c_str()]],*e=[f dateFromString:[NSString stringWithUTF8String:expires.c_str()]];if(!i||!e)return refuse("DEVICE_PROVISIONING_APPROVAL_TIME_FORMAT");double im=i.timeIntervalSince1970*1000,em=e.timeIntervalSince1970*1000;if(!std::isfinite(im)||!std::isfinite(em)||im<(double)intent.issuedAtMs||em<=im||em-im>30000||em>(double)intent.expiresAtMs)return refuse("DEVICE_PROVISIONING_APPROVAL_TIME_BOUND");auto approved=intent;approved.issuedAtMs=(uint64_t)im;approved.expiresAtMs=(uint64_t)em;a->window.check(approved);
  if(!ProvisioningV4Invoke(a->env,a->current,peer)||!ProvisioningV4Current(a->parent))return refuse("DEVICE_PROVISIONING_APPROVAL_POST_CURRENT");a->window.check(approved);return true;
 }@catch(id){return refuse("DEVICE_PROVISIONING_APPROVAL_OBJC_CURRENT");}}catch(...){return refuse("DEVICE_PROVISIONING_APPROVAL_CLOCK_CURRENT");}
}
#ifdef YNX_ORIGINAL_PRODUCT_DEVICE_V4_PROVISIONING_STAGE
#include "original-product-device-v4-provisioning-composition.inc.mm"
static void ProvisioningV4CompositionRetire(ProvisioningV4Approval*a){if(a->composition&&a->composition->operation)a->composition->operation->retire();}
static bool ProvisioningV4CompositionClose(ProvisioningV4Approval*a){return !a->composition||a->composition->close();}
#else
// PUBLIC loader fixture deliberately has no effect composition/Root/OS path.
static void ProvisioningV4CompositionRetire(ProvisioningV4Approval*){}
static bool ProvisioningV4CompositionClose(ProvisioningV4Approval*){return true;}
#endif
static void ProvisioningV4ApprovalClose(ProvisioningV4Approval*a){if(a->closed)return;a->retired=true;ProvisioningV4CompositionRetire(a);if(a->recheckPending||!ProvisioningV4CompositionClose(a)){provisioningV4ApprovalDebts.insert(a);return;}a->closed=true;provisioningV4ApprovalDebts.erase(a);for(auto r:{a->parentObject,a->peer,a->reader,a->current,a->recheck})if(r)napi_delete_reference(a->env,r);a->parentObject=a->peer=a->reader=a->current=a->recheck=nullptr;if(a->parent&&a->parent->children)a->parent->children--;a->parent=nullptr;}
struct ProvisioningV4Recheck {ProvisioningV4Approval*approval=nullptr;napi_ref self=nullptr;napi_deferred deferred=nullptr;bool complete=false;};
static napi_value ProvisioningV4RecheckDone(napi_env env,napi_callback_info info){size_t count=1;napi_value value=nullptr;void*raw=nullptr;napi_get_cb_info(env,info,&count,&value,nullptr,&raw);auto*state=(ProvisioningV4Recheck*)raw;if(state->complete)return DeviceV4Undefined(env);state->complete=true;auto*a=state->approval;bool ok=ProvisioningV4ApprovalCurrent(a);if(ok){a->rechecked=true;napi_resolve_deferred(env,state->deferred,DeviceV4Undefined(env));}else{a->failed=true;bool pending=false;napi_is_exception_pending(env,&pending);if(pending){napi_value cause=nullptr;napi_get_and_clear_last_exception(env,&cause);}napi_reject_deferred(env,state->deferred,DeviceV4Error(env,"DEVICE_PROVISIONING_APPROVAL_RECHECK_FAILED"));}a->recheckPending=false;if(state->self)napi_delete_reference(env,state->self);delete state;return DeviceV4Undefined(env);}
static napi_value ProvisioningV4RecheckRejected(napi_env env,napi_callback_info info){size_t count=1;napi_value value=nullptr;void*raw=nullptr;napi_get_cb_info(env,info,&count,&value,nullptr,&raw);auto*state=(ProvisioningV4Recheck*)raw;if(state->complete)return DeviceV4Undefined(env);state->complete=true;state->approval->failed=true;state->approval->recheckPending=false;napi_reject_deferred(env,state->deferred,DeviceV4Error(env,"DEVICE_PROVISIONING_APPROVAL_RECHECK_FAILED"));if(state->self)napi_delete_reference(env,state->self);delete state;return DeviceV4Undefined(env);}
static napi_value ProvisioningV4ApprovalRecheck(napi_env env,ProvisioningV4Approval*a,napi_value self){if(a->recheckPending||!ProvisioningV4ApprovalCurrent(a))return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_RECHECK_UNAVAILABLE");auto it=provisioningV4ModuleLoaders.find(env);if(it==provisioningV4ModuleLoaders.end())return DeviceV4Throw(env,"DEVICE_PROVISIONING_FIXED_MODULE_NOT_HELD");auto*state=new(std::nothrow)ProvisioningV4Recheck;if(!state)return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_CAPACITY");state->approval=a;napi_value returned=nullptr;if(napi_create_promise(env,&state->deferred,&returned)!=napi_ok||!DeviceV4Keep(env,self,state->self)){delete state;return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_CAPTURE");}a->recheckPending=true;a->rechecked=false;auto promise=ProvisioningV4Invoke(env,a->recheck,DeviceV4Ref(env,a->peer));bool isPromise=false;napi_value onfulfilled=nullptr,onrejected=nullptr,ignored=nullptr;if(promise&&napi_is_promise(env,promise,&isPromise)==napi_ok&&isPromise&&napi_create_function(env,"originalRecheckComplete",NAPI_AUTO_LENGTH,ProvisioningV4RecheckDone,state,&onfulfilled)==napi_ok&&napi_create_function(env,"originalRecheckFailed",NAPI_AUTO_LENGTH,ProvisioningV4RecheckRejected,state,&onrejected)==napi_ok){napi_value callbacks[]={onfulfilled,onrejected};if(napi_call_function(env,promise,DeviceV4Ref(env,it->second.promiseThen),2,callbacks,&ignored)==napi_ok)return returned;}bool pending=false;napi_is_exception_pending(env,&pending);if(pending){napi_value cause=nullptr;napi_get_and_clear_last_exception(env,&cause);}a->failed=true;a->recheckPending=false;napi_reject_deferred(env,state->deferred,DeviceV4Error(env,"DEVICE_PROVISIONING_APPROVAL_RECHECK_FAILED"));napi_delete_reference(env,state->self);delete state;return returned;}
static void ProvisioningV4ApprovalFinalize(napi_env,void*raw,void*){auto*a=(ProvisioningV4Approval*)raw;if(!provisioningV4Approvals.count(a))return;ProvisioningV4ApprovalClose(a);if(!a->closed)return;provisioningV4Approvals.erase(a);delete a;}
static napi_value ProvisioningV4ApprovalMethod(napi_env env,napi_callback_info info){
 size_t count=1;napi_value arg=nullptr,self=nullptr;void*kind=nullptr;if(napi_get_cb_info(env,info,&count,&arg,&self,&kind)!=napi_ok||count)return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_ARGUMENTS");
 bool tagged=false;void*raw=nullptr;if(napi_check_object_type_tag(env,self,&provisioningV4ApprovalTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,self,&raw)!=napi_ok)return DeviceV4Throw(env,"DEVICE_PROVISIONING_ORIGINAL_APPROVAL_REQUIRED");auto*a=(ProvisioningV4Approval*)raw;if(!provisioningV4Approvals.count(a)||a->env!=env||!pthread_main_np())return DeviceV4Throw(env,"DEVICE_PROVISIONING_ORIGINAL_APPROVAL_REQUIRED");
 switch((uintptr_t)kind){
 case 1:if(ProvisioningV4ApprovalCurrent(a))return DeviceV4Undefined(env);a->failed=true;return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_NOT_CURRENT");
 case 2:a->retired=true;ProvisioningV4CompositionRetire(a);return DeviceV4Undefined(env);
 case 3:if((!a->retired&&!a->closed)||a->recheckPending)return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_RETIRE_BEFORE_JOIN");return DeviceV4Undefined(env);
 case 4:ProvisioningV4ApprovalClose(a);if(!a->closed)return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_JOIN_PENDING");return DeviceV4Undefined(env);
 case 5:return ProvisioningV4ApprovalRecheck(env,a,self);
#ifdef YNX_ORIGINAL_PRODUCT_DEVICE_V4_PROVISIONING_STAGE
 case 6:return ProvisioningV4Prepare(env,a);
 case 7:return ProvisioningV4ReadPair(env,a);
 case 8:return ProvisioningV4Complete(env,a);
 case 9:if(a->composition&&a->composition->operation)return ProvisioningV4OutcomeDATA(env,a->composition->operation->originalOutcomeDATA());return DeviceV4Throw(env,"DEVICE_PROVISIONING_ORIGINAL_OUTCOME_NOT_ENTERED");
#endif
 }return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_METHOD");
}
static napi_value ProvisioningV4CaptureApproval(napi_env env,ProvisioningV4SourceNapi*p,napi_value self,napi_value peer){
 if(!ProvisioningV4Current(p))return DeviceV4Throw(env,p->first.c_str());
 NSError*e=nil;NSString*path=[p->source copyOriginalProductSessionDeviceV4ApprovalModulePath:&e];if(!path||e)return DeviceV4Throw(env,"DEVICE_PROVISIONING_MAIN_MODULE_NOT_SUPPLIED");
 napi_value file=nullptr,require=nullptr,module=nullptr;napi_create_string_utf8(env,path.UTF8String,NAPI_AUTO_LENGTH,&file);auto it=provisioningV4ModuleLoaders.find(env);if(it==provisioningV4ModuleLoaders.end()||napi_call_function(env,DeviceV4Undefined(env),DeviceV4Ref(env,it->second.createRequire),1,&file,&require)!=napi_ok||napi_call_function(env,DeviceV4Undefined(env),require,1,&file,&module)!=napi_ok)return DeviceV4Throw(env,"DEVICE_PROVISIONING_FIXED_MODULE_LOAD_FAILED");
 auto*a=new(std::nothrow)ProvisioningV4Approval;if(!a)return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_CAPACITY");a->env=env;a->parent=p;
 napi_value out=nullptr;bool held=DeviceV4Keep(env,self,a->parentObject)&&DeviceV4Keep(env,peer,a->peer);const std::pair<const char*,napi_ref*>refs[]={{"readOriginalWalletDeviceCreateApprovalForNative",&a->reader},{"assertOriginalWalletDeviceCreateApprovalCurrentForNative",&a->current},{"recheckOriginalWalletDeviceCreateApprovalForNative",&a->recheck}};for(auto&entry:refs){napi_value fn=nullptr;napi_valuetype type;if(!held||napi_get_named_property(env,module,entry.first,&fn)!=napi_ok||napi_typeof(env,fn,&type)!=napi_ok||type!=napi_function||!DeviceV4Keep(env,fn,*entry.second))held=false;}
 if(!held){a->parent=nullptr;ProvisioningV4ApprovalClose(a);delete a;return DeviceV4Throw(env,"DEVICE_PROVISIONING_FIXED_MODULE_EXPORTS");}
 p->children++;if(napi_create_object(env,&out)!=napi_ok||napi_type_tag_object(env,out,&provisioningV4ApprovalTag)!=napi_ok||napi_wrap(env,out,a,ProvisioningV4ApprovalFinalize,nullptr,nullptr)!=napi_ok){ProvisioningV4ApprovalClose(a);delete a;return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_WRAP");}provisioningV4Approvals.insert(a);
 const char*names[]={"assertCurrent","retire","join","close","recheck","prepare","readPublicPairDATA","complete","readOriginalOutcomeDATA"};for(uintptr_t i=0;i<9;i++){napi_property_descriptor d={names[i],nullptr,ProvisioningV4ApprovalMethod,nullptr,nullptr,nullptr,napi_default,(void*)(i+1)};if(napi_define_properties(env,out,1,&d)!=napi_ok)return DeviceV4Throw(env,"DEVICE_PROVISIONING_APPROVAL_METHODS");}napi_object_freeze(env,out);
 if(!ProvisioningV4ApprovalCurrent(a)){a->failed=true;bool pending=false;napi_is_exception_pending(env,&pending);if(pending){napi_value cause=nullptr;napi_get_and_clear_last_exception(env,&cause);}napi_value err=DeviceV4Error(env,a->first.empty()?"DEVICE_PROVISIONING_ORIGINAL_APPROVAL_REQUIRED":a->first.c_str());napi_set_named_property(env,err,"partial",out);napi_throw(env,err);return nullptr;}return out;
}
static void ProvisioningV4LoaderCleanup(void*raw){auto env=(napi_env)raw;for(auto*a:provisioningV4Approvals)if(a->env==env)ProvisioningV4ApprovalClose(a);auto it=provisioningV4ModuleLoaders.find(env);if(it!=provisioningV4ModuleLoaders.end()){for(auto r:{it->second.createRequire,it->second.promiseThen})if(r)napi_delete_reference(env,r);provisioningV4ModuleLoaders.erase(it);}}
static bool ProvisioningV4LoaderInitialize(napi_env env){
 if(provisioningV4ModuleLoaders.count(env))return false;napi_value global=nullptr,process=nullptr,get=nullptr,name=nullptr,module=nullptr,fn=nullptr,promise=nullptr,prototype=nullptr;napi_get_global(env,&global);napi_create_string_utf8(env,"node:module",NAPI_AUTO_LENGTH,&name);
 if(napi_get_named_property(env,global,"process",&process)!=napi_ok||napi_get_named_property(env,process,"getBuiltinModule",&get)!=napi_ok||napi_call_function(env,process,get,1,&name,&module)!=napi_ok||napi_get_named_property(env,module,"createRequire",&fn)!=napi_ok)return false;ProvisioningV4ModuleLoader capture;if(!DeviceV4Keep(env,fn,capture.createRequire))return false;
 if(napi_get_named_property(env,global,"Promise",&promise)!=napi_ok||napi_get_named_property(env,promise,"prototype",&prototype)!=napi_ok||napi_get_named_property(env,prototype,"then",&fn)!=napi_ok||!DeviceV4Keep(env,fn,capture.promiseThen)){napi_delete_reference(env,capture.createRequire);return false;}
 provisioningV4ModuleLoaders.emplace(env,capture);return napi_add_env_cleanup_hook(env,ProvisioningV4LoaderCleanup,env)==napi_ok;
}
