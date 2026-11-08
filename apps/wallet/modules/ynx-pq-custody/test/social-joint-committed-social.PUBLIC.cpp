#ifndef YNX_SOCIAL_JOINT_PUBLIC_CONTROLS
#error "PUBLIC Main C5 and Source-loan seam forbidden in production"
#endif
#include "OriginalServices.hpp"
#include "social_main_committed_pair_private.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <thread>
#include <vector>
#include <sys/wait.h>
#include <unistd.h>
using namespace ynx::social::joint::original;
namespace {
constexpr std::uint64_t sourceLoan=0x1020304050607080ULL,ownerID=0x210;
Result failed(int code=0,bool unknown=false){return{true,code,unknown,false};}
bool raw0(Result r){return r.error_present&&r.first==0;}
struct Fixture{
 Resource f06{};std::string mode;int borrows=0,opens=0,currents=0,viewOpens=0,releases=0,closes=0;std::uint64_t nextView=0x310;const pid_t pid=getpid();const std::thread::id actor=std::this_thread::get_id();
 std::array<std::string,6>app{"PUBLIC-realm","PUBLIC-client","PUBLIC-network","PUBLIC-identity","PUBLIC-device","PUBLIC-header"};Bytes classic=Bytes(33,0x11),pq=Bytes(2592,0x22);std::shared_ptr<SocialHolder>*holderSlot=nullptr;std::shared_ptr<SocialView>*viewSlot=nullptr;Fixture(){f06.fill(0x44);}
};
std::shared_ptr<Fixture>heldCfg;
struct S final:Source{std::shared_ptr<Fixture>cfg;explicit S(std::shared_ptr<Fixture>x):cfg(std::move(x)){}Result current()noexcept override{return cfg->mode=="source-post0"&&cfg->opens?failed():Result{};}Window window()const noexcept override{return{1,100};}Result matchCurrentOriginals(const SourceInput&)noexcept override{return{};}Result matchBinding(SocialHolder&,DeviceHolder&)noexcept override{return{};}Result inspectOriginalBodyDATA(SocialHolder&,DeviceHolder&,const Bytes&)noexcept override{return{};}void role(SocialHolder&,DeviceHolder&,const Resource&,const Resource&,std::uint32_t,const Bytes&,const Bytes&,std::shared_ptr<Role>&,Result&r)noexcept override{r=failed(90);}Result close()noexcept override{return{false,0,false,true};}};
void identity(){assert(heldCfg->pid==getpid()&&heldCfg->actor==std::this_thread::get_id());}
void success(ynx_social_joint_status_v1*s,bool physical=false){*s={1,sizeof(*s),0,0,physical?1U:0U,0};}
void zero(ynx_social_joint_status_v1*s,bool unknown=false,bool physical=false){*s={1,sizeof(*s),1,0,physical?1U:0U,unknown?1U:0U};}
void exactData(const SocialData&data,const std::shared_ptr<Fixture>&cfg){assert(data.application==cfg->app&&data.classic_public==cfg->classic&&data.pq_public==cfg->pq&&data.window.not_before_ms==10&&data.window.expires_ms==90);for(const auto&s:data.application)assert(s.find("PRIVATE-ACCOUNT")==std::string::npos);}
void denied(Result r){assert(!r.ok()&&!r.physical_done);}
void run(const std::string&mode){heldCfg=std::make_shared<Fixture>();auto cfg=heldCfg;cfg->mode=mode;S source(cfg);std::shared_ptr<SocialHolder>holder;cfg->holderSlot=&holder;Result r;acquireCommittedSocialPair(source,cfg->f06,holder,r);
 if(mode=="borrow-failed0"||mode=="borrow-zero"){assert(!r.ok()&&!holder&&cfg->opens==0&&cfg->borrows==1);if(mode=="borrow-failed0")assert(raw0(r));return;}
 assert(holder&&cfg->borrows==1&&cfg->opens==1);
 if(mode=="open-partial0"||mode=="open-unknown"||mode=="source-post0"){assert(raw0(r));assert(raw0(holder->current())&&cfg->currents==0);auto closed=holder->close();assert(raw0(closed)&&closed.physical_done&&cfg->closes==1);assert(holder->close().physical_done&&cfg->closes==1);return;}
 if(mode=="owner0-untouched"){assert(!r.ok()&&r.unknown);assert(!holder->close().physical_done&&cfg->closes==0);assert(!holder->close().physical_done&&cfg->closes==0);return;}
 if(mode=="owner0-known-absence"){assert(!r.ok());assert(holder->close().physical_done&&cfg->closes==0);return;}
 if(mode=="open-untouched"){assert(!r.ok()&&r.unknown);assert(holder->close().physical_done&&cfg->closes==1);return;}
 assert(r.ok());
 if(mode=="actor-holder-thread"){std::thread t([&]{auto a=holder->current();auto b=holder->close();std::shared_ptr<SocialView>v;Result c;holder->view(v,c);assert(a.first==-41304&&b.first==-41304&&c.first==-41304&&!v);});t.join();assert(cfg->currents==0&&cfg->closes==0&&cfg->viewOpens==0);assert(holder->close().physical_done);return;}
 if(mode=="current-untouched"||mode=="current-malformed"){auto bad=holder->current();assert(!bad.ok()&&bad.unknown);assert(holder->close().physical_done&&cfg->closes==1);return;}
 if(mode=="close-pointer0-done0"||mode=="close-ambiguous"||mode=="close-done-late0"||mode=="reentrant-close"){auto closed=holder->close();if(mode=="close-done-late0")assert(raw0(closed)&&closed.physical_done);else if(mode=="reentrant-close")assert(closed.ok()&&closed.physical_done);else assert(!closed.physical_done&&closed.unknown);auto again=holder->close();assert(again.physical_done==closed.physical_done&&cfg->closes==1);return;}
 if(mode=="children64"){std::vector<std::shared_ptr<SocialView>>views;for(int i=0;i<64;i++){std::shared_ptr<SocialView>v;holder->view(v,r);assert(r.ok()&&v);views.push_back(std::move(v));}std::shared_ptr<SocialView>extra;holder->view(extra,r);assert(!r.ok()&&!extra&&cfg->viewOpens==64);assert(!holder->close().physical_done&&cfg->closes==0);for(auto&v:views)assert(v->release().physical_done);holder->view(extra,r);assert(r.ok()&&extra&&cfg->viewOpens==65);assert(extra->release().physical_done&&cfg->releases==65);assert(holder->close().physical_done&&cfg->closes==1);return;}
 std::shared_ptr<SocialView>view;cfg->viewSlot=&view;holder->view(view,r);assert(view&&cfg->viewOpens==1);
 if(mode=="view0-untouched"){assert(!r.ok());assert(!view->release().physical_done&&cfg->releases==0);assert(!view->release().physical_done&&cfg->releases==0);assert(!holder->close().physical_done&&cfg->closes==0);return;}
 if(mode=="view0-known-absence"){assert(!r.ok());auto released=view->release();assert(released.physical_done&&cfg->releases==0);assert(holder->close().physical_done);return;}
 if(mode=="span-foreign"||mode=="span-end"||mode=="app-too-long"||mode=="public-size"||mode=="private-span-foreign"||mode=="view-size"||mode=="window-negative"||mode=="window-empty"||mode=="window-too-big"){assert(!r.ok()&&view->data().classic_public.empty());assert(view->release().physical_done&&cfg->releases==1);auto closed=holder->close();assert(!closed.ok()&&closed.physical_done);return;}
 if(mode=="view-late0"){assert(raw0(r));exactData(view->data(),cfg);auto released=view->release();assert(raw0(released)&&released.physical_done&&cfg->releases==1);auto closed=holder->close();assert(raw0(closed)&&closed.physical_done);return;}
 if(mode=="view-status-untouched"){assert(!r.ok());exactData(view->data(),cfg);assert(view->release().physical_done);assert(holder->close().physical_done);return;}
 assert(r.ok());exactData(view->data(),cfg);
 if(mode=="actor-view-thread"){std::thread t([&]{auto e=view->release();assert(e.error_present&&e.first==-41304&&!e.physical_done);});t.join();assert(cfg->releases==0);assert(view->release().physical_done);assert(holder->close().physical_done);return;}
 if(mode=="actor-pid"){const pid_t pid=fork();assert(pid>=0);if(!pid){auto a=holder->current();auto b=view->release();assert(a.first==-41304&&b.first==-41304&&!b.physical_done);_exit(0);}int status=0;assert(waitpid(pid,&status,0)==pid&&WIFEXITED(status)&&!WEXITSTATUS(status));assert(view->release().physical_done);assert(holder->close().physical_done);return;}
 if(mode=="closed-view-actor"){assert(view->release().physical_done);std::thread t([&]{auto bad=view->release();assert(bad.error_present&&bad.first==-41304&&!bad.physical_done);});t.join();const auto pid=fork();assert(pid>=0);if(!pid){auto bad=view->release();assert(bad.error_present&&bad.first==-41304&&!bad.physical_done);_exit(0);}int status=0;assert(waitpid(pid,&status,0)==pid&&WIFEXITED(status)&&!WEXITSTATUS(status));assert(cfg->releases==1);assert(holder->close().physical_done);return;}
 auto released=view->release();
 if(mode=="release-unknown"||mode=="release0-untouched"){assert(!released.physical_done&&released.unknown);assert(!view->release().physical_done&&cfg->releases==1);assert(!holder->close().physical_done&&cfg->closes==0);return;}
 if(mode=="release-late0"){assert(raw0(released)&&released.physical_done);auto closed=holder->close();assert(raw0(closed)&&closed.physical_done);return;}
 assert(released.physical_done&&released.ok()&&cfg->releases==1);assert(view->release().physical_done&&cfg->releases==1);assert(holder->close().physical_done&&cfg->closes==1);
}
}
namespace ynx::social::joint::original {
Result borrowCapturedSourceLoan(Source&s,std::uint64_t&out)noexcept{auto*source=dynamic_cast<S*>(&s);assert(source&&source->cfg==heldCfg);++heldCfg->borrows;out=heldCfg->mode=="borrow-zero"?0:sourceLoan;return heldCfg->mode=="borrow-failed0"?failed():Result{};}
#ifndef YNX_SOCIAL_TEST_REAL_ROUTE
// PUBLIC local-only compatibility seam. New registered-route controls link the
// actual MainPairRoute/RegisteredMainPair bodies instead of these three helpers.
void selectOriginalMainPairRoute(Source&s,std::uint32_t&route,std::uint64_t&loan,Result&r)noexcept{route=0;loan=0;r=borrowCapturedSourceLoan(s,loan);if(r.ok()&&loan)route=1;else if(r.ok())r=failed(90);}
void acquireRegisteredMainPair(Source&,const Resource&,std::shared_ptr<SocialHolder>&out,Result&r)noexcept{out.reset();r=failed(90);}
bool copyRegisteredMainPairAccountNamespace(SocialHolder&,AccountNamespace&,Result&)noexcept{return false;}
#endif
}
extern "C" {
void ynx_social_main_committed_pair_open_v1(std::uint64_t loan,unsigned char*locator,std::size_t n,std::uint64_t*out,ynx_social_joint_status_v1*s){identity();auto cfg=heldCfg;++cfg->opens;assert(loan==sourceLoan&&n==32&&!std::memcmp(locator,cfg->f06.data(),32)&&*out==0);locator[0]^=1;assert(cfg->f06[0]==0x44);*out=cfg->mode=="owner0-untouched"||cfg->mode=="owner0-known-absence"?0:ownerID;if(cfg->mode=="reentrant-open"){denied((*cfg->holderSlot)->close());denied((*cfg->holderSlot)->current());assert(cfg->closes==0&&cfg->currents==0);}if(cfg->mode=="open-untouched"||cfg->mode=="owner0-untouched")return;if(cfg->mode=="open-partial0"||cfg->mode=="open-unknown")zero(s,cfg->mode=="open-unknown");else success(s);}
void ynx_social_main_committed_pair_current_v1(std::uint64_t owner,ynx_social_joint_status_v1*s){identity();assert(owner==ownerID);auto cfg=heldCfg;++cfg->currents;if(cfg->mode=="current-untouched")return;success(s);if(cfg->mode=="current-malformed")s->physical_done=1;}
void ynx_social_main_committed_pair_view_open_v1(std::uint64_t owner,unsigned char*storage,std::size_t capacity,ynx_social_main_pair_view_v1*out,ynx_social_joint_status_v1*s){identity();assert(owner==ownerID&&capacity==8192);auto cfg=heldCfg;++cfg->viewOpens;std::size_t at=0;auto put=[&](const unsigned char*bytes,std::size_t n){assert(at+n<=capacity);auto*p=storage+at;std::memcpy(p,bytes,n);at+=n;return ynx_social_joint_bytes_v1{p,n};};*out={};out->version=1;out->size=sizeof(*out);out->view=cfg->nextView++;for(unsigned i=0;i<6;i++)out->application[i]=put(reinterpret_cast<const unsigned char*>(cfg->app[i].data()),cfg->app[i].size());out->classic_public=put(cfg->classic.data(),cfg->classic.size());out->pq_public=put(cfg->pq.data(),cfg->pq.size());const std::string issuer="PRIVATE-ACCOUNT-ISSUER",subject="PRIVATE-ACCOUNT-SUBJECT";out->account_issuer=put(reinterpret_cast<const unsigned char*>(issuer.data()),issuer.size());out->account_subject=put(reinterpret_cast<const unsigned char*>(subject.data()),subject.size());out->not_before_ms=10;out->expires_ms=90;static const unsigned char outside[]="FOREIGN";if(cfg->mode=="span-foreign")out->application[0]={outside,1};if(cfg->mode=="span-end")out->pq_public.data=storage+capacity-1;if(cfg->mode=="app-too-long")out->application[0].size=129;if(cfg->mode=="public-size")out->classic_public.size=32;if(cfg->mode=="private-span-foreign")out->account_issuer={outside,1};if(cfg->mode=="view-size")out->size=191;if(cfg->mode=="window-negative")out->not_before_ms=-1;if(cfg->mode=="window-empty")out->expires_ms=out->not_before_ms;if(cfg->mode=="window-too-big")out->expires_ms=9007199254740992LL;if(cfg->mode=="view0-known-absence"||cfg->mode=="view0-untouched")out->view=0;if(cfg->mode=="reentrant-view"){denied((*cfg->viewSlot)->release());denied((*cfg->holderSlot)->close());assert(cfg->releases==0&&cfg->closes==0);}if(cfg->mode=="view-status-untouched"||cfg->mode=="view0-untouched")return;if(cfg->mode=="view-late0")zero(s);else success(s);}
void ynx_social_main_committed_pair_view_release_v1(std::uint64_t owner,std::uint64_t*view,ynx_social_joint_status_v1*s){identity();auto cfg=heldCfg;assert(owner==ownerID&&*view>=0x310);++cfg->releases;if(cfg->mode=="reentrant-release"){denied((*cfg->viewSlot)->release());denied((*cfg->holderSlot)->close());assert(cfg->releases==1&&cfg->closes==0);}if(cfg->mode=="release-unknown"){zero(s,true);return;}*view=0;if(cfg->mode=="release0-untouched")return;if(cfg->mode=="release-late0")zero(s);else success(s);}
void ynx_social_main_committed_pair_close_v1(std::uint64_t*owner,ynx_social_joint_status_v1*s){identity();auto cfg=heldCfg;assert(*owner==ownerID);++cfg->closes;if(cfg->mode=="reentrant-close"){denied((*cfg->holderSlot)->close());denied((*cfg->holderSlot)->current());assert(cfg->closes==1);}if(cfg->mode=="close-ambiguous"){zero(s,true);return;}*owner=0;if(cfg->mode=="close-pointer0-done0"){success(s);return;}if(cfg->mode=="close-done-late0")zero(s,false,true);else success(s,true);}
}
int main(int argc,char**argv){assert(argc==2);run(argv[1]);std::cout<<"PASS "<<argv[1]<<" actual CommittedSocial CPP, PUBLIC Main C5/Source-loan boundaries only; no actual Main/Go/Root/keys/network\n";return 0;}
