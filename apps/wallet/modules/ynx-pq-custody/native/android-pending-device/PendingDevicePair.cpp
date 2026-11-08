#include "PendingReviewOwner.h"
#include <PendingMainCalleePrivate.h>
#include <atomic>
#include <cstring>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <unistd.h>
namespace {
using F=ynx_auth_android_provision_failure_v1;using D=ynx_auth_android_provision_drain_v1;
using Source=ynx_auth_android_pending_source_v1;using Main=ynx_main_android_pending_pair_hold_v1;
using Borrow=ynx_original_android_pending_pair_borrow_v1;using ReviewOwner=ynx::mobilepq::android_pending::PendingReviewOwner;
static_assert(sizeof(Borrow)==72,"actual Main pair borrow ABI");
constexpr uint32_t origin=0x4e505041;
enum Code:int32_t{Invalid=2,Changed=3,Actor=6,Retired=7,Internal=8,Once=9,Pending=10,Limit=11};
F error(Code c){return{1,int32_t(c),origin,0};}
bool valid(F f){return f.present<=1&&(f.present||(!f.code&&!f.origin&&!f.platform_code));}
F checked(F f){return valid(f)?f:error(Invalid);}
void keep(F&first,F f){f=checked(f);if(f.present&&!first.present)first=f;}
struct NativeActor{
 const pid_t pid=getpid();const uid_t uid=geteuid();const gid_t gid=getegid();const std::thread::id thread=std::this_thread::get_id();
 bool same()const noexcept{return pid==getpid()&&thread==std::this_thread::get_id()&&uid==geteuid()&&gid==getegid();}
};
struct Pair{
 const NativeActor actor;Source*const source;std::atomic<bool>retired{false};
 std::shared_ptr<ReviewOwner>review;Main*main=nullptr;F first{};
 bool ready=false,busy=false,borrowSelected=false,mainRetireSelected=false,mainCloseInFlight=false,mainUnknown=false,closed=false;
 explicit Pair(Source*s):source(s){}
 F local()const{if(!actor.same())return error(Actor);if(retired.load(std::memory_order_acquire)||closed)return error(Retired);return first;}
 F observed(F f){f=checked(f);keep(first,f);return f.present?first:local();}
 F authorize(){auto f=local();if(f.present)return f;if(!review)return error(Internal);f=review->requireIndependentApproval();return observed(f);}
 F current(Source*s){
  auto f=local();if(f.present)return f;if(s!=source)return error(Changed);if(!ready||!main)return error(Invalid);
  f=authorize();if(f.present)return f;f=local();if(f.present)return f;
  F actual=error(Internal);ynx_main_android_pending_pair_hold_current_v1(main,source,&actual);
  f=observed(actual);if(f.present)return f;return authorize();
 }
};
struct Inventory{std::mutex mutex;uintptr_t next=1;size_t active=0;std::unordered_map<uintptr_t,std::shared_ptr<Pair>>rows;};
Inventory&inventory(){static auto*p=new Inventory;return*p;}
std::shared_ptr<Pair>known(void*p){auto&i=inventory();std::lock_guard<std::mutex>lock(i.mutex);auto it=i.rows.find(reinterpret_cast<uintptr_t>(p));return it==i.rows.end()?nullptr:it->second;}
struct Call{Pair&p;explicit Call(Pair&v):p(v){if(p.busy)throw error(Pending);p.busy=true;}~Call(){p.busy=false;}};
void open(Pair&p){
 auto f=ReviewOwner::acquire(p.source,p.review);if((f=p.observed(f)).present)throw f;
 f=p.authorize();if(f.present)throw f;f=p.local();if(f.present)throw f;
 F actual=error(Internal);ynx_main_android_pending_pair_hold_capture_v1(p.source,&p.main,&actual); // adopt partial first
 f=p.observed(actual);if(f.present)throw f;if(!p.main)throw error(Internal);
 p.ready=true;f=p.current(p.source);if(f.present)throw f;
}
bool untouched(const Borrow&b){return !b.version&&!b.size&&!b.der_a.bytes&&!b.der_a.length&&!b.der_b.bytes&&!b.der_b.length&&!b.pk_a.bytes&&!b.pk_a.length&&!b.pk_b.bytes&&!b.pk_b.length;}
bool shape(const Borrow&b){return b.version==1&&b.size==sizeof(b)&&b.der_a.bytes&&b.der_a.length==54&&b.der_b.bytes&&b.der_b.length==150&&b.pk_a.bytes&&b.pk_a.length==2592&&b.pk_b.bytes&&b.pk_b.length==64;}
D close(Pair&p){
 if(!p.actor.same())return{error(Actor),0,0};p.retired.store(true,std::memory_order_release);if(p.review)p.review->retire();
 if(p.closed)return{p.first,0,1};if(p.busy)return{p.first,p.mainCloseInFlight||p.mainUnknown?1u:0u,0};Call call(p);
 if(p.mainUnknown)return{p.first,1,0};
 if(p.main){
  if(!p.mainRetireSelected){p.mainRetireSelected=true;try{ynx_main_android_pending_pair_hold_retire_v1(p.main);}catch(...){keep(p.first,error(Internal));}}
  Main*original=p.main;D d{error(Internal),UINT32_MAX,UINT32_MAX};p.mainCloseInFlight=true;
  try{ynx_main_android_pending_pair_hold_close_v1(&p.main,&d);}catch(...){p.mainCloseInFlight=false;p.mainUnknown=true;keep(p.first,error(Internal));return{p.first,1,0};}
  p.mainCloseInFlight=false;keep(p.first,d.failure);
  const bool validDrain=valid(d.failure)&&d.unknown<=1&&d.physical_done<=1&&!(d.unknown&&d.physical_done);
  if(!validDrain||(!p.main&&!d.physical_done)||(p.main&&d.physical_done)){if(!p.main)p.main=original;keep(p.first,error(Invalid));p.mainUnknown=true;return{p.first,1,0};}
  if(!d.physical_done){if(d.unknown)p.mainUnknown=true;return{p.first,d.unknown,0};}
 }
 p.closed=true;p.ready=false;p.review.reset();auto&i=inventory();{std::lock_guard<std::mutex>lock(i.mutex);if(i.active)--i.active;}return{p.first,0,1};
}
}
extern "C" void ynx_original_android_pending_pair_open_v1(Source*source,ynx_original_android_pending_device_pair_v1**out,F*f){
 if(!f)return;*f=error(Invalid);if(!out||*out||!source)return;std::shared_ptr<Pair>p;
 try{p=std::make_shared<Pair>(source);auto&i=inventory();{std::lock_guard<std::mutex>lock(i.mutex);if(i.active>=64||i.next>16384)throw error(Limit);++i.next;auto id=reinterpret_cast<uintptr_t>(p.get());i.rows.emplace(id,p);++i.active;*out=reinterpret_cast<ynx_original_android_pending_device_pair_v1*>(id);}Call call(*p);open(*p);*f={};}
 catch(F e){if(p)keep(p->first,e);*f=p?p->first:e;}catch(...){if(p)keep(p->first,error(Internal));*f=p?p->first:error(Internal);}
}
extern "C" void ynx_original_android_pending_pair_current_v1(ynx_original_android_pending_device_pair_v1*raw,Source*source,F*f){
 if(!f)return;*f=error(Invalid);auto p=known(raw);if(!p)return;if(!p->actor.same()){*f=error(Actor);return;}
 try{Call call(*p);*f=p->current(source);if(f->present&&!p->closed)keep(p->first,*f);}catch(F e){*f=e;}catch(...){keep(p->first,error(Internal));*f=p->first;}
}
extern "C" void ynx_original_android_pending_pair_borrow_once_v1(ynx_original_android_pending_device_pair_v1*raw,Source*source,Borrow*out,F*f){
 if(!f)return;*f=error(Invalid);auto p=known(raw);if(!p)return;if(!p->actor.same()){*f=error(Actor);return;}if(!out||!untouched(*out))return;
 try{Call call(*p);auto gate=p->local();if(gate.present)throw gate;if(source!=p->source)throw error(Changed);if(p->borrowSelected)throw error(Once);p->borrowSelected=true;
  auto e=p->current(source);if(e.present)throw e;e=p->review->selectPrivateBorrowOnce();if((e=p->observed(e)).present)throw e;
  // Native current, including its independent retire bit, immediately before
  // the actual protected callee; external Root-only current is insufficient.
  e=p->current(source);if(e.present)throw e;e=p->local();if(e.present)throw e;
  Borrow actual{};F observed=error(Internal);
  try{ynx_main_android_pending_pair_hold_borrow_once_v1(p->main,source,&actual,&observed);}
  catch(...){
   *out=actual; // adopt late/partial DATA before interpreting foreign exception
   auto cause=!valid(observed)?error(Invalid):(observed.present?observed:error(Internal));
   keep(p->first,cause);throw p->first;
  }
  *out=actual; // Main still owns every nonnull late/partial secret loan
  e=p->observed(observed);if(e.present)throw e;
  if(!shape(actual))throw error(Invalid);auto*v=p->review->originalReviewForNative();if(!v)throw error(Retired);
  if(std::memcmp(v->device_pk_a,actual.pk_a.bytes,2592)||std::memcmp(v->device_pk_b,actual.pk_b.bytes,64))throw error(Changed);
  e=p->current(source);if(e.present)throw e;*f={};
 }catch(F e){if(!p->closed&&!(e.origin==origin&&(e.code==Once||e.code==Pending)))keep(p->first,e);*f=p->first.present?p->first:e;}
 catch(...){keep(p->first,error(Internal));*f=p->first;}
}
extern "C" void ynx_original_android_pending_pair_retire_v1(ynx_original_android_pending_device_pair_v1*raw){auto p=known(raw);if(p)p->retired.store(true,std::memory_order_release);}
extern "C" void ynx_original_android_pending_pair_close_v1(ynx_original_android_pending_device_pair_v1**raw,D*out){
 if(!out)return;*out={error(Invalid),0,0};if(!raw||!*raw)return;auto p=known(*raw);if(!p)return;
 try{*out=close(*p);if(out->physical_done)*raw=nullptr;}catch(F e){*out={e,0,0};}catch(...){keep(p->first,error(Internal));*out={p->first,1,0};}
}
