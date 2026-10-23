// SAME original addon. Actual tagged Native custody; no JS provider/fd/Source.
#import "../../../packages/wallet-auth/native/original-ide-contract-relay-owner.h"
#include <uv.h>
struct NativeRelayRef {
 napi_env env=nullptr;YNXOriginalIDEContractRelayOwner *__strong owner=nil;
 NSError *__strong originalError=nil;napi_ref self=nullptr,listener=nullptr;
 NSError *__strong actionError=nil;
 uv_timer_t timer{};bool timerInitialized=false,timerClosing=false,timerDrained=true;
 bool retired=false,closeSelected=false,closed=false,envDead=false,finalized=false;
 napi_deferred cleanup=nullptr;unsigned cleanupKind=0;std::string closeError;
};
static const napi_type_tag nativeRelayTag={0x594e58434f4e5452ULL,0x41435452454c4159ULL};
static std::unordered_set<NativeRelayRef*> nativeRelayRefs;
static napi_value RelayTrue(napi_env env){napi_value v;return napi_get_boolean(env,true,&v)==napi_ok?v:nullptr;}
static const char*RelayCode(NSError *e){NSString *s=e.localizedDescription;return s.length&&s.length<=128?[s UTF8String]:"YNX_CONTRACT_RELAY_NATIVE_UNKNOWN";}
static napi_value RelayError(napi_env env,const char*code){napi_value s,e;if(napi_create_string_utf8(env,code,NAPI_AUTO_LENGTH,&s)!=napi_ok||napi_create_error(env,nullptr,s,&e)!=napi_ok)return nullptr;napi_set_named_property(env,e,"code",s);return e;}
static NativeRelayRef*RelayOriginal(napi_env env,napi_value v){
 bool tagged=false;void *raw=nullptr;if(napi_check_object_type_tag(env,v,&nativeRelayTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,v,&raw)!=napi_ok)return nullptr;
 auto *h=static_cast<NativeRelayRef*>(raw);return nativeRelayRefs.count(h)&&h->env==env&&!h->envDead&&pthread_main_np()?h:nullptr;
}
static void RelayRemember(NativeRelayRef*h,NSError*e){if(!h->originalError&&e)h->originalError=e;}
static void RelayRemoveObserver(NativeRelayRef*h){[h->owner removeLocalRevocationObserver];if(h->listener&&!h->envDead){napi_delete_reference(h->env,h->listener);h->listener=nullptr;}}
static void RelayResolveCleanup(NativeRelayRef*h){
 if(!h->cleanup||!h->timerDrained||h->envDead)return;
 NSError *e=nil;BOOL ok=!h->owner||[h->owner join:&e];
 if(ok&&h->cleanupKind==3){
  if(!h->closeSelected){h->closeSelected=true;ok=!h->owner||[h->owner close:&e];h->closed=ok;if(!ok)h->closeError=RelayCode(e);}
  else ok=h->closed;
 }
 if(ok&&h->cleanupKind==1&&h->actionError){ok=NO;e=h->actionError;}
 napi_deferred deferred=h->cleanup;h->cleanup=nullptr;h->cleanupKind=0;
 if(ok){if(h->closed){RelayRemoveObserver(h);if(h->self){napi_delete_reference(h->env,h->self);h->self=nullptr;}}napi_resolve_deferred(h->env,deferred,RelayTrue(h->env));}
 else {RelayRemember(h,e);napi_reject_deferred(h->env,deferred,RelayError(h->env,h->closeError.empty()?RelayCode(e):h->closeError.c_str()));}
}
static void RelayTimerClosed(uv_handle_t*timer){auto*h=static_cast<NativeRelayRef*>(timer->data);h->timerDrained=true;h->timerInitialized=false;RelayResolveCleanup(h);}
static void RelayStop(NativeRelayRef*h){
 if(h->timerInitialized&&!h->timerClosing){h->timerClosing=true;uv_timer_stop(&h->timer);uv_close((uv_handle_t*)&h->timer,RelayTimerClosed);}
}
static void RelayTick(uv_timer_t*timer){
 auto*h=static_cast<NativeRelayRef*>(timer->data);if(h->envDead||h->retired){RelayStop(h);return;}
 napi_handle_scope scope=nullptr;if(napi_open_handle_scope(h->env,&scope)!=napi_ok){h->retired=true;RelayStop(h);return;}
 NSError*e=nil;if(![h->owner pollLocalRevocation:&e]){RelayRemember(h,e);h->retired=true;RelayStop(h);}
 napi_close_handle_scope(h->env,scope);
}
static void RelayFinalize(napi_env env,void*raw,void*){
 auto*h=static_cast<NativeRelayRef*>(raw);if(!nativeRelayRefs.count(h))return;h->finalized=true;
 RelayRemoveObserver(h);h->retired=true;[h->owner retire:nil];RelayStop(h);
 if(!h->timerDrained||h->cleanup)return; // retained original debt; no retry
 NSError*e=nil;if(h->owner&&(![h->owner join:&e]||![h->owner close:&e])){RelayRemember(h,e);return;}
 nativeRelayRefs.erase(h);delete h;
}
static napi_value RelayScopeValue(napi_env env,NSDictionary*scope){
 napi_value out;if(napi_create_object(env,&out)!=napi_ok)return nullptr;
 for(NSString*k in scope){id v=scope[k];napi_value value;
  if([v isKindOfClass:NSString.class]){NSData*b=[v dataUsingEncoding:NSUTF8StringEncoding];if(napi_create_string_utf8(env,(const char*)b.bytes,b.length,&value)!=napi_ok)return nullptr;}
  else if([v isKindOfClass:NSNumber.class]){if(napi_create_double(env,[v doubleValue],&value)!=napi_ok)return nullptr;}
  else if([v isKindOfClass:NSArray.class]){NSArray*a=v;if(napi_create_array_with_length(env,a.count,&value)!=napi_ok)return nullptr;for(NSUInteger i=0;i<a.count;i++){NSData*b=[a[i]dataUsingEncoding:NSUTF8StringEncoding];napi_value text;if(!b||napi_create_string_utf8(env,(const char*)b.bytes,b.length,&text)!=napi_ok||napi_set_element(env,value,(uint32_t)i,text)!=napi_ok)return nullptr;}napi_object_freeze(env,value);}
  else return nullptr;
  if(napi_set_named_property(env,out,k.UTF8String,value)!=napi_ok)return nullptr;
 }return napi_object_freeze(env,out)==napi_ok?out:nullptr;
}
static napi_value RelayAcquire(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a)||!pthread_main_np()||nativeRelayRefs.size()>=64)return Error(env,"YNX_CONTRACT_RELAY_ARGUMENTS_INVALID");
 NSDictionary *input=Dictionary(env,a[0]);if(!input||![[NSSet setWithArray:input.allKeys]isEqual:[NSSet setWithArray:@[@"serverModuleURL",@"expectedScope"]]]||![input[@"serverModuleURL"]isKindOfClass:NSString.class]||![input[@"expectedScope"]isKindOfClass:NSDictionary.class])return Error(env,"YNX_CONTRACT_RELAY_ARGUMENTS_INVALID");
 auto*h=new(std::nothrow)NativeRelayRef;if(!h)return Error(env,"YNX_CONTRACT_RELAY_CAPACITY");h->env=env;
 napi_value object,promise;napi_deferred deferred;
 if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,&nativeRelayTag)!=napi_ok||napi_create_promise(env,&deferred,&promise)!=napi_ok){delete h;return nullptr;}
 nativeRelayRefs.insert(h);
 if(napi_wrap(env,object,h,RelayFinalize,nullptr,nullptr)!=napi_ok){nativeRelayRefs.erase(h);delete h;return nullptr;}
 if(napi_create_reference(env,object,1,&h->self)!=napi_ok)return Error(env,"YNX_CONTRACT_RELAY_CAPTURE_UNKNOWN");
 if(napi_object_freeze(env,object)!=napi_ok)return Error(env,"YNX_CONTRACT_RELAY_CAPTURE_UNKNOWN");
 // Actual partial is retained before error/status. expectedScope never selects
 // Source/Root/peer/project. Independent Source lease is NOT AI Tools custody.
 NSError*e=nil;h->owner=[YNXOriginalIDEContractRelayOwner captureForActualRunningEntry:input[@"serverModuleURL"] error:&e];RelayRemember(h,e);
 NSDictionary *scope=h->originalError?nil:[h->owner copyScopeLocal:&e];RelayRemember(h,e);
 NSDictionary *expected=input[@"expectedScope"];
 BOOL mismatch=NO;
 if(scope){
  NSNumber *limit=expected[@"expiresMS"];
  mismatch=![scope[@"projectId"]isEqual:expected[@"projectId"]]||![scope[@"projectGeneration"]isEqual:expected[@"projectGeneration"]]||![limit isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)limit)==CFBooleanGetTypeID()||limit.doubleValue<1||limit.doubleValue>9007199254740991.0||limit.doubleValue!=(double)limit.unsignedLongLongValue||[scope[@"expiresMS"]unsignedLongLongValue]>limit.unsignedLongLongValue;
  for(NSString*k in expected)if(![@[@"kind",@"projectId",@"projectGeneration",@"callerIdentity",@"origin",@"expiresMS",@"chainId",@"methods",@"relayURL"]containsObject:k]||(![k isEqual:@"expiresMS"]&&![scope[k]isEqual:expected[k]]))mismatch=YES;
 }
 if(mismatch){h->originalError=[NSError errorWithDomain:@"YNXOriginalContractRelay" code:5 userInfo:@{NSLocalizedDescriptionKey:@"YNX_CONTRACT_RELAY_PROJECT_MISMATCH"}];[h->owner retire:nil];}
 if(!h->originalError&&h->owner){
  uv_loop_t*loop=nullptr;
  if(napi_get_uv_event_loop(env,&loop)!=napi_ok||!loop||uv_timer_init(loop,&h->timer)){h->originalError=[NSError errorWithDomain:@"YNXOriginalContractRelay" code:6 userInfo:@{NSLocalizedDescriptionKey:@"YNX_CONTRACT_RELAY_OBSERVER_UNKNOWN"}];[h->owner retire:nil];}
  else{h->timer.data=h;h->timerInitialized=true;h->timerDrained=false;if(uv_timer_start(&h->timer,RelayTick,100,100)){h->originalError=[NSError errorWithDomain:@"YNXOriginalContractRelay" code:6 userInfo:@{NSLocalizedDescriptionKey:@"YNX_CONTRACT_RELAY_OBSERVER_UNKNOWN"}];[h->owner retire:nil];RelayStop(h);}else uv_unref((uv_handle_t*)&h->timer);}
 }
 napi_resolve_deferred(env,deferred,object);return promise;
}
static napi_value RelayRead(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"YNX_CONTRACT_RELAY_ARGUMENTS_INVALID");auto*h=RelayOriginal(env,a[0]);if(!h)return Error(env,"YNX_CONTRACT_RELAY_ORIGINAL_REQUIRED");if(h->originalError)return Error(env,RelayCode(h->originalError));NSError*e=nil;NSDictionary*s=[h->owner copyScopeLocal:&e];if(!s||e){RelayRemember(h,e);return Error(env,RelayCode(e));}return RelayScopeValue(env,s);}
static napi_value RelayCurrent(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"YNX_CONTRACT_RELAY_ARGUMENTS_INVALID");auto*h=RelayOriginal(env,a[0]);if(!h)return Error(env,"YNX_CONTRACT_RELAY_ORIGINAL_REQUIRED");if(h->originalError)return Error(env,RelayCode(h->originalError));NSError*e=nil;
 if(h->retired||![h->owner assertLocalCurrent:&e]){RelayRemember(h,e);return Error(env,e?RelayCode(e):"YNX_CONTRACT_RELAY_RETIRED");}
 // This is a concrete activation fence, NOT a successful guard stub: local
 // peer/project qualification cannot stop unqualified inbound WC handlers
 // before Verify. Normal initiator requires ZERO Verify HTTP. Qualify only
 // the actual initiator-role boundary and exact installed runtime closure;
 // never replace this with a broad Verify permission or caller boolean.
 return Error(env,"YNX_CONTRACT_RELAY_INITIATOR_ROLE_BOUNDARY_UNQUALIFIED");
}
struct RelaySubscription{NativeRelayRef*handle;napi_ref owner;bool active=true;};
static void RelaySubscriptionFinalize(napi_env env,void*raw,void*){auto*t=static_cast<RelaySubscription*>(raw);if(t->owner)napi_delete_reference(env,t->owner);delete t;}
static napi_value RelayUnsubscribe(napi_env env,napi_callback_info info){size_t n=0;void*raw=nullptr;if(napi_get_cb_info(env,info,&n,nullptr,nullptr,&raw)!=napi_ok)return nullptr;auto*t=static_cast<RelaySubscription*>(raw);if(!t||!t->active)return Undefined(env);auto*h=t->handle;if(!nativeRelayRefs.count(h)||h->env!=env)return Error(env,"YNX_CONTRACT_RELAY_ORIGINAL_REQUIRED");t->active=false;RelayRemoveObserver(h);return Undefined(env);}
static napi_value RelayObserve(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"YNX_CONTRACT_RELAY_ARGUMENTS_INVALID");auto*h=RelayOriginal(env,a[0]);napi_valuetype kind;if(!h||napi_typeof(env,a[1],&kind)!=napi_ok||kind!=napi_function||h->listener)return Error(env,"YNX_CONTRACT_RELAY_OBSERVER_INVALID");
 if(h->originalError)return Error(env,RelayCode(h->originalError));
 if(napi_create_reference(env,a[1],1,&h->listener)!=napi_ok)return Error(env,"YNX_CONTRACT_RELAY_OBSERVER_UNKNOWN");
 NSError*e=nil;BOOL ok=[h->owner observeLocalRevocation:^{if(h->envDead||!h->listener)return;napi_value listener,global,result;if(napi_get_reference_value(env,h->listener,&listener)!=napi_ok||napi_get_global(env,&global)!=napi_ok||napi_call_function(env,global,listener,0,nullptr,&result)!=napi_ok){bool pending=false;napi_is_exception_pending(env,&pending);if(pending){napi_value ignored;napi_get_and_clear_last_exception(env,&ignored);}h->retired=true;}} error:&e];
 if(!ok){RelayRemoveObserver(h);RelayRemember(h,e);return Error(env,RelayCode(e));}
 auto*t=new(std::nothrow)RelaySubscription{h,nullptr};napi_value unsubscribe;
 if(!t||napi_create_reference(env,a[0],1,&t->owner)!=napi_ok||napi_create_function(env,"unsubscribeOriginalContractRelay",NAPI_AUTO_LENGTH,RelayUnsubscribe,t,&unsubscribe)!=napi_ok){if(t){if(t->owner)napi_delete_reference(env,t->owner);delete t;}RelayRemoveObserver(h);return Error(env,"YNX_CONTRACT_RELAY_OBSERVER_UNKNOWN");}
 if(napi_add_finalizer(env,unsubscribe,t,RelaySubscriptionFinalize,nullptr,nullptr)!=napi_ok){napi_delete_reference(env,t->owner);t->owner=nullptr;t->active=false;RelayRemoveObserver(h);return Error(env,"YNX_CONTRACT_RELAY_OBSERVER_UNKNOWN");}return unsubscribe;
}
static napi_value RelayLifecycle(napi_env env,napi_callback_info info){
 napi_value a[1];size_t n=1;void*raw=nullptr;if(napi_get_cb_info(env,info,&n,a,nullptr,&raw)!=napi_ok||n!=1)return Error(env,"YNX_CONTRACT_RELAY_ARGUMENTS_INVALID");auto*h=RelayOriginal(env,a[0]);if(!h)return Error(env,"YNX_CONTRACT_RELAY_ORIGINAL_REQUIRED");
 if(h->cleanup)return Error(env,"YNX_CONTRACT_RELAY_CLEANUP_PENDING");
 unsigned op=(unsigned)(uintptr_t)raw;napi_value promise;if(napi_create_promise(env,&h->cleanup,&promise)!=napi_ok)return nullptr;
 h->cleanupKind=op==5?3:op==4?2:1;
 if(op<=3&&!h->retired){h->retired=true;NSError*e=nil;if(h->owner&&![h->owner retire:&e]){h->actionError=e?:[NSError errorWithDomain:@"YNXOriginalContractRelay" code:8 userInfo:@{NSLocalizedDescriptionKey:@"YNX_CONTRACT_RELAY_CANCEL_UNKNOWN"}];RelayRemember(h,h->actionError);}RelayStop(h);}
 if(!h->retired){napi_deferred d=h->cleanup;h->cleanup=nullptr;napi_reject_deferred(env,d,RelayError(env,"YNX_CONTRACT_RELAY_NOT_RETIRED"));return promise;}
 RelayResolveCleanup(h);return promise;
}
static void RelayEnvironmentCleanup(void*raw){auto env=(napi_env)raw;for(auto*h:nativeRelayRefs)if(h->env==env){RelayRemoveObserver(h);h->retired=true;[h->owner retire:nil];RelayStop(h);h->envDead=true;}}
static napi_value RegisterOriginalIDEContractRelayBinding(napi_env env,napi_value exports){
 const struct{const char*name;napi_callback fn;uintptr_t data;}methods[]={
  {"acquireOriginalIDEContractRelayGuard",RelayAcquire,0},{"readOriginalIDEContractRelayGuardScope",RelayRead,0},{"assertOriginalIDEContractRelayGuardCurrent",RelayCurrent,0},{"observeOriginalIDEContractRelayGuardRevocation",RelayObserve,0},
  {"cancelOriginalIDEContractRelayGuard",RelayLifecycle,1},{"revokeOriginalIDEContractRelayGuard",RelayLifecycle,2},{"retireOriginalIDEContractRelayGuard",RelayLifecycle,3},{"joinOriginalIDEContractRelayGuard",RelayLifecycle,4},{"closeOriginalIDEContractRelayGuard",RelayLifecycle,5}};
 for(const auto&m:methods){napi_property_descriptor d={m.name,nullptr,m.fn,nullptr,nullptr,nullptr,napi_default,(void*)m.data};if(napi_define_properties(env,exports,1,&d)!=napi_ok)return nullptr;}
 return napi_add_env_cleanup_hook(env,RelayEnvironmentCleanup,env)==napi_ok?exports:nullptr;
}
