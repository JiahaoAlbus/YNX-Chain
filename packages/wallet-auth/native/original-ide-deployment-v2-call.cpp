#include "original-ide-deployment-v2-call.h"
#include <array>
#include <vector>
#include <unordered_set>
#include <mutex>
#include <thread>
#include <cstring>
#include <new>
namespace {
enum:int{OK=0,INVALID=1,CLOSED=6,UNKNOWN=23};
std::mutex calls_mutex;std::unordered_set<YNXSourceDeploymentV2Call*>calls;
bool span(YNXArtifactBytesV1 s,size_t min,size_t max){return s.length>=min&&s.length<=max&&(!s.length||s.bytes);}
std::vector<uint8_t>copy(YNXArtifactBytesV1 s){return s.length?std::vector<uint8_t>(s.bytes,s.bytes+s.length):std::vector<uint8_t>{};}
uint32_t be32(const uint8_t*p){return(uint32_t(p[0])<<24)|(uint32_t(p[1])<<16)|(uint32_t(p[2])<<8)|uint32_t(p[3]);}
uint64_t be64(const uint8_t*p){uint64_t n=0;for(size_t i=0;i<8;i++)n=(n<<8)|p[i];return n;}
// Binding comparison only, not a second E11/Ref codec. Exact BindE3 comes from
// sole OPEN; the Core typed callee independently decodes/re-hashes it as well.
bool approved_bind(YNXArtifactBytesV1 b,const YNXIDEDeploymentV2LoanContext&c){return span(b,152,152)&&be32(b.bytes)==3&&be32(b.bytes+4)==8&&be64(b.bytes+8)==c.payload_bytes&&be32(b.bytes+16)==64&&be32(b.bytes+84)==64&&!memcmp(b.bytes+20,c.approved_payload_sha3_512,64)&&!memcmp(b.bytes+88,c.approved_payload_sha512,64);}
YNXArtifactBytesV1 view(const std::vector<uint8_t>&v){return{v.empty()?nullptr:v.data(),v.size()};}
}
struct YNXSourceDeploymentV2Call{
 YNXIDEDeploymentV2KeyLoan*loan;YNXIDEDeploymentV2LoanContext context;std::array<std::vector<uint8_t>,9>public_inputs;std::vector<uint8_t>member;std::thread::id thread=std::this_thread::get_id();bool entered=false,attempted=false,retired=false,close_selected=false;int first=0,close_first=0;int32_t core_status=YNX_ARTIFACT_INTERNAL_V1;uint32_t cleanup=YNX_ARTIFACT_CLEANUP_UNKNOWN_V1;
 YNXSourceDeploymentV2Call(YNXIDEDeploymentV2KeyLoan*l,const YNXIDEDeploymentV2LoanContext&c):loan(l),context(c){}
 int remember(int rc){if(rc&&!first)first=rc;return first?first:rc;}
 int current(){if(thread!=std::this_thread::get_id()||retired||close_selected)return CLOSED;if(first)return first;int rc=ynx_source_ide_deployment_v2_key_loan_current(loan,&context);return rc?remember(rc):OK;}
};
extern "C" int ynx_source_deployment_v2_call_capture(YNXIDEDeploymentV2KeyLoan*loan,const YNXIDEDeploymentV2LoanContext*context,const YNXSourceDeploymentV2PublicOriginals*in,YNXSourceDeploymentV2Call**out){
 if(!out)return INVALID;*out=nullptr;if(!loan||!context||!in)return INVALID;
 auto*p=new(std::nothrow)YNXSourceDeploymentV2Call(loan,*context);if(!p)return INVALID;{std::lock_guard<std::mutex>lock(calls_mutex);calls.insert(p);}*out=p; // retain partial BEFORE any Source/argument check
 int rc=p->current();if(rc)return rc;
 const std::array<YNXArtifactBytesV1,9>s={in->payload_original,in->actual_artifact,in->expected_payload_original,in->expected_payload_bind,in->expected_artifact_bind,in->profile_network_id,in->subject_owner,in->expected_pk_a,in->expected_pk_b};
 if(!span(s[0],1,16384)||!span(s[1],0,67108864)||!span(s[2],1,16384)||!span(s[3],152,152)||!span(s[4],152,152)||!span(s[5],32,32)||!span(s[6],1,128)||!span(s[7],2592,2592)||!span(s[8],64,64)||!approved_bind(s[3],*context))return p->remember(INVALID);
 try{for(size_t i=0;i<s.size();i++)p->public_inputs[i]=copy(s[i]);}catch(...){return p->remember(UNKNOWN);}return p->current();
}
extern "C" int ynx_source_deployment_v2_call_invoke(YNXSourceDeploymentV2Call*p){
 {std::lock_guard<std::mutex>lock(calls_mutex);if(!p||!calls.count(p)||p->thread!=std::this_thread::get_id()||p->entered||p->attempted)return INVALID;p->attempted=true;p->entered=true;}
 try{
 int rc=p->current();if(rc){p->entered=false;return rc;}YNXIDEDeploymentV2NativeKeySpans keys{};rc=ynx_source_ide_deployment_v2_key_loan_borrow(p->loan,&p->context,&keys);if(rc){p->entered=false;return p->remember(rc);}
 auto&v=p->public_inputs;YNXDeploymentManifestRequestV2 request{};request.abi_version=YNX_DEPLOYMENT_MANIFEST_ABI_V2;request.struct_size=sizeof(request);
 request.payload_original=view(v[0]);request.actual_artifact=view(v[1]);request.expected_payload_original=view(v[2]);request.expected_payload_bind=view(v[3]);request.expected_artifact_bind=view(v[4]);request.profile_network_id=view(v[5]);request.subject_owner=view(v[6]);request.expected_pk_a=view(v[7]);request.expected_pk_b=view(v[8]);
 request.pkcs8_a={keys.pkcs8_a,keys.pkcs8_a_bytes};request.pkcs8_b={keys.pkcs8_b,keys.pkcs8_b_bytes};request.pk_a={keys.pk_a,keys.pk_a_bytes};request.pk_b={keys.pk_b,keys.pk_b_bytes};
 // All owned output allocations are disjoint; no sizing/signing retry.
 std::vector<uint8_t>buffer(YNX_DEPLOYMENT_MANIFEST_MEMBER_CAPACITY_V2);const size_t output_capacity=buffer.size();size_t length=0;p->cleanup=YNX_ARTIFACT_CLEANUP_UNKNOWN_V1;
 p->core_status=YNXDeploymentManifestSignV2(&request,buffer.data(),buffer.size(),&length,&p->cleanup);
 if(length<=buffer.size()){buffer.resize(length);p->member=std::move(buffer);} // PUBLIC partial BEFORE rc/cleanup/current interpretation
 int failure=OK;if(length>output_capacity||p->core_status!=YNX_ARTIFACT_OK_V1||p->cleanup!=YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1||p->member.empty())failure=UNKNOWN;
 if(!failure)failure=ynx_source_ide_deployment_v2_key_loan_current(p->loan,&p->context);
 p->entered=false;return failure?p->remember(failure):OK;
 }catch(...){p->entered=false;return p->remember(UNKNOWN);}
}
extern "C" int ynx_source_deployment_v2_call_copy_partial(YNXSourceDeploymentV2Call*p,uint8_t*out,size_t capacity,size_t*length,int32_t*core,uint32_t*cleanup){std::lock_guard<std::mutex>lock(calls_mutex);if(!p||!calls.count(p)||!out||!length||!core||!cleanup||p->thread!=std::this_thread::get_id()||capacity<p->member.size())return INVALID;*core=p->core_status;*cleanup=p->cleanup;*length=p->member.size();if(!p->member.empty())memcpy(out,p->member.data(),p->member.size());return OK;}
extern "C" int ynx_source_deployment_v2_call_current(YNXSourceDeploymentV2Call*p){std::lock_guard<std::mutex>lock(calls_mutex);if(!p||!calls.count(p))return INVALID;return p->current();}
extern "C" void ynx_source_deployment_v2_call_retire(YNXSourceDeploymentV2Call*p){std::lock_guard<std::mutex>lock(calls_mutex);if(p&&calls.count(p)){p->retired=true;ynx_source_ide_deployment_v2_key_loan_retire(p->loan);}}
extern "C" int ynx_source_deployment_v2_call_join(YNXSourceDeploymentV2Call*p){std::lock_guard<std::mutex>lock(calls_mutex);if(!p||!calls.count(p)||p->thread!=std::this_thread::get_id()||p->entered)return UNKNOWN;return ynx_source_ide_deployment_v2_key_loan_join(p->loan);}
extern "C" int ynx_source_deployment_v2_call_close(YNXSourceDeploymentV2Call*p){std::lock_guard<std::mutex>lock(calls_mutex);if(!p||!calls.count(p)||p->thread!=std::this_thread::get_id()||p->entered)return INVALID;if(p->close_selected)return p->close_first;p->close_selected=true;p->retired=true;p->close_first=ynx_source_ide_deployment_v2_key_loan_close(p->loan);return p->close_first;}
