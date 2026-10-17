#include <node_api.h>
#include "original-host-dirfd-journal.h"
#include <unordered_set>

// Source-current SERVICE storage primitive only. This module never signs,
// admits a root/profile/client or returns a Native business capability.
namespace {
struct Owner {ynx_auth_private::HostDirfdJournal io;bool ready=false,closed=false,busy=false;std::string first;};
std::unordered_set<Owner *> owners,debt;
napi_value error(napi_env env,const char *code){napi_throw_error(env,code,code);return nullptr;}
napi_value undefined(napi_env env){napi_value v;napi_get_undefined(env,&v);return v;}
bool args(napi_env env,napi_callback_info info,size_t wanted,napi_value *out){size_t count=4;napi_value a[4];if(napi_get_cb_info(env,info,&count,a,nullptr,nullptr)!=napi_ok||count!=wanted)return false;for(size_t i=0;i<wanted;i++)out[i]=a[i];return true;}
bool text(napi_env env,napi_value value,size_t limit,std::string &out){size_t length=0;if(napi_get_value_string_utf8(env,value,nullptr,0,&length)!=napi_ok||length>limit)return false;out.assign(length+1,'\0');if(napi_get_value_string_utf8(env,value,out.data(),out.size(),&length)!=napi_ok)return false;out.resize(length);return out.find('\0')==std::string::npos;}
Owner *original(napi_env env,napi_value ref){void *ptr=nullptr;if(napi_unwrap(env,ref,&ptr)!=napi_ok)return nullptr;return owners.count((Owner *)ptr)?(Owner *)ptr:nullptr;}
void finalizer(napi_env,void *ptr,void *){auto *o=(Owner *)ptr;if(!owners.count(o)||o->busy||!o->io.close()){debt.insert(o);return;}owners.erase(o);debt.erase(o);delete o;}
napi_value open(napi_env env,napi_callback_info info){napi_value a[2];std::string parent,leaf;if(!args(env,info,2,a)||!text(env,a[0],4096,parent)||!text(env,a[1],255,leaf))return error(env,"AUTH_SOURCE_STATE_ARGUMENTS_INVALID");auto *o=new Owner;owners.insert(o);debt.insert(o);napi_value ref;napi_create_object(env,&ref);if(napi_wrap(env,ref,o,finalizer,nullptr,nullptr)!=napi_ok)return error(env,"AUTH_SOURCE_STATE_WRAP_UNKNOWN");try{o->io.open(parent,leaf);o->ready=true;}catch(const std::exception&e){o->first=e.what();}return ref;}
template<class Work>napi_value call(napi_env env,napi_callback_info info,size_t wanted,Work work){napi_value a[3];if(!args(env,info,wanted,a))return error(env,"AUTH_SOURCE_STATE_ARGUMENTS_INVALID");auto *o=original(env,a[0]);if(!o)return error(env,"AUTH_SOURCE_STATE_ORIGINAL_OWNER_REQUIRED");if(o->busy||!o->ready||o->closed||!o->first.empty())return error(env,o->first.empty()?"AUTH_SOURCE_STATE_UNRESOLVED":o->first.c_str());o->busy=true;try{o->io.assertCurrent();auto result=work(o,a);o->io.assertCurrent();o->busy=false;return result;}catch(const std::exception&e){if(o->first.empty())o->first=e.what();o->busy=false;return error(env,o->first.c_str());}}
napi_value ready(napi_env env,napi_callback_info info){return call(env,info,1,[&](Owner *,napi_value *){return undefined(env);});}
napi_value list(napi_env env,napi_callback_info info){return call(env,info,1,[&](Owner *o,napi_value *){auto names=o->io.list();napi_value a;napi_create_array_with_length(env,names.size(),&a);for(size_t i=0;i<names.size();i++){napi_value v;napi_create_string_utf8(env,names[i].data(),names[i].size(),&v);napi_set_element(env,a,i,v);}return a;});}
napi_value read(napi_env env,napi_callback_info info){return call(env,info,2,[&](Owner *o,napi_value *a){std::string name;if(!text(env,a[1],73,name))throw std::runtime_error("AUTH_SOURCE_STATE_RECORD_INVALID");auto raw=o->io.read(name);napi_value result;napi_create_string_utf8(env,raw.data(),raw.size(),&result);return result;});}
napi_value write(napi_env env,napi_callback_info info){return call(env,info,3,[&](Owner *o,napi_value *a){std::string name,raw;if(!text(env,a[1],73,name)||!text(env,a[2],8192,raw))throw std::runtime_error("AUTH_SOURCE_STATE_RECORD_INVALID");o->io.writeExclusive(name,raw);return undefined(env);});}
napi_value close(napi_env env,napi_callback_info info){napi_value a[1];if(!args(env,info,1,a))return error(env,"AUTH_SOURCE_STATE_ARGUMENTS_INVALID");auto *o=original(env,a[0]);if(!o||o->busy)return error(env,"AUTH_SOURCE_STATE_JOIN_PENDING");bool done=o->io.close();o->closed=done;if(!done)return error(env,"AUTH_SOURCE_STATE_CLOSE_UNKNOWN");debt.erase(o);return undefined(env);}
napi_value init(napi_env env,napi_value exports){struct E{const char *name;napi_callback method;};for(auto item:{E{"open",open},E{"ready",ready},E{"list",list},E{"read",read},E{"write",write},E{"close",close}}){napi_property_descriptor d={item.name,nullptr,item.method,nullptr,nullptr,nullptr,napi_default,nullptr};if(napi_define_properties(env,exports,1,&d)!=napi_ok)return nullptr;}return exports;}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
