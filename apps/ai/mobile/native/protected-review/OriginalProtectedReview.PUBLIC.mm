// PUBLIC boundaries only: fake Source/installed/account/UI, actual owning UI7
// state machine. Never a Root, real account, real approval, signer or UIKit run.
#define YNX_AI_REVIEW_PUBLIC_MODEL 1
#include "OriginalProtectedReview.ios.mm"
#include <cassert>
#include <iostream>
namespace fixture {
using namespace ynx::platform::ai::review;
YNXAIMobileSigningCapture*capture=reinterpret_cast<YNXAIMobileSigningCapture*>(1);
std::string account="0x"+std::string(40,'1'),network(64,'1'),epoch="1";
std::string u="{\"applicationId\":\"com.ynxweb4.ai\",\"account\":\""+account+"\",\"canonicalOwner\":\""+account+"\",\"action\":\"task.run-start\",\"method\":\"POST\",\"path\":\"/api/tasks/PUBLIC/runs\",\"origin\":\"https://PUBLIC.invalid\",\"operationId\":\"PUBLIC_original\",\"expiresAt\":\"123456789\"}";
std::string agent="{\"canonicalOwner\":\""+account+"\",\"networkId\":\""+network+"\",\"keyEpoch\":\"7\"}";
std::string body="{\"authorizationRef\":\"PUBLIC SECRET TOKEN\",\"prompt\":\"PUBLIC prompt\"}",message="PUBLIC E5",scope="PUBLIC scope",digest(64,'a');
std::string one="1",ios="ios",appid="com.ynxweb4.ai";
int reads=0,choice=approved,accountReleases=0;bool acknowledge=false,sourceRawZero=false,observedFailure=false;
YNXAIMobileSpanV6 span(const std::string&s){return {reinterpret_cast<const uint8_t*>(s.data()),s.size()};}
YNXMobileSelectedPublicSpan selected(const std::string&s){return {reinterpret_cast<const uint8_t*>(s.data()),s.size()};}
void reset(){reads=0;choice=approved;acknowledge=false;sourceRawZero=false;observedFailure=false;epoch="1";}
YNXMobileRegisteredPhaseV2 ready(){return {2,sizeof(YNXMobileRegisteredPhaseV2),YNX_MOBILE_REGISTERED_READY_V2,{},{}};}
}
namespace ynx::sdk::mobileapplication {
struct InstalledApplicationOriginal::Storage {};
InstalledApplicationOriginal::InstalledApplicationOriginal():storage_(new Storage){}
InstalledApplicationOriginal::~InstalledApplicationOriginal()=default;
Failure InstalledApplicationOriginal::acquire(std::unique_ptr<InstalledApplicationOriginal>&o)noexcept{o.reset(new InstalledApplicationOriginal);return {};}
Failure InstalledApplicationOriginal::readCaptured(Capture&)noexcept{return {};}
Failure InstalledApplicationOriginal::current()noexcept{return {};}
void InstalledApplicationOriginal::retire()noexcept{}
Failure InstalledApplicationOriginal::close(bool&done)noexcept{done=true;return {};}
}
namespace ynx::auth::ai::mobile {
ProtectedReviewReadResult readOriginalProtectedReviewDATA(YNXAIMobileSigningCapture*c)noexcept{
 if(c!=fixture::capture)return {{},{1,-99},-99};fixture::reads++;
 return {{fixture::span(fixture::u),fixture::span(fixture::message),fixture::span(fixture::body),fixture::span(fixture::scope),fixture::span(fixture::digest),fixture::span(fixture::agent)},{},0};
}
int32_t signingCaptureSourceCurrentOriginal(YNXAIMobileSigningCapture*)noexcept{if(fixture::sourceRawZero&&fixture::reads>=2)fixture::observedFailure=true;return 0;}
YNXAIMobileFailureV6 signingCaptureSourceFailureOriginal(YNXAIMobileSigningCapture*)noexcept{return {uint32_t(fixture::observedFailure),0};}
}
extern "C" YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_acquire_v2(YNXMobilePQSelectedOriginal**o){*o=reinterpret_cast<YNXMobilePQSelectedOriginal*>(2);return fixture::ready();}
extern "C" YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_current_v2(YNXMobilePQSelectedOriginal*){return fixture::ready();}
extern "C" YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_read_v2(YNXMobilePQSelectedOriginal*,YNXMobilePQSelectedOriginalDATA*d){
 *d={1,sizeof(*d),2,fixture::selected(fixture::one),{},fixture::selected(fixture::network),fixture::selected(fixture::account),fixture::selected(fixture::ios),fixture::selected(fixture::appid),{}, {},{}, {},fixture::selected(fixture::epoch),{},{},{},0,0};return fixture::ready();}
extern "C" YNXMobileRegisteredFailureV2 ynx_mobile_pq_registered_account_retire_v2(YNXMobilePQSelectedOriginal*){return {};}
extern "C" YNXMobileRegisteredDrainV2 ynx_mobile_pq_registered_account_join_v2(YNXMobilePQSelectedOriginal*){return {2,sizeof(YNXMobileRegisteredDrainV2),1,{},{}};}
extern "C" YNXMobileRegisteredDrainV2 ynx_mobile_pq_registered_account_close_v2(YNXMobilePQSelectedOriginal*){return {2,sizeof(YNXMobileRegisteredDrainV2),1,{},{}};}
extern "C" YNXMobileRegisteredFailureV2 ynx_mobile_pq_registered_account_release_closed_v2(YNXMobilePQSelectedOriginal*){fixture::accountReleases++;return {};}
namespace ynx::platform::ai::review {namespace {
void showUI(const std::shared_ptr<OriginalReview>&p){assert(p->presentation.find("PUBLIC SECRET TOKEN")==std::string::npos);if(fixture::choice!=waiting)choose(p,static_cast<Decision>(fixture::choice));}
void dismissUI(const std::shared_ptr<OriginalReview>&p){if(fixture::acknowledge)p->uiDone=true;}
}}
static void finish(ynx::platform::ai::review::OriginalReview*p){
 using namespace ynx::platform::ai::review;
 auto before=closeOriginalProtectedReview(p);assert(!before.physicalDone);if(!known(p)->first.present&&!known(p)->cleanup.present)assert(!before.failure.present);
 const auto releases=fixture::accountReleases;
 fixture::acknowledge=true;known(p)->uiDone=true; // PUBLIC actual dismiss callback, not a retry/timeout

 auto done=joinOriginalProtectedReview(p);assert(done.physicalDone&&fixture::accountReleases==releases+1);
 auto released=releaseClosedOriginalProtectedReview(p);assert(released.physicalDone);
 assert(!releaseClosedOriginalProtectedReview(p).physicalDone);
}
int main(){@autoreleasepool {
 using namespace ynx::platform::ai::review;
 auto mainThread=acquireOriginalProtectedReview(fixture::capture);assert(mainThread.owner&&mainThread.failure.present);
 fixture::acknowledge=true;assert(closeOriginalProtectedReview(mainThread.owner).physicalDone);assert(releaseClosedOriginalProtectedReview(mainThread.owner).physicalDone);
 std::thread actor([]{@autoreleasepool {
  fixture::reset();auto opened=acquireOriginalProtectedReview(fixture::capture);assert(opened.owner&&!opened.failure.present);
  assert(!currentOriginalProtectedReview(opened.owner,fixture::capture).present);
  Failure foreign;std::thread other([&]{foreign=claimOriginalProtectedReview(opened.owner,fixture::capture);});other.join();assert(foreign.present);
  assert(!claimOriginalProtectedReview(opened.owner,fixture::capture).present);assert(claimOriginalProtectedReview(opened.owner,fixture::capture).present);finish(opened.owner);
  fixture::reset();opened=acquireOriginalProtectedReview(fixture::capture);known(opened.owner)->uiDone=true;assert(!currentOriginalProtectedReview(opened.owner,fixture::capture).present);assert(!claimOriginalProtectedReview(opened.owner,fixture::capture).present);assert(closeOriginalProtectedReview(opened.owner).physicalDone);assert(releaseClosedOriginalProtectedReview(opened.owner).physicalDone);
  fixture::reset();fixture::choice=denied;opened=acquireOriginalProtectedReview(fixture::capture);assert(opened.owner&&opened.failure.present);assert(claimOriginalProtectedReview(opened.owner,fixture::capture).present);finish(opened.owner);
  fixture::reset();opened=acquireOriginalProtectedReview(fixture::capture);fixture::epoch="2";assert(currentOriginalProtectedReview(opened.owner,fixture::capture).present);finish(opened.owner);
  fixture::reset();opened=acquireOriginalProtectedReview(fixture::capture);auto original=fixture::body;fixture::body="{\"prompt\":\"PUBLIC mutated after review\"}";assert(claimOriginalProtectedReview(opened.owner,fixture::capture).present);fixture::body=original;finish(opened.owner);
  fixture::reset();fixture::choice=waiting;fixture::sourceRawZero=true;opened=acquireOriginalProtectedReview(fixture::capture);assert(opened.owner&&opened.failure.present&&opened.failure.code==0);finish(opened.owner);
  std::cout<<"PUBLIC owning UI7: main/wrong actor refusal, genuine capture boundary, actual body redaction, approved receipt/current/claim once, denial, account epoch/body mutation, Source late raw0, dismiss ACK before release PASS; actual UIKit/Source/Root/account/signing false\n";
 }});actor.join();
}}
