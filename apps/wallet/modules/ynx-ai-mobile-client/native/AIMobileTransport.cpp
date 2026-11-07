#include "AIMobileProducerState.h"
#include "AIMobileTransportFrame.h"
#include "AIMobileTransportLoanPrivate.hpp"
#include "codec/MobileAITaskV6HeaderDATA.hpp"
#include <MobileCanonicalDATA.hpp>
#include "link/ai-mobile-v6-transport.hpp"
#include <MobileAITransportAuthorityPrivate.hpp>
#include <chrono>
#include <map>
#include <limits>
#include <stdexcept>
namespace physical=ynx::ai_mobile_v6::physical;
namespace authai=ynx::auth::ai::mobile;
namespace codec=ynx::sdk::ai::v6::data;
namespace canonical=ynx::auth::mobile::qualified::data;
namespace ynx::ai_mobile_v6::physical::native_loan {
struct OriginalAttempt {
 std::thread::id actor=std::this_thread::get_id();
 std::shared_ptr<ynx::mobileai::producer::Producer>parent;
 std::shared_ptr<authai::OriginalAITransportAuthority>authority;
 ynx::mobileai::transport::OriginalRequestLoan*payload=nullptr;
 Material material;
 std::atomic<bool>selected{false},cancelled{false},releaseSelected{false},released{false};
 std::mutex failureMutex;YNXAIMobileFailureV6 first{},cleanup{};
 bool physicalHeld=false;size_t packetDebts=0;
};
}
namespace ynx::mobileai::producer {
struct NativeTransportState {
 std::thread::id actor=std::this_thread::get_id();std::shared_ptr<physical::native_loan::OriginalAttempt>attempt;
 std::shared_ptr<authai::OriginalAITransportAuthority>authority;
 std::shared_ptr<physical::RequestOwner>physical;
 const physical::Packet*packet=nullptr;bool packetAuthHeld=false,packetReleased=false;
 std::atomic<bool>cancelled{false};bool responseSelected=false;size_t responseOwners=0;
 bool authorityCloseSelected=false,closed=false;
 Failure first{},cleanup{};
 ResponseSnapshot snapshot;Bytes unsignedOriginal,messageOriginal,memberOriginal;
};
}
namespace ynx::mobileai::transport {
namespace {
using Attempt=physical::native_loan::OriginalAttempt;using State=producer::NativeTransportState;
std::mutex attemptsMutex;std::map<const Attempt*,std::shared_ptr<Attempt>>attempts;
std::shared_ptr<Attempt>known(const Attempt*a){std::lock_guard<std::mutex>lock(attemptsMutex);auto i=attempts.find(a);return i==attempts.end()?nullptr:i->second;}
Failure failure(int32_t code){return {1,code};}
void rememberAttempt(const std::shared_ptr<Attempt>&a,Failure f,bool cleanup=false){if(!a)return;std::lock_guard<std::mutex>lock(a->failureMutex);producer::remember(cleanup?a->cleanup:a->first,f);}
Failure firstAttempt(const std::shared_ptr<Attempt>&a){std::lock_guard<std::mutex>lock(a->failureMutex);return a->first;}
Failure cleanupAttempt(const std::shared_ptr<Attempt>&a){std::lock_guard<std::mutex>lock(a->failureMutex);return a->cleanup;}
int32_t port(Failure f){return f.present?(f.code?f.code:retained):0;}
Failure physicalFailure(physical::Code code){return code==physical::Code::ok||code==physical::Code::draining?Failure{}:failure(10900+int32_t(code));}
std::vector<std::pair<std::string,std::string>>headers(const std::string&raw){if(raw.size()>262144)throw invalid;std::vector<std::pair<std::string,std::string>>out;auto at=raw.find("\r\n");if(at==std::string::npos)throw invalid;at+=2;while(at<raw.size()){auto end=raw.find("\r\n",at);if(end==std::string::npos)throw invalid;if(end==at){if(end+2!=raw.size())throw invalid;break;}auto colon=raw.find(':',at);if(colon==std::string::npos||colon>=end||colon==at)throw invalid;auto key=raw.substr(at,colon-at);for(auto&c:key){if(c>='A'&&c<='Z')c=char(c-'A'+'a');if(c<=32||c>=127)throw invalid;}auto start=colon+1;while(start<end&&(raw[start]==' '||raw[start]=='\t'))++start;auto stop=end;while(stop>start&&(raw[stop-1]==' '||raw[stop-1]=='\t'))--stop;out.emplace_back(std::move(key),raw.substr(start,stop-start));at=end+2;}return out;}
// Completed against the original Auth reviewed-material accessor, never aliases
// request policyRevision/serverName/expiry to independent LINK trust fields.
void fillReviewedLINKMaterial(const authai::AITransportCredentials&c,physical::Material&out){
 if(c.rootCertificatePEM.empty()||c.rootCertificatePEM.size()>65536||!canonical::hex(c.caSHA256)||!canonical::hex(c.clientCertificateSHA256)||!canonical::hex(c.serverSPKI)||!c.credentialEpoch||!c.policyEpoch||c.peerSAN.empty()||c.roots.empty()||c.roots.size()>2||c.expiresAtMs>uint64_t(std::numeric_limits<int64_t>::max()))throw invalid;
 out.service_origin=c.targetOrigin;out.local_san=c.clientSAN;out.peer_san=c.peerSAN;out.client_certificate_fd=c.certificateFD;out.client_private_key_fd=c.privateKeyFD;out.root_certificate_pem=c.rootCertificatePEM;out.client_certificate_sha256=c.clientCertificateSHA256;out.credential_epoch=c.credentialEpoch;out.policy_epoch=c.policyEpoch;out.credential_until_unix_ms=int64_t(c.expiresAtMs);out.peer_spki_sha256=c.serverSPKI;for(const auto&root:c.roots){if(!canonical::hex(root.certificateSHA256)||!root.untilUnixMs||root.untilUnixMs>uint64_t(std::numeric_limits<int64_t>::max()))throw invalid;out.roots.push_back({root.certificateSHA256,int64_t(root.untilUnixMs)});}
}
void bindPacket(const std::shared_ptr<State>&s,const physical::Packet*packet){
 if(s->packet&&s->packet!=packet)throw invalid;if(!packet||s->packet)return;
 s->packet=packet; // Adopt before ANY error/retention inspection.
 auto f=s->authority->retainPacket();producer::remember(s->first,f);if(!f.present){s->packetAuthHeld=true;++s->attempt->packetDebts;}
 producer::remember(s->first,physicalFailure(packet->failure.code));
 s->snapshot.status=uint32_t(packet->response.status_code);s->snapshot.complete=packet->response.body_complete;s->snapshot.bodyOriginal=packet->response.body;
 if(!packet->response.headers_original.empty())s->snapshot.headers=headers(packet->response.headers_original);
 std::string carrier;size_t carrierCount=0;for(const auto&[key,value]:s->snapshot.headers)if(key==codec::responseHeaderName){if(++carrierCount!=1)throw invalid;carrier=value;}
 if(carrier.empty()){producer::remember(s->first,failure(notSupplied));return;}
 auto decoded=codec::decodeResponseHeaderDATA(carrier,s->attempt->parent->network);s->unsignedOriginal=std::move(decoded.unsignedOriginal);s->messageOriginal=std::move(decoded.messageOriginal);s->memberOriginal=std::move(decoded.memberOriginal);s->snapshot.declarationOriginal=s->unsignedOriginal;
 // Raw OUTER bytes and declaration only. Matching Auth verifies Root/N1,
 // digest/op/nonce/current BEFORE decoding the paired signed carrier.
 if(!s->snapshot.complete)producer::remember(s->first,failure(notSupplied));
}
Failure progress(const std::shared_ptr<State>&s){
 if(!s||s->actor!=std::this_thread::get_id())return failure(wrongThread);if(s->closed)return s->cleanup;
 auto physical=std::atomic_load(&s->physical);
 if(physical){
  physical->retire();if(!s->packet){const physical::Packet*packet=nullptr;auto rc=physical->wait_response(0,&packet);if(packet)try{bindPacket(s,packet);}catch(...){producer::remember(s->first,failure(invalid));}if(rc!=physical::Code::draining)producer::remember(s->first,physicalFailure(rc));}
  if(!s->packetReleased&&s->packet&&s->responseOwners==0){auto rc=physical->release_packet(s->packet);if(rc==physical::Code::ok){s->packetReleased=true;if(s->packetAuthHeld){auto f=s->authority->releasePacket();producer::remember(s->cleanup,f);if(!f.present){s->packetAuthHeld=false;--s->attempt->packetDebts;}}}else producer::remember(s->cleanup,physicalFailure(rc));}
  if(!s->packetReleased||s->packetAuthHeld||s->responseOwners)return s->cleanup;
  bool joined=false;auto rc=physical->join(0,&joined);producer::remember(s->cleanup,physicalFailure(rc));if(!joined)return s->cleanup;
  s->attempt->parent->transportPhysicallyClosed=true; // actual worker/reaper/packet drain witness
  bool closed=false;rc=physical->close(&closed);producer::remember(s->cleanup,physicalFailure(rc));if(!closed)return s->cleanup;
 }
 if(s->authority){s->authority->retire();auto f=s->authorityCloseSelected?s->authority->join():s->authority->close();s->authorityCloseSelected=true;producer::remember(s->cleanup,f);if(!s->authority->isClosed())return s->cleanup;}
 // If start never borrowed the Native loan, it is still owned here and closes
 // only after any nonnull partial physical owner actually joined/closed.
 if(s->attempt&&s->attempt->payload&&!s->attempt->released){auto f=closeOriginalRequest(s->attempt->payload);producer::remember(s->cleanup,f);if(!originalRequestClosed(s->attempt->payload))return s->cleanup;f=releaseClosedOriginalRequest(s->attempt->payload);producer::remember(s->cleanup,f);if(f.present)return s->cleanup;s->attempt->released=true;}
 s->closed=true;return s->cleanup;
}
}
}
namespace ynx::ai_mobile_v6::physical::native_loan {
int32_t retain_original(OriginalAttempt*token){using namespace ynx::mobileai;auto a=transport::known(token);if(!a||a->actor!=std::this_thread::get_id()||a->selected.exchange(true))return invalid;auto f=transport::originalRequestCurrent(a->payload);if(!f.present)f=a->authority->current();transport::rememberAttempt(a,f);if(f.present)return transport::port(f);f=a->authority->retainPhysicalChild();transport::rememberAttempt(a,f);if(f.present)return transport::port(f);a->physicalHeld=true;return 0;}
int32_t read_original_material(OriginalAttempt*token,Material&out){using namespace ynx::mobileai;auto a=transport::known(token);if(!a||a->actor!=std::this_thread::get_id()||!a->selected||!a->physicalHeld||a->released)return invalid;auto f=transport::originalRequestCurrent(a->payload);if(!f.present)f=a->authority->current();transport::rememberAttempt(a,f);if(f.present)return transport::port(f);out=a->material;f=a->authority->current();if(!f.present)f=transport::originalRequestCurrent(a->payload);transport::rememberAttempt(a,f);return transport::port(f);}
int32_t current_before_write(OriginalAttempt*token){using namespace ynx::mobileai;auto a=transport::known(token);if(!a||!a->selected||a->released||a->cancelled||a->parent->cancelled.load()||transport::originalRequestCancelled(a->payload)||!a->authority||!a->authority->workerCurrent())return closed;return 0;}
void release_after_physical_join(OriginalAttempt*token){using namespace ynx::mobileai;auto a=transport::known(token);if(!a||a->actor!=std::this_thread::get_id()||!a->physicalHeld||a->packetDebts||a->releaseSelected.exchange(true))throw std::runtime_error("AI_V6_NATIVE_PHYSICAL_RELEASE_DEBT");auto f=a->authority->releasePhysicalChild();transport::rememberAttempt(a,f,true);if(f.present)throw std::runtime_error("AI_V6_NATIVE_AUTH_RELEASE_UNKNOWN");a->physicalHeld=false;f=transport::closeOriginalRequest(a->payload);transport::rememberAttempt(a,f,true);if(!transport::originalRequestClosed(a->payload)||f.present)throw std::runtime_error("AI_V6_NATIVE_PAYLOAD_CLOSE_DEBT");f=transport::releaseClosedOriginalRequest(a->payload);transport::rememberAttempt(a,f,true);if(f.present)throw std::runtime_error("AI_V6_NATIVE_PAYLOAD_RELEASE_UNKNOWN");a->released=true;}
}
namespace ynx::mobileai::producer {
void cancelTransport(const std::shared_ptr<Producer>&p)noexcept{try{auto s=std::atomic_load(&p->transportChild);if(!s)return;s->cancelled=true;if(auto physical=std::atomic_load(&s->physical))physical->retire();}catch(...){}}
void releaseClosedTransportData(const std::shared_ptr<Producer>&p)noexcept{try{auto s=std::atomic_load(&p->transportChild);if(!s||!s->closed||p->children)return;if(s->attempt){s->attempt->released=true;s->attempt->authority.reset();s->attempt->material=physical::Material{};}s->authority.reset();std::atomic_store(&p->transportChild,std::shared_ptr<NativeTransportState>{});}catch(...){}}
Failure joinTransport(const std::shared_ptr<Producer>&p)noexcept{try{auto s=std::atomic_load(&p->transportChild);return s?transport::progress(s):Failure{};}catch(...){return {1,retained};}}
bool closeTransport(const std::shared_ptr<Producer>&p)noexcept{try{auto s=std::atomic_load(&p->transportChild);if(!s)return true;transport::progress(s);if(s->attempt)remember(p->cleanup,transport::cleanupAttempt(s->attempt));remember(p->cleanup,s->cleanup);if(s->attempt){auto first=transport::firstAttempt(s->attempt);remember(p->first,first);}return s->closed;}catch(...){remember(p->cleanup,{1,retained});return false;}}
}
namespace ynx::mobileai {
Failure readOriginalResponseSnapshot(YNXAIMobileProducerV6*token,ResponseSnapshot&out)noexcept{try{auto p=producer::get(token);if(!p||p->actor!=std::this_thread::get_id())return {1,wrongThread};auto s=std::atomic_load(&p->transportChild);if(!s)return {1,notSupplied};out=s->snapshot;return s->first;}catch(...){return {1,retained};}}
}
extern "C" YNXAIMobileFailureV6 ynx_ai_mobile_producer_dispatch_once_v6(YNXAIMobileProducerV6*token,YNXAuthAIMobileOwnerV6*source,YNXAuthAIMobileOwnerV6*review,YNXAuthAIMobileOwnerV6*operation){using namespace ynx::mobileai;using namespace transport;auto p=producer::get(token);if(!producer::current(p)||p->kind!=1||p->source!=source||p->review!=review||p->operation!=operation||!p->proved||p->dispatchEntered)return {1,invalid};p->dispatchEntered=true;try{
 auto s=std::make_shared<State>();std::atomic_store(&p->transportChild,s);p->transportPhysicallyClosed=false;
 auto capture=authai::TransportAuthorityFactory::capture(source,operation,reinterpret_cast<YNXAIMobileSDKPeer*>(token),p->contextToken);s->authority=capture.owner;producer::remember(s->first,capture.failure);if(capture.failure.present||!s->authority){if(!s->first.present)s->first={1,notSupplied};producer::remember(p->first,s->first);return s->first;}
 authai::AITransportRequest request;authai::AITransportCredentials credentials;auto f=s->authority->read(request,credentials);producer::remember(s->first,f);if(f.present){producer::remember(p->first,f);return f;}
 if(request.unsignedOriginal!=p->unsignedOriginal||request.bodyOriginal!=p->intent.body||request.method!=p->intent.method||request.path!=p->intent.path||request.operationId!=p->intent.operation||request.originURL!=p->originURL||request.issuedAtMs!=p->issuedAtMs||request.expiresAtMs!=p->expiresAtMs)throw invalid;
 if(authai::originalSHA256(p->messageOriginal)!=request.requestDigest)throw invalid;auto unsignedValue=canonical::parseCanonical(request.unsignedOriginal,16384);if(unsignedValue.at("nonce").text()!=request.nonce||unsignedValue.at("operationId").text()!=request.operationId)throw invalid;
 auto carrier=codec::encodeRequestHeaderDATA(request.unsignedOriginal,p->network,request.bodyOriginal,request.memberOriginal);auto decoded=codec::decodeRequestHeaderDATA(carrier,p->network,p->intent.body);if(decoded.unsignedOriginal!=request.unsignedOriginal||decoded.memberOriginal!=request.memberOriginal||decoded.messageOriginal!=p->messageOriginal)throw invalid;
 physical::Material material;fillReviewedLINKMaterial(credentials,material);if(material.service_origin!=credentials.targetOrigin)throw invalid;
 auto scheme=material.service_origin.find("https://");if(scheme!=0||material.service_origin.size()<=8)throw invalid;auto host=material.service_origin.substr(8);if(host.find_first_of("/?#@\r\n")!=std::string::npos)throw invalid;
 auto head=p->intent.method+" "+p->intent.path+" HTTP/1.1\r\nHost: "+host+"\r\nContent-Type: application/json\r\nContent-Length: "+std::to_string(p->intent.body.size())+"\r\n"+codec::requestHeaderName+": "+carrier+"\r\nConnection: close\r\n\r\n";if(head.size()>262144)throw invalid;p->finalHead={head.begin(),head.end()};
 material.original_operation_id=p->intent.operation;material.method=p->intent.method;material.path=p->intent.path;material.request_head_original=head;material.request_body_original=p->intent.body;
 auto a=std::make_shared<Attempt>();a->parent=p;a->authority=s->authority;a->material=std::move(material);s->attempt=a;{std::lock_guard<std::mutex>lock(attemptsMutex);attempts.emplace(a.get(),a);}
 OriginalDispatchFrame frame(p);auto payload=acquireOriginalRequestForDispatch();a->payload=payload.owner;producer::remember(s->first,payload.failure);if(payload.failure.present||!a->payload){if(!s->first.present)s->first={1,notSupplied};producer::remember(p->first,s->first);return s->first;}
 RequestDATA actual;f=readOriginalRequest(a->payload,actual);if(!f.present&&(actual.finalHead!=p->finalHead||actual.bodyOriginal!=request.bodyOriginal||actual.path!=request.path||actual.method!=request.method||actual.sourceOriginURL!=request.originURL))f={1,invalid};producer::remember(s->first,f);if(f.present){producer::remember(p->first,f);return f;}
 std::shared_ptr<physical::RequestOwner>physical;auto rc=physical::RequestOwner::start(a.get(),physical);std::atomic_store(&s->physical,physical);producer::remember(s->first,firstAttempt(a));producer::remember(s->first,physicalFailure(rc));if(physical){const physical::Packet*packet=nullptr;rc=physical->wait_response(5000,&packet);if(packet)bindPacket(s,packet);if(rc==physical::Code::draining)producer::remember(s->first,{1,retained});else producer::remember(s->first,physicalFailure(rc));}else producer::remember(s->first,{1,notSupplied});producer::remember(p->first,s->first);return s->first;
 }catch(...){producer::remember(p->first,{1,invalid});return p->first;}}
namespace ynx::mobileai::transport {
namespace {
struct ResponseOwner {std::thread::id actor=std::this_thread::get_id();std::shared_ptr<State>state;std::shared_ptr<producer::Producer>parent;Failure first{};bool authPacketHeld=false,retired=false,closed=false,released=false;};
std::mutex responsesMutex;std::map<uintptr_t,std::shared_ptr<ResponseOwner>>responses;uintptr_t nextResponse=1;
std::shared_ptr<ResponseOwner>response(YNXAIMobileResponse*token){std::lock_guard<std::mutex>lock(responsesMutex);auto i=responses.find(reinterpret_cast<uintptr_t>(token));return i==responses.end()?nullptr:i->second;}
YNXAIMobileSpanV6 span(const Bytes&b){return {b.data(),b.size()};}
}
}
extern "C" {
int32_t ynx_ai_mobile_response_acquire_v6(YNXAIMobileSDKPeer*peer,YNXAIMobileSDKContext*ctx,YNXAIMobileResponse**out){using namespace ynx::mobileai;using namespace transport;try{auto p=producer::peer(peer);if(!p||p->actor!=std::this_thread::get_id()||p->contextToken!=ctx||!p->dispatchEntered||!out||*out)return invalid;auto s=std::atomic_load(&p->transportChild);if(!s||s->responseSelected||!s->authority)return notSupplied;s->responseSelected=true;auto owner=std::make_shared<ResponseOwner>();owner->state=s;owner->parent=p;{std::lock_guard<std::mutex>lock(responsesMutex);if(nextResponse==std::numeric_limits<uintptr_t>::max())return capacity;auto id=nextResponse++;responses.emplace(id,owner);*out=reinterpret_cast<YNXAIMobileResponse*>(id);++p->children;++s->responseOwners;}
 owner->first=s->first;if(!s->packet)producer::remember(owner->first,{1,notSupplied});auto f=s->authority->retainPacket();producer::remember(owner->first,f);if(!f.present){owner->authPacketHeld=true;++s->attempt->packetDebts;}return port(owner->first);
 }catch(...){return retained;}}
int32_t ynx_ai_mobile_response_read_v6(YNXAIMobileResponse*token,YNXAIMobileResponseDATA*out){using namespace ynx::mobileai;using namespace transport;auto owner=response(token);if(!owner||owner->actor!=std::this_thread::get_id()||owner->released||owner->closed||!out||out->version!=6||out->size!=sizeof(*out))return invalid;auto&s=*owner->state;*out={6,sizeof(*out),s.snapshot.status,span(s.unsignedOriginal),span(s.messageOriginal),span(s.memberOriginal),span(s.snapshot.bodyOriginal),{},{},owner->first};return port(owner->first);}
void ynx_ai_mobile_response_retire_v6(YNXAIMobileResponse*token){auto owner=ynx::mobileai::transport::response(token);if(owner&&owner->actor==std::this_thread::get_id())owner->retired=true;}
int32_t ynx_ai_mobile_response_join_v6(YNXAIMobileResponse*token){auto owner=ynx::mobileai::transport::response(token);return owner&&owner->actor==std::this_thread::get_id()&&!owner->released?0:ynx::mobileai::invalid;}
int32_t ynx_ai_mobile_response_close_v6(YNXAIMobileResponse*token){auto owner=ynx::mobileai::transport::response(token);if(!owner||owner->actor!=std::this_thread::get_id()||owner->released)return ynx::mobileai::invalid;owner->retired=owner->closed=true;return 0;}
int32_t ynx_ai_mobile_response_release_closed_v6(YNXAIMobileResponse*token){using namespace ynx::mobileai;using namespace transport;auto owner=response(token);if(!owner||owner->actor!=std::this_thread::get_id()||!owner->closed)return retained;if(owner->released)return 0;if(owner->authPacketHeld){auto f=owner->state->authority->releasePacket();if(f.present)return port(f);owner->authPacketHeld=false;--owner->state->attempt->packetDebts;}owner->released=true;--owner->state->responseOwners;--owner->parent->children;owner->state.reset();owner->parent.reset();return 0;}
}
