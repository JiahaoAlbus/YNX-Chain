// Necessary Auth Native addon only; no IDE/Cloud product implementation.
// Root-selected public source/ledger/approval originals and key records remain
// distinct. All normal rows are EMPTY. No caller path/Root/signer constructor.
#include <node_api.h>
#include <memory>
#include <set>
#include <array>
#include <thread>
#include <vector>
#include <string>
#include "original-ide-deployment-v2-key-loan.cpp"
#include "original-ide-deployment-v2-call.h"
namespace {
struct NativeSourceRow{
 YNXIDEDeploymentV2LoanContext context;
 FilePin source_input,publisher,issuer,project,resource,approval,expected_payload,payload_bind,artifact_bind;
 std::array<uint8_t,32>network;std::string subject;
 std::array<uint8_t,2592>expected_pk_a;std::array<uint8_t,64>expected_pk_b;
};
const std::array<NativeSourceRow,0>&native_rows(){static const std::array<NativeSourceRow,0>rows{};return rows;}
struct NativeOwner{
 napi_env env;const NativeSourceRow*row;std::thread::id thread=std::this_thread::get_id();std::array<ProtectedOriginal,9>public_files;std::string current;YNXIDEDeploymentV2KeyLoan*loan=nullptr;YNXSourceDeploymentV2Call*call=nullptr;bool retired=false,close_selected=false;int first=0,close_first=0;
 NativeOwner(napi_env e,const NativeSourceRow*r):env(e),row(r){}
 int remember(int rc){if(rc&&!first)first=rc;return first?first:rc;}
 int local_current(){if(thread!=std::this_thread::get_id()||retired||close_selected)return CLOSED;if(first)return first;if(wall()<row->context.not_before_ms||wall()>=row->context.expires_ms)return remember(EXPIRED);for(auto&f:public_files){int rc=f.current();if(rc)return remember(rc);}if(loan){int rc=ynx_source_ide_deployment_v2_key_loan_current(loan,&row->context);if(rc)return remember(rc);}return OK;}
 int open_public(){const std::array<FilePin,9>pins={row->source_input,row->publisher,row->issuer,row->project,row->resource,row->approval,row->expected_payload,row->payload_bind,row->artifact_bind};for(size_t i=0;i<pins.size();i++){const size_t maximum=i==0?393216:i<6?32768:i==6?16384:152;if(!pins[i].bytes||pins[i].bytes>maximum||(i>=7&&pins[i].bytes!=152))return remember(INVALID);int rc=public_files[i].open_original(pins[i],pins[i].bytes);if(rc)return remember(rc);}return local_current();}
 int close(){if(close_selected)return close_first;close_selected=true;retired=true;
  if(call){int rc=ynx_source_deployment_v2_call_close(call);if(rc&&!close_first)close_first=rc;}
  else if(loan){int rc=ynx_source_ide_deployment_v2_key_loan_close(loan);if(rc&&!close_first)close_first=rc;}
  // Keep the original Source/approval descriptors when key close is unknown.
  if(!close_first)for(auto i=public_files.rbegin();i!=public_files.rend();++i){int rc=i->close();if(rc&&!close_first)close_first=rc;}return close_first;
 }
};
std::set<NativeOwner*>owners,debt;
const napi_type_tag owner_tag={0x594e584944455632ULL,0x4b45594c4f414e32ULL};
napi_value undef(napi_env env){napi_value v;napi_get_undefined(env,&v);return v;}
napi_value number(napi_env env,int n){napi_value v;napi_create_int32(env,n,&v);return v;}
napi_value error(napi_env env,const char*code){napi_throw_error(env,code,code);return nullptr;}
bool args(napi_env env,napi_callback_info info,size_t count,napi_value*out){size_t n=count+1;std::vector<napi_value>v(n);if(napi_get_cb_info(env,info,&n,v.data(),nullptr,nullptr)!=napi_ok||n!=count)return false;for(size_t i=0;i<count;i++)out[i]=v[i];return true;}
NativeOwner*owner(napi_env env,napi_value v){bool tagged=false;void*p=nullptr;if(napi_check_object_type_tag(env,v,&owner_tag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,v,&p)!=napi_ok)return nullptr;auto*h=(NativeOwner*)p;return owners.count(h)&&h->env==env&&h->thread==std::this_thread::get_id()?h:nullptr;}
bool bytes(napi_env env,napi_value v,size_t max,std::vector<uint8_t>&out){bool typed=false,ordinary=false,detached=false;napi_typedarray_type type;size_t n=0,offset=0;void*p=nullptr;napi_value backing;if(napi_is_typedarray(env,v,&typed)!=napi_ok||!typed||napi_get_typedarray_info(env,v,&type,&n,&p,&backing,&offset)!=napi_ok||type!=napi_uint8_array||n>max||napi_is_arraybuffer(env,backing,&ordinary)!=napi_ok||!ordinary||napi_is_detached_arraybuffer(env,backing,&detached)!=napi_ok||detached||(n&&!p))return false;out=n?std::vector<uint8_t>((uint8_t*)p,(uint8_t*)p+n):std::vector<uint8_t>{};return true;}
bool text(napi_env env,napi_value v,size_t max,std::string&out){size_t n=0;if(napi_get_value_string_utf8(env,v,nullptr,0,&n)!=napi_ok||!n||n>max)return false;std::vector<char>b(n+1);size_t written=0;if(napi_get_value_string_utf8(env,v,b.data(),b.size(),&written)!=napi_ok||written!=n)return false;out.assign(b.data(),n);return true;}
napi_value string(napi_env env,const std::vector<uint8_t>&v){napi_value out;napi_create_string_utf8(env,(const char*)v.data(),v.size(),&out);return out;}
napi_value json(napi_env env,const std::vector<uint8_t>&v){napi_value global,JSON,parse,raw=string(env,v),out;napi_get_global(env,&global);if(napi_get_named_property(env,global,"JSON",&JSON)!=napi_ok||napi_get_named_property(env,JSON,"parse",&parse)!=napi_ok||napi_call_function(env,JSON,parse,1,&raw,&out)!=napi_ok)return nullptr;return out;}
napi_value status(napi_env env,int rc){napi_value out;napi_create_object(env,&out);napi_set_named_property(env,out,"status",number(env,rc));return out;}
void finalize(napi_env,void*p,void*){auto*h=(NativeOwner*)p;if(!owners.count(h))return;if(h->close()){debt.insert(h);return;}owners.erase(h);delete h;}
napi_value acquire(napi_env env,napi_callback_info info){if(!args(env,info,0,nullptr))return error(env,"IDE_DEPLOYMENT_V2_CALLER_FACTORY_FORBIDDEN");napi_value out=status(env,NOT_SUPPLIED),value;napi_get_null(env,&value);if(native_rows().empty()){napi_set_named_property(env,out,"owner",value);return out;}const auto*row=&native_rows()[0];auto*h=new(std::nothrow)NativeOwner(env,row);if(!h)return error(env,"IDE_DEPLOYMENT_V2_CAPACITY");owners.insert(h);napi_create_object(env,&value);napi_type_tag_object(env,value,&owner_tag);napi_wrap(env,value,h,finalize,nullptr,nullptr);napi_set_named_property(env,out,"owner",value);napi_set_named_property(env,out,"status",number(env,h->open_public()));return out;}
napi_value source_input(napi_env env,napi_callback_info info){napi_value a[1];if(!args(env,info,1,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);if(!h||h->local_current())return error(env,"IDE_DEPLOYMENT_V2_SOURCE_CURRENT");return json(env,h->public_files[0].bytes);}
napi_value registered(napi_env env,napi_callback_info info){napi_value a[1],out;if(!args(env,info,1,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);if(!h||h->local_current())return error(env,"IDE_DEPLOYMENT_V2_REGISTERED_CURRENT");napi_create_object(env,&out);const char*names[]={"publisherOriginal","issuerOriginal","projectOriginal","resourceOriginal","approvalOriginal"};for(size_t i=0;i<5;i++)napi_set_named_property(env,out,names[i],string(env,h->public_files[i+1].bytes));return out;}
napi_value retain_current(napi_env env,napi_callback_info info){napi_value a[2];if(!args(env,info,2,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);std::string raw;if(!h||h->local_current()||!text(env,a[1],393216,raw))return error(env,"IDE_DEPLOYMENT_V2_CURRENT_ORIGINAL");h->current=raw;return undef(env);}
napi_value current(napi_env env,napi_callback_info info){napi_value a[2];if(!args(env,info,2,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);if(!h)return number(env,INVALID);napi_value raw;std::string expected;if(napi_get_named_property(env,a[1],"sourceCurrentOriginal",&raw)!=napi_ok||!text(env,raw,393216,expected)||h->current!=expected)return number(env,h->remember(CHANGED));return number(env,h->local_current());}
napi_value capture_key(napi_env env,napi_callback_info info){napi_value a[3];if(!args(env,info,3,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);if(!h||h->local_current())return status(env,INVALID);std::vector<uint8_t>payload,artifact;if(!bytes(env,a[1],16384,payload)||payload.empty()||!bytes(env,a[2],67108864,artifact)||payload!=h->public_files[6].bytes)return status(env,h->remember(INVALID));
 int rc=ynx_source_ide_deployment_v2_key_loan_acquire(&h->row->context,&h->loan);if(rc)return status(env,h->remember(rc));
 const auto span=[](const std::vector<uint8_t>&v)->YNXArtifactBytesV1{return{v.empty()?nullptr:v.data(),v.size()};};const auto*r=h->row;
 YNXSourceDeploymentV2PublicOriginals in{span(payload),span(artifact),span(h->public_files[6].bytes),span(h->public_files[7].bytes),span(h->public_files[8].bytes),{r->network.data(),r->network.size()},{(const uint8_t*)r->subject.data(),r->subject.size()},{r->expected_pk_a.data(),r->expected_pk_a.size()},{r->expected_pk_b.data(),r->expected_pk_b.size()}};
 rc=ynx_source_deployment_v2_call_capture(h->loan,&r->context,&in,&h->call);return status(env,rc?h->remember(rc):h->local_current());
}
napi_value partial(napi_env env,NativeOwner*h,int rc){napi_value out=status(env,rc),member;std::vector<uint8_t>b(98304);size_t n=0;int32_t core=10;uint32_t cleanup=0;if(h&&h->call&&ynx_source_deployment_v2_call_copy_partial(h->call,b.data(),b.size(),&n,&core,&cleanup)==0){void*p=nullptr;napi_value backing;napi_create_arraybuffer(env,n,&p,&backing);if(n)memcpy(p,b.data(),n);napi_create_typedarray(env,napi_uint8_array,n,backing,0,&member);}else{void*p=nullptr;napi_value backing;napi_create_arraybuffer(env,0,&p,&backing);napi_create_typedarray(env,napi_uint8_array,0,backing,0,&member);}napi_set_named_property(env,out,"memberOriginal",member);napi_set_named_property(env,out,"coreStatus",number(env,core));napi_set_named_property(env,out,"cleanupStatus",number(env,cleanup));return out;}
napi_value invoke(napi_env env,napi_callback_info info){napi_value a[1];if(!args(env,info,1,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);if(!h||!h->call||h->local_current())return partial(env,h,INVALID);int rc=ynx_source_deployment_v2_call_invoke(h->call);return partial(env,h,rc?h->remember(rc):h->local_current());}
napi_value copy_partial(napi_env env,napi_callback_info info){napi_value a[1];if(!args(env,info,1,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);return partial(env,h,h?h->first:INVALID);}
napi_value retire(napi_env env,napi_callback_info info){napi_value a[1];if(!args(env,info,1,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);if(h){h->retired=true;if(h->call)ynx_source_deployment_v2_call_retire(h->call);else if(h->loan)ynx_source_ide_deployment_v2_key_loan_retire(h->loan);}return undef(env);}
napi_value join(napi_env env,napi_callback_info info){napi_value a[1];if(!args(env,info,1,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);return number(env,!h?INVALID:h->call?ynx_source_deployment_v2_call_join(h->call):h->loan?ynx_source_ide_deployment_v2_key_loan_join(h->loan):OK);}
napi_value close(napi_env env,napi_callback_info info){napi_value a[1];if(!args(env,info,1,a))return error(env,"IDE_DEPLOYMENT_V2_ARGS");auto*h=owner(env,a[0]);return number(env,h?h->close():INVALID);}
napi_value init(napi_env env,napi_value exports){const struct{const char*name;napi_callback fn;}rows[]={{"acquireOriginalIDEDeploymentV2",acquire},{"copyOriginalIDEDeploymentV2SourceInput",source_input},{"copyOriginalIDEDeploymentV2RegisteredOriginals",registered},{"retainOriginalIDEDeploymentV2SourceCurrent",retain_current},{"assertOriginalIDEDeploymentV2Current",current},{"captureOriginalIDEDeploymentV2ReleaseKey",capture_key},{"invokeOriginalIDEDeploymentV2E11",invoke},{"copyOriginalIDEDeploymentV2PublicPartial",copy_partial},{"retireOriginalIDEDeploymentV2",retire},{"joinOriginalIDEDeploymentV2",join},{"closeOriginalIDEDeploymentV2",close}};for(const auto&r:rows){napi_property_descriptor p={r.name,nullptr,r.fn,nullptr,nullptr,nullptr,napi_default,nullptr};if(napi_define_properties(env,exports,1,&p)!=napi_ok)return nullptr;}return exports;}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
