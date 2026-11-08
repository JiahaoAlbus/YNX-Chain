#ifndef YNX_ANDROID_PENDING_PAIR_ABORT_PUBLIC_CONTROLS
#error "Finite PUBLIC metadata/failure delegation controls only"
#endif
// Finite PUBLIC Source/approval edge, no prior directory test/body involved.
#include "android-pending-source-fixture.PUBLIC.h"
namespace {std::atomic<int>livePublicSpans{0};}
struct PublicInvalidPKCS8SpanStorage{
 const std::array<uint8_t,54>a=[](){std::array<uint8_t,54>v{};v.fill(0xa5);return v;}();
 const std::array<uint8_t,150>b=[](){std::array<uint8_t,150>v{};v.fill(0x5a);return v;}();
 const std::array<uint8_t,2592>pa=[](){std::array<uint8_t,2592>v{};v[0]=1;return v;}();
 const std::array<uint8_t,64>pb=[](){std::array<uint8_t,64>v{};v[0]=2;return v;}();
 PublicInvalidPKCS8SpanStorage(){++livePublicSpans;}~PublicInvalidPKCS8SpanStorage(){--livePublicSpans;}
};
struct ynx_main_android_pending_pair_hold_v1{bool retired=false,closed=false;std::unique_ptr<const PublicInvalidPKCS8SpanStorage>spans;};
namespace {
int pairCapture=0,pairCurrent=0,pairBorrow=0,pairRetire=0,pairClose=0,abortCalls=0;
bool throwBorrowRaw0=false,throwBorrowSuccess=false;
bool capture0=false,current0=false,malformedBorrow=false,retireBorrow=false,retireAnd0=false,borrowReentry=false,captureSwitch=false,sentinelPublication=false,lateSourceAfterSpan=false;
bool pairUnknown=false,pairPending=false,pairNullNoAck=false,pairUntouched=false,pairClose0=false,pairCloseReentry=false;
ynx_original_android_pending_device_pair_v1**pairPublished=nullptr;D pairNested{};
std::vector<std::unique_ptr<ynx_main_android_pending_pair_hold_v1>>pairHolds;
std::array<uint8_t,2592>publicA{};std::array<uint8_t,64>publicB{};
int rawAbortObject=1;auto*rawAbort=reinterpret_cast<ynx_original_android_abort_context_v1*>(&rawAbortObject);std::string abortMode;
void pairReenter(){if(pairPublished&&*pairPublished)ynx_original_android_pending_pair_close_v1(pairPublished,&pairNested);}
}
extern "C" void ynx_main_android_pending_pair_hold_capture_v1(Source*s,ynx_main_android_pending_pair_hold_v1**out,F*f){++pairCapture;if(s!=source){*f=invalid();return;}auto h=std::make_unique<ynx_main_android_pending_pair_hold_v1>();*out=h.get();pairHolds.push_back(std::move(h));if(captureSwitch)sourceID="changed-source";*f=capture0?fail():F{};}
extern "C" void ynx_main_android_pending_pair_hold_current_v1(ynx_main_android_pending_pair_hold_v1*,Source*s,F*f){++pairCurrent;*f=s!=source?invalid():(current0?fail():F{});}
extern "C" void ynx_main_android_pending_pair_hold_borrow_once_v1(ynx_main_android_pending_pair_hold_v1*held,Source*s,ynx_original_android_pending_pair_borrow_v1*out,F*f){
 ++pairBorrow;if(s!=source){*f=invalid();return;}publicA[0]=1;publicB[0]=2;*out={1,sizeof(*out),{},{},{publicA.data(),publicA.size()},{publicB.data(),publicB.size()}};
 // Optional PUBLIC readonly byte sentinels are deliberately INVALID PKCS8.
 // They exercise span ownership only; no Core function exists or is invoked.
 if(sentinelPublication){held->spans=std::make_unique<const PublicInvalidPKCS8SpanStorage>();auto&v=*held->spans;*out={1,sizeof(*out),{v.a.data(),v.a.size()},{v.b.data(),v.b.size()},{v.pa.data(),v.pa.size()},{v.pb.data(),v.pb.size()}};}
 if(lateSourceAfterSpan)sourceID="changed-after-public-span";
 if(retireBorrow||retireAnd0){auto*raw=*pairPublished;std::thread other([&]{ynx_original_android_pending_pair_retire_v1(raw);});other.join();}
 if(borrowReentry)pairReenter();*f=malformedBorrow||retireBorrow||sentinelPublication||throwBorrowSuccess?F{}:fail();if(throwBorrowRaw0||throwBorrowSuccess)throw 1;
}
extern "C" void ynx_main_android_pending_pair_hold_retire_v1(ynx_main_android_pending_pair_hold_v1*p){++pairRetire;p->retired=true;}
extern "C" void ynx_main_android_pending_pair_hold_close_v1(ynx_main_android_pending_pair_hold_v1**p,D*out){++pairClose;if(pairCloseReentry){pairCloseReentry=false;pairReenter();}if(pairUntouched)return;if(pairUnknown){*out={{},1,0};return;}if(pairNullNoAck){*p=nullptr;*out={{},0,0};return;}if(pairPending){pairPending=false;*out={fail(),0,0};return;}(*p)->spans.reset();(*p)->closed=true;*p=nullptr;*out={pairClose0?fail():F{},0,1};}
extern "C" void ynx_main_android_pending_original_abort_current_v1(ynx_original_android_abort_context_v1*p,F*f){
 ++abortCalls;if(p!=rawAbort){*f=fail(22);return;}if(abortMode=="raw0"||abortMode=="throw-raw0"){*f=fail();if(abortMode=="throw-raw0")throw 1;return;}
 if(abortMode=="nonbool"){*f={2,0,0,0};return;}if(abortMode=="absent-code"){*f={0,7,0,0};return;}if(abortMode=="absent-origin"){*f={0,0,7,0};return;}if(abortMode=="absent-platform"){*f={0,0,0,7};return;}if(abortMode=="throw-untouched")throw 1;*f={};if(abortMode=="throw-success")throw 1;
}
int main(int argc,char**argv){
 if(argc!=2)return 2;std::string mode=argv[1];
 if(mode.rfind("abort-",0)==0){abortMode=mode.substr(6);F f{};auto*p=abortMode=="invalid-context"?reinterpret_cast<ynx_original_android_abort_context_v1*>(uintptr_t(0x777)):rawAbort;if(abortMode=="null")p=nullptr;ynx_original_android_pending_abort_current_v1(p,&f);
  if(abortMode=="success")CHECK(!f.present&&abortCalls==1);else if(abortMode=="raw0"||abortMode=="throw-raw0")CHECK(f.present&&f.code==0&&f.platform_code==41&&f.origin==0x5055424c);else CHECK(f.present==1);if(abortMode=="null")CHECK(abortCalls==0);std::printf("PASS %s fixed raw-context F24 delegation only\n",mode.c_str());return 0;
 }
 if(mode=="source0")sourceLate0=true;if(mode=="approval0")approvalLate0=true;if(mode=="capture0")capture0=true;if(mode=="capture-source-switch")captureSwitch=true;
 ynx_original_android_pending_device_pair_v1*p=nullptr;pairPublished=&p;F f{};ynx_original_android_pending_pair_open_v1(source,&p,&f);CHECK(p);
 if(mode=="source0"||mode=="approval0"||mode=="capture0"||mode=="capture-source-switch"){
  CHECK(f.present);if(mode!="capture-source-switch")CHECK(f.code==0&&f.platform_code==41);if(mode=="source0"||mode=="approval0")CHECK(pairCapture==0);D d{};auto first=f;ynx_original_android_pending_pair_close_v1(&p,&d);CHECK(!p&&d.physical_done&&d.failure.present&&d.failure.code==first.code&&d.failure.platform_code==first.platform_code&&pairClose==pairCapture&&pairBorrow==0);std::puts("PASS partial pair capture/first0 cleanup without private borrow");return 0;
 }
 CHECK(!f.present);
 if(mode=="current0"){current0=true;ynx_original_android_pending_pair_current_v1(p,source,&f);CHECK(f.present&&f.code==0);}
 if(mode=="wrong-source"){int other=2;ynx_original_android_pending_pair_current_v1(p,reinterpret_cast<Source*>(&other),&f);CHECK(f.present);}
 if(mode=="retire-anythread"){auto q=p;std::thread thread([&]{ynx_original_android_pending_pair_retire_v1(q);});thread.join();auto calls=pairCurrent;ynx_original_android_pending_pair_current_v1(p,source,&f);CHECK(f.present&&calls==pairCurrent);}
 if(mode=="actor"){
  std::atomic<bool>ok{false};auto q=p;std::thread thread([&]{F f{};ynx_original_android_pending_pair_current_v1(q,source,&f);D d{};auto raw=q;ynx_original_android_pending_pair_close_v1(&raw,&d);ok=f.present&&!d.physical_done&&raw==q;});thread.join();CHECK(ok);auto pid=fork();CHECK(pid>=0);if(!pid){F f{};ynx_original_android_pending_pair_current_v1(q,source,&f);_exit(f.present?0:4);}int status=0;CHECK(waitpid(pid,&status,0)==pid&&WIFEXITED(status)&&!WEXITSTATUS(status));
 }
 if(mode=="capacity"){
  std::vector<ynx_original_android_pending_device_pair_v1*>all{p};for(int i=1;i<64;++i){ynx_original_android_pending_device_pair_v1*q=nullptr;ynx_original_android_pending_pair_open_v1(source,&q,&f);CHECK(q&&!f.present);all.push_back(q);}ynx_original_android_pending_device_pair_v1*extra=nullptr;ynx_original_android_pending_pair_open_v1(source,&extra,&f);CHECK(!extra&&f.present);for(auto q:all){D d{};ynx_original_android_pending_pair_close_v1(&q,&d);CHECK(!q&&d.physical_done);}for(int i=0;i<70;++i){ynx_original_android_pending_device_pair_v1*q=nullptr;ynx_original_android_pending_pair_open_v1(source,&q,&f);CHECK(q&&!f.present);D d{};ynx_original_android_pending_pair_close_v1(&q,&d);CHECK(!q&&d.physical_done);}CHECK(pairBorrow==0);std::puts("PASS bounded active metadata and closed history reuse without keys");return 0;
 }
 if(mode=="sentinel-publication"||mode=="sentinel-postsource-refusal"){
  sentinelPublication=true;lateSourceAfterSpan=mode=="sentinel-postsource-refusal";ynx_original_android_pending_pair_borrow_v1 b{};ynx_original_android_pending_pair_borrow_once_v1(p,source,&b,&f);
  CHECK(pairBorrow==1&&livePublicSpans==1&&b.der_a.length==54&&b.der_b.length==150&&b.der_a.bytes[0]==0xa5&&b.der_b.bytes[0]==0x5a);CHECK((mode=="sentinel-publication")?!f.present:f.present);
  // The readonly sentinels are invalid DER and MUST NOT be passed to Core.
  ynx_original_android_pending_pair_borrow_v1 again{};ynx_original_android_pending_pair_borrow_once_v1(p,source,&again,&f);CHECK(f.present&&pairBorrow==1&&livePublicSpans==1&&!again.version);
 }
 if(mode=="borrow-raw0"||mode=="borrow-malformed"||mode=="retire-borrow"||mode=="retire-raw0"||mode=="borrow-reentry"||mode=="borrow-throw-raw0"||mode=="borrow-throw-success"||mode=="revoke-before-borrow"){
  throwBorrowRaw0=mode=="borrow-throw-raw0";throwBorrowSuccess=mode=="borrow-throw-success";malformedBorrow=mode=="borrow-malformed";retireBorrow=mode=="retire-borrow";retireAnd0=mode=="retire-raw0";borrowReentry=mode=="borrow-reentry";if(mode=="revoke-before-borrow")revoked=true;
  ynx_original_android_pending_pair_borrow_v1 b{};ynx_original_android_pending_pair_borrow_once_v1(p,source,&b,&f);CHECK(f.present);if(mode=="revoke-before-borrow")CHECK(pairBorrow==0);else CHECK(pairBorrow==1&&b.version==1&&b.pk_a.length==2592&&b.der_a.bytes==nullptr&&b.der_b.bytes==nullptr);
  if(mode=="borrow-raw0"||mode=="retire-raw0"||mode=="borrow-reentry"||mode=="borrow-throw-raw0")CHECK(f.code==0&&f.platform_code==41);if(mode=="borrow-reentry")CHECK(!pairNested.unknown&&!pairNested.physical_done&&p);
  ynx_original_android_pending_pair_borrow_v1 again{};int calls=pairBorrow;ynx_original_android_pending_pair_borrow_once_v1(p,source,&again,&f);CHECK(f.present&&calls==pairBorrow&&!again.version);
 }
 if(mode=="lookup-race"){
  auto q=p;std::atomic<bool>ready{false},go{false};std::atomic<int>n{0};std::thread thread([&]{ready=true;while(!go)std::this_thread::yield();for(int i=0;i<1000;++i){F x{};ynx_original_android_pending_pair_current_v1(q,source,&x);if(x.present)++n;}});while(!ready)std::this_thread::yield();go=true;D d{};ynx_original_android_pending_pair_close_v1(&p,&d);thread.join();CHECK(n==1000&&!p&&d.physical_done);std::puts("PASS shared pair lookup concurrent foreign close");return 0;
 }
 if(mode=="close-unknown")pairUnknown=true;if(mode=="close-noack")pairNullNoAck=true;if(mode=="close-untouched")pairUntouched=true;if(mode=="close-late0")pairClose0=true;if(mode=="close-pending")pairPending=true;if(mode=="close-reentry")pairCloseReentry=true;
 D d{};ynx_original_android_pending_pair_close_v1(&p,&d);CHECK(pairRetire==1);
 if(mode=="close-unknown"||mode=="close-noack"||mode=="close-untouched"){CHECK(p&&d.unknown&&!d.physical_done);int calls=pairClose;ynx_original_android_pending_pair_close_v1(&p,&d);CHECK(p&&d.unknown&&!d.physical_done&&pairClose==calls&&pairRetire==1);std::puts("PASS UNKNOWN/noack retains same pair debt without retry");return 0;}
 if(mode=="close-pending"){CHECK(p&&!d.unknown&&!d.physical_done&&d.failure.present&&d.failure.code==0);int calls=authCalls+approvalCalls;revoked=true;ynx_original_android_pending_pair_close_v1(&p,&d);CHECK(!p&&d.physical_done&&d.failure.present&&d.failure.code==0&&pairClose==2&&pairRetire==1&&authCalls+approvalCalls==calls);}
 else CHECK(!p&&d.physical_done&&!d.unknown&&pairClose==1);CHECK(livePublicSpans==0);
 if(mode=="current0"||mode=="close-late0"||mode=="borrow-raw0"||mode=="retire-raw0"||mode=="borrow-throw-raw0")CHECK(d.failure.present&&d.failure.code==0&&d.failure.platform_code==41);
 if(mode=="close-reentry")CHECK(pairNested.unknown&&!pairNested.physical_done);
 std::printf("PASS %s metadata/debt only, no genuine private DER/Core execution\n",mode.c_str());return 0;
}
