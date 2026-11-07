#include "desktop-grant-native-private.h"
#include "desktop-grant-qualification-private.hpp"
#include <memory>
#include <string>
#include <map>
#include <mutex>
namespace {
using namespace ynx::auth::desktopgrant;
struct Box{std::shared_ptr<Qualification>root;};
const napi_type_tag tag={0x90e4b11baf7b3c67ULL,0x224f7aae49301f82ULL};
std::map<napi_env,napi_ref>originalAcquisitions;
std::mutex acquisitionsMutex;
void forgetEnvironment(void*p){std::lock_guard<std::mutex>lock(acquisitionsMutex);originalAcquisitions.erase(static_cast<napi_env>(p));}
napi_value undef(napi_env e){napi_value v=nullptr;napi_get_undefined(e,&v);return v;}
napi_value str(napi_env e,const std::string&s){napi_value v=nullptr;napi_create_string_utf8(e,s.data(),s.size(),&v);return v;}
napi_value fail(napi_env e,const char*c){napi_throw_error(e,c,c);return nullptr;}
bool set(napi_env e,napi_value o,const char*k,napi_value v){return v&&napi_set_named_property(e,o,k,v)==napi_ok;}
napi_value boolean(napi_env e,bool b){napi_value v=nullptr;napi_get_boolean(e,b,&v);return v;}
Box*box(napi_env e,napi_callback_info info,void**data=nullptr){size_t n=1;napi_value argv[1],self=nullptr;void*d=nullptr;if(napi_get_cb_info(e,info,&n,argv,&self,&d)!=napi_ok||n){fail(e,"DESKTOP_GRANT_ZERO_INPUT_REQUIRED");return nullptr;}bool branded=false;if(napi_check_object_type_tag(e,self,&tag,&branded)!=napi_ok||!branded){fail(e,"DESKTOP_GRANT_ORIGINAL_NATIVE_ROOT_REQUIRED");return nullptr;}Box*b=nullptr;if(napi_unwrap(e,self,(void**)&b)!=napi_ok||!b){fail(e,"DESKTOP_GRANT_ORIGINAL_NATIVE_ROOT_REQUIRED");return nullptr;}if(data)*data=d;return b;}
napi_value current(napi_env e,napi_callback_info i){auto*b=box(e,i);if(!b)return nullptr;return qualification_current(b->root)?fail(e,"DESKTOP_GRANT_NATIVE_ROOT_NOT_CURRENT"):undef(e);}
napi_value observed(napi_env e,napi_callback_info i){auto*b=box(e,i);if(!b)return nullptr;return qualification_observed_current(b->root)?fail(e,"DESKTOP_GRANT_NATIVE_ROOT_OBSERVATION_EXPIRED"):undef(e);}
napi_value retire(napi_env e,napi_callback_info i){auto*b=box(e,i);if(!b)return nullptr;qualification_retire(b->root);return undef(e);}
napi_value join(napi_env e,napi_callback_info i){auto*b=box(e,i);if(!b)return nullptr;return qualification_join(b->root)?fail(e,"DESKTOP_GRANT_NATIVE_ROOT_JOIN_PENDING"):undef(e);}
napi_value close(napi_env e,napi_callback_info i){auto*b=box(e,i);if(!b)return nullptr;return qualification_close(b->root)?fail(e,"DESKTOP_GRANT_NATIVE_ROOT_CLOSE_PENDING"):undef(e);}
napi_value closed(napi_env e,napi_callback_info i){auto*b=box(e,i);return b?boolean(e,qualification_closed(b->root)):nullptr;}
napi_value json(napi_env e,napi_callback_info i){void*d=nullptr;auto*b=box(e,i,&d);if(!b)return nullptr;std::string raw;if(qualification_json(b->root,(const char*)d,raw))return fail(e,"DESKTOP_GRANT_NATIVE_ORIGINAL_DATA_NOT_CURRENT");napi_value g=nullptr,j=nullptr,parse=nullptr,out=nullptr,arg=str(e,raw);if(napi_get_global(e,&g)!=napi_ok||napi_get_named_property(e,g,"JSON",&j)!=napi_ok||napi_get_named_property(e,j,"parse",&parse)!=napi_ok||napi_call_function(e,j,parse,1,&arg,&out)!=napi_ok)return nullptr;return out;}
napi_value module(napi_env e,napi_callback_info i){void*d=nullptr;auto*b=box(e,i,&d);if(!b)return nullptr;std::string p;if(qualification_module(b->root,d!=nullptr,p))return fail(e,"DESKTOP_GRANT_NATIVE_FIXED_MODULE_NOT_CURRENT");return str(e,p);}
napi_value resourceModule(napi_env e,napi_callback_info i){auto*b=box(e,i);if(!b)return nullptr;std::string p;if(qualification_task_read_module(b->root,p))return fail(e,"DESKTOP_GRANT_TASK_READ_FIXED_MODULE_NOT_CURRENT");return str(e,p);}
napi_value continuationModule(napi_env e,napi_callback_info i){auto*b=box(e,i);if(!b)return nullptr;std::string p;if(qualification_task_read_continuation_module(b->root,p))return fail(e,"DESKTOP_GRANT_TASK_READ_CONTINUATION_MODULE_NOT_CURRENT");return str(e,p);}
napi_value executors(napi_env e,napi_callback_info i){auto*b=box(e,i);if(!b)return nullptr;if(qualification_current(b->root))return fail(e,"DESKTOP_GRANT_NATIVE_ROOT_NOT_CURRENT");
 // No original resource executor is registered in this release. The actual
 // shared store/management/caller may initialize; an effect cannot select a
 // transport target or obtain a false empty receipt from this array.
 napi_value out=nullptr;napi_create_array_with_length(e,0,&out);return out;
}
void finalize(napi_env,void*p,void*){delete static_cast<Box*>(p);/*Qualification destructor parks physical debt, never auto-closes.*/}
napi_value rootFacade(napi_env e,const std::shared_ptr<Qualification>&root){napi_value o=nullptr;if(napi_create_object(e,&o)!=napi_ok)return nullptr;auto*b=new Box{root};if(napi_wrap(e,o,b,finalize,nullptr,nullptr)!=napi_ok){delete b;return nullptr;}if(napi_type_tag_object(e,o,&tag)!=napi_ok)return nullptr;
 napi_property_descriptor p[]={
 {"assertNativeCurrent",nullptr,current,nullptr,nullptr,nullptr,napi_default,nullptr},{"assertCurrent",nullptr,current,nullptr,nullptr,nullptr,napi_default,nullptr},{"assertNativeObservedCurrent",nullptr,observed,nullptr,nullptr,nullptr,napi_default,nullptr},
 {"readOriginalScopeDATA",nullptr,json,nullptr,nullptr,nullptr,napi_default,(void*)"scope"},{"readOriginalAuthorityBindingDATA",nullptr,json,nullptr,nullptr,nullptr,napi_default,(void*)"authority"},{"readOriginalCallerRegistrationDATA",nullptr,json,nullptr,nullptr,nullptr,napi_default,(void*)"caller"},{"readOriginalLINKRegistrationDATA",nullptr,json,nullptr,nullptr,nullptr,napi_default,(void*)"link"},
 {"readOriginalTaskReadAvailabilityDATA",nullptr,json,nullptr,nullptr,nullptr,napi_default,(void*)"task-read-availability"},{"readOriginalTaskReadMaterialDATA",nullptr,json,nullptr,nullptr,nullptr,napi_default,(void*)"task-read-material"},{"readOriginalTaskReadPeerDATA",nullptr,json,nullptr,nullptr,nullptr,napi_default,(void*)"task-read-peer"},{"readOriginalTaskReadTargetDATA",nullptr,json,nullptr,nullptr,nullptr,napi_default,(void*)"task-read-target"},{"readOriginalTaskReadClientModulePath",nullptr,resourceModule,nullptr,nullptr,nullptr,napi_default,nullptr},
 {"readOriginalTaskReadContinuationModulePath",nullptr,continuationModule,nullptr,nullptr,nullptr,napi_default,nullptr},
 {"readOriginalLINKModulePath",nullptr,module,nullptr,nullptr,nullptr,napi_default,(void*)1},{"readOriginalRegisteredTaskExecutors",nullptr,executors,nullptr,nullptr,nullptr,napi_default,nullptr},
 {"retire",nullptr,retire,nullptr,nullptr,nullptr,napi_default,nullptr},{"join",nullptr,join,nullptr,nullptr,nullptr,napi_default,nullptr},{"close",nullptr,close,nullptr,nullptr,nullptr,napi_default,nullptr},{"isClosed",nullptr,closed,nullptr,nullptr,nullptr,napi_default,nullptr}};
 if(napi_define_properties(e,o,sizeof(p)/sizeof(p[0]),p)!=napi_ok)return nullptr;napi_object_freeze(e,o);return o;
}
napi_value result(napi_env e,napi_value owner,bool failed,napi_value error){napi_value r=nullptr;napi_create_object(e,&r);if(!owner)napi_get_null(e,&owner);if(!error)napi_get_null(e,&error);if(!set(e,r,"owner",owner)||!set(e,r,"errorPresent",boolean(e,failed))||!set(e,r,"error",error))return nullptr;napi_object_freeze(e,r);return r;}
napi_value errorValue(napi_env e,const std::string&cause){napi_value msg=str(e,cause),v=nullptr;napi_create_error(e,nullptr,msg,&v);return v;}
napi_value requireFixed(napi_env e,const std::string&path){napi_value g=nullptr,process=nullptr,getBuiltin=nullptr,m=nullptr,id=str(e,"module"),create=nullptr,req=nullptr,arg=str(e,path),out=nullptr;
 if(napi_get_global(e,&g)!=napi_ok||napi_get_named_property(e,g,"process",&process)!=napi_ok||napi_get_named_property(e,process,"getBuiltinModule",&getBuiltin)!=napi_ok||napi_call_function(e,process,getBuiltin,1,&id,&m)!=napi_ok||napi_get_named_property(e,m,"createRequire",&create)!=napi_ok||napi_call_function(e,m,create,1,&arg,&req)!=napi_ok)return nullptr;
 napi_value cache=nullptr;bool present=false;if(napi_get_named_property(e,req,"cache",&cache)!=napi_ok||napi_has_named_property(e,cache,path.c_str(),&present)!=napi_ok)return nullptr;if(present)return fail(e,"DESKTOP_GRANT_PRIVATE_BOOTSTRAP_PRELOADED");
 if(napi_call_function(e,undef(e),req,1,&arg,&out)!=napi_ok)return nullptr;return out;
}
napi_value acquire(napi_env e,napi_callback_info info){size_t n=1;napi_value argv[1];if(napi_get_cb_info(e,info,&n,argv,nullptr,nullptr)!=napi_ok||n)return fail(e,"GRANT_SOURCE_ZERO_INPUT_REQUIRED");
 napi_ref cached=nullptr;{std::lock_guard<std::mutex>lock(acquisitionsMutex);auto found=originalAcquisitions.find(e);if(found!=originalAcquisitions.end())cached=found->second;}if(cached){napi_value same=nullptr;if(napi_get_reference_value(e,cached,&same)==napi_ok)return same;return fail(e,"DESKTOP_GRANT_ORIGINAL_ACQUISITION_LOST");}
 const auto remember=[e](napi_value r){if(r){napi_ref ref=nullptr;if(napi_create_reference(e,r,1,&ref)==napi_ok){{std::lock_guard<std::mutex>lock(acquisitionsMutex);originalAcquisitions.emplace(e,ref);}napi_add_env_cleanup_hook(e,forgetEnvironment,e);}}return r;};
 try{auto a=acquire_original_qualification((const void*)&acquire);napi_value partial=a.owner?rootFacade(e,a.owner):nullptr;if(a.error_present||!a.owner)return remember(result(e,partial,true,errorValue(e,a.cause.empty()?"DESKTOP_GRANT_NATIVE_SOURCE_NOT_SUPPLIED":a.cause)));
  if(!partial)return nullptr;std::string path;if(qualification_module(a.owner,false,path))return remember(result(e,partial,true,errorValue(e,"DESKTOP_GRANT_BOOTSTRAP_MODULE_NOT_SUPPLIED")));
  napi_value m=requireFixed(e,path),fn=nullptr,backend=nullptr;
  if(m&&napi_get_named_property(e,m,"createOriginalTaskGrantNativeBackend",&fn)==napi_ok&&napi_call_function(e,m,fn,1,&partial,&backend)==napi_ok&&backend)return remember(result(e,backend,false,nullptr));
  bool pending=false;napi_is_exception_pending(e,&pending);napi_value cause=nullptr;if(pending)napi_get_and_clear_last_exception(e,&cause);else cause=errorValue(e,"DESKTOP_GRANT_NATIVE_COMPOSITION_NOT_SUPPLIED");return remember(result(e,partial,true,cause));
 }catch(...){return result(e,nullptr,true,errorValue(e,"DESKTOP_GRANT_NATIVE_CPP_EXCEPTION"));}
}
}
void RegisterOriginalTaskGrantAuthorityBackendV1(napi_env e,napi_value exports){napi_value fn=nullptr;if(napi_create_function(e,"acquireOriginalTaskGrantAuthorityBackendV1",NAPI_AUTO_LENGTH,acquire,nullptr,&fn)==napi_ok)napi_set_named_property(e,exports,"acquireOriginalTaskGrantAuthorityBackendV1",fn);}
