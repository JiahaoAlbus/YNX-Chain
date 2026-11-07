#include "AgentOperation.h"
#include "RequiredOriginalAgentPorts.hpp"
#include <MobileCanonicalDATA.hpp>
#include <MobileAISigningCapturePairedPrivate.hpp>
#include <OS43Private.h>
#include <atomic>
#include <algorithm>
#include <cstring>
#include <map>
#include <mutex>
#include <thread>
#include <limits>
namespace ynx::mobilepq::aiagent {
namespace data=ynx::auth::mobile::qualified::data;
namespace {
struct Operation {
 const std::thread::id actor=std::this_thread::get_id();YNXAIMobileSigningCapture*capture=nullptr;
 std::shared_ptr<OriginalRegisteredAgentKeyLoan>resource;
 Bytes unsignedOriginal,messageOriginal,expectedOriginal,resourceRegistration,member;
 std::string network,epoch;Failure first{},cleanup{};
 std::atomic<bool>retired{false},released{false};bool signSelected=false,closeSelected=false,closed=false,resourceCloseSelected=false;
 int32_t primitiveStatus=notSupplied;uint32_t cleanupStatus=1; // no private entry yet
};
std::mutex inventoryMutex;auto&inventory=*new std::map<uintptr_t,std::shared_ptr<Operation>>;uintptr_t next=1;std::map<YNXAIMobileSigningCapture*,bool>selectedCaptures;
Failure failure(int32_t code){return{1,code};}
void remember(Failure&dst,Failure f){if(f.present&&!dst.present)dst=f;}
int32_t port(Failure f){return f.present?(f.code?f.code:unknown):0;}
std::shared_ptr<Operation>get(YNXAIMobileAgentOperation*t){std::lock_guard<std::mutex>lock(inventoryMutex);auto i=inventory.find(reinterpret_cast<uintptr_t>(t));return i==inventory.end()?nullptr:i->second;}
bool actor(const std::shared_ptr<Operation>&o){return o&&o->actor==std::this_thread::get_id();}
Bytes bytes(YNXAIMobileSpanV6 s,size_t cap,bool empty=false){if(s.bytes>cap||(!s.data&&s.bytes)||(!empty&&!s.bytes))throw invalid;return s.bytes?Bytes(s.data,s.data+s.bytes):Bytes{};}
YNXAIMobileSpanV6 span(const Bytes&v){return{v.data(),v.size()};}YNXAIMobileSpanV6 span(const std::string&v){return{reinterpret_cast<const uint8_t*>(v.data()),v.size()};}
std::string digest(const Bytes&v){uint8_t out[32];if(ynx::mobilepq::os43::platformSHA256(v.data(),v.size(),out))throw notSupplied;static const char h[]="0123456789abcdef";std::string s;for(auto b:out){s+=h[b>>4];s+=h[b&15];}return s;}
void inspectRegistration(const Bytes&raw){auto r=data::parseCanonical(raw,16384);r.keys({"version","purpose","networkId","canonicalOwner","registrationId","registrationDigest","keyEpoch","pkA","pkB","sourceId","instanceId","resourceKey","protectedResourceRef","registeredAtMs","expiresAtMs"});if(r.at("version").text()!="1"||r.at("purpose").text()!="PRODUCT-SESSION-AI-TASK-ACTION"||!data::hex(r.at("networkId").text())||!data::hex(r.at("registrationDigest").text())||!data::hex(r.at("pkA").text(),5184)||!data::hex(r.at("pkB").text(),128))throw invalid;data::u64(r.at("keyEpoch").text());for(const char*k:{"registrationId","sourceId","instanceId","resourceKey","protectedResourceRef"}){auto&s=r.at(k).text();if(s.empty()||s.size()>((std::string(k)=="resourceKey"||std::string(k)=="protectedResourceRef")?1024:256)||std::any_of(s.begin(),s.end(),[](unsigned char c){return c<32||c==127;}))throw invalid;}auto owner=r.at("canonicalOwner").text();if(owner.size()!=42||owner.substr(0,2)!="0x"||!data::hex(owner.substr(2),40)||r.at("expiresAtMs").number()<=r.at("registeredAtMs").number())throw invalid;}
Failure captureFailure(YNXAIMobileSigningCapture*c){auto result=ynx::auth::ai::mobile::captureOriginalAgentBinding(c);if(result.failure.present)return result.failure;if(result.status)return failure(result.status);if(result.originals.version!=6||result.originals.size!=sizeof(result.originals))return failure(invalid);return {};}
Failure liveFence(const std::shared_ptr<Operation>&o){if(!actor(o))return failure(o?wrongThread:invalid);if(o->retired||o->closed||o->released||o->closeSelected)return failure(closed);auto captureResult=captureFailure(o->capture);if(captureResult.present)return captureResult;if(!o->resource)return failure(notSupplied);auto f=o->resource->current(o->capture);if(f.present)return f;return captureFailure(o->capture);}
Failure current(const std::shared_ptr<Operation>&o){if(!actor(o))return failure(o?wrongThread:invalid);return o->first.present?o->first:liveFence(o);}
Failure closePass(const std::shared_ptr<Operation>&o){
 if(!actor(o))return failure(o?wrongThread:invalid);if(o->released||o->closed)return o->cleanup;
 o->retired=true;if(!o->closeSelected)o->closeSelected=true;
 if(o->cleanupStatus==0||o->cleanupStatus==3){if(o->resource)o->resource->retire();return o->cleanup.present?o->cleanup:failure(cleanupDebt);}
 if(o->resource){o->resource->retire();auto f=o->resourceCloseSelected?o->resource->join():o->resource->close();o->resourceCloseSelected=true;remember(o->cleanup,f);if(!o->resource->isClosed())return o->cleanup.present?o->cleanup:failure(cleanupDebt);f=o->resource->releaseClosed();remember(o->cleanup,f);if(f.present)return o->cleanup;o->resource.reset();}
 if(o->cleanupStatus==1)o->cleanupStatus=2;
 // Unknown/failed primitive cleanup remains debt even if outer key loan closed.
 if(o->cleanupStatus==0||o->cleanupStatus==3)return o->cleanup.present?o->cleanup:failure(cleanupDebt);
 o->closed=true;return o->cleanup;
}
void capture(const std::shared_ptr<Operation>&o){
 auto read=ynx::auth::ai::mobile::captureOriginalAgentBinding(o->capture);if(read.failure.present){remember(o->first,read.failure);return;}if(read.status)throw read.status;auto v=read.originals;if(v.version!=6||v.size!=sizeof(v))throw invalid;
 o->unsignedOriginal=bytes(v.unsigned_original,16384);o->messageOriginal=bytes(v.message_original,16384);o->expectedOriginal=bytes(v.agent_expected_original,16384);auto capturedDigest=digest(o->messageOriginal);if(bytes(v.request_digest,64)!=Bytes(capturedDigest.begin(),capturedDigest.end()))throw invalid;
 inspectRegistration(o->expectedOriginal);auto expected=data::parseCanonical(o->expectedOriginal,16384);o->network=expected.at("networkId").text();o->epoch=expected.at("keyEpoch").text();auto u=data::parseCanonical(o->unsignedOriginal,16384);if(u.at("canonicalOwner").text()!=expected.at("canonicalOwner").text())throw invalid;
 // Auth Prepared and the sole fixed math signer independently check exact35/E5.
 // Capture contains no body span: never treat empty bytes as original body.
 auto acquired=acquireOriginalRegisteredAgentKeyForCapture(o->capture);o->resource=acquired.owner;remember(o->first,acquired.failure);if(acquired.failure.present)return;if(!o->resource)throw notSupplied;
 auto f=o->resource->copyOriginalRegistrationDATA(o->resourceRegistration);remember(o->first,f);if(f.present)return;inspectRegistration(o->resourceRegistration);if(o->resourceRegistration!=o->expectedOriginal)throw invalid;
 f=current(o);remember(o->first,f);
}
}
}
extern "C" {
int32_t ynx_ai_mobile_agent_operation_acquire_v6(YNXAIMobileSigningCapture*c,YNXAIMobileAgentOperation**out){using namespace ynx::mobilepq::aiagent;if(!c||!out||*out)return invalid;std::shared_ptr<Operation>o;try{o=std::make_shared<Operation>();o->capture=c;{std::lock_guard<std::mutex>lock(inventoryMutex);size_t active=0;for(const auto&[id,x]:inventory){(void)id;active+=!x->released;}if(active>=64||next==std::numeric_limits<uintptr_t>::max())return capacity;if(selectedCaptures.count(c))return unknown;selectedCaptures.emplace(c,true);auto id=next++;inventory.emplace(id,o);*out=reinterpret_cast<YNXAIMobileAgentOperation*>(id);}capture(o);return port(o->first);}catch(int32_t e){if(o)remember(o->first,{1,e});return e?e:unknown;}catch(...){if(o)remember(o->first,{1,unknown});return unknown;}}
int32_t ynx_ai_mobile_agent_operation_sign_once_v6(YNXAIMobileAgentOperation*t){using namespace ynx::mobilepq::aiagent;auto o=get(t);if(!actor(o))return o?wrongThread:invalid;if(o->signSelected)return unknown;o->signSelected=true;try{auto f=current(o);if(f.present){remember(o->first,f);return port(f);}ProtectedKeySpans keys{};f=o->resource->borrowForOriginalFixedSign(o->capture,keys);remember(o->first,f);if(f.present)return port(f);auto expected=data::parseCanonical(o->expectedOriginal,16384);if(bytes(keys.publicA,2592)!=data::unhex(expected.at("pkA").text(),2592)||bytes(keys.publicB,64)!=data::unhex(expected.at("pkB").text(),64)||keys.pkcs8A.bytes!=54||keys.pkcs8B.bytes!=150||!keys.pkcs8A.data||!keys.pkcs8B.data)throw invalid;f=current(o);if(f.present){remember(o->first,f);return port(f);}o->member.resize(98304);size_t length=0;o->cleanupStatus=0;FixedSignRequest request;request.unsignedOriginal=span(o->unsignedOriginal);request.messageOriginal=span(o->messageOriginal);request.networkHex=span(o->network);request.keyEpoch=span(o->epoch);request.publicA=keys.publicA;request.publicB=keys.publicB;request.pkcs8A=keys.pkcs8A;request.pkcs8B=keys.pkcs8B;o->primitiveStatus=signOriginalAITaskActionV6(request,o->member.data(),o->member.size(),&length,&o->cleanupStatus);if(length>o->member.size()){o->member.clear();throw invalid;}o->member.resize(length);if(o->primitiveStatus)remember(o->first,{1,o->primitiveStatus});if(o->cleanupStatus!=2)remember(o->first,{1,cleanupDebt});f=liveFence(o);remember(o->first,f);return port(o->first);}catch(int32_t code){remember(o->first,{1,code});return port(o->first);}catch(...){remember(o->first,{1,unknown});return port(o->first);}}
int32_t ynx_ai_mobile_agent_operation_read_v6(YNXAIMobileAgentOperation*t,YNXAIMobileAgentOutcome*out){using namespace ynx::mobilepq::aiagent;auto o=get(t);if(!actor(o)||!out||out->version!=6||out->size!=sizeof(*out)||o->released)return invalid;*out={6,sizeof(*out),span(o->member),o->primitiveStatus,o->cleanupStatus,o->first};return 0;}
void ynx_ai_mobile_agent_operation_retire_v6(YNXAIMobileAgentOperation*t){auto o=ynx::mobilepq::aiagent::get(t);if(o)o->retired=true;}
int32_t ynx_ai_mobile_agent_operation_join_v6(YNXAIMobileAgentOperation*t){using namespace ynx::mobilepq::aiagent;auto o=get(t);if(!actor(o))return o?wrongThread:invalid;if(!o->closeSelected)return 0;return port(closePass(o));}
int32_t ynx_ai_mobile_agent_operation_close_v6(YNXAIMobileAgentOperation*t){using namespace ynx::mobilepq::aiagent;return port(closePass(get(t)));}
int32_t ynx_ai_mobile_agent_operation_release_closed_v6(YNXAIMobileAgentOperation*t){using namespace ynx::mobilepq::aiagent;auto o=get(t);if(!actor(o))return o?wrongThread:invalid;if(!o->closed)return cleanupDebt;o->released=true;o->member.clear();o->unsignedOriginal.clear();o->messageOriginal.clear();o->capture=nullptr;return 0;}
}
