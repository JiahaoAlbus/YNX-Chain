// SAME original addon image. No caller Source/Root/provider constructor or FD
// serialization. Type recognition is custody only; every effect checks Source.
#import "../../../packages/wallet-auth/native/original-pq-host-catalog-source.h"
struct OriginalPQCatalogOwner {
 napi_env env=nullptr;pthread_t thread{};YNXOriginalPQHostCatalogSource*__strong source=nil;
 NSError*__strong acquisitionCause=nil;NSError*__strong cleanupCause=nil;
 bool busy=false,retired=false,closeSelected=false,closed=false,hook=false;
};
static const napi_type_tag originalPQCatalogTag={0x594e585051435352ULL,0x434f574e45523031ULL};
static std::unordered_set<OriginalPQCatalogOwner*>originalPQCatalogOwners,originalPQCatalogDebts;
static OriginalPQCatalogOwner*PQCatalogOriginal(napi_env env,napi_value value){
 bool tagged=false;void*raw=nullptr;if(!pthread_main_np()||napi_check_object_type_tag(env,value,&originalPQCatalogTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,value,&raw)!=napi_ok)return nullptr;
 auto*p=static_cast<OriginalPQCatalogOwner*>(raw);return originalPQCatalogOwners.count(p)&&p->env==env&&pthread_equal(p->thread,pthread_self())?p:nullptr;
}
static bool PQCatalogClose(OriginalPQCatalogOwner*p){
 if(p->closeSelected)return p->closed;if(p->busy)return false;p->retired=true;
 NSError*e=nil;[p->source retire];if(p->source&&![p->source join:&e]){p->cleanupCause=e;return false;}
 p->closeSelected=true;e=nil;p->closed=!p->source||[p->source close:&e];
 if(!p->closed||e){p->closed=false;p->cleanupCause=e;originalPQCatalogDebts.insert(p);return false;}
 originalPQCatalogDebts.erase(p);return true;
}
static void PQCatalogEnvRetire(void*raw){auto*p=static_cast<OriginalPQCatalogOwner*>(raw);if(!originalPQCatalogOwners.count(p))return;p->hook=false;p->retired=true;[p->source retire];}
static void PQCatalogFinalize(napi_env,void*raw,void*){
 auto*p=static_cast<OriginalPQCatalogOwner*>(raw);if(!originalPQCatalogOwners.count(p))return;
 if(!PQCatalogClose(p)){originalPQCatalogDebts.insert(p);return;}
 if(p->hook&&napi_remove_env_cleanup_hook(p->env,PQCatalogEnvRetire,p)!=napi_ok){originalPQCatalogDebts.insert(p);return;}
 p->hook=false;originalPQCatalogOwners.erase(p);originalPQCatalogDebts.erase(p);delete p;
}
static NSDictionary*PQCatalogJournal(napi_env env,napi_value value){
 napi_value keys;napi_valuetype type;uint32_t length=0;
 if(napi_typeof(env,value,&type)!=napi_ok||type!=napi_object||napi_get_all_property_names(env,value,napi_key_own_only,napi_key_all_properties,napi_key_numbers_to_strings,&keys)!=napi_ok||napi_get_array_length(env,keys,&length)!=napi_ok||length!=6)return nil;
 NSMutableDictionary*d=[NSMutableDictionary dictionary];NSArray*expected=@[@"operationId",@"account",@"networkId",@"originalHash",@"nativeWireHash",@"transactionHash"];
 for(uint32_t i=0;i<length;i++){napi_value key,v;if(napi_get_element(env,keys,i,&key)!=napi_ok)return nil;NSString*k=ProjectText(env,key);if(![expected containsObject:k]||d[k]||napi_get_property(env,value,key,&v)!=napi_ok)return nil;NSString*s=ProjectText(env,v);if(!s)return nil;d[k]=s;}
 return d.count==6?[d copy]:nil;
}
static napi_value PQCatalogAcquire(napi_env env,napi_callback_info info){
 napi_value args[1];if(!Args(env,info,0,args))return Error(env,"PQ_HOST_SOURCE_ARGUMENTS_INVALID");
 size_t held=0;for(auto*p:originalPQCatalogOwners)if(p->env==env&&!p->closed)held++;if(held>=16)return Error(env,"PQ_HOST_SOURCE_CAPACITY");
 auto*p=new(std::nothrow)OriginalPQCatalogOwner{};if(!p)return Error(env,"PQ_HOST_SOURCE_CAPACITY");p->env=env;p->thread=pthread_self();
 @try{NSError*e=nil;p->source=[YNXOriginalPQHostCatalogSource acquire:&e];p->acquisitionCause=e;
  if(!p->source){delete p;return Error(env,"PQ_HOST_SOURCE_NOT_SUPPLIED");}
  originalPQCatalogOwners.insert(p);
  napi_value object;if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,&originalPQCatalogTag)!=napi_ok||napi_wrap(env,object,p,PQCatalogFinalize,nullptr,nullptr)!=napi_ok){PQCatalogFinalize(env,p,nullptr);return nullptr;}
  if(napi_add_env_cleanup_hook(env,PQCatalogEnvRetire,p)!=napi_ok){p->retired=true;[p->source retire];return object;}p->hook=true;
  return napi_object_freeze(env,object)==napi_ok?object:nullptr;
 }@catch(NSException*){if(p->source){originalPQCatalogOwners.insert(p);PQCatalogFinalize(env,p,nullptr);}else delete p;return Error(env,"PQ_HOST_SOURCE_ACQUISITION_UNKNOWN");}
}
static napi_value PQCatalogIs(napi_env env,napi_callback_info info){napi_value a[1],result;if(!Args(env,info,1,a))return Error(env,"PQ_HOST_SOURCE_ARGUMENTS_INVALID");napi_get_boolean(env,PQCatalogOriginal(env,a[0])!=nullptr,&result);return result;}
struct OriginalPQCatalogWork{OriginalPQCatalogOwner*p=nullptr;napi_async_work work=nullptr;napi_deferred deferred=nullptr;napi_ref self=nullptr;};
static napi_value PQCatalogErrorValue(napi_env env,const char*code){napi_value text,error;napi_create_string_utf8(env,code,NAPI_AUTO_LENGTH,&text);napi_create_error(env,nullptr,text,&error);napi_set_named_property(env,error,"code",text);return error;}
static void PQCatalogExecute(napi_env,void*raw){auto*w=static_cast<OriginalPQCatalogWork*>(raw);[w->p->source runPreparedHandoff];}
static void PQCatalogComplete(napi_env env,napi_status status,void*raw){
 std::unique_ptr<OriginalPQCatalogWork>w(static_cast<OriginalPQCatalogWork*>(raw));auto*p=w->p;
 @autoreleasepool{@try{NSError*e=nil;if(status!=napi_ok)[p->source retire];NSDictionary*pair=[p->source completeHandoff:&e];
  // Original DATA must reach Main retention before its subsequent current
  // fence rejects late retirement. It is never qualification or a Host grant.
  napi_value value=pair?ProjectData(env,pair):nullptr;
  if(env){if(value)napi_resolve_deferred(env,w->deferred,value);else napi_reject_deferred(env,w->deferred,PQCatalogErrorValue(env,e.localizedDescription.UTF8String?:"PQ_HOST_SOURCE_HANDOFF_UNKNOWN"));}
 }@catch(NSException*){if(env)napi_reject_deferred(env,w->deferred,PQCatalogErrorValue(env,"PQ_HOST_SOURCE_HANDOFF_EXCEPTION"));}}
 p->busy=false;if(env){napi_delete_async_work(env,w->work);napi_delete_reference(env,w->self);}
}
static napi_value PQCatalogRead(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"PQ_HOST_SOURCE_ARGUMENTS_INVALID");auto*p=PQCatalogOriginal(env,a[0]);if(!p)return Error(env,"PQ_HOST_SOURCE_ORIGINAL_OWNER_REQUIRED");
 if(p->busy||p->retired||p->closeSelected)return Error(env,"PQ_HOST_SOURCE_CALL_PENDING_OR_RETIRED");p->busy=true;
 NSDictionary*journal=PQCatalogJournal(env,a[1]);NSError*e=nil;
 if(!journal||![p->source prepareHandoff:journal error:&e]||e){p->busy=false;return Error(env,e.localizedDescription.UTF8String?:"PQ_HOST_SOURCE_JOURNAL_OR_PREPARE_FAILED");}
 auto*w=new(std::nothrow)OriginalPQCatalogWork{};if(!w){[p->source cancelPreparedHandoff];[p->source completeHandoff:nil];p->busy=false;return Error(env,"PQ_HOST_SOURCE_CAPACITY");}w->p=p;
 napi_value promise,name;napi_create_string_utf8(env,"OriginalPQHostCatalogSource",NAPI_AUTO_LENGTH,&name);
 if(napi_create_promise(env,&w->deferred,&promise)!=napi_ok||napi_create_reference(env,a[0],1,&w->self)!=napi_ok||napi_create_async_work(env,nullptr,name,PQCatalogExecute,PQCatalogComplete,w,&w->work)!=napi_ok){[p->source cancelPreparedHandoff];[p->source completeHandoff:nil];if(w->self)napi_delete_reference(env,w->self);delete w;p->busy=false;return Error(env,"PQ_HOST_SOURCE_QUEUE_UNKNOWN");}
 if(napi_queue_async_work(env,w->work)!=napi_ok){[p->source cancelPreparedHandoff];[p->source completeHandoff:nil];napi_reject_deferred(env,w->deferred,PQCatalogErrorValue(env,"PQ_HOST_SOURCE_QUEUE_UNKNOWN"));napi_delete_async_work(env,w->work);napi_delete_reference(env,w->self);delete w;p->busy=false;}
 return promise;
}
static napi_value PQCatalogCurrent(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"PQ_HOST_SOURCE_ARGUMENTS_INVALID");auto*p=PQCatalogOriginal(env,a[0]);if(!p)return Error(env,"PQ_HOST_SOURCE_ORIGINAL_OWNER_REQUIRED");
 if(p->busy||p->retired||p->closeSelected)return Error(env,"PQ_HOST_SOURCE_CALL_PENDING_OR_RETIRED");p->busy=true;NSDictionary*journal=PQCatalogJournal(env,a[1]);NSError*e=nil;BOOL ok=journal&&[p->source assertCurrentForJournal:journal error:&e];p->busy=false;return ok&&!e?Undefined(env):Error(env,e.localizedDescription.UTF8String?:"PQ_HOST_SOURCE_NOT_CURRENT");
}
enum class PQCatalogLifecycle:uintptr_t{observe=1,retire,join,close,status};
static napi_value PQCatalogLife(napi_env env,napi_callback_info info){
 napi_value a[2];void*raw=nullptr;size_t count=2;if(napi_get_cb_info(env,info,&count,a,nullptr,&raw)!=napi_ok||count!=1)return Error(env,"PQ_HOST_SOURCE_ARGUMENTS_INVALID");
 auto*p=PQCatalogOriginal(env,a[0]);if(!p)return Error(env,"PQ_HOST_SOURCE_ORIGINAL_OWNER_REQUIRED");auto method=static_cast<PQCatalogLifecycle>((uintptr_t)raw);NSError*e=nil;
 if(method==PQCatalogLifecycle::retire){p->retired=true;[p->source retire];return Undefined(env);}
 if(method==PQCatalogLifecycle::status)return ProjectData(env,[p->source status]);
 if(method==PQCatalogLifecycle::observe){if(p->busy)return Error(env,"PQ_HOST_SOURCE_CALL_PENDING");return ProjectData(env,[p->source observeRevocation]);}
 if(method==PQCatalogLifecycle::join)return !p->busy&&p->retired&&[p->source join:&e]&&!e?Undefined(env):Error(env,"PQ_HOST_SOURCE_CHILD_NOT_JOINED");
 return PQCatalogClose(p)?Undefined(env):Error(env,"PQ_HOST_SOURCE_CLOSE_UNKNOWN");
}
static napi_value RegisterOriginalPQHostCatalogSource(napi_env env,napi_value exports){
 const struct{const char*name;napi_callback callback;void*data;}methods[]={
  {"acquireOriginalPQHostCatalogSource",PQCatalogAcquire,nullptr},{"isOriginalPQHostCatalogSource",PQCatalogIs,nullptr},{"readOriginalPQHostCatalogHandoff",PQCatalogRead,nullptr},{"assertOriginalPQHostCatalogSourceCurrent",PQCatalogCurrent,nullptr},
  {"observeOriginalPQHostCatalogSourceRevocation",PQCatalogLife,(void*)PQCatalogLifecycle::observe},{"retireOriginalPQHostCatalogSource",PQCatalogLife,(void*)PQCatalogLifecycle::retire},{"joinOriginalPQHostCatalogSource",PQCatalogLife,(void*)PQCatalogLifecycle::join},{"closeOriginalPQHostCatalogSource",PQCatalogLife,(void*)PQCatalogLifecycle::close},{"readOriginalPQHostCatalogSourceStatus",PQCatalogLife,(void*)PQCatalogLifecycle::status}};
 for(const auto&m:methods){napi_property_descriptor d={m.name,nullptr,m.callback,nullptr,nullptr,nullptr,napi_default,m.data};if(napi_define_properties(env,exports,1,&d)!=napi_ok)return nullptr;}return exports;
}
