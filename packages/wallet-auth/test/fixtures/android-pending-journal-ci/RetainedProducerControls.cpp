// PUBLIC resource/approval/Core boundaries only. Exercises the actual Auth
// production TU; these symbols are not a product installer or signing backend.
#include "AndroidDeviceRegistrationPortsPrivate.h"
#include "product_device_challenge_v4.h"
#include <array>
#include <cassert>
#include <chrono>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <string>
#include <unistd.h>
#ifdef YNX_PENDING_COMBINED_ROOT_CONTROL
#include "SoleCollectorRuntime.hpp"
#include "AndroidDevicePublicGetPrivate.h"
#endif
using F=ynx_auth_android_provision_failure_v1;
using D=ynx_auth_android_provision_drain_v1;
using B=ynx_auth_android_provision_bytes_v1;
using V=ynx_auth_android_pending_review_data_v1;
struct ynx_original_android_pending_root_v1 {bool retired=false;};
struct ynx_original_android_pending_approval_v1 {};
struct ynx_original_android_pending_device_pair_v1 {};
struct ynx_original_android_pending_directory_v1 {int fd=-1;};
struct ynx_original_android_abort_context_v1 {};
namespace {
enum Hook {None,RootCopy,ApprovalCopy,CoreProofClose,CoreSourceClose,CoreExpire,CoreRevoke};
Hook hook=None; bool fired=false,rawZero=false,badOrigin=false,badPair=false;
bool rootRevoked=false,pairUnknown=false;int kind=1,coreCalls=0,pairCloses=0,rootOpens=0;
int64_t begin=0,end=0;uint32_t cleanup=2;
std::string reuseDirectory;
ynx_auth_android_pending_source_v1*activeSource=nullptr;
ynx_auth_android_pending_proof_v1*activeProof=nullptr;
std::array<uint8_t,2592>pkA{};std::array<uint8_t,64>pkB{};
ynx_original_android_abort_context_v1 context;
int64_t now(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
B put(uint8_t*b,size_t cap,size_t&at,const std::string&s){assert(s.size()<=cap-at);auto*p=b+at;std::memcpy(p,s.data(),s.size());at+=s.size();return{p,s.size()};}
void callback(Hook h){if(hook!=h||fired)return;fired=true;if(h==CoreExpire){while(now()<=end)::usleep(1000);return;}if(h==CoreRevoke){rootRevoked=true;return;}D d{};if(h==CoreProofClose){assert(activeProof);ynx_auth_android_pending_proof_close_v1(activeProof,&d);}else {assert(activeSource);ynx_auth_android_pending_source_close_v1(activeSource,&d);}assert(!d.physical_done&&!d.unknown);assert(pairCloses==0);}
void reset(){hook=None;fired=false;rawZero=badOrigin=badPair=rootRevoked=pairUnknown=false;kind=1;cleanup=2;coreCalls=pairCloses=rootOpens=0;activeSource=nullptr;activeProof=nullptr;begin=now()-10;end=begin+20000;pkA.fill(7);pkB.fill(8);}
void open(){F f{};ynx_auth_android_pending_source_open_original_v1(&activeSource,&f);assert(activeSource&&!f.present);}
F produce(){F f{};if(kind==1)ynx_auth_android_pending_produce_registration_proof_v1(activeSource,&context,&activeProof,&f);else ynx_auth_android_pending_produce_challenge_proof_v1(activeSource,&context,&activeProof,&f);return f;}
void proofClose(bool expected=true){D d{};ynx_auth_android_pending_proof_close_v1(activeProof,&d);assert(bool(d.physical_done)==expected);if(expected){ynx_auth_android_pending_proof_release_closed_v1(&activeProof,&d);assert(d.physical_done&&!activeProof);}}
void sourceClose(){D d{};ynx_auth_android_pending_source_close_v1(activeSource,&d);assert(d.physical_done);ynx_auth_android_pending_source_release_closed_v1(&activeSource,&d);assert(d.physical_done&&!activeSource);}
void group(const char*s){std::cout<<"PASS "<<s<<'\n';}
}
extern "C" {
#ifndef YNX_PENDING_COMBINED_ROOT_CONTROL
void ynx_original_android_pending_root_open_v1(ynx_original_android_pending_root_v1**p,F*f){++rootOpens;*p=new ynx_original_android_pending_root_v1;*f={};}
void ynx_original_android_pending_root_current_v1(ynx_original_android_pending_root_v1*p,F*f){*f=(p->retired||rootRevoked)?F{1,0,11,0}:F{};}
void ynx_original_android_pending_root_copy_v1(ynx_original_android_pending_root_v1*,uint8_t*b,size_t n,V*v,F*f){*f={};*v={};v->version=1;v->size=sizeof(*v);v->kind=kind;v->not_before_ms=begin;v->expires_at_ms=end;size_t a=0;
 v->scope_original=put(b,n,a,"PUBLIC_SCOPE");v->registration_original=put(b,n,a,"PUBLIC_REGISTRATION");v->request_original=put(b,n,a,"PUBLIC_REQUEST");if(kind==2)v->challenge_original=put(b,n,a,"PUBLIC_CHALLENGE");
 v->pending_id=put(b,n,a,std::string(64,'1'));v->registration_digest=put(b,n,a,std::string(64,'2'));v->approval_digest=put(b,n,a,std::string(64,'a'));
 v->source_id=put(b,n,a,"source");v->instance_id=put(b,n,a,"instance");v->source_generation=put(b,n,a,"71");v->device_generation=put(b,n,a,"3");v->account=put(b,n,a,"PUBLIC_ACCOUNT");
 v->product_id=put(b,n,a,"wallet");v->client_id=put(b,n,a,"client");v->application_id=put(b,n,a,"app");v->origin=put(b,n,a,"https://public.invalid");v->callback=put(b,n,a,"ynx://callback");v->device_id=put(b,n,a,"device");v->null_mask=3;if(badOrigin)v->origin={};
 const std::string owner="0x"+std::string(40,'3');std::memcpy(v->canonical_owner,owner.data(),42);std::memcpy(v->device_pk_a,pkA.data(),pkA.size());std::memcpy(v->device_pk_b,pkB.data(),pkB.size());callback(RootCopy);
}
void ynx_original_android_pending_root_retire_v1(ynx_original_android_pending_root_v1*p){p->retired=true;}
void ynx_original_android_pending_root_join_v1(ynx_original_android_pending_root_v1*,D*d){*d={{},0,1};}
void ynx_original_android_pending_root_close_v1(ynx_original_android_pending_root_v1**p,D*d){delete *p;*p=nullptr;*d={{},0,1};}
#endif
void ynx_original_android_pending_approval_capture_v1(ynx_auth_android_pending_source_v1*,ynx_original_android_pending_approval_v1**p,F*f){*p=new ynx_original_android_pending_approval_v1;*f={};}
void ynx_original_android_pending_approval_current_v1(ynx_original_android_pending_approval_v1*,ynx_auth_android_pending_source_v1*,F*f){*f=rawZero?F{1,0,12,0}:F{};}
void ynx_original_android_pending_approval_copy_v1(ynx_original_android_pending_approval_v1*,uint8_t*b,size_t n,ynx_original_android_pending_approval_data_v1*v,F*f){*v={};*f={};v->version=1;v->size=sizeof(*v);size_t at=0;v->approval_original=put(b,n,at,"PUBLIC_APPROVAL");v->policy_original=put(b,n,at,"PUBLIC_POLICY");v->request_original=put(b,n,at,"PUBLIC_REQUEST");std::memset(v->approval_digest,0xaa,32);v->not_before_ms=begin;v->expires_at_ms=end;callback(ApprovalCopy);}
void ynx_original_android_pending_approval_retire_v1(ynx_original_android_pending_approval_v1*){}
void ynx_original_android_pending_approval_close_v1(ynx_original_android_pending_approval_v1**p,D*d){delete *p;*p=nullptr;*d={{},0,1};}
void ynx_original_android_pending_pair_open_v1(ynx_auth_android_pending_source_v1*,ynx_original_android_pending_device_pair_v1**p,F*f){*p=new ynx_original_android_pending_device_pair_v1;*f={};}
void ynx_original_android_pending_pair_current_v1(ynx_original_android_pending_device_pair_v1*,ynx_auth_android_pending_source_v1*,F*f){*f={};}
void ynx_original_android_pending_pair_borrow_once_v1(ynx_original_android_pending_device_pair_v1*,ynx_auth_android_pending_source_v1*,ynx_original_android_pending_pair_borrow_v1*v,F*f){static std::array<uint8_t,54>a{};static std::array<uint8_t,150>b{};static std::array<uint8_t,2592>wrong{};*f={};*v={1,sizeof(*v),{a.data(),a.size()},{b.data(),b.size()},{badPair?wrong.data():pkA.data(),pkA.size()},{pkB.data(),pkB.size()}};}
void ynx_original_android_pending_pair_retire_v1(ynx_original_android_pending_device_pair_v1*){}
void ynx_original_android_pending_pair_close_v1(ynx_original_android_pending_device_pair_v1**p,D*d){++pairCloses;if(pairUnknown){*d={{1,0,13,0},1,0};return;}delete *p;*p=nullptr;*d={{},0,1};}
void ynx_original_android_pending_abort_current_v1(ynx_original_android_abort_context_v1*p,F*f){assert(p==&context);*f={};}
void ynx_original_android_pending_directory_open_v1(ynx_auth_android_pending_source_v1*,ynx_original_android_pending_directory_v1**p,F*f){char name[]="/tmp/ynx-pending-public-XXXXXX";const char*path=reuseDirectory.empty()?mkdtemp(name):reuseDirectory.c_str();assert(path);*p=new ynx_original_android_pending_directory_v1{::open(path,O_RDONLY|O_DIRECTORY|O_CLOEXEC)};assert((*p)->fd>=0);*f={};}
void ynx_original_android_pending_directory_borrow_v1(ynx_original_android_pending_directory_v1*p,int*fd,F*f){*fd=p->fd;*f={};}
void ynx_original_android_pending_directory_current_v1(ynx_original_android_pending_directory_v1*,F*f){*f={};}
void ynx_original_android_pending_directory_close_v1(ynx_original_android_pending_directory_v1**p,D*d){assert(!::close((*p)->fd));delete *p;*p=nullptr;*d={{},0,1};}
int32_t YNXProductSessionDeviceRegistrationSignV4(YNXProductSessionDeviceRegistrationRequestV4*,uint8_t*b,size_t cap,size_t*n,uint32_t*c){++coreCalls;assert(cap>=3);callback(CoreProofClose);callback(CoreSourceClose);callback(CoreExpire);callback(CoreRevoke);b[0]=1;b[1]=2;b[2]=3;*n=3;*c=cleanup;return 0;}
int32_t YNXProductSessionDeviceChallengeSignV4(YNXProductSessionDeviceChallengeRequestV4*,uint8_t*b,size_t cap,size_t*n,uint32_t*c){return YNXProductSessionDeviceRegistrationSignV4(nullptr,b,cap,n,c);}
}
#ifdef YNX_PENDING_COMBINED_ROOT_CONTROL
namespace ynx::social::device_source {
struct SoleCollectorRuntime::State {};
FixedSourceMathBridge::FixedSourceMathBridge():actor_(std::this_thread::get_id()),process_(getpid()){}
SoleCollectorRuntime::SoleCollectorRuntime(Purpose):state_(std::make_unique<State>()){}
SoleCollectorRuntime::~SoleCollectorRuntime()=default;
std::unique_ptr<SoleCollectorRuntime>SoleCollectorRuntime::open_fixed(){assert(false&&"Root empty must precede Main runtime");return {};}
std::unique_ptr<SoleCollectorRuntime>SoleCollectorRuntime::open_pending_fixed(){assert(false&&"Root empty must precede Main runtime");return {};}
CollectedSourceDATA SoleCollectorRuntime::collect_captured_data(const std::string&){assert(false);return {};}
bool SoleCollectorRuntime::close_on_original_actor()noexcept{return true;}
}
extern "C" void ynx_social_android_device_public_get_v1(ynx_auth_android_device_capture_v1*,const ynx_social_android_device_public_get_request_v1*,uint8_t*,size_t,size_t*,F*){assert(false&&"Root empty must precede network");}
#endif
int main(int argc,char**){
#ifdef YNX_PENDING_COMBINED_ROOT_CONTROL
 if(argc>1){reset();F f{};ynx_auth_android_pending_source_open_original_v1(&activeSource,&f);assert(activeSource&&f.present&&f.code==1&&coreCalls==0&&rootOpens==0);sourceClose();group("actual-root-capture-pending7c-native9-rootempty-before-main-os-core");return 0;}
#endif
 if(argc>1){F f{};std::array<uint8_t,1024>b{};size_t used=0;
 reset();end=now()+60;open();hook=CoreExpire;assert(produce().present&&fired&&coreCalls==1);ynx_auth_android_pending_proof_copy_member_v1(activeProof,b.data(),b.size(),&used,&f);assert(!f.present&&used==3);assert(produce().present&&coreCalls==1);proofClose();sourceClose();group("late-expiry-retains-partial-no-second-core");
 reset();open();hook=CoreRevoke;auto fail=produce();assert(fail.present&&fail.code==0&&coreCalls==1);ynx_auth_android_pending_proof_copy_member_v1(activeProof,b.data(),b.size(),&used,&f);assert(!f.present&&used==3);proofClose();sourceClose();group("late-root-revoke-first-zero-retains-original");
 reset();char leaf[]="/tmp/ynx-pending-cold-public-XXXXXX";assert(mkdtemp(leaf));reuseDirectory=leaf;open();assert(!produce().present&&coreCalls==1);proofClose();sourceClose();open();assert(produce().present&&coreCalls==1);ynx_auth_android_pending_status_v1 status{};ynx_auth_android_pending_proof_copy_status_v1(activeProof,&status,&f);assert(!f.present&&status.recovered_original&&status.durable_ack);proofClose();sourceClose();group("cold-original-journal-query-only-no-core");
 return 0;}
 reset();open();assert(!produce().present&&coreCalls==1);proofClose();F f{};ynx_auth_android_pending_source_current_v1(activeSource,&f);assert(!f.present);std::array<uint8_t,1024>b{};B approval{},policy{};ynx_auth_android_pending_source_copy_user_approval_v1(activeSource,b.data(),b.size(),&approval,&policy,&f);assert(!f.present&&approval.length&&policy.length);assert(produce().present&&coreCalls==1&&rootOpens==1);sourceClose();group("proof-closed-parent-live-approval-once");
 reset();kind=2;open();assert(!produce().present&&coreCalls==1);proofClose();sourceClose();group("challenge-distinct-operation");
 reset();open();hook=RootCopy;std::array<uint8_t,262144>reviewbuf{};V v{};ynx_auth_android_pending_source_copy_review_v1(activeSource,reviewbuf.data(),reviewbuf.size(),&v,&f);assert(fired&&f.present);sourceClose();group("reentrant-root-copy-close-pending");
 reset();open();hook=ApprovalCopy;assert(produce().present&&fired&&coreCalls==0);proofClose();sourceClose();group("reentrant-approval-copy-retains-storage");
 reset();open();hook=CoreProofClose;assert(produce().present&&fired&&coreCalls==1&&pairCloses==0);size_t used=0;ynx_auth_android_pending_proof_copy_member_v1(activeProof,b.data(),b.size(),&used,&f);assert(!f.present&&used==3);proofClose();sourceClose();group("reentrant-core-proof-close-public-partial");
 reset();open();hook=CoreSourceClose;assert(produce().present&&fired&&coreCalls==1&&pairCloses==0);proofClose();sourceClose();group("reentrant-core-source-close-drain");
 reset();open();rawZero=true;auto zero=produce();assert(zero.present&&zero.code==0&&coreCalls==0);proofClose();sourceClose();group("first-present-code-zero");
 reset();badOrigin=true;ynx_auth_android_pending_source_open_original_v1(&activeSource,&f);assert(activeSource&&f.present);sourceClose();group("null-origin-rejected-bundle-package-only-null");
 reset();open();badPair=true;assert(produce().present&&coreCalls==0);proofClose();sourceClose();group("full-device-pair-substitution-rejected");
 reset();open();rootRevoked=true;assert(produce().present&&coreCalls==0&&rootOpens==1);sourceClose();group("root-revoke-no-reacquire");
 reset();open();cleanup=3;assert(produce().present&&coreCalls==1);proofClose(false);D d{};ynx_auth_android_pending_source_close_v1(activeSource,&d);assert(!d.physical_done);group("core-cleanup-failed-retains-parent-debt");
 reset();open();assert(!produce().present);pairUnknown=true;proofClose(false);const int selected=pairCloses;proofClose(false);assert(pairCloses==selected);ynx_auth_android_pending_source_close_v1(activeSource,&d);assert(!d.physical_done);group("unknown-close-not-redispatched");
 return 0; // This retained main is renamed when only new journal controls run.
}
