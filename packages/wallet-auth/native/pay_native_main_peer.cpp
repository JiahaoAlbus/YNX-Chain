#include "pay_native_main_peer_private.hpp"
#include <cstring>
#include <cmath>

namespace ynx::wallet::pay {
namespace {
napi_value undefined(napi_env e){napi_value v;napi_get_undefined(e,&v);return v;}
napi_value get(napi_env e,napi_value o,const char*k){napi_value v;if(napi_get_named_property(e,o,k,&v)!=napi_ok)throw Failure{"PAY_MAIN_PROPERTY"};return v;}
bool isnull(napi_env e,napi_value v){napi_valuetype t;return napi_typeof(e,v,&t)==napi_ok&&t==napi_null;}
bool same(napi_env e,napi_value a,napi_value b){bool yes=false;return napi_strict_equals(e,a,b,&yes)==napi_ok&&yes;}
void keep(napi_env e,napi_value v,napi_ref&r){if(napi_create_reference(e,v,1,&r)!=napi_ok)throw Failure{"PAY_MAIN_REFERENCE"};}
napi_value ref(napi_env e,napi_ref r){napi_value v;if(!r||napi_get_reference_value(e,r,&v)!=napi_ok)throw Failure{"PAY_MAIN_REFERENCE"};return v;}
void exact8(napi_env e,napi_value o){napi_value names;uint32_t n=0;if(napi_get_all_property_names(e,o,napi_key_own_only,napi_key_all_properties,napi_key_numbers_to_strings,&names)!=napi_ok||napi_get_array_length(e,names,&n)!=napi_ok||n!=8)throw Failure{"PAY_MAIN_SNAPSHOT_KEYS"};for(const char*k:{"purpose","request","permission","capsule","borrow","original","target","signedMember"}){napi_value key;bool own=false;napi_create_string_utf8(e,k,NAPI_AUTO_LENGTH,&key);if(napi_has_own_property(e,o,key,&own)!=napi_ok||!own)throw Failure{"PAY_MAIN_SNAPSHOT_KEYS"};}}
std::string text(napi_env e,napi_value v){napi_valuetype t;size_t n=0;if(napi_typeof(e,v,&t)!=napi_ok||t!=napi_string||napi_get_value_string_utf8(e,v,nullptr,0,&n)!=napi_ok||n>32)throw Failure{"PAY_MAIN_PURPOSE"};std::string s(n,'\0');napi_get_value_string_utf8(e,v,s.data(),n+1,&n);return s;}
std::string field(napi_env e,napi_value o,const char*k,size_t max){auto v=get(e,o,k);napi_valuetype t;size_t n=0;if(napi_typeof(e,v,&t)!=napi_ok||t!=napi_string||napi_get_value_string_utf8(e,v,nullptr,0,&n)!=napi_ok||n>max)throw Failure{"PAY_MAIN_BINDING_DATA"};std::string s(n,'\0');napi_get_value_string_utf8(e,v,s.data(),n+1,&n);if(s.find('\0')!=std::string::npos)throw Failure{"PAY_MAIN_BINDING_DATA"};return s;}
Binding binding(napi_env e,napi_value original,napi_value target){auto typed=get(e,original,"typed");Binding b{field(e,typed,"networkId",64),field(e,original,"account",42),field(e,original,"hash",66),field(e,typed,"memberHash",66),field(e,original,"operationId",128),{}};auto&t=b.target;napi_value names;uint32_t count=0;if(napi_get_all_property_names(e,target,napi_key_own_only,napi_key_all_properties,napi_key_numbers_to_strings,&names)!=napi_ok||napi_get_array_length(e,names,&count)!=napi_ok||count!=7)throw Failure{"PAY_MAIN_TARGET_KEYS"};double version;if(napi_get_value_double(e,get(e,target,"version"),&version)!=napi_ok||version!=1)throw Failure{"PAY_MAIN_TARGET_VERSION"};t.service=field(e,target,"service",8);auto kind=field(e,target,"kind",32);if(kind=="invoice_terms")t.kind=Kind::terms;else if(kind=="invoice_settle")t.kind=Kind::settlement;else if(kind=="invoice_refund")t.kind=Kind::refund;else throw Failure{"PAY_MAIN_TARGET_KIND"};for(auto item:{std::pair<const char*,std::optional<std::string>*>{"intentId",&t.intent_id},{"merchant",&t.merchant},{"invoiceId",&t.invoice_id}}){auto value=get(e,target,item.first);if(!isnull(e,value))*item.second=field(e,target,item.first,64);}t.request_path=field(e,target,"requestPath",256);validate_binding(b);return b;}
std::vector<uint8_t>copy_member(napi_env e,napi_value v){bool typed=false;if(napi_is_typedarray(e,v,&typed)!=napi_ok||!typed)throw Failure{"PAY_MAIN_MEMBER"};napi_typedarray_type kind;size_t length=0,offset=0;void*data=nullptr;napi_value backing;if(napi_get_typedarray_info(e,v,&kind,&length,&data,&backing,&offset)!=napi_ok||kind!=napi_uint8_array||!data||!length||length>98304)throw Failure{"PAY_MAIN_MEMBER"};bool ab=false,detached=false;if(napi_is_arraybuffer(e,backing,&ab)!=napi_ok||!ab||napi_is_detached_arraybuffer(e,backing,&detached)!=napi_ok||detached)throw Failure{"PAY_MAIN_MEMBER_BACKING"};std::vector<uint8_t>out(length);std::memcpy(out.data(),data,length);return out;}
std::vector<uint8_t>copy_original_wire(napi_env e,napi_value original){
 auto value=get(e,original,"wire");napi_valuetype type;size_t n=0;
 if(napi_typeof(e,value,&type)!=napi_ok||type!=napi_string||napi_get_value_string_utf8(e,value,nullptr,0,&n)!=napi_ok||!n||n>262144||n%4==1)throw Failure{"PAY_MAIN_ORIGINAL_WIRE"};
 std::string wire(n,'\0');napi_get_value_string_utf8(e,value,wire.data(),n+1,&n);
 // Decode the existing public journal's canonical unpadded base64url. This is
 // only transport decoding, not a new Member/ABCI codec or signature verifier.
 std::vector<uint8_t>out;out.reserve(n*3/4);uint32_t bits=0;unsigned count=0;
 for(unsigned char c:wire){int v=c>='A'&&c<='Z'?c-'A':c>='a'&&c<='z'?c-'a'+26:c>='0'&&c<='9'?c-'0'+52:c=='-'?62:c=='_'?63:-1;if(v<0)throw Failure{"PAY_MAIN_ORIGINAL_WIRE"};bits=(bits<<6)|static_cast<uint32_t>(v);count+=6;if(count>=8){count-=8;out.push_back(static_cast<uint8_t>(bits>>count));}}
 if((count&&(bits&((1u<<count)-1u)))||out.empty()||out.size()>196608)throw Failure{"PAY_MAIN_ORIGINAL_WIRE"};return out;
}
}
MainPeerLoan::MainPeerLoan(napi_env e,const std::shared_ptr<MainNativeEpoch>&epoch):env_(e),actor_(std::this_thread::get_id()),epoch_(epoch){}
void MainPeerLoan::actor()const{if(actor_!=std::this_thread::get_id())throw Failure{"PAY_MAIN_ACTOR"};}
void MainPeerLoan::remember_pending(){bool pending=false;napi_is_exception_pending(env_,&pending);if(!pending)return;napi_value cause;napi_get_and_clear_last_exception(env_,&cause);if(first_)return;napi_value box;napi_create_object(env_,&box);napi_set_named_property(env_,box,"cause",cause);keep(env_,box,first_);}
napi_value MainPeerLoan::original_failure(){actor();return get(env_,ref(env_,first_),"cause");}
napi_value MainPeerLoan::peer(){actor();return ref(env_,peer_);}
napi_value MainPeerLoan::call(const char*name){actor();napi_value p=peer(),fn=get(env_,p,name),out;napi_valuetype t;if(napi_typeof(env_,fn,&t)!=napi_ok||t!=napi_function)throw Failure{"PAY_MAIN_METHOD"};if(napi_call_function(env_,p,fn,0,nullptr,&out)!=napi_ok){remember_pending();throw Failure{"PAY_MAIN_ORIGINAL_FAILURE"};}return out;}
void MainPeerLoan::capture(napi_env e,napi_value ns,napi_value request,napi_value original,napi_value target,const std::shared_ptr<MainNativeEpoch>&epoch,std::unique_ptr<MainPeerLoan>*out){
 if(!out)throw Failure{"PAY_MAIN_OUTPUT"};out->reset();if(!epoch)throw Failure{"PAY_MAIN_EPOCH_REQUIRED"};
 struct FailRetire{std::shared_ptr<MainNativeEpoch>epoch;bool success=false;~FailRetire(){if(!success)epoch->retire();}}guard{epoch};
 auto owner=std::unique_ptr<MainPeerLoan>(new MainPeerLoan(e,epoch));*out=std::move(owner);auto*p=out->get();keep(e,ns,p->namespace_);
 napi_value capture=get(e,ns,"captureOriginalWalletPayContextForNative"),peerValue=nullptr;
 if(napi_call_function(e,ns,capture,0,nullptr,&peerValue)!=napi_ok){
  // Adopt the same private nonnull partial before interpreting its original
  // error. Never replace a false/0/null/undefined cause with a generic success.
  bool pending=false;napi_is_exception_pending(e,&pending);if(pending){napi_value error;napi_get_and_clear_last_exception(e,&error);napi_value key;bool own=false;napi_create_string_utf8(e,"partial",NAPI_AUTO_LENGTH,&key);napi_has_own_property(e,error,key,&own);if(own){auto partial=get(e,error,"partial");if(!isnull(e,partial)){napi_valuetype t;napi_typeof(e,partial,&t);if(t==napi_object)keep(e,partial,p->peer_);}}napi_value box;napi_create_object(e,&box);napi_set_named_property(e,box,"cause",error);keep(e,box,p->first_);}throw Failure{"PAY_MAIN_CAPTURE_FAILED"};
 }
 keep(e,peerValue,p->peer_);
 napi_value recognizer=get(e,ns,"isOriginalWalletPayContextForNative"),yes;bool recognized=false;
 if(napi_call_function(e,ns,recognizer,1,&peerValue,&yes)!=napi_ok){p->remember_pending();throw Failure{"PAY_MAIN_RECOGNITION_FAILED"};}
 if(napi_get_value_bool(e,yes,&recognized)!=napi_ok||!recognized)throw Failure{"PAY_MAIN_ORIGINAL_PEER_REQUIRED"};
 p->assert_actor_current();auto snapshot=p->call("readOriginal");exact8(e,snapshot);
 const bool query=isnull(e,request);if(text(e,get(e,snapshot,"purpose"))!=(query?"query":"broadcast")||!same(e,get(e,snapshot,"request"),request)||!(binding(e,get(e,snapshot,"original"),get(e,snapshot,"target"))==binding(e,original,target)))throw Failure{"PAY_MAIN_SAME_ORIGINAL_REQUIRED"};
 for(const char*k:{"permission","capsule","borrow"}){auto v=get(e,snapshot,k);napi_valuetype type;napi_typeof(e,v,&type);if(query?!isnull(e,v):type!=napi_object||isnull(e,v))throw Failure{"PAY_MAIN_PURPOSE_AUTHORITY"};}
 p->member_=copy_member(e,get(e,snapshot,"signedMember"));p->envelope_=copy_original_wire(e,get(e,snapshot,"original"));keep(e,snapshot,p->snapshot_);p->assert_actor_current();guard.success=true;
}
void MainPeerLoan::assert_actor_current(){actor();try{if(closed_||!epoch_->current())throw Failure{"PAY_MAIN_RETIRED"};if(!same(env_,call("assertCurrent"),undefined(env_)))throw Failure{"PAY_MAIN_CURRENT_RESULT"};if(snapshot_){auto actual=call("readOriginal");if(!same(env_,actual,ref(env_,snapshot_))||copy_member(env_,get(env_,actual,"signedMember"))!=member_)throw Failure{"PAY_MAIN_ORIGINAL_CHANGED"};}if(!epoch_->current())throw Failure{"PAY_MAIN_RETIRED"};}catch(...){retire_native();throw;}}
void MainPeerLoan::claim_original_child(){assert_actor_current();if(claimed_)throw Failure{"PAY_MAIN_CLAIM_ONCE"};claimed_=true;if(!same(env_,call("claim"),undefined(env_)))throw Failure{"PAY_MAIN_CLAIM_RESULT"};assert_actor_current();}
void MainPeerLoan::associate_original_native_owner(napi_value owner){actor();try{assert_actor_current();auto ns=ref(env_,namespace_),p=peer();napi_value deadlineFn=get(env_,ns,"copyOriginalWalletPayNativeDeadline"),deadline;if(napi_call_function(env_,ns,deadlineFn,1,&p,&deadline)!=napi_ok){remember_pending();throw Failure{"PAY_MAIN_DEADLINE_NOT_SUPPLIED"};}napi_value keys;uint32_t count=0;double milliseconds=0;if(napi_get_all_property_names(env_,deadline,napi_key_own_only,napi_key_all_properties,napi_key_numbers_to_strings,&keys)!=napi_ok||napi_get_array_length(env_,keys,&count)!=napi_ok||count!=1||napi_get_value_double(env_,get(env_,deadline,"expiresAtMs"),&milliseconds)!=napi_ok||!std::isfinite(milliseconds)||milliseconds<1||milliseconds>9007199254740991.0||std::floor(milliseconds)!=milliseconds||!epoch_->shorten_original_unix_ms(static_cast<int64_t>(milliseconds)))throw Failure{"PAY_MAIN_ORIGINAL_DEADLINE"};napi_value association=get(env_,ns,"associateOriginalWalletPayNativeRetirement"),args[]={p,owner},result;if(napi_call_function(env_,ns,association,2,args,&result)!=napi_ok){remember_pending();throw Failure{"PAY_MAIN_ASSOCIATION_FAILED"};}if(!same(env_,result,undefined(env_)))throw Failure{"PAY_MAIN_ASSOCIATION_RESULT"};assert_actor_current();}catch(...){retire_native();throw;}}
napi_value MainPeerLoan::recheck_actor(){assert_actor_current();return call("recheck");}
void MainPeerLoan::retire_native()noexcept{if(epoch_)epoch_->retire();}
void MainPeerLoan::retire_actor(){actor();retire_native();if(peer_)call("retire");}
napi_value MainPeerLoan::join_actor(){actor();retire_native();return call("join");}
napi_value MainPeerLoan::close_actor(){actor();retire_native();return call("close");}
void MainPeerLoan::acknowledge_closed_actor(){actor();closed_=true;member_.clear();envelope_.clear();for(auto*r:{&peer_,&namespace_,&first_,&snapshot_})if(*r){napi_delete_reference(env_,*r);*r=nullptr;}}
MainPeerLoan::~MainPeerLoan(){retire_native();/* No JS/Join/Close at GC. Unconfirmed refs remain held, never silently release original custody. */}
}
