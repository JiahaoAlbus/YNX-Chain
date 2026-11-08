#ifndef YNX_SOCIAL_JOINT_PUBLIC_CONTROLS
#error "PUBLIC Device C12/namespace seams forbidden in production"
#endif
#ifdef YNX_SOCIAL_DEVICE_BINDING_DRAIN_CONTROLS
#define main OriginalProfileMainForDeviceDrain
#include "social-joint-profile-issuer.PUBLIC.cpp"
#undef main
namespace ynx::social::joint::original {
Result prepareOriginalSourceFrame(std::uint32_t,const Bytes&,Bytes&){assert(false&&"new drain controls never prepare/sign");return{true,999,false,false};}
}
int main(int argc,char**argv){assert(argc==2);execute(argv[1]);std::cout<<"PASS "<<argv[1]<<" actual Binding CPP; PUBLIC Device drain progress only, no Go/frame/Root/sign\n";}
#else
#include "OriginalServices.hpp"
#include "DeviceNamespace.hpp"
#include <cassert>
#include <iostream>
#include <thread>
#include <sys/wait.h>
#include <unistd.h>
using namespace ynx::social::joint::original;
struct ynx_auth_device_v4_source_v1 {unsigned id=1;};
struct ynx_auth_device_v4_view_v1 {unsigned id=0;};
namespace {
using F=ynx_auth_device_v4_failure_v1;using D=ynx_auth_device_v4_drain_v1;
Result bad(int n=0,bool unknown=false){return{true,n,unknown,false};}
bool raw0(Result r){return r.error_present&&r.first==0;}
F failed(){return{1,0,43,9876543210LL};}
D drained(bool done=true,bool unknown=false,bool first0=false){return{first0?failed():F{},unknown?1U:0U,done?1U:0U};}
struct Fixture {
 std::string mode;bool later=false,revoked=false;const pid_t pid=getpid();const std::thread::id actor=std::this_thread::get_id();
 int sourceCurrent=0,mainCurrent=0,namespaces=0,acquires=0,currents=0,viewOpens=0,reads=0,matches=0,viewCurrents=0,releases=0,retires=0,joins=0,closes=0,releasesClosed=0,retains=0,releasesReference=0;
 ynx_auth_device_v4_source_v1 source;std::array<ynx_auth_device_v4_view_v1,200> views{};
 std::array<std::string,17> expected;Bytes context=Bytes(20,'c'),registration=Bytes(20,'r'),session=Bytes(20,'s');
 std::shared_ptr<DeviceHolder>*holderSlot=nullptr;std::shared_ptr<DeviceView>*viewSlot=nullptr;
 Fixture(){for(unsigned i=0;i<17;++i)expected[i]="PUBLIC-expected-"+std::to_string(i);expected[2]="PRIVATE-SUBJECT";expected[8].clear();expected[9].clear();}
 bool active()const{return later||mode.rfind("init-",0)==0;}
};
std::shared_ptr<Fixture> held;
void identity(){assert(held->pid==getpid()&&held->actor==std::this_thread::get_id());}
struct S final:Source {std::shared_ptr<Fixture>cfg;explicit S(std::shared_ptr<Fixture>x):cfg(std::move(x)){}Result current()noexcept override{++cfg->sourceCurrent;if(cfg->revoked||cfg->mode=="source-pre0"||(cfg->mode=="source-post0"&&cfg->viewCurrents))return bad();return{};}Window window()const noexcept override{return{1,100};}Result matchCurrentOriginals(const SourceInput&)noexcept override{return{};}Result matchBinding(SocialHolder&,DeviceHolder&)noexcept override{return{};}Result inspectOriginalBodyDATA(SocialHolder&,DeviceHolder&,const Bytes&)noexcept override{return{};}void role(SocialHolder&,DeviceHolder&,const Resource&,const Resource&,std::uint32_t,const Bytes&,const Bytes&,std::shared_ptr<Role>&,Result&r)noexcept override{assert(false);r=bad(99);}Result close()noexcept override{return{false,0,false,true};}};
struct M final:SocialHolder {std::shared_ptr<Fixture>cfg;explicit M(std::shared_ptr<Fixture>x):cfg(std::move(x)){}Result current()noexcept override{++cfg->mainCurrent;return cfg->mode=="main-pre0"||(cfg->mode=="main-post0"&&cfg->viewCurrents)?bad():Result{};}void view(std::shared_ptr<SocialView>&,Result&)noexcept override{assert(false);}Result close()noexcept override{assert(false);return{};}};
void deny(Result r){assert(!r.ok()&&!r.physical_done);}
void data(const DeviceData&d){assert(d.expected==held->expected&&d.null_mask==((1U<<8)|(1U<<9))&&d.window.not_before_ms==10&&d.window.expires_ms==90);}
void closeGood(const std::shared_ptr<DeviceHolder>&p){const auto before=held->sourceCurrent,main=held->mainCurrent;auto r=p->close();assert(r.physical_done&&!r.original_drain_pending&&held->retires==1&&held->joins==1&&held->closes==1&&held->releasesClosed==1&&held->retains==0&&held->releasesReference==0);assert(held->sourceCurrent==before&&held->mainCurrent==main);assert(p->close().physical_done&&held->closes==1&&held->releasesClosed==1);}
void run(const std::string&mode){held=std::make_shared<Fixture>();auto cfg=held;cfg->mode=mode;if(mode=="original-max"){cfg->context=Bytes(65536,'c');cfg->registration=Bytes(16384,'r');cfg->session=Bytes(16384,'s');}S source(cfg);M main(cfg);Resource rsrc{};std::shared_ptr<DeviceHolder>owner;cfg->holderSlot=&owner;Result r;acquireRegisteredDeviceSession(source,main,rsrc,owner,r);
 if(mode=="source-pre0"||mode=="main-pre0"||mode=="namespace-failed0"||mode=="namespace-empty-issuer"||mode=="namespace-empty-subject"){assert(!r.ok()&&!owner&&cfg->acquires==0);if(mode=="source-pre0"||mode=="main-pre0"||mode=="namespace-failed0")assert(raw0(r));return;}
 assert(owner&&cfg->acquires==1&&cfg->namespaces==1&&cfg->retains==0&&cfg->releasesReference==0);
 if(mode=="acquire-null0"){assert(raw0(r)&&cfg->viewOpens==0);auto e=owner->close();assert(raw0(e)&&e.physical_done&&cfg->retires==0&&cfg->releasesClosed==0);return;}
 if(mode=="acquire-partial0"||mode=="acquire-malformed"||mode=="source-post0"||mode=="main-post0"||mode.rfind("init-",0)==0){assert(!r.ok());if(mode!="acquire-malformed"&&mode!="init-subject-mismatch"&&mode!="init-issuer-mismatch")assert(raw0(r));if(mode=="init-subject-mismatch")assert(cfg->matches==0);if(mode=="init-issuer-mismatch")assert(cfg->matches==1);closeGood(owner);return;}
 assert(r.ok()&&cfg->viewOpens==1&&cfg->reads==1&&cfg->matches==1&&cfg->viewCurrents==1&&cfg->releases==1);cfg->later=true;
 if(mode=="source-revoked"){cfg->revoked=true;assert(raw0(owner->current())&&cfg->currents==0);closeGood(owner);return;}
 if(mode=="current-late0"){assert(raw0(owner->current())&&cfg->currents==1);assert(raw0(owner->current())&&cfg->currents==1);closeGood(owner);return;}
 if(mode.rfind("join-",0)==0||mode.rfind("close-",0)==0||mode.rfind("releaseclosed-",0)==0){auto e=owner->close();
  if(mode=="join-pending-progress"){assert(raw0(e)&&!e.physical_done&&e.original_drain_pending&&cfg->joins==1&&cfg->closes==0);deny(owner->current());e=owner->close();assert(raw0(e)&&e.physical_done&&!e.original_drain_pending&&cfg->joins==2&&cfg->closes==1&&cfg->releasesClosed==1);assert(owner->close().physical_done&&cfg->joins==2);return;}
  if(mode=="join-pending"||mode=="join-malformed"){assert(!e.physical_done&&e.original_drain_pending&&cfg->closes==0);assert(owner->close().original_drain_pending&&cfg->joins==2&&cfg->closes==0);return;}
  if(mode=="join-done-late0"||mode=="close-done-late0"||mode=="releaseclosed-done-late0"){assert(raw0(e)&&e.physical_done&&!e.original_drain_pending&&cfg->closes==1&&cfg->releasesClosed==1);return;}
  assert(!e.physical_done&&!e.original_drain_pending&&e.unknown);const auto closes=cfg->closes,releases=cfg->releasesClosed;assert(!owner->close().physical_done&&cfg->closes==closes&&cfg->releasesClosed==releases&&cfg->joins==1);return;
 }
 if(mode=="holder-actor-thread"){const auto reads=cfg->reads;std::thread t([&]{assert(owner->current().first==-41604);assert(owner->close().first==-41604);std::shared_ptr<DeviceView>v;Result q;owner->view(v,q);assert(q.first==-41604&&!v);});t.join();assert(cfg->reads==reads&&cfg->currents==0);closeGood(owner);return;}
 if(mode=="children64"){std::vector<std::shared_ptr<DeviceView>>views;for(int i=0;i<64;++i){std::shared_ptr<DeviceView>v;owner->view(v,r);assert(v&&r.ok());views.push_back(v);}std::shared_ptr<DeviceView>v;owner->view(v,r);assert(!v&&!r.ok()&&cfg->viewOpens==65);assert(!owner->close().physical_done&&cfg->retires==0);for(auto&x:views)assert(x->release().physical_done);owner->view(v,r);assert(r.ok()&&v&&cfg->viewOpens==66);assert(v->release().physical_done);closeGood(owner);return;}
 std::shared_ptr<DeviceView>view;cfg->viewSlot=&view;owner->view(view,r);assert(view&&cfg->viewOpens==2&&cfg->reads==2);
 const bool malformed=mode=="data-version"||mode=="data-size"||mode=="null-invalid"||mode=="null-nonempty"||mode=="expected-too-long"||mode=="expected-null-bytes"||mode=="context-too-long"||mode=="registration-too-long"||mode=="session-too-long"||mode=="original-empty"||mode=="window-negative"||mode=="window-empty"||mode=="window-too-big"||mode=="subject-mismatch"||mode=="issuer-mismatch";
 if(malformed){assert(!r.ok());if(mode=="subject-mismatch")assert(cfg->matches==1);if(mode=="issuer-mismatch")assert(cfg->matches==2);assert(view->release().physical_done);closeGood(owner);return;}
 if(mode=="view-open-late0"||mode=="view-read-late0"||mode=="view-current-late0"||mode=="matcher-late0"){assert(raw0(r));data(view->data());assert(view->release().physical_done);closeGood(owner);return;}
 assert(r.ok());data(view->data());
 if(mode=="view-actor-thread"||mode=="closed-view-actor"){if(mode=="closed-view-actor")assert(view->release().physical_done);auto n=cfg->releases;std::thread t([&]{auto e=view->release();assert(e.first==-41604&&!e.physical_done);});t.join();assert(cfg->releases==n);if(mode!="closed-view-actor")assert(view->release().physical_done);else{auto pid=fork();assert(pid>=0);if(!pid){assert(view->release().first==-41604);_exit(0);}int st=0;assert(waitpid(pid,&st,0)==pid&&WIFEXITED(st)&&!WEXITSTATUS(st));}closeGood(owner);return;}
 if(mode=="actor-pid"){auto pid=fork();assert(pid>=0);if(!pid){assert(owner->current().first==-41604);assert(view->release().first==-41604);_exit(0);}int st=0;assert(waitpid(pid,&st,0)==pid&&WIFEXITED(st)&&!WEXITSTATUS(st));assert(view->release().physical_done);closeGood(owner);return;}
 auto e=view->release();if(mode=="view-release-unknown"||mode=="view-release-malformed"){assert(!e.physical_done&&e.unknown);assert(!view->release().physical_done&&cfg->releases==2);assert(!owner->close().physical_done&&cfg->retires==0);return;}
 if(mode=="view-release-done-late0")assert(raw0(e)&&e.physical_done);else assert(e.ok()&&e.physical_done);assert(view->release().physical_done&&cfg->releases==2);closeGood(owner);
}
}
namespace ynx::social::joint::original {
void copyOriginalCommittedPairAccountNamespace(SocialHolder&s,AccountNamespace&out,Result&r)noexcept{identity();auto*actual=dynamic_cast<M*>(&s);assert(actual&&actual->cfg==held&&held->acquires==0);++held->namespaces;out={"PRIVATE-ISSUER","PRIVATE-SUBJECT"};if(held->mode=="namespace-empty-issuer")out.issuer.clear();if(held->mode=="namespace-empty-subject")out.subject.clear();if(held->mode=="namespace-failed0")r=bad();}
#ifndef YNX_SOCIAL_TEST_REAL_DEVICE_NAMESPACE
Result matchQualifiedDeviceNamespace(ynx_auth_device_v4_view_v1*v,const AccountNamespace&a,ynx_auth_device_v4_failure_v1&original)noexcept{original={};identity();assert(v&&a.subject=="PRIVATE-SUBJECT"&&a.issuer=="PRIVATE-ISSUER");++held->matches;const auto&m=held->mode;if(held->active()&&(m=="issuer-mismatch"||m=="init-issuer-mismatch"||m=="matcher-late0")){original=failed();return bad();}return{};}
#endif
}
extern "C" {
ynx_auth_device_v4_acquisition_v1 ynx_auth_device_v4_source_acquire_original_v1(){identity();assert(held->namespaces==1);++held->acquires;if(held->mode=="acquire-reentrant"){deny((*held->holderSlot)->close());deny((*held->holderSlot)->current());assert(held->retires==0);}if(held->mode=="acquire-null0")return{nullptr,failed()};if(held->mode=="acquire-partial0")return{&held->source,failed()};if(held->mode=="acquire-malformed")return{&held->source,{0,7,43,9}};return{&held->source,{}};}
ynx_auth_device_v4_acquisition_v1 ynx_auth_device_v4_source_retain_v1(ynx_auth_device_v4_source_v1*){++held->retains;assert(false);return{};}
ynx_auth_device_v4_reference_release_v1 ynx_auth_device_v4_source_release_reference_v1(ynx_auth_device_v4_source_v1*){++held->releasesReference;assert(false);return{};}
ynx_auth_device_v4_failure_v1 ynx_auth_device_v4_source_current_v1(ynx_auth_device_v4_source_v1*p){identity();assert(p==&held->source);++held->currents;return held->mode=="current-late0"?failed():F{};}
ynx_auth_device_v4_view_acquisition_v1 ynx_auth_device_v4_source_open_view_v1(ynx_auth_device_v4_source_v1*p){identity();assert(p==&held->source);auto i=held->viewOpens++;assert(i<200);held->views[i].id=unsigned(i+1);const auto&m=held->mode;return{&held->views[i],held->active()&&(m=="view-open-late0"||m=="init-view-open-late0")?failed():F{}};}
ynx_auth_device_v4_failure_v1 ynx_auth_device_v4_view_read_original_v1(ynx_auth_device_v4_view_v1*v,ynx_auth_device_v4_view_data_v1*out){identity();assert(v&&out->version==1&&out->size==sizeof(*out));++held->reads;out->null_mask=(1U<<8)|(1U<<9);for(unsigned i=0;i<17;++i)out->expected[i]={reinterpret_cast<const unsigned char*>(held->expected[i].data()),held->expected[i].size()};out->context_original={held->context.data(),held->context.size()};out->registration_original={held->registration.data(),held->registration.size()};out->session_original={held->session.data(),held->session.size()};out->not_before_ms=10;out->expires_ms=90;if(held->active()){const auto&m=held->mode;if(m=="data-version")out->version=2;if(m=="data-size")--out->size;if(m=="null-invalid")out->null_mask|=1;if(m=="null-nonempty")out->expected[8]={held->context.data(),1};if(m=="expected-too-long")out->expected[0].length=2049;if(m=="expected-null-bytes")out->expected[0].bytes=nullptr;if(m=="context-too-long")out->context_original.length=65537;if(m=="registration-too-long")out->registration_original.length=16385;if(m=="session-too-long")out->session_original.length=16385;if(m=="original-empty")out->context_original.length=0;if(m=="window-negative")out->not_before_ms=-1;if(m=="window-empty")out->expires_ms=10;if(m=="window-too-big")out->expires_ms=9007199254740992LL;if(m=="subject-mismatch"||m=="init-subject-mismatch")out->expected[2]=out->expected[0];if(m=="view-reentrant"){deny((*held->viewSlot)->release());deny((*held->holderSlot)->close());deny((*held->holderSlot)->current());assert(held->retires==0);}if(m=="view-read-late0"||m=="init-view-read-late0")return failed();}return{};}
ynx_auth_device_v4_failure_v1 ynx_auth_device_v4_view_current_v1(ynx_auth_device_v4_view_v1*v){identity();assert(v);++held->viewCurrents;return held->active()&&(held->mode=="view-current-late0"||held->mode=="init-view-current-late0")?failed():F{};}
ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_view_release_v1(ynx_auth_device_v4_view_v1*v){identity();assert(v);++held->releases;if(held->later&&held->mode=="view-release-unknown")return drained(false,true,true);if(held->later&&held->mode=="view-release-malformed"){auto d=drained();d.failure={0,7,1,2};return d;}return drained(true,false,held->later&&held->mode=="view-release-done-late0");}
void ynx_auth_device_v4_source_request_retire_v1(ynx_auth_device_v4_source_v1*p){identity();assert(p==&held->source);++held->retires;}
ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_source_join_v1(ynx_auth_device_v4_source_v1*p){identity();assert(p==&held->source&&held->retires==1);++held->joins;const auto&m=held->mode;if(m=="join-pending"||(m=="join-pending-progress"&&held->joins==1))return drained(false,true,true);if(m=="join-malformed"){auto d=drained();d.unknown=2;return d;}return drained(true,false,m=="join-done-late0");}
ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_source_close_v1(ynx_auth_device_v4_source_v1*p){identity();assert(p==&held->source&&held->retires==1&&held->joins>=1);++held->closes;if(held->mode=="close-unknown")return drained(false,true,true);if(held->mode=="close-no-done")return drained(false);return drained(true,false,held->mode=="close-done-late0");}
ynx_auth_device_v4_drain_v1 ynx_auth_device_v4_source_release_closed_v1(ynx_auth_device_v4_source_v1*p){identity();assert(p==&held->source&&held->closes==1);++held->releasesClosed;if(held->mode=="releaseclosed-unknown")return drained(false,true,true);return drained(true,false,held->mode=="releaseclosed-done-late0");}
}
int main(int argc,char**argv){assert(argc==2);run(argv[1]);std::cout<<"PASS "<<argv[1]<<" actual RegisteredDeviceSession CPP; PUBLIC DeviceC12 + namespace matcher seam; no real Auth/Root/keys/transport\n";return 0;}
#endif
