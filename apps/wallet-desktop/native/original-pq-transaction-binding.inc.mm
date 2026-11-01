// Main-only synchronous NAPI -> original Auth C exports. All seven calls stay
// on the same Node main thread. No async pool, DER, provider or IPC interface.
#include "pq-transaction/NativePQCustody.h"
static bool PQTXArgs(napi_env env,napi_callback_info info,size_t want,napi_value *out){
 size_t count=want+1;napi_value a[10];if(want>8||napi_get_cb_info(env,info,&count,a,nullptr,nullptr)!=napi_ok||count!=want)return false;for(size_t i=0;i<want;i++)out[i]=a[i];return true;
}
static bool PQTXBytes(napi_env env,napi_value value,size_t max,const uint8_t **bytes,size_t *length){
 bool buffer=false,ordinary=false;void*p=nullptr,*view=nullptr;napi_value backing;napi_typedarray_type type;size_t elements,offset;
 return napi_is_buffer(env,value,&buffer)==napi_ok&&buffer&&napi_get_typedarray_info(env,value,&type,&elements,&view,&backing,&offset)==napi_ok&&napi_is_arraybuffer(env,backing,&ordinary)==napi_ok&&ordinary&&napi_get_buffer_info(env,value,&p,length)==napi_ok&&*length>0&&*length<=max&&((*bytes=(const uint8_t*)p)!=nullptr);
}
static bool PQTXID(napi_env env,napi_value value,uint64_t *id){bool exact=false;return napi_get_value_bigint_uint64(env,value,id,&exact)==napi_ok&&exact&&*id!=0;}
static bool PQTXInt(napi_env env,napi_value result,const char*key,int32_t number){napi_value v;return napi_create_int32(env,number,&v)==napi_ok&&napi_set_named_property(env,result,key,v)==napi_ok;}
static napi_value PQTXOpen(napi_env env,napi_callback_info info){
 napi_value a[3],result;if(!PQTXArgs(env,info,3,a))return Error(env,"PQ_NATIVE_ARGUMENTS_INVALID");
 const uint8_t *wire,*credential,*binding;size_t wn,cn,bn;
 if(!PQTXBytes(env,a[0],196608,&wire,&wn)||!PQTXBytes(env,a[1],43,&credential,&cn)||cn!=43||!PQTXBytes(env,a[2],8192,&binding,&bn))return Error(env,"PQ_NATIVE_ARGUMENTS_INVALID");
 if(napi_create_object(env,&result)!=napi_ok)return nullptr;
 uint64_t id=0;int32_t code=ynx_auth_pq_native_open_v1(wire,wn,credential,cn,binding,bn,1,&id);
 napi_value value;if(napi_create_bigint_uint64(env,id,&value)!=napi_ok||napi_set_named_property(env,result,"ownerId",value)!=napi_ok||!PQTXInt(env,result,"status",code)){
  if(id){ynx_auth_pq_native_retire_v1(id);ynx_auth_pq_native_close_v1(id);ynx_auth_pq_native_release_closed_v1(id);}return nullptr;
 }
 return result;
}
static napi_value PQTXCopyResult(napi_env env,uint64_t id,int32_t callStatus){
 std::vector<uint8_t> bytes(98304);size_t length=0;int32_t status=-1;uint32_t cleanup=0,selected=0;
 int32_t copied=ynx_auth_pq_native_copy_outcome_v1(id,bytes.data(),bytes.size(),&length,&status,&cleanup,&selected);
 if(length>bytes.size())return Error(env,"PQ_NATIVE_PUBLIC_OUTPUT_BOUNDS");
 napi_value result,member,flag;if(napi_create_object(env,&result)!=napi_ok||!PQTXInt(env,result,"callStatus",callStatus)||!PQTXInt(env,result,"copyStatus",copied)||!PQTXInt(env,result,"primitiveStatus",status)||!PQTXInt(env,result,"cleanupStatus",(int32_t)cleanup)||napi_get_boolean(env,selected==1,&flag)!=napi_ok||napi_set_named_property(env,result,"selected",flag)!=napi_ok||napi_create_buffer_copy(env,length,bytes.data(),nullptr,&member)!=napi_ok||napi_set_named_property(env,result,"member",member)!=napi_ok)return nullptr;
 return result;
}
static napi_value PQTXOnce(napi_env env,napi_callback_info info){
 napi_value a[6];uint64_t id,chain;const uint8_t *message,*policy,*version,*height;size_t mn,pn,vn,hn;
 if(!PQTXArgs(env,info,6,a)||!PQTXID(env,a[0],&id)||!PQTXID(env,a[3],&chain)||!PQTXBytes(env,a[1],8192,&message,&mn)||!PQTXBytes(env,a[2],8388608,&policy,&pn)||!PQTXBytes(env,a[4],20,&version,&vn)||!PQTXBytes(env,a[5],20,&height,&hn))return Error(env,"PQ_NATIVE_ARGUMENTS_INVALID");
 int32_t code=ynx_auth_pq_native_transaction_once_v1(id,message,mn,policy,pn,chain,version,vn,height,hn);
 // Copy the same retained PUBLIC result even when sign reports an error. Main
 // must capture it before late permission/lock/UI checks. No sign retry.
 return PQTXCopyResult(env,id,code);
}
static napi_value PQTXCopy(napi_env env,napi_callback_info info){napi_value a[1];uint64_t id;if(!PQTXArgs(env,info,1,a)||!PQTXID(env,a[0],&id))return Error(env,"PQ_NATIVE_ARGUMENTS_INVALID");return PQTXCopyResult(env,id,0);}
static napi_value PQTXCapabilities(napi_env env,napi_callback_info info){napi_value a[1],result;if(!PQTXArgs(env,info,0,a))return Error(env,"PQ_NATIVE_ARGUMENTS_INVALID");if(napi_create_uint32(env,ynx_auth_pq_native_capabilities_v1(),&result)!=napi_ok)return nullptr;return result;}
static napi_value PQInitialOpen(napi_env env,napi_callback_info info){
 napi_value a[8],result;if(!PQTXArgs(env,info,8,a))return Error(env,"PQ_NATIVE_ARGUMENTS_INVALID");
 const uint8_t *wire,*credential,*binding,*message,*genesis,*pin,*height;size_t wn,cn,bn,mn,gn,pn,hn;uint64_t chain;
 if(!PQTXBytes(env,a[0],196608,&wire,&wn)||!PQTXBytes(env,a[1],43,&credential,&cn)||cn!=43||!PQTXBytes(env,a[2],8192,&binding,&bn)||!PQTXBytes(env,a[3],4096,&message,&mn)||!PQTXBytes(env,a[4],67108864,&genesis,&gn)||!PQTXBytes(env,a[5],32,&pin,&pn)||pn!=32||!PQTXID(env,a[6],&chain)||!PQTXBytes(env,a[7],20,&height,&hn))return Error(env,"PQ_NATIVE_ARGUMENTS_INVALID");
 if(napi_create_object(env,&result)!=napi_ok)return nullptr;
 uint64_t id=0;int32_t code=ynx_auth_pq_native_open_initial_v1(wire,wn,credential,cn,binding,bn,message,mn,genesis,gn,pin,pn,chain,height,hn,&id);
 napi_value value;if(napi_create_bigint_uint64(env,id,&value)!=napi_ok||napi_set_named_property(env,result,"ownerId",value)!=napi_ok||!PQTXInt(env,result,"status",code)){if(id){ynx_auth_pq_native_retire_v1(id);ynx_auth_pq_native_close_v1(id);ynx_auth_pq_native_release_closed_v1(id);}return nullptr;}return result;
}
static napi_value PQInitialOnce(napi_env env,napi_callback_info info){napi_value a[1];uint64_t id;if(!PQTXArgs(env,info,1,a)||!PQTXID(env,a[0],&id))return Error(env,"PQ_NATIVE_ARGUMENTS_INVALID");return PQTXCopyResult(env,id,ynx_auth_pq_native_account_initial_once_v1(id));}
template<int32_t (*Call)(uint64_t)>static napi_value PQTXStatus(napi_env env,napi_callback_info info){napi_value a[1],result;uint64_t id;if(!PQTXArgs(env,info,1,a)||!PQTXID(env,a[0],&id))return Error(env,"PQ_NATIVE_ARGUMENTS_INVALID");if(napi_create_int32(env,Call(id),&result)!=napi_ok)return nullptr;return result;}
static bool RegisterOriginalPQTransaction(napi_env env,napi_value exports){
 struct Entry{const char*name;napi_callback callback;};
 Entry rows[]={{"originalPQOpen",PQTXOpen},{"originalPQCurrent",PQTXStatus<ynx_auth_pq_native_current_v1>},{"originalPQRetire",PQTXStatus<ynx_auth_pq_native_retire_v1>},{"originalPQTransactionOnce",PQTXOnce},{"originalPQCopyOutcome",PQTXCopy},{"originalPQClose",PQTXStatus<ynx_auth_pq_native_close_v1>},{"originalPQReleaseClosed",PQTXStatus<ynx_auth_pq_native_release_closed_v1>},{"originalPQCapabilities",PQTXCapabilities},{"originalPQOpenInitial",PQInitialOpen},{"originalPQInitialOnce",PQInitialOnce}};
 for(auto&r:rows){napi_property_descriptor d={r.name,nullptr,r.callback,nullptr,nullptr,nullptr,napi_default,nullptr};if(napi_define_properties(env,exports,1,&d)!=napi_ok)return false;}return true;
}
