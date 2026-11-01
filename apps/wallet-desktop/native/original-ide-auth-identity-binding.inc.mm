// Included only in the ORIGINAL Native addon after kernel/IDE helpers.
// Availability of request callbacks is NOT Source/current/Root/permission.
// No JS-supplied callbacks, module objects, Source, paths or expected clock.
#include <array>
#include <new>
#include <pthread.h>
struct OriginalIDEAuthCallback {
 const char *name;
 napi_callback callback=nullptr;
 void *data=nullptr;
};
struct OriginalIDEAuthCallbacks {
 napi_env env=nullptr;bool retired=false;
 std::array<OriginalIDEAuthCallback,3> rows{{
  {"receiveOriginalIDEIdentity",nullptr,nullptr},
  {"recoverOriginalIDEIdentity",nullptr,nullptr},
  {"acquireOriginalIDEProtectedKeyCall",nullptr,nullptr}}};
 bool complete()const{for(const auto &r:rows)if(!r.callback)return false;return true;}
};
static void OriginalIDEAuthBindingCleanup(void *raw){delete static_cast<OriginalIDEAuthCallbacks *>(raw);}
static napi_value OriginalIDEAuthBinding(napi_env env,napi_callback_info info){
 size_t count=0;void *raw=nullptr;
 if(napi_get_cb_info(env,info,&count,nullptr,nullptr,&raw)!=napi_ok||count!=1)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto *table=static_cast<OriginalIDEAuthCallbacks *>(raw);
 if(!table||table->env!=env||table->retired)return Error(env,"AUTH_IDENTITY_NATIVE_BINDING_RETIRED");
 if(!pthread_main_np()||getuid()!=geteuid()||getgid()!=getegid())return Error(env,"AUTH_IDENTITY_NATIVE_BINDING_PROCESS_REQUIRED");
 napi_value argument;count=1;if(napi_get_cb_info(env,info,&count,&argument,nullptr,nullptr)!=napi_ok)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 size_t bytes=0;if(napi_get_value_string_utf8(env,argument,nullptr,0,&bytes)!=napi_ok||!bytes||bytes>8192)return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
 std::string input(bytes+1,'\0');size_t written=0;
 if(napi_get_value_string_utf8(env,argument,input.data(),input.size(),&written)!=napi_ok||written!=bytes||memchr(input.data(),0,bytes))return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
 NSString *entry=[[NSString alloc]initWithBytes:input.data() length:bytes encoding:NSUTF8StringEncoding];
 if(!entry)return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
 try{
  // The same original kernel code checks signed parent bundle, actual Node
  // executable and REAL argc/argv. JS process.argv or object shape is not it.
  NSString *resources=ynx_auth_ide_private::actualNodeParentResources();
  if(!ynx_auth_ide_private::actualNodeEntry(resources,entry))return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
 }catch(const std::exception &){return Error(env,"IDE_NODE_ACTUAL_PARENT_ENTRY_UNAVAILABLE");}
 if(!table->complete()){napi_value absent;if(napi_get_null(env,&absent)!=napi_ok)return nullptr;return absent;}
 napi_value result;if(napi_create_object(env,&result)!=napi_ok)return Error(env,"AUTH_IDENTITY_NATIVE_BINDING_OBJECT_UNAVAILABLE");
 for(const auto &row:table->rows){
  // These addresses/data came from the immutable compiled Native Method[]
  // registry, NEVER properties on a possibly extensible JS module object.
  napi_property_descriptor p={row.name,nullptr,row.callback,nullptr,nullptr,nullptr,napi_default,row.data};
  if(napi_define_properties(env,result,1,&p)!=napi_ok)return Error(env,"AUTH_IDENTITY_NATIVE_BINDING_DEFINITION_UNKNOWN");
 }
 if(napi_object_freeze(env,result)!=napi_ok)return Error(env,"AUTH_IDENTITY_NATIVE_BINDING_FREEZE_UNKNOWN");
 return result;
}
template<class Method,std::size_t N>
static napi_value RegisterOriginalIDEAuthIdentityBinding(napi_env env,napi_value exports,const Method(&methods)[N]){
 auto *table=new(std::nothrow) OriginalIDEAuthCallbacks;
 if(!table)return Error(env,"AUTH_IDENTITY_NATIVE_BINDING_CAPACITY");table->env=env;
 for(const auto &method:methods)for(auto &row:table->rows)if(!strcmp(row.name,method.name)){
  if(row.callback||!method.callback){delete table;return Error(env,"AUTH_IDENTITY_NATIVE_BINDING_DUPLICATE");}
  row.callback=method.callback;row.data=method.data;
 }
 if(napi_add_env_cleanup_hook(env,OriginalIDEAuthBindingCleanup,table)!=napi_ok){delete table;return Error(env,"AUTH_IDENTITY_NATIVE_BINDING_CLEANUP_UNAVAILABLE");}
 napi_property_descriptor p={"getOriginalIDENativeAuthBinding",nullptr,OriginalIDEAuthBinding,nullptr,nullptr,nullptr,napi_default,table};
 if(napi_define_properties(env,exports,1,&p)!=napi_ok){table->retired=true;return Error(env,"AUTH_IDENTITY_NATIVE_BINDING_REGISTER_UNKNOWN");}
 // The three actual constructors are still unfinished. Therefore the current
 // original Method[] yields genuine null availability, not fake successful
 // owners, old private-parent operations, or callback stubs. When the real
 // owning callbacks are added to that SAME table, this collector binds them.
 return exports;
}
