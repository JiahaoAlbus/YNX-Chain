#ifndef YNX_SOCIAL_JOINT_PUBLIC_CONTROLS
#error "PUBLIC route/client C boundaries are forbidden in production"
#endif
#include "OriginalServices.hpp"
#include "social_joint_profile_issuer_private.h"
#include "social_main_committed_pair_private.h"
#include "ynx_auth_registered_main_pair_read_private_v1.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <thread>
#include <sys/wait.h>
#include <unistd.h>
using namespace ynx::social::joint::original;
struct ynx_auth_registered_main_pair_channel_v1 {int unused=0;};
struct ynx_auth_registered_main_pair_view_v1 {unsigned id=0;};
namespace {
constexpr std::uint64_t loan=0x1020304050607080ULL,capture=0x8877665544332211ULL;
Result failure(int code=0,bool unknown=false){return {true,code,unknown,false};}
bool raw0(Result r){return r.error_present&&r.first==0;}
void status(ynx_social_joint_status_v1*s,bool done=false){*s={1,sizeof(*s),0,0,done?1U:0U,0};}
void late0(ynx_social_joint_status_v1*s,bool unknown=false,bool done=false){*s={1,sizeof(*s),1,0,done?1U:0U,unknown?1U:0U};}
struct Fixture {
 std::string mode;Resource f06{};SourceInput input{};
 int borrows=0,routes=0,sourceCurrent=0,copies=0,opens=0,currents=0,viewOpens=0,viewCopies=0,viewCurrents=0,releases=0,closes=0,localOpens=0,localCloses=0;
 bool revoked=false;const pid_t pid=getpid();
 std::thread::id actor=std::this_thread::get_id();
 std::array<std::string,6> app{"PUBLIC-realm","PUBLIC-client","PUBLIC-network","PUBLIC-identity","PUBLIC-device","PUBLIC-header"};
 Bytes classic=Bytes(33,0x11),pq=Bytes(2592,0x22);
 ynx_auth_registered_main_pair_channel_v1 channel;std::array<ynx_auth_registered_main_pair_view_v1,130> views{};
 std::shared_ptr<SocialHolder>*holderSlot=nullptr;std::shared_ptr<SocialView>*viewSlot=nullptr;
 Fixture(){f06.fill(0x44);input.resource.fill(0x23);input.same_process_capture_reference=capture;for(unsigned i=0;i<4;++i)input.originals[i]=Bytes{static_cast<unsigned char>('A'+i),0,static_cast<unsigned char>(i)};}
};
std::shared_ptr<Fixture> held;
void identity(){assert(held->pid==getpid()&&held->actor==std::this_thread::get_id());}
struct S final:Source {
 std::shared_ptr<Fixture> cfg;explicit S(std::shared_ptr<Fixture>p):cfg(std::move(p)){}
 Result current()noexcept override {++cfg->sourceCurrent;if(cfg->revoked||(cfg->mode=="route-source-post0"&&cfg->routes)||(cfg->mode=="open-source-post0"&&cfg->opens)||(cfg->mode=="view-source-post0"&&cfg->viewCurrents))return failure();return {};}
 Window window()const noexcept override{return{1,100};}
 Result matchCurrentOriginals(const SourceInput&)noexcept override{return{};}
 Result matchBinding(SocialHolder&,DeviceHolder&)noexcept override{return{};}
 Result inspectOriginalBodyDATA(SocialHolder&,DeviceHolder&,const Bytes&)noexcept override{return{};}
 void role(SocialHolder&,DeviceHolder&,const Resource&,const Resource&,std::uint32_t,const Bytes&,const Bytes&,std::shared_ptr<Role>&,Result&r)noexcept override{r=failure(999);}
 Result close()noexcept override{return{false,0,false,true};}
};
struct ForeignHolder final:SocialHolder{int calls=0;Result current()noexcept override{++calls;return{};}void view(std::shared_ptr<SocialView>&,Result&)noexcept override{++calls;}Result close()noexcept override{++calls;return{};}};
void data(const SocialData&d){assert(d.application==held->app&&d.classic_public==held->classic&&d.pq_public==held->pq&&d.window.not_before_ms==10&&d.window.expires_ms==90);for(auto&s:d.application)assert(s.find("PRIVATE-")==std::string::npos);}
void denied(Result r){assert(!r.ok()&&!r.physical_done);}
void run(const std::string&mode){
 held=std::make_shared<Fixture>();const auto cfg=held;cfg->mode=mode;S source(cfg);std::shared_ptr<SocialHolder>owner;cfg->holderSlot=&owner;Result r;
 acquireCommittedSocialPair(source,cfg->f06,owner,r);
 if(mode.rfind("route-",0)==0||mode=="borrow-zero"||mode=="borrow-failed0"){
  assert(!r.ok()&&!owner&&cfg->opens==0&&cfg->localOpens==0);if(mode=="route-late0"||mode=="route-source-post0"||mode=="borrow-failed0")assert(raw0(r));return;
 }
 if(mode=="local-only"||mode=="local-failed0"){
  assert(owner&&cfg->localOpens==1&&cfg->opens==0);if(mode=="local-failed0")assert(raw0(r));else assert(r.ok());auto e=owner->close();assert(e.physical_done&&cfg->localCloses==1&&cfg->opens==0);return;
 }
 assert(owner&&cfg->localOpens==0);
 if(mode=="copy-source-failed0"){assert(raw0(r)&&cfg->opens==0);assert(owner->close().physical_done&&cfg->closes==0);return;}
 assert(cfg->opens==1&&cfg->copies==1);
 if(mode=="open-partial0"||mode=="open-unknown"||mode=="open-source-post0"||mode=="open-revoked"){
  assert(raw0(r));assert(raw0(owner->current())&&cfg->currents==0);auto e=owner->close();assert(raw0(e)&&e.physical_done&&cfg->closes==1);assert(owner->close().physical_done&&cfg->closes==1);return;
 }
 if(mode=="channel0-untouched"){assert(!r.ok()&&r.unknown);assert(!owner->close().physical_done&&cfg->closes==0);assert(!owner->close().physical_done&&cfg->closes==0);return;}
 if(mode=="channel0-known-absence"){assert(!r.ok());assert(owner->close().physical_done&&cfg->closes==0);return;}
 if(mode=="open-status-untouched"){assert(!r.ok()&&r.unknown);assert(owner->close().physical_done&&cfg->closes==1);return;}
 assert(r.ok());
 if(mode=="source-expired"||mode=="source-revoked"){cfg->revoked=true;assert(raw0(owner->current())&&cfg->currents==0);assert(owner->close().physical_done&&cfg->closes==1);return;}
 if(mode=="current-late0"||mode=="current-status-untouched"){auto e=owner->current();assert(!e.ok());if(mode=="current-late0")assert(raw0(e));assert(owner->close().physical_done);return;}
 if(mode=="holder-actor-thread"){std::thread t([&]{assert(owner->current().first==-41504);assert(owner->close().first==-41504);std::shared_ptr<SocialView>v;Result q;owner->view(v,q);assert(q.first==-41504&&!v);});t.join();assert(cfg->currents==0&&cfg->closes==0&&cfg->viewOpens==0);assert(owner->close().physical_done);return;}
 if(mode.rfind("close-",0)==0){auto e=owner->close();if(mode=="close-done-late0")assert(raw0(e)&&e.physical_done);else if(mode=="close-reentrant")assert(e.ok()&&e.physical_done);else assert(e.unknown&&!e.physical_done);assert(owner->close().physical_done==e.physical_done&&cfg->closes==1);return;}
 if(mode=="namespace-foreign"){ForeignHolder f;AccountNamespace ns{"OLD","OLD"};copyOriginalCommittedPairAccountNamespace(f,ns,r);assert(!r.ok()&&f.calls==0&&ns.issuer.empty()&&ns.subject.empty());assert(owner->close().physical_done);return;}
 if(mode.rfind("namespace-",0)==0){AccountNamespace ns;copyOriginalCommittedPairAccountNamespace(*owner,ns,r);assert(ns.issuer=="PRIVATE-ISSUER"&&ns.subject=="PRIVATE-SUBJECT");assert(cfg->viewOpens==1&&cfg->viewCopies==1&&cfg->releases==1);if(mode=="namespace-partial0")assert(raw0(r));if(mode=="namespace-release-unknown"){assert(r.unknown&&!r.physical_done);assert(!owner->close().physical_done&&cfg->closes==0);assert(!owner->close().physical_done&&cfg->releases==1);return;}assert(owner->close().physical_done);return;}
 if(mode=="children64"){std::vector<std::shared_ptr<SocialView>>vs;for(int i=0;i<64;++i){std::shared_ptr<SocialView>v;owner->view(v,r);assert(r.ok()&&v);vs.push_back(v);}std::shared_ptr<SocialView>v;owner->view(v,r);assert(!r.ok()&&!v&&cfg->viewOpens==64);assert(!owner->close().physical_done);for(auto&x:vs)assert(x->release().physical_done);owner->view(v,r);assert(r.ok()&&v&&cfg->viewOpens==65);assert(v->release().physical_done);assert(owner->close().physical_done);return;}
 std::shared_ptr<SocialView>view;cfg->viewSlot=&view;owner->view(view,r);assert(view&&cfg->viewOpens==1);
 if(mode=="view0-untouched"){assert(!r.ok());assert(!view->release().physical_done&&cfg->releases==0);assert(!owner->close().physical_done);return;}
 if(mode=="view0-known-absence"){assert(!r.ok());assert(view->release().physical_done&&cfg->releases==0);assert(owner->close().physical_done);return;}
 assert(cfg->viewCopies==1);
 if(mode=="span-foreign"||mode=="span-end"||mode=="app-too-long"||mode=="public-size"||mode=="private-span"||mode=="private-empty"||mode=="view-size"||mode=="viewid-zero"||mode=="window-negative"||mode=="window-empty"||mode=="window-too-big"){
  assert(!r.ok()&&view->data().classic_public.empty());assert(view->release().physical_done&&cfg->releases==1);assert(owner->close().physical_done);return;
 }
 if(mode=="view-open-late0"||mode=="view-copy-late0"||mode=="view-current-late0"||mode=="view-source-post0"){
  assert(raw0(r));data(view->data());assert(view->release().physical_done&&cfg->releases==1);auto e=owner->close();assert(raw0(e)&&e.physical_done);return;
 }
 if(mode=="view-copy-untouched"){assert(!r.ok()&&r.unknown);data(view->data());assert(view->release().physical_done);assert(owner->close().physical_done);return;}
 assert(r.ok());data(view->data());
 if(mode=="view-actor-thread"||mode=="closed-view-actor"){
  if(mode=="closed-view-actor")assert(view->release().physical_done);
  const auto before=cfg->releases;std::thread t([&]{auto e=view->release();assert(e.first==-41504&&!e.physical_done);});t.join();assert(cfg->releases==before);if(mode!="closed-view-actor")assert(view->release().physical_done);assert(owner->close().physical_done);return;
 }
 if(mode=="actor-pid"){auto pid=fork();assert(pid>=0);if(!pid){assert(owner->current().first==-41504);assert(view->release().first==-41504);_exit(0);}int st=0;assert(waitpid(pid,&st,0)==pid&&WIFEXITED(st)&&!WEXITSTATUS(st));assert(view->release().physical_done);assert(owner->close().physical_done);return;}
 auto e=view->release();
 if(mode=="release-unknown"||mode=="release-pointer0-done0"||mode=="release-status-untouched"||mode=="release-done-pointer-nonzero"){
  assert(!e.physical_done&&e.unknown);assert(!view->release().physical_done&&cfg->releases==1);assert(!owner->close().physical_done&&cfg->closes==0);return;
 }
 if(mode=="release-done-late0")assert(raw0(e)&&e.physical_done);else assert(e.ok()&&e.physical_done);
 assert(view->release().physical_done&&cfg->releases==1);assert(owner->close().physical_done&&cfg->closes==1);
}
}
namespace ynx::social::joint::original {
Result borrowCapturedSourceLoan(Source&s,std::uint64_t&out)noexcept{auto*actual=dynamic_cast<S*>(&s);assert(actual&&actual->cfg==held);++held->borrows;out=held->mode=="borrow-zero"?0:loan;return held->mode=="borrow-failed0"?failure():Result{};}
void copyOriginalCapturedSourceInputs(Source&s,SourceInput&out,Result&r)noexcept{auto*actual=dynamic_cast<S*>(&s);assert(actual&&actual->cfg==held);++held->copies;out=actual->cfg->input;if(held->mode=="copy-source-failed0")r=failure();}
}
extern "C" {
void ynx_auth_social_joint_capture_borrow_main_pair_route_v1(std::uint64_t value,std::uint32_t*out,ynx_social_joint_status_v1*s){identity();assert(value==loan&&*out==0);++held->routes;if(held->mode=="route-untouched")return;*out=held->mode=="local-only"||held->mode=="local-failed0"?1:2;if(held->mode=="route-unmarked")*out=0;if(held->mode=="route-invalid")*out=99;if(held->mode=="route-late0")late0(s);else status(s);if(held->mode=="route-physical")s->physical_done=1;}
void ynx_auth_registered_main_pair_open_v1(const ynx_social_joint_source_input_v1*in,const unsigned char*f06,std::size_t n,ynx_auth_registered_main_pair_channel_v1**out,ynx_social_joint_status_v1*s){identity();++held->opens;assert(in&&in->version==2&&in->size==sizeof(*in)&&in->same_process_capture_reference==0&&*out==nullptr);assert(!std::memcmp(in->registered_source_resource,held->input.resource.data(),32)&&n==32&&!std::memcmp(f06,held->f06.data(),32));const ynx_social_joint_bytes_v1 parts[]={in->registration,in->issuer_credential,in->anchor_credential,in->history_envelope};for(unsigned i=0;i<4;++i)assert(parts[i].size==held->input.originals[i].size()&&!std::memcmp(parts[i].data,held->input.originals[i].data(),parts[i].size));*out=held->mode=="channel0-untouched"||held->mode=="channel0-known-absence"?nullptr:&held->channel;if(held->mode=="open-reentrant"){denied((*held->holderSlot)->close());denied((*held->holderSlot)->current());assert(held->closes==0&&held->currents==0);}if(held->mode=="open-revoked")held->revoked=true;if(held->mode=="channel0-untouched"||held->mode=="open-status-untouched")return;if(held->mode=="open-partial0"||held->mode=="open-unknown")late0(s,held->mode=="open-unknown");else status(s);}
void ynx_auth_registered_main_pair_current_v1(ynx_auth_registered_main_pair_channel_v1*c,ynx_social_joint_status_v1*s){identity();assert(c==&held->channel);++held->currents;if(held->mode=="current-status-untouched")return;if(held->mode=="current-late0")late0(s);else status(s);}
void ynx_auth_registered_main_pair_view_open_v1(ynx_auth_registered_main_pair_channel_v1*c,ynx_auth_registered_main_pair_view_v1**out,ynx_social_joint_status_v1*s){identity();assert(c==&held->channel&&*out==nullptr);auto i=held->viewOpens++;assert(i<130);held->views[i].id=unsigned(i+1);*out=held->mode=="view0-untouched"||held->mode=="view0-known-absence"?nullptr:&held->views[i];if(held->mode=="view0-untouched")return;if(held->mode=="view-open-late0")late0(s);else status(s);}
void ynx_auth_registered_main_pair_view_copy_v1(ynx_auth_registered_main_pair_channel_v1*c,ynx_auth_registered_main_pair_view_v1*v,unsigned char*storage,std::size_t cap,ynx_social_main_pair_view_v1*out,ynx_social_joint_status_v1*s){identity();assert(c==&held->channel&&v&&cap==8192);++held->viewCopies;std::size_t at=0;auto put=[&](const unsigned char*p,std::size_t n){assert(at+n<=cap);auto*q=storage+at;std::memcpy(q,p,n);at+=n;return ynx_social_joint_bytes_v1{q,n};};*out={};out->version=1;out->size=sizeof(*out);out->view=v->id;for(unsigned i=0;i<6;++i)out->application[i]=put(reinterpret_cast<const unsigned char*>(held->app[i].data()),held->app[i].size());out->classic_public=put(held->classic.data(),held->classic.size());out->pq_public=put(held->pq.data(),held->pq.size());const std::string issuer="PRIVATE-ISSUER",subject="PRIVATE-SUBJECT";out->account_issuer=put(reinterpret_cast<const unsigned char*>(issuer.data()),issuer.size());out->account_subject=put(reinterpret_cast<const unsigned char*>(subject.data()),subject.size());out->not_before_ms=10;out->expires_ms=90;static const unsigned char foreign[]="FOREIGN";const auto&m=held->mode;if(m=="span-foreign")out->application[0]={foreign,1};if(m=="span-end")out->pq_public.data=storage+cap-1;if(m=="app-too-long")out->application[0].size=129;if(m=="public-size")out->pq_public.size=2591;if(m=="private-span")out->account_subject={foreign,1};if(m=="private-empty")out->account_issuer.size=0;if(m=="view-size")out->size=191;if(m=="viewid-zero")out->view=0;if(m=="window-negative")out->not_before_ms=-1;if(m=="window-empty")out->expires_ms=10;if(m=="window-too-big")out->expires_ms=9007199254740992LL;if(m=="view-reentrant"){denied((*held->viewSlot)->release());denied((*held->holderSlot)->close());denied((*held->holderSlot)->current());assert(held->releases==0&&held->closes==0&&held->currents==0);}if(m=="view-copy-untouched")return;if(m=="view-copy-late0"||m=="namespace-partial0")late0(s);else status(s);}
void ynx_auth_registered_main_pair_view_current_v1(ynx_auth_registered_main_pair_channel_v1*c,ynx_auth_registered_main_pair_view_v1*v,ynx_social_joint_status_v1*s){identity();assert(c==&held->channel&&v);++held->viewCurrents;if(held->mode=="view-current-late0")late0(s);else status(s);}
void ynx_auth_registered_main_pair_view_release_v1(ynx_auth_registered_main_pair_channel_v1*c,ynx_auth_registered_main_pair_view_v1**v,ynx_social_joint_status_v1*s){identity();assert(c==&held->channel&&*v);++held->releases;if(held->mode=="release-reentrant"){denied((*held->viewSlot)->release());denied((*held->holderSlot)->close());assert(held->releases==1&&held->closes==0);}if(held->mode=="release-unknown"||held->mode=="namespace-release-unknown"){late0(s,true);return;}if(held->mode!="release-done-pointer-nonzero")*v=nullptr;if(held->mode=="release-status-untouched")return;if(held->mode=="release-pointer0-done0"){status(s);return;}if(held->mode=="release-done-late0")late0(s,false,true);else status(s,true);}
void ynx_auth_registered_main_pair_close_v1(ynx_auth_registered_main_pair_channel_v1**c,ynx_social_joint_status_v1*s){identity();assert(*c==&held->channel);++held->closes;if(held->mode=="close-reentrant"){denied((*held->holderSlot)->close());denied((*held->holderSlot)->current());assert(held->closes==1);}if(held->mode=="close-ambiguous"){late0(s,true);return;}if(held->mode!="close-done-pointer-nonzero")*c=nullptr;if(held->mode=="close-status-untouched")return;if(held->mode=="close-pointer0-done0"){status(s);return;}if(held->mode=="close-done-late0")late0(s,false,true);else status(s,true);}
void ynx_social_main_committed_pair_open_v1(std::uint64_t value,unsigned char*f06,std::size_t n,std::uint64_t*out,ynx_social_joint_status_v1*s){identity();assert(value==loan&&n==32&&!std::memcmp(f06,held->f06.data(),32)&&*out==0);++held->localOpens;*out=42;if(held->mode=="local-failed0")late0(s);else status(s);}
void ynx_social_main_committed_pair_current_v1(std::uint64_t,ynx_social_joint_status_v1*){assert(false);}
void ynx_social_main_committed_pair_view_open_v1(std::uint64_t,unsigned char*,std::size_t,ynx_social_main_pair_view_v1*,ynx_social_joint_status_v1*){assert(false);}
void ynx_social_main_committed_pair_view_release_v1(std::uint64_t,std::uint64_t*,ynx_social_joint_status_v1*){assert(false);}
void ynx_social_main_committed_pair_close_v1(std::uint64_t*out,ynx_social_joint_status_v1*s){identity();assert(*out==42);++held->localCloses;*out=0;status(s,true);}
}
int main(int argc,char**argv){assert(argc==2);run(argv[1]);std::cout<<"PASS "<<argv[1]<<" actual Native3CPP; PUBLIC C7client+route1+local5/Source boundaries; no Go/Root/transport/keys\n";}
