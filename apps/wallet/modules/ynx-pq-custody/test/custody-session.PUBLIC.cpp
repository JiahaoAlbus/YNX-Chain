// PUBLIC control producers ONLY. Not part of module CMake/pod production files.
// These strong test symbols exercise actual bridge code, never real keys/Auth.
#include "CustodySession.h"
#include "SerialCustodyWorker.h"
#include "CustodyABI.h"
#include <cassert>
#include <cstring>
#include <future>
#include <iostream>
#include <map>
#include <functional>
#include <set>
using namespace ynx::mobilepq;
struct YNXMobilePQCapture {bool closed=false;};
struct YNXMobilePQLoan {};
namespace {
struct Config {
 int capture=0,current=0,borrow=0,releaseLoan=0,open=0,sign=0,save=0,begin=0,dispatch=0,query=0,restore=0,close=0;
 int captures=0,borrows=0,opens=0,signs=0,saves=0,begins=0,dispatches=0,queries=0,restores=0,releases=0;
 int expectedCredential=43,failPhase=0,failCurrentAt=0,currentCalls=0;
 bool selected=true,occupied=false,retainPartial=false,submitPreviouslyEntered=true,closeCompleted=true;
 int bindingFailure=0,liveCaptures=0,liveLoans=0,signBegin=0,signBegins=0;
 bool durableSignEntered=false;uint32_t coldFlags=7;
 uint32_t cleanup=2;size_t memberLength=60000;
 std::function<void()> onSign;
} f;
const uint8_t binding[]={1,2},message[]={3,4},policy[]={5,6},version[]={'1'},height[]={'9'},backup[]={8};
uint8_t credential[43];std::map<uint64_t,bool> owners;std::set<uint64_t> signedOwners;uint64_t nextOwner=1;
YNXMobilePQSpan s(const uint8_t* b,size_t n){return {b,n};}
void reset(){assert(owners.empty()&&f.liveCaptures==0&&f.liveLoans==0);f=Config{};memset(credential,'x',43);}
template<class F>void control(const char* name,F run){reset();run();assert(owners.empty()&&f.liveCaptures==0&&f.liveLoans==0);std::cout<<"PASS "<<name<<"\n";}
}
extern "C" {
int32_t ynx_auth_mobile_pq_capture_v1(const uint8_t*,size_t,uint32_t,YNXMobilePQCapture**out){f.captures++;if(!f.capture||f.retainPartial){*out=new YNXMobilePQCapture;f.liveCaptures++;}return f.capture;}
int32_t ynx_auth_mobile_pq_current_v1(YNXMobilePQCapture*,uint32_t phase){f.currentCalls++;return (f.failPhase==int(phase)||f.failCurrentAt==f.currentCalls)?91:f.current;}
int32_t ynx_auth_mobile_pq_inputs_v1(YNXMobilePQCapture*,YNXMobilePQInputs*out){out->binding=s(binding,2);out->message=s(message,2);out->policy=s(policy,2);out->key_version=s(version,1);out->execution_height=s(height,1);out->native_chain_id=6423;return 0;}
int32_t ynx_auth_mobile_pq_read_original_state_v1(YNXMobilePQCapture*,uint32_t*out){*out=f.submitPreviouslyEntered?f.coldFlags:0;return 0;}
int32_t ynx_auth_mobile_pq_borrow_backup43_v1(YNXMobilePQCapture*,YNXMobilePQLoan**out,YNXMobilePQSpan*b,YNXMobilePQSpan*c){f.borrows++;*out=new YNXMobilePQLoan;f.liveLoans++;*b=s(backup,1);*c=s(credential,f.expectedCredential);return f.borrow;}
int32_t ynx_auth_mobile_pq_release_loan_v1(YNXMobilePQLoan*l){if(f.releaseLoan)return f.releaseLoan;delete l;f.liveLoans--;return 0;}
int32_t ynx_auth_mobile_pq_begin_sign_once_v1(YNXMobilePQCapture*,uint64_t id){assert(owners.count(id));f.signBegins++;if(f.durableSignEntered)return 97;f.durableSignEntered=true;return f.signBegin;}
int32_t ynx_auth_mobile_pq_retain_signed_v1(YNXMobilePQCapture*,const uint8_t*b,size_t n){f.saves++;assert(n==f.memberLength&&b[0]==17);return f.save;}
int32_t ynx_auth_mobile_pq_begin_submit_once_v1(YNXMobilePQCapture*){f.begins++;return f.begin;}
int32_t ynx_auth_mobile_pq_dispatch_once_v1(YNXMobilePQCapture*){f.dispatches++;return f.dispatch;}
int32_t ynx_auth_mobile_pq_query_original_v1(YNXMobilePQCapture*){f.queries++;return f.query;}
int32_t ynx_auth_mobile_pq_cancel_v1(YNXMobilePQCapture*){return 0;}
int32_t ynx_auth_mobile_pq_restore_registered_empty_once_v1(YNXMobilePQCapture*,uint64_t id){assert(owners.count(id));f.restores++;return f.occupied?92:f.restore;}
int32_t ynx_auth_mobile_pq_copy_public_v1(YNXMobilePQCapture*,uint32_t kind,uint8_t*b,size_t cap,size_t*n,uint32_t*selected){assert(cap>=2);b[0]=uint8_t(kind);b[1]=255;*n=2;*selected=1;return 0;}
int32_t ynx_auth_mobile_pq_copy_projection_v1(YNXMobilePQCapture*,YNXMobilePQProjection*p){memset(p->account,1,20);memset(p->network_id,2,32);memset(p->request_digest,3,32);p->transaction_hash_present=f.saves?1:0;if(p->transaction_hash_present)memset(p->transaction_hash,4,32);return 0;}
int32_t ynx_auth_mobile_pq_retire_v1(YNXMobilePQCapture*){return 0;}
int32_t ynx_auth_mobile_pq_close_v1(YNXMobilePQCapture*c){if(f.closeCompleted)c->closed=true;return f.close;}
int32_t ynx_auth_mobile_pq_release_closed_v1(YNXMobilePQCapture*c){if(!c->closed)return 93;delete c;f.liveCaptures--;return 0;}
int32_t ynx_auth_pq_native_open_v1(const uint8_t*,size_t,const uint8_t*c,size_t n,const uint8_t*,size_t,uint32_t purpose,uint64_t*out){assert(n==43&&c==credential&&purpose==1&&*out==0);f.opens++;if(f.open)return f.open;*out=nextOwner++;owners[*out]=false;return 0;}
int32_t ynx_auth_pq_native_current_v1(uint64_t id){assert(owners.count(id));return 0;}
int32_t ynx_auth_pq_native_assert_binding_v1(uint64_t id,const uint8_t*b,size_t n){assert(owners.count(id)&&b==binding&&n==2);return f.bindingFailure;}
int32_t ynx_auth_pq_native_transaction_once_v1(uint64_t id,const uint8_t*m,size_t n,const uint8_t*p,size_t pn,uint64_t chain,const uint8_t*,size_t,const uint8_t*,size_t){assert(owners.count(id)&&m==message&&n==2&&p==policy&&pn==2&&chain==6423);signedOwners.insert(id);f.signs++;if(f.onSign)f.onSign();return f.sign;}
int32_t ynx_auth_pq_native_copy_outcome_v1(uint64_t id,uint8_t*b,size_t cap,size_t*n,int32_t*status,uint32_t*cleanup,uint32_t*selected){assert(owners.count(id)&&cap==98304);bool entered=signedOwners.count(id);*selected=entered&&f.selected?1:0;*status=entered?f.sign:-1;*cleanup=entered?f.cleanup:0;*n=*selected&&*status==0&&*cleanup==2?f.memberLength:0;if(*n<=cap)memset(b,17,*n);return 0;}
int32_t ynx_auth_pq_native_retire_v1(uint64_t id){assert(owners.count(id));return 0;}
int32_t ynx_auth_pq_native_close_v1(uint64_t id){assert(owners.count(id));owners[id]=true;return f.sign;}
int32_t ynx_auth_pq_native_release_closed_v1(uint64_t id){assert(owners.at(id));owners.erase(id);signedOwners.erase(id);f.releases++;return 0;}
}
int main(){
 control("prepare captures only original reference; no private borrow",[]{CustodySession x(1);assert(x.prepare("PUBLIC-reference"));assert(f.captures==1&&f.borrows==0);assert(x.copyOriginalPublicOutcome().review[0]==0);assert(x.close());});
 control("partial capture error is owned and drainable",[]{f.capture=81;f.retainPartial=true;CustodySession x(1);assert(!x.prepare("PUBLIC"));assert(x.copyOriginalPublicOutcome().firstCause.code==81);assert(x.close());});
 control("exact43 bound refuses before native open",[]{f.expectedCredential=42;CustodySession x(1);assert(x.prepare("PUBLIC"));assert(!x.signOnce());assert(f.opens==0&&f.signs==0);assert(x.close());});
 control("partial loan error closes loan without opening keys",[]{f.borrow=82;CustodySession x(1);assert(x.prepare("PUBLIC"));assert(!x.signOnce());assert(f.opens==0);assert(x.close());});
 control("loan cleanup debt blocks signing and retains resources",[]{f.releaseLoan=83;CustodySession x(1);assert(x.prepare("PUBLIC"));assert(!x.signOnce());assert(f.signs==0);assert(!x.close());assert(owners.empty());f.releaseLoan=0;assert(x.close());assert(x.copyOriginalPublicOutcome().cleanupCause.code==83);});
 control("sign once copies original bytes then ACK before late current",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));assert(x.signOnce());auto out=x.copyOriginalPublicOutcome();assert(out.member.size()==60000&&out.storageConfirmed&&out.state=="signed-unsubmitted");assert(!x.signOnce());assert(f.signs==1&&f.dispatches==0);assert(x.close());assert(x.copyOriginalPublicOutcome().member==out.member);});
 control("sign error retains original outcome and first cause after close",[]{f.sign=84;CustodySession x(1);assert(x.prepare("PUBLIC"));assert(!x.signOnce());assert(x.copyOriginalPublicOutcome().primitiveStatus==84);assert(x.close());assert(x.copyOriginalPublicOutcome().firstCause.code==84);});
 control("storage lost ACK blocks close; local same-original flush never re-signs",[]{f.save=85;CustodySession x(1);assert(x.prepare("PUBLIC"));assert(!x.signOnce());assert(!x.submitSignedOnce());assert(f.signs==1&&f.dispatches==0);assert(x.copyOriginalPublicOutcome().firstCause.code==85);assert(!x.close());assert(!x.released());f.save=0;assert(x.saveOriginal());assert(x.close());assert(f.signs==1&&f.dispatches==0);assert(x.copyOriginalPublicOutcome().firstCause.code==85);});
 control("broadcast permission is independent from successful signing",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));assert(x.signOnce());f.failPhase=3;assert(!x.submitSignedOnce());assert(f.begins==0&&f.dispatches==0);assert(x.close());});
 control("lost begin ACK forbids resend; original query still works",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));assert(x.signOnce());f.begin=86;assert(!x.submitSignedOnce());assert(!x.submitSignedOnce());assert(f.begins==1&&f.dispatches==0);assert(x.queryOriginal());assert(f.queries==1);assert(x.close());});
 control("dispatch once keeps UNKNOWN and public response on lost reply",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));assert(x.signOnce());f.dispatch=87;assert(!x.submitSignedOnce());auto out=x.copyOriginalPublicOutcome();assert(out.state=="submission-unknown"&&out.submissionSelected&&out.submission[0]==1);assert(!x.submitSignedOnce());assert(f.dispatches==1);assert(x.queryOriginal());auto q=x.copyOriginalPublicOutcome();assert(q.submission==out.submission&&q.query[0]==2);assert(x.queryOriginal());assert(f.queries==1);assert(x.close());});
 control("query rejects signed but unsubmitted originals",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));assert(x.signOnce());assert(!x.queryOriginal());assert(f.queries==0);assert(x.close());});
 control("cancel keeps same original UNKNOWN query; no new effects",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));assert(x.signOnce());assert(x.submitSignedOnce());assert(x.cancel());assert(!x.submitSignedOnce());assert(x.queryOriginal());assert(x.copyOriginalPublicOutcome().cancelled);assert(x.close());});
 control("registered restore uses ordinary purpose and refuses occupied slot",[]{f.occupied=true;CustodySession x(2);assert(x.prepare("PUBLIC-restore"));assert(!x.restoreRegisteredEmptyOnce());assert(f.opens==1&&f.signs==0&&f.restores==1);assert(!x.restoreRegisteredEmptyOnce());assert(x.close());});
 control("registered EMPTY CAS restore is once and never signs",[]{CustodySession x(2);assert(x.prepare("PUBLIC-restore"));assert(x.restoreRegisteredEmptyOnce());assert(x.copyOriginalPublicOutcome().state=="registered-slot-restored");assert(!x.restoreRegisteredEmptyOnce());assert(f.restores==1&&f.signs==0&&f.dispatches==0);assert(x.close());});
 control("ordinary owner ID without exact binding refuses restore",[]{f.bindingFailure=94;CustodySession x(2);assert(x.prepare("PUBLIC"));assert(!x.restoreRegisteredEmptyOnce());assert(f.restores==0);assert(x.copyOriginalPublicOutcome().firstCause.code==94);assert(x.close());});
 control("sticky capture close failure still releases actually closed owner",[]{f.close=95;CustodySession x(1);assert(x.prepare("PUBLIC"));assert(x.close());assert(x.released());assert(x.copyOriginalPublicOutcome().cleanupCause.code==95);assert(x.close());});
 control("unclosed capture retains same debt until true release gate",[]{f.close=96;f.closeCompleted=false;CustodySession x(1);assert(x.prepare("PUBLIC"));assert(!x.close());assert(!x.released()&&f.liveCaptures==1);f.closeCompleted=true;assert(x.close());assert(x.copyOriginalPublicOutcome().cleanupCause.code==96);});
 control("Renderer projection never contains member or response bytes",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));assert(x.signOnce());assert(x.submitSignedOnce());assert(x.queryOriginal());auto p=x.copyProjection();assert(p.member.empty()&&p.review.empty()&&p.submission.empty()&&p.query.empty());assert(p.memberRetained&&p.submissionSelected&&p.querySelected&&p.projectionAvailable);assert(x.close());});
 control("primitive cleanup refusal cannot be promoted to broadcast",[]{f.cleanup=1;CustodySession x(1);assert(x.prepare("PUBLIC"));assert(!x.signOnce());assert(!x.submitSignedOnce());assert(f.dispatches==0&&f.begins==0&&f.signs==1);assert(x.copyOriginalPublicOutcome().firstCause.present);assert(x.close());});
 control("late sign lock keeps signed outcome and original durable ACK",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));f.onSign=[](){f.failPhase=2;};assert(!x.signOnce());auto o=x.copyOriginalPublicOutcome();assert(o.member.size()==60000&&o.storageConfirmed&&o.firstCause.code==91);assert(f.saves==1&&f.signs==1);assert(x.close());});
 control("cold recovery only reads native journal entered state",[]{CustodySession x(3);assert(x.prepare("PUBLIC-original"));assert(!x.signOnce());assert(x.queryOriginal());assert(f.queries==1&&f.borrows==0&&f.dispatches==0);assert(x.close());});
 control("cold recovery missing entered record cannot create UNKNOWN",[]{f.submitPreviouslyEntered=false;CustodySession x(3);assert(!x.prepare("PUBLIC"));assert(!x.queryOriginal());assert(f.queries==0);assert(x.close());});
 control("lost durable SIGN_ENTERED ACK never calls crypto",[]{f.signBegin=98;CustodySession x(1);assert(x.prepare("PUBLIC"));assert(!x.signOnce());assert(f.signBegins==1&&f.signs==0);assert(x.close());});
 control("cold same-reference recapture cannot sign a second time",[]{CustodySession first(1);assert(first.prepare("PUBLIC"));assert(first.signOnce());assert(first.close());CustodySession second(1);assert(second.prepare("PUBLIC"));assert(!second.signOnce());assert(f.signs==1&&f.signBegins==2);assert(second.close());});
 control("cold signing uncertainty can query original without signing or sending",[]{f.coldFlags=1;CustodySession x(3);assert(x.prepare("PUBLIC"));assert(x.copyOriginalPublicOutcome().state=="signing-unknown");assert(x.queryOriginal());assert(f.signs==0&&f.dispatches==0&&f.queries==1);assert(x.close());});
 control("cancel request closes queued signing before native credential borrow",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));x.requestCancel();assert(!x.signOnce());assert(f.borrows==0&&f.signs==0);assert(x.cancel());assert(x.close());});
 control("late retire request preserves signed bytes before refusing further effects",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));f.onSign=[&]{x.requestRetire();};assert(!x.signOnce());auto out=x.copyOriginalPublicOutcome();assert(out.storageConfirmed&&out.memberRetained);assert(!x.submitSignedOnce());assert(f.dispatches==0);assert(x.close());});
 control("callback reentry cannot release native private owner mid-sign",[]{CustodySession x(1);assert(x.prepare("PUBLIC"));f.onSign=[&]{assert(!x.close());assert(!x.signOnce());};assert(!x.signOnce());assert(f.releases==0&&f.signs==1);assert(x.close());});
 control("worker keeps pthread identity across jobs and closes GC debt",[]{
  SerialCustodyWorker worker;auto held=std::make_shared<std::promise<std::shared_ptr<CustodySession>>>();auto future=held->get_future();
  worker.enqueue([&]{held->set_value(worker.prepare("PUBLIC",1));});auto session=future.get();
  auto signedDone=std::make_shared<std::promise<bool>>();auto signedFuture=signedDone->get_future();worker.enqueue([&]{signedDone->set_value(session->signOnce());});assert(signedFuture.get());session.reset();assert(worker.shutdown());assert(f.signs==1&&f.releases==1);
 });
 std::cout<<"30 PUBLIC native bridge controls passed; real Auth/custody/JSI/IO not executed\n";
}
