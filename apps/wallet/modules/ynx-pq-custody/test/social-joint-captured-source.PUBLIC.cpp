#ifndef YNX_SOCIAL_JOINT_PUBLIC_CONTROLS
#error "PUBLIC seven-borrow bridge is forbidden in a production binary"
#endif
#include "OriginalServices.hpp"
#include "social_joint_profile_issuer_private.h"
#include <algorithm>
#include <cassert>
#include <cstring>
#include <iostream>
using namespace ynx::social::joint::original;
namespace {
Result failed(int code=0,bool unknown=false,bool physical=false){return{true,code,unknown,physical};}
Result done(){return{false,0,false,true};}
bool raw0(Result r){return r.error_present&&r.first==0;}
constexpr std::uint64_t loan=0x1234567890abcdefULL;
struct Fixture{
 SourceInput input;SocialData social;DeviceData device;Window live{100,1000};
 Bytes body{' ','P','U','B',0,'{','N','O','T','-','P','A','R','S','E','D','}',0xff},frame{'P','U','B','-','F','R','A','M','E'};
 Resource bindingId{},roleId{};std::string mode;std::vector<std::string>events;
 int acquire=0,current=0,window=0,compare=0,retire=0,join=0,close=0,sview=0,dview=0,srelease=0,drelease=0,finite=0,currentLateAt=0;
 Fixture(){input.resource.fill(0x31);input.same_process_capture_reference=0xfedcba9876543210ULL;for(unsigned i=0;i<4;i++)input.originals[i]={'P','U','B',static_cast<unsigned char>('0'+i)};social.application={"PUBLIC-realm","PUBLIC-client","PUBLIC-network","PUBLIC-identity","PUBLIC-device","PUBLIC-header"};social.classic_public=Bytes(33,0x11);social.pq_public=Bytes(2592,0x22);social.window={80,950};device.window={120,900};for(unsigned i=0;i<17;i++)device.expected[i]="PUBLIC-value-"+std::to_string(i);device.expected[8].clear();device.expected[9].clear();device.null_mask=(1U<<8)|(1U<<9);bindingId.fill(0x41);roleId.fill(0x52);}
};
std::shared_ptr<Fixture>heldCfg;
struct SV final:SocialView{std::shared_ptr<Fixture>cfg;SocialData snapshot;explicit SV(std::shared_ptr<Fixture>x):cfg(std::move(x)),snapshot(cfg->social){}const SocialData&data()const noexcept override{return snapshot;}Result release()noexcept override{++cfg->srelease;cfg->events.push_back("S.release");return cfg->mode=="social-release-late0"?failed(0,false,true):done();}};
struct DV final:DeviceView{std::shared_ptr<Fixture>cfg;DeviceData snapshot;explicit DV(std::shared_ptr<Fixture>x):cfg(std::move(x)),snapshot(cfg->device){}const DeviceData&data()const noexcept override{return snapshot;}Result release()noexcept override{++cfg->drelease;cfg->events.push_back("D.release");if(cfg->mode=="release-unknown")return failed(0,true,false);if(cfg->mode=="release-late0")return failed(0,false,true);return done();}};
struct SH final:SocialHolder{std::shared_ptr<Fixture>cfg;explicit SH(std::shared_ptr<Fixture>x):cfg(std::move(x)){}Result current()noexcept override{cfg->events.push_back("S.current");return{};}void view(std::shared_ptr<SocialView>&out,Result&r)noexcept override{++cfg->sview;out=std::make_shared<SV>(cfg);r=cfg->mode=="social-view-partial0"?failed():Result{};}Result close()noexcept override{return done();}};
struct DH final:DeviceHolder{std::shared_ptr<Fixture>cfg;explicit DH(std::shared_ptr<Fixture>x):cfg(std::move(x)){}Result current()noexcept override{cfg->events.push_back("D.current");return{};}void view(std::shared_ptr<DeviceView>&out,Result&r)noexcept override{++cfg->dview;out=std::make_shared<DV>(cfg);r=cfg->mode=="device-view-partial0"?failed():Result{};}Result close()noexcept override{return done();}};
struct Finite final:Role{Result current()noexcept override{return{};}Result enterOriginalOnce()noexcept override{return failed(90);}Result durableOriginalIntentCurrent()noexcept override{return failed(90);}Result signOnceOriginalSourceProof()noexcept override{return failed(90);}Result copyOriginal(Bytes&)noexcept override{return failed(90);}Result queryOriginal(Bytes&)noexcept override{return failed(90);}Result retire()noexcept override{return{};}Result join()noexcept override{return{};}Result close()noexcept override{return done();}};
struct Foreign final:Source{Result current()noexcept override{return{};}Window window()const noexcept override{return{};}Result matchCurrentOriginals(const SourceInput&)noexcept override{return{};}Result matchBinding(SocialHolder&,DeviceHolder&)noexcept override{return{};}Result inspectOriginalBodyDATA(SocialHolder&,DeviceHolder&,const Bytes&)noexcept override{return{};}void role(SocialHolder&,DeviceHolder&,const Resource&,const Resource&,std::uint32_t,const Bytes&,const Bytes&,std::shared_ptr<Role>&,Result&r)noexcept override{r=failed(91);}Result close()noexcept override{return done();}};
void success(ynx_social_joint_status_v1*s,bool physical=false){*s={1,sizeof(*s),0,0,physical?1U:0U,0};}
void zero(ynx_social_joint_status_v1*s,bool physical=false){*s={1,sizeof(*s),1,0,physical?1U:0U,0};}
void exact(ynx_social_joint_bytes_v1 s,const std::string&v){assert(s.size==v.size()&&(!s.size||!std::memcmp(s.data,v.data(),s.size)));}
void exact(ynx_social_joint_bytes_v1 s,const Bytes&v){assert(s.size==v.size()&&(!s.size||!std::memcmp(s.data,v.data(),s.size)));}
void run(const std::string&mode){heldCfg=std::make_shared<Fixture>();auto cfg=heldCfg;cfg->mode=mode;if(mode=="window-invalid-late0")cfg->live={100,50};std::shared_ptr<Source>source;Result r;acquireRegisteredSource(cfg->input,source,r);assert(source&&cfg->acquire==1);
 if(mode=="factory-partial0"){assert(raw0(r)&&cfg->window==0&&cfg->current==0);assert(raw0(source->current())&&cfg->current==0);auto closed=source->close();assert(raw0(closed)&&closed.physical_done&&cfg->close==1);return;}
 if(mode=="window-late0"||mode=="window-invalid-late0"){assert(raw0(r)&&cfg->window==1);const auto copied=source->window();assert(copied.not_before_ms==cfg->live.not_before_ms&&copied.expires_ms==cfg->live.expires_ms);auto closed=source->close();assert(raw0(closed)&&closed.physical_done&&cfg->close==1);return;}
 assert(r.ok());SH social(cfg);DH device(cfg);
 if(mode=="window-no-renew"){const auto original=source->window();cfg->live.expires_ms+=50;r=source->current();assert(!r.ok()&&source->window().expires_ms==original.expires_ms);const auto calls=cfg->window;assert(!source->current().ok()&&cfg->window==calls);auto closed=source->close();assert(closed.physical_done&&!closed.ok());return;}
 if(mode=="borrow-loan"){std::uint64_t actual=0;r=borrowCapturedSourceLoan(*source,actual);assert(r.ok()&&actual==loan&&actual!=cfg->input.same_process_capture_reference);assert(source->close().physical_done);return;}
 if(mode=="borrow-foreign"){Foreign foreign;std::uint64_t actual=123;const auto calls=cfg->current;r=borrowCapturedSourceLoan(foreign,actual);assert(!r.ok()&&actual==0&&cfg->current==calls);assert(source->close().physical_done);return;}
 if(mode=="borrow-post-current0"){cfg->currentLateAt=cfg->current+2;std::uint64_t actual=123;r=borrowCapturedSourceLoan(*source,actual);assert(raw0(r)&&actual==0);auto closed=source->close();assert(raw0(closed)&&closed.physical_done);return;}
 if(mode=="originals-and-foreign"){auto in=cfg->input;assert(source->matchCurrentOriginals(in).ok());auto count=cfg->current;in.originals[0].push_back('x');assert(!source->matchCurrentOriginals(in).ok()&&cfg->current==count);in=cfg->input;++in.same_process_capture_reference;assert(!source->matchCurrentOriginals(in).ok()&&cfg->current==count);in=cfg->input;in.resource[0]^=1;assert(!source->matchCurrentOriginals(in).ok()&&cfg->current==count);SourceInput copy;copyOriginalCapturedSourceInputs(*source,copy,r);assert(r.ok()&&copy.resource==cfg->input.resource&&copy.originals==cfg->input.originals&&copy.same_process_capture_reference==cfg->input.same_process_capture_reference);copy.originals[1].push_back('x');SourceInput again;copyOriginalCapturedSourceInputs(*source,again,r);assert(r.ok()&&again.originals==cfg->input.originals);Foreign foreign;count=cfg->current;copyOriginalCapturedSourceInputs(foreign,copy,r);assert(!r.ok()&&cfg->current==count&&copy.originals[1].back()=='x');assert(source->close().physical_done);return;}
 if(mode=="copy-late0"){cfg->currentLateAt=cfg->current+2;SourceInput copied;copyOriginalCapturedSourceInputs(*source,copied,r);assert(raw0(r)&&copied.originals==cfg->input.originals&&copied.same_process_capture_reference==cfg->input.same_process_capture_reference);auto closed=source->close();assert(raw0(closed)&&closed.physical_done);return;}
 if(mode=="finite-binding-resource"){std::shared_ptr<Role>op;source->role(social,device,cfg->bindingId,cfg->roleId,2,cfg->body,cfg->frame,op,r);assert(r.ok()&&op&&cfg->finite==1&&cfg->compare==1);assert(source->close().physical_done);return;}
 r=source->inspectOriginalBodyDATA(social,device,cfg->body);
 if(mode=="social-view-partial0"){assert(raw0(r)&&cfg->sview==1&&cfg->dview==0&&cfg->srelease==1&&cfg->compare==0);assert(source->close().physical_done);return;}
 if(mode=="device-view-partial0"){assert(raw0(r)&&cfg->sview==1&&cfg->dview==1&&cfg->srelease==1&&cfg->drelease==1&&cfg->compare==0);assert(source->close().physical_done);return;}
 assert(cfg->compare==1&&cfg->sview==1&&cfg->dview==1);
 if(mode=="release-unknown"){assert(raw0(r)&&r.unknown&&cfg->drelease==1);const int released=cfg->srelease+cfg->drelease;auto closed=source->close();assert(!closed.physical_done&&closed.unknown&&cfg->close==0&&cfg->retire==0);closed=source->close();assert(!closed.physical_done&&cfg->srelease+cfg->drelease==released&&cfg->close==0);return;}
 assert(cfg->srelease==1&&cfg->drelease==1);
 if(mode=="release-late0"||mode=="social-release-late0"){assert(raw0(r));auto closed=source->close();assert(raw0(closed)&&closed.physical_done);return;}
 if(mode=="compare-late0"||mode=="post-compare-current0"){assert(raw0(r));auto closed=source->close();assert(closed.physical_done);if(mode=="post-compare-current0")assert(raw0(closed));return;}
 assert(r.ok());auto compare=std::find(cfg->events.begin(),cfg->events.end(),"compare");assert(compare!=cfg->events.end());assert(std::find(cfg->events.begin(),compare,"C.current")!=compare);assert(std::find(compare,cfg->events.end(),"C.current")!=cfg->events.end());assert(source->close().physical_done&&cfg->close==1);
}
}
namespace ynx::social::joint::original {
void acquireOriginalFiniteRole(Source&,SocialHolder&s,DeviceHolder&d,const Resource&binding,const Resource&role,std::uint32_t n,const Bytes&body,const Bytes&frame,std::shared_ptr<Role>&out,Result&r)noexcept{auto cfg=heldCfg;++cfg->finite;auto*social=dynamic_cast<SH*>(&s);auto*device=dynamic_cast<DH*>(&d);assert(social&&device&&social->cfg==cfg&&device->cfg==cfg&&binding==cfg->bindingId&&role==cfg->roleId&&n==2&&body==cfg->body&&frame==cfg->frame);out=std::make_shared<Finite>();r={};}
}
extern "C" {
void ynx_auth_social_joint_capture_borrow_acquire_v1(std::uint64_t ref,ynx_social_joint_source_input_v1*in,std::uint64_t*out,ynx_social_joint_status_v1*st){auto cfg=heldCfg;++cfg->acquire;assert(ref==cfg->input.same_process_capture_reference&&in->same_process_capture_reference==ref&&in->version==2&&in->size==112&&!std::memcmp(in->registered_source_resource,cfg->input.resource.data(),32));exact(in->registration,cfg->input.originals[0]);exact(in->issuer_credential,cfg->input.originals[1]);exact(in->anchor_credential,cfg->input.originals[2]);exact(in->history_envelope,cfg->input.originals[3]);*out=loan;if(cfg->mode=="factory-partial0")zero(st);else success(st);}
void ynx_auth_social_joint_capture_borrow_current_v1(std::uint64_t n,ynx_social_joint_status_v1*st){assert(n==loan);auto cfg=heldCfg;++cfg->current;cfg->events.push_back("C.current");if(cfg->current==cfg->currentLateAt)zero(st);else success(st);}
void ynx_auth_social_joint_capture_borrow_retire_v1(std::uint64_t n,ynx_social_joint_status_v1*st){assert(n==loan);++heldCfg->retire;success(st);}
void ynx_auth_social_joint_capture_borrow_join_v1(std::uint64_t n,ynx_social_joint_status_v1*st){assert(n==loan);++heldCfg->join;success(st);}
void ynx_auth_social_joint_capture_borrow_close_v1(std::uint64_t*n,ynx_social_joint_status_v1*st){assert(*n==loan);++heldCfg->close;*n=0;success(st,true);}
void ynx_auth_social_joint_capture_borrow_window_v1(std::uint64_t n,ynx_social_joint_source_window_v1*w,ynx_social_joint_status_v1*st){assert(n==loan);auto cfg=heldCfg;++cfg->window;cfg->events.push_back("C.window");*w={1,sizeof(*w),cfg->live.not_before_ms,cfg->live.expires_ms};if(cfg->mode=="window-late0"||cfg->mode=="window-invalid-late0")zero(st);else success(st);}
void ynx_auth_social_joint_capture_borrow_compare_body_v1(std::uint64_t n,ynx_social_joint_binding_view_v1*v,ynx_social_joint_bytes_v1 body,ynx_social_joint_status_v1*st){assert(n==loan);auto cfg=heldCfg;++cfg->compare;cfg->events.push_back("compare");assert(v&&v->version==1&&v->size==432&&v->not_before_ms==120&&v->expires_ms==900&&v->expected_null_mask==((1U<<8)|(1U<<9)));for(unsigned i=0;i<6;i++)exact(v->application[i],cfg->social.application[i]);for(unsigned i=0;i<17;i++)exact(v->expected[i],cfg->device.expected[i]);exact(v->classic_public,cfg->social.classic_public);exact(v->pq_public,cfg->social.pq_public);exact(body,cfg->body);if(cfg->mode=="post-compare-current0")cfg->currentLateAt=cfg->current+1;if(cfg->mode=="compare-late0")zero(st);else success(st);}
}
int main(int argc,char**argv){assert(argc==2);run(argv[1]);std::cout<<"PASS "<<argv[1]<<" actual CapturedSource+CaptureLoan C++ with finite PUBLIC seven-Go-ABI/view/role boundaries; no actual Go/math/keys/Root/network\n";return 0;}
