#include "social_joint_profile_issuer_private.h"
#include "OriginalServices.hpp"
#include <algorithm>
#include <cstring>
#include <limits>
#include <mutex>
#include <new>
#include <thread>
#include <unordered_map>
#include <unistd.h>

struct ynx_social_joint_source_v1 { std::uint64_t serial; };
struct ynx_social_joint_binding_v1 { std::uint64_t serial; };
struct ynx_social_joint_role_v1 { std::uint64_t serial; };

namespace {
namespace port=ynx::social::joint::original;
using port::Result;
enum : std::int32_t { Invalid=-41001, Actor=-41002, Capacity=-41003,
 Missing=-41004, Retired=-41005, ChildDebt=-41006, AlreadySelected=-41007,
 Buffer=-41008, Bounds=-41009, PhysicalUnknown=-41010, Internal=-41011,
 Busy=-41012 };
static_assert(sizeof(ynx_social_joint_status_v1)==24);
static_assert(sizeof(ynx_social_joint_binding_view_v1)==432);
static_assert(sizeof(ynx_social_joint_source_input_v1)==112);
Result error(std::int32_t code,bool unknown=false) noexcept {
 return {true,code,unknown,false};
}
struct ActorID {
 const pid_t pid=getpid(); const uid_t uid=getuid();
 const std::thread::id thread=std::this_thread::get_id();
 bool same() const noexcept {
  return pid==getpid()&&uid==getuid()&&uid==geteuid()&&
         getgid()==getegid()&&thread==std::this_thread::get_id();
 }
};
struct State {
 const ActorID actor;
 Result first;
 bool retired=false,close_selected=false,busy=false;
 void remember(Result r) noexcept {
  if(!r.ok()&&first.ok())first=r;
 }
};
struct Use {
 State&state;
 explicit Use(State&s):state(s){if(s.busy)throw static_cast<std::int32_t>(Busy);s.busy=true;}
 ~Use(){state.busy=false;}
};
struct ApiFrame;
thread_local ApiFrame* active_frame=nullptr;
struct ApiFrame {
 ApiFrame*previous=active_frame;
 std::shared_ptr<State> state;
 ApiFrame(){active_frame=this;}
 ~ApiFrame(){active_frame=previous;}
 void failed(Result r) noexcept {if(state)state->remember(r);}
};
void adoptErrorSink(const std::shared_ptr<State>&state) noexcept {
 if(active_frame)active_frame->state=state;
}
struct SourceState : State {
 port::SourceInput input;
 std::shared_ptr<port::Source> held;
 std::size_t bindings=0;
};
struct BindingState : State {
 port::Resource resource{};
 std::shared_ptr<SourceState> source;
 std::shared_ptr<port::SocialHolder> social;
 std::shared_ptr<port::DeviceHolder> device;
 bool counted=false,social_close=false,device_close=false;
 std::size_t views=0,roles=0;
};
struct RoleState : State {
 std::shared_ptr<SourceState> source;
 std::shared_ptr<BindingState> binding;
 std::shared_ptr<port::Role> held;
 port::Bytes body,frame;
 port::Resource resource{};
 std::uint32_t role=0;
 bool counted=false,enter_selected=false,entered=false,sign_selected=false;
 bool sign_returned=false,retire_selected=false,join_selected=false,joined=false;
 bool unresolved=false;
};
struct ViewState {
 std::shared_ptr<BindingState> binding;
 std::shared_ptr<port::SocialView> social;
 std::shared_ptr<port::DeviceView> device;
 ynx_social_joint_binding_view_v1 original{};
 std::array<std::array<unsigned char,128>,6> application{};
 std::array<std::array<unsigned char,2048>,17> expected{};
 std::array<unsigned char,33> classic{};
 std::array<unsigned char,2592> pq{};
 bool social_release=false,device_release=false;
};
// A borrowed object stays alive across inventory lookups. Revocation removes
// authority, not memory behind a concurrent rejected foreign-thread lookup.
// Tokens are permanent bounded tombstones: an old address cannot become a
// new registered owner. No production registration setter exists.
struct Inventories {
 std::mutex mutex;
 std::uint64_t serial=0;
 std::unordered_map<ynx_social_joint_source_v1*,std::shared_ptr<SourceState>> sources;
 std::unordered_map<ynx_social_joint_binding_v1*,std::shared_ptr<BindingState>> bindings;
 std::unordered_map<ynx_social_joint_role_v1*,std::shared_ptr<RoleState>> roles;
 std::unordered_map<ynx_social_joint_binding_view_v1*,std::shared_ptr<ViewState>> views;
 std::vector<std::unique_ptr<ynx_social_joint_source_v1>> source_tokens;
 std::vector<std::unique_ptr<ynx_social_joint_binding_v1>> binding_tokens;
 std::vector<std::unique_ptr<ynx_social_joint_role_v1>> role_tokens;
 // Unique application[0] storage also prevents a released view's bytes from
 // recognizing a later view at the same caller-owned output address.
 std::vector<std::unique_ptr<unsigned char[]>> view_markers;
};
Inventories& inventory(){static auto*p=new Inventories;return *p;}
template<class Map,class Key> auto lookup(Map&map,Key key)->typename Map::mapped_type {
 auto&i=inventory();std::lock_guard<std::mutex>lock(i.mutex);
 auto it=map.find(key);return it==map.end()?nullptr:it->second;
}
template<class Token,class StateType,class Map,class Arena>
Token* install(std::shared_ptr<StateType> state,Map&map,Arena&arena){
 auto&i=inventory();std::lock_guard<std::mutex>lock(i.mutex);
 if(map.size()>=64||i.serial>=16384)throw static_cast<std::int32_t>(Capacity);
 auto token=std::make_unique<Token>();token->serial=++i.serial;
 Token*raw=token.get();arena.push_back(std::move(token));
 map.emplace(raw,std::move(state));return raw;
}
void status(ynx_social_joint_status_v1*out,Result r,bool done=false) noexcept {
 if(!out)return;
 *out={1,sizeof(*out),r.error_present?1U:0U,r.first,done?1U:0U,r.unknown?1U:0U};
}
template<class F> void api(ynx_social_joint_status_v1*out,F&&fn) noexcept {
 if(!out)return;*out={1,sizeof(*out),1,Internal,0,0};
 ApiFrame frame;
 try{fn();}catch(std::int32_t e){auto r=error(e);frame.failed(r);status(out,r);}
 catch(const std::bad_alloc&){auto r=error(Capacity);frame.failed(r);status(out,r);}
 catch(...){auto r=error(Internal,true);frame.failed(r);status(out,r);}
}
bool resource(const unsigned char*p,std::size_t n,port::Resource&out) noexcept {
 if(!p||n!=out.size())return false;
 std::memcpy(out.data(),p,n);
 return std::any_of(out.begin(),out.end(),[](unsigned char c){return c!=0;});
}
bool copy(ynx_social_joint_bytes_v1 s,port::Bytes&out,std::size_t max){
 if(!s.data||s.size==0||s.size>max)return false;
 out.assign(s.data,s.data+s.size);return true;
}
Result sourceCurrentBody(const std::shared_ptr<SourceState>&s) noexcept {
 if(!s)return error(Invalid);if(!s->actor.same())return error(Actor);
 if(!s->first.ok())return s->first;
 if(s->retired||s->close_selected)return error(Retired);
 if(!s->held)return error(Missing);
 Result r=s->held->current();
 if(r.ok())r=s->held->matchCurrentOriginals(s->input);
 if(r.ok())r=s->held->current();
 s->remember(r);return s->first.ok()?r:s->first;
}
Result sourceCurrent(const std::shared_ptr<SourceState>&s){
 if(!s)return error(Invalid);if(!s->actor.same())return error(Actor);
 Use use(*s);return sourceCurrentBody(s);
}
Result bindingCurrentBody(const std::shared_ptr<BindingState>&b) {
 if(!b)return error(Invalid);if(!b->actor.same())return error(Actor);
 if(!b->first.ok())return b->first;
 if(b->retired||b->close_selected)return error(Retired);
 Result r=sourceCurrent(b->source);
 if(r.ok())r=b->social?b->social->current():error(Missing);
 if(r.ok())r=b->device?b->device->current():error(Missing);
 if(r.ok())r=b->source->held->matchBinding(*b->social,*b->device);
 if(r.ok())r=sourceCurrent(b->source);
 b->remember(r);return b->first.ok()?r:b->first;
}
Result bindingCurrent(const std::shared_ptr<BindingState>&b){
 if(!b)return error(Invalid);if(!b->actor.same())return error(Actor);
 Use use(*b);return bindingCurrentBody(b);
}
Result roleCurrentBody(const std::shared_ptr<RoleState>&r) {
 if(!r)return error(Invalid);if(!r->actor.same())return error(Actor);
 if(!r->first.ok())return r->first;
 if(r->retired||r->close_selected)return error(Retired);
 Result result=bindingCurrent(r->binding);
 if(result.ok())result=r->held?r->held->current():error(Missing);
 if(result.ok())result=r->source->held->inspectOriginalBodyDATA(
   *r->binding->social,*r->binding->device,r->body);
 if(result.ok())result=bindingCurrent(r->binding);
 r->remember(result);return r->first.ok()?result:r->first;
}
Result roleCurrent(const std::shared_ptr<RoleState>&r){
 if(!r)return error(Invalid);if(!r->actor.same())return error(Actor);
 Use use(*r);return roleCurrentBody(r);
}
template<std::size_t N> bool text(const std::string&s,
 std::array<unsigned char,N>&bytes,ynx_social_joint_bytes_v1&out) noexcept {
 if(s.size()>N)return false;
 std::memcpy(bytes.data(),s.data(),s.size());out={bytes.data(),s.size()};return true;
}
Result populateView(ViewState&v) noexcept {
 auto&o=v.original;
 if(v.social){const auto&d=v.social->data();
  for(std::size_t j=0;j<6;++j){
   if(!text(d.application[j],v.application[j],o.application[j]))return error(Bounds);
  }
  if(d.classic_public.size()!=v.classic.size()||d.pq_public.size()!=v.pq.size())return error(Bounds);
  std::memcpy(v.classic.data(),d.classic_public.data(),v.classic.size());
  std::memcpy(v.pq.data(),d.pq_public.data(),v.pq.size());
  o.classic_public={v.classic.data(),v.classic.size()};o.pq_public={v.pq.data(),v.pq.size()};
  o.not_before_ms=d.window.not_before_ms;o.expires_ms=d.window.expires_ms;
 }
 if(v.device){const auto&d=v.device->data();
  if(d.null_mask&~((1U<<8)|(1U<<9)))return error(Bounds);
  for(std::size_t j=0;j<17;++j){
   if(!text(d.expected[j],v.expected[j],o.expected[j]))return error(Bounds);
   if((d.null_mask&(1U<<j))&&!d.expected[j].empty())return error(Bounds);
  }
  o.expected_null_mask=d.null_mask;
  o.not_before_ms=std::max(o.not_before_ms,d.window.not_before_ms);
  o.expires_ms=std::min(o.expires_ms,d.window.expires_ms);
 }
 if(v.social&&v.device){const auto w=v.binding->source->held->window();
  o.not_before_ms=std::max(o.not_before_ms,w.not_before_ms);
  o.expires_ms=std::min(o.expires_ms,w.expires_ms);
  if(o.not_before_ms<0||o.expires_ms<=o.not_before_ms)return error(Bounds);
 }
 return {};
}
}

extern "C" void ynx_social_joint_source_open_v1(const ynx_social_joint_source_input_v1*in,
 ynx_social_joint_source_v1**out,ynx_social_joint_status_v1*st){api(st,[&]{
 if(!out){status(st,error(Invalid));return;}*out=nullptr;
 auto s=std::make_shared<SourceState>();auto&i=inventory();
 *out=install<ynx_social_joint_source_v1>(s,i.sources,i.source_tokens);
 adoptErrorSink(s);
 Use use(*s);
 Result r;
 if(!s->actor.same()||!in||in->version!=2||in->size!=sizeof(*in)||
   !in->same_process_capture_reference||
   !resource(in->registered_source_resource,32,s->input.resource)||
   !copy(in->registration,s->input.originals[0],port::OriginalMax)||
   !copy(in->issuer_credential,s->input.originals[1],port::OriginalMax)||
   !copy(in->anchor_credential,s->input.originals[2],port::OriginalMax)||
   !copy(in->history_envelope,s->input.originals[3],port::OriginalMax))r=error(Invalid);
 if(r.ok()){s->input.same_process_capture_reference=in->same_process_capture_reference;
  port::acquireRegisteredSource(s->input,s->held,r);} // partial first
 if(r.ok()&&!s->held)r=error(Missing);
 s->remember(r);if(r.ok())r=sourceCurrentBody(s);status(st,r);
 });}
extern "C" void ynx_social_joint_source_current_v1(ynx_social_joint_source_v1*p,
 ynx_social_joint_status_v1*st){api(st,[&]{status(st,sourceCurrent(lookup(inventory().sources,p)));});}
extern "C" void ynx_social_joint_source_close_v1(ynx_social_joint_source_v1**p,
 ynx_social_joint_status_v1*st){api(st,[&]{
 if(!p){status(st,error(Invalid));return;}if(!*p){status(st,{},true);return;}
 auto s=lookup(inventory().sources,*p);if(!s||!s->actor.same()){status(st,error(Actor));return;}
 adoptErrorSink(s);Use use(*s);
 s->retired=true;if(s->bindings){status(st,error(ChildDebt));return;}
 if(s->close_selected){status(st,error(PhysicalUnknown,true));return;}
 s->close_selected=true;Result r=s->held?s->held->close():Result{};
 const bool done=!s->held||r.physical_done;s->remember(r);
 if(done){s->held.reset();auto&i=inventory();std::lock_guard<std::mutex>l(i.mutex);i.sources.erase(*p);*p=nullptr;}
 auto result=s->first;if(!done)result.unknown=true;status(st,result,done);
 });}
extern "C" void ynx_social_joint_binding_open_v1(ynx_social_joint_source_v1*p,
 const unsigned char*id,std::size_t n,ynx_social_joint_binding_v1**out,
 ynx_social_joint_status_v1*st){api(st,[&]{
 if(!out){status(st,error(Invalid));return;}*out=nullptr;
 auto b=std::make_shared<BindingState>();auto&i=inventory();
 *out=install<ynx_social_joint_binding_v1>(b,i.bindings,i.binding_tokens);
 adoptErrorSink(b);
 Use use(*b);
 auto s=lookup(i.sources,p);port::Resource locator{};Result r;
 if(!s||!s->actor.same()||!resource(id,n,locator))r=error(Invalid);
 if(r.ok()){b->resource=locator;b->source=s;++s->bindings;b->counted=true;r=sourceCurrent(s);}
 if(r.ok())port::acquireCommittedSocialPair(*s->held,locator,b->social,r);
 if(r.ok()&&!b->social)r=error(Missing);
 if(r.ok())r=b->social->current();
 if(r.ok())r=sourceCurrent(s);
 if(r.ok())port::acquireRegisteredDeviceSession(*s->held,*b->social,locator,b->device,r);
 if(r.ok()&&!b->device)r=error(Missing);
 b->remember(r);if(r.ok())r=bindingCurrentBody(b);status(st,r);
 });}
extern "C" void ynx_social_joint_binding_current_v1(ynx_social_joint_binding_v1*p,
 ynx_social_joint_status_v1*st){api(st,[&]{status(st,bindingCurrent(lookup(inventory().bindings,p)));});}
extern "C" void ynx_social_joint_binding_view_v1_open(ynx_social_joint_binding_v1*p,
 ynx_social_joint_binding_view_v1*out,ynx_social_joint_status_v1*st){api(st,[&]{
 if(!out){status(st,error(Invalid));return;}
 auto&i=inventory();
 {std::lock_guard<std::mutex>l(i.mutex);if(i.views.count(out)){status(st,error(AlreadySelected));return;}}
 *out={};auto b=lookup(i.bindings,p);Result r=bindingCurrent(b);
 if(!r.ok()){status(st,r);return;}
 adoptErrorSink(b);
 Use use(*b);
 auto v=std::make_shared<ViewState>();v->binding=b;
 // Allocate and register all debt storage before either foreign acquisition.
 auto marker=std::make_unique<unsigned char[]>(128);auto*unique=marker.get();
 {std::lock_guard<std::mutex>l(i.mutex);if(i.views.size()>=64||i.view_markers.size()>=16384){status(st,error(Capacity));return;}
  i.view_markers.push_back(std::move(marker));i.views.emplace(out,v);}
 ++b->views;b->social->view(v->social,r);
 if(r.ok()&&!v->social)r=error(Missing);
 if(r.ok())r=bindingCurrentBody(b);
 if(r.ok())b->device->view(v->device,r);
 if(r.ok()&&!v->device)r=error(Missing);
 if(v->social||v->device){v->original.version=1;v->original.size=sizeof(*out);
  Result data=populateView(*v);if(r.ok())r=data;
  const auto&realm=v->application[0];const auto len=v->original.application[0].size;
  if(len<=128)std::memcpy(unique,realm.data(),len);
  v->original.application[0]={unique,len};*out=v->original;
 }else{--b->views;std::lock_guard<std::mutex>l(i.mutex);i.views.erase(out);}
 if(r.ok())r=bindingCurrentBody(b);b->remember(r);status(st,r);
 });}
extern "C" void ynx_social_joint_binding_view_v1_release(ynx_social_joint_binding_v1*p,
 ynx_social_joint_binding_view_v1*out,ynx_social_joint_status_v1*st){api(st,[&]{
 auto b=lookup(inventory().bindings,p);if(!b||!b->actor.same()||!out){status(st,error(Actor));return;}
 adoptErrorSink(b);Use use(*b);
 auto v=lookup(inventory().views,out);
 if(!v||v->binding!=b||std::memcmp(out,&v->original,sizeof(*out))){status(st,error(Invalid));return;}
 Result r;
 if(v->device&&!v->device_release){v->device_release=true;auto z=v->device->release();b->remember(z);if(!z.ok())r=z;if(z.physical_done)v->device.reset();else if(r.ok())r=error(PhysicalUnknown,true);}
 if(v->device){status(st,r.ok()?error(PhysicalUnknown,true):r);return;}
 if(v->social&&!v->social_release){v->social_release=true;auto z=v->social->release();b->remember(z);if(r.ok()&&!z.ok())r=z;if(z.physical_done)v->social.reset();else if(r.ok())r=error(PhysicalUnknown,true);}
 if(v->social){status(st,r.ok()?error(PhysicalUnknown,true):r);return;}
 if(!b->views){status(st,error(Internal,true));return;}--b->views;
 {auto&i=inventory();std::lock_guard<std::mutex>l(i.mutex);i.views.erase(out);}*out={};
 status(st,r);
 });}
extern "C" void ynx_social_joint_binding_close_v1(ynx_social_joint_binding_v1**p,
 ynx_social_joint_status_v1*st){api(st,[&]{
 if(!p){status(st,error(Invalid));return;}if(!*p){status(st,{},true);return;}
 auto b=lookup(inventory().bindings,*p);if(!b||!b->actor.same()){status(st,error(Actor));return;}
 adoptErrorSink(b);Use use(*b);
 b->retired=true;if(b->roles||b->views){status(st,error(ChildDebt));return;}
 if(b->close_selected){status(st,error(PhysicalUnknown,true));return;}
 b->close_selected=true;
 if(b->device){b->device_close=true;auto r=b->device->close();b->remember(r);
  if(r.physical_done)b->device.reset();
  else if(r.original_drain_pending){b->device_close=false;b->close_selected=false;}}
 if(b->device){status(st,b->first.ok()?error(PhysicalUnknown,true):b->first);return;}
 if(b->social){b->social_close=true;auto r=b->social->close();b->remember(r);if(r.physical_done)b->social.reset();}
 if(b->social){status(st,b->first.ok()?error(PhysicalUnknown,true):b->first);return;}
 if(b->counted){if(!b->source||!b->source->bindings){status(st,error(Internal,true));return;}--b->source->bindings;b->counted=false;}
 b->source.reset();{auto&i=inventory();std::lock_guard<std::mutex>l(i.mutex);i.bindings.erase(*p);*p=nullptr;}
 status(st,b->first,true);
 });}
extern "C" void ynx_social_joint_role_open_v1(ynx_social_joint_source_v1*s,
 ynx_social_joint_binding_v1*b,const unsigned char*id,std::size_t n,
 std::uint32_t role,ynx_social_joint_bytes_v1 body,ynx_social_joint_role_v1**out,
 ynx_social_joint_status_v1*st){api(st,[&]{
 if(!out){status(st,error(Invalid));return;}*out=nullptr;
 auto r=std::make_shared<RoleState>();auto&i=inventory();
 *out=install<ynx_social_joint_role_v1>(r,i.roles,i.role_tokens);
 adoptErrorSink(r);
 Use use(*r);
 auto source=lookup(i.sources,s);auto binding=lookup(i.bindings,b);Result z;
 if(!source||!binding||!source->actor.same()||!binding->actor.same()||binding->source!=source||
   (role!=1&&role!=2)||!resource(id,n,r->resource)||!copy(body,r->body,port::BodyMax))z=error(Invalid);
 if(z.ok()){r->source=source;r->binding=binding;r->role=role;++binding->roles;r->counted=true;z=bindingCurrent(binding);}
 if(z.ok())z=source->held->inspectOriginalBodyDATA(*binding->social,*binding->device,r->body);
 if(z.ok())z=port::prepareOriginalSourceFrame(role,r->body,r->frame);
 if(z.ok())z=bindingCurrent(binding);
 if(z.ok())source->held->role(*binding->social,*binding->device,binding->resource,r->resource,role,r->body,r->frame,r->held,z);
 r->unresolved=z.unknown;
 if(z.ok()&&!r->held)z=error(Missing);
 r->remember(z);if(z.ok())z=roleCurrentBody(r);status(st,z);
 });}
extern "C" void ynx_social_joint_role_current_v1(ynx_social_joint_role_v1*p,
 ynx_social_joint_status_v1*st){api(st,[&]{status(st,roleCurrent(lookup(inventory().roles,p)));});}
extern "C" void ynx_social_joint_role_enter_v1(ynx_social_joint_role_v1*p,
 ynx_social_joint_status_v1*st){api(st,[&]{
 auto r=lookup(inventory().roles,p);if(!r||!r->actor.same()){status(st,error(Actor));return;}
 adoptErrorSink(r);Use use(*r);Result z=roleCurrentBody(r);
 if(!z.ok()){status(st,z);return;}if(r->enter_selected){status(st,error(AlreadySelected,r->unresolved));return;}
 r->enter_selected=true;z=r->held->enterOriginalOnce();r->unresolved=z.unknown;
 if(z.ok())z=r->held->durableOriginalIntentCurrent();
 if(z.ok())z=roleCurrentBody(r);
 if(z.ok())r->entered=true;else r->unresolved=true;
 r->remember(z);if(r->unresolved)z.unknown=true;status(st,z);
 });}
extern "C" void ynx_social_joint_role_sign_once_v1(ynx_social_joint_role_v1*p,
 ynx_social_joint_status_v1*st){api(st,[&]{
 auto r=lookup(inventory().roles,p);if(!r||!r->actor.same()){status(st,error(Actor));return;}
 adoptErrorSink(r);Use use(*r);Result z=roleCurrentBody(r);
 if(!z.ok()){status(st,z);return;}
 if(!r->entered||r->sign_selected||r->unresolved){status(st,error(AlreadySelected,r->unresolved));return;}
 z=r->held->durableOriginalIntentCurrent();if(z.ok())z=roleCurrentBody(r);
 if(z.ok()){r->sign_selected=true;z=r->held->signOnceOriginalSourceProof();r->sign_returned=true;
  if(!z.ok())r->unresolved=true;else{z=roleCurrentBody(r);if(!z.ok())r->unresolved=true;}}
 r->remember(z);if(r->unresolved)z.unknown=true;status(st,z);
 });}
namespace {
void copyRole(ynx_social_joint_role_v1*p,unsigned char*out,std::size_t capacity,
 std::size_t*written,ynx_social_joint_status_v1*st,bool query){api(st,[&]{
 if(!written){status(st,error(Invalid));return;}*written=0;
 auto r=lookup(inventory().roles,p);if(!r||!r->actor.same()||!r->held||(!out&&capacity)||capacity>port::OriginalMax){status(st,error(Invalid));return;}
 adoptErrorSink(r);Use use(*r);
 if(!query&&(!r->sign_returned||r->unresolved)){status(st,r->first.ok()?error(AlreadySelected,r->unresolved):r->first);return;}
 // Acquisition can recover an already uncertain original durable operation.
 // Its same held cap may query BEFORE this process enters any new intent.
 // The service's query is read-only and must never create/renew an operation.
 port::Bytes bytes;Result z=query?r->held->queryOriginal(bytes):r->held->copyOriginal(bytes);
 // Actual partial public output is adopted before late service/current errors.
 if(z.ok()&&bytes.empty())z=error(Missing,r->unresolved);
 if(bytes.size()>port::OriginalMax){z=error(Bounds,true);}else if(bytes.size()>capacity){z=error(Buffer,z.unknown);}
 else{if(!bytes.empty())std::memcpy(out,bytes.data(),bytes.size());*written=bytes.size();}
 if(!query&&z.ok())z=roleCurrentBody(r);
 r->remember(z);if(r->unresolved)z.unknown=true;status(st,z);
 });}
}
extern "C" void ynx_social_joint_role_copy_original_v1(ynx_social_joint_role_v1*p,
 unsigned char*out,std::size_t cap,std::size_t*n,ynx_social_joint_status_v1*s){copyRole(p,out,cap,n,s,false);}
extern "C" void ynx_social_joint_role_query_original_v1(ynx_social_joint_role_v1*p,
 unsigned char*out,std::size_t cap,std::size_t*n,ynx_social_joint_status_v1*s){copyRole(p,out,cap,n,s,true);}
extern "C" void ynx_social_joint_role_retire_v1(ynx_social_joint_role_v1*p,
 ynx_social_joint_status_v1*st){api(st,[&]{
 auto r=lookup(inventory().roles,p);if(!r||!r->actor.same()){status(st,error(Actor));return;}
 if(r->busy){r->retired=true;status(st,error(Busy));return;}
 adoptErrorSink(r);Use use(*r);
 r->retired=true;if(r->retire_selected){status(st,{});return;}
 r->retire_selected=true;Result z=r->held?r->held->retire():Result{};r->remember(z);status(st,z);
 });}
extern "C" void ynx_social_joint_role_join_v1(ynx_social_joint_role_v1*p,
 ynx_social_joint_status_v1*st){api(st,[&]{
 auto r=lookup(inventory().roles,p);if(!r||!r->actor.same()){status(st,error(Actor));return;}
 adoptErrorSink(r);Use use(*r);
 if(r->retired&&!r->retire_selected){r->retire_selected=true;auto z=r->held?r->held->retire():Result{};r->remember(z);if(!z.ok()){status(st,z);return;}}
 if(!r->retire_selected){status(st,error(AlreadySelected));return;}
 if(r->joined){status(st,{});return;}
 if(r->join_selected){status(st,error(PhysicalUnknown,true));return;}
 r->join_selected=true;Result z=r->held?r->held->join():Result{};
 if(z.ok())r->joined=true;r->remember(z);status(st,z);
 });}
extern "C" void ynx_social_joint_role_close_v1(ynx_social_joint_role_v1**p,
 ynx_social_joint_status_v1*st){api(st,[&]{
 if(!p){status(st,error(Invalid));return;}if(!*p){status(st,{},true);return;}
 auto r=lookup(inventory().roles,*p);if(!r||!r->actor.same()){status(st,error(Actor));return;}
 adoptErrorSink(r);Use use(*r);
 if(!r->retire_selected||!r->joined){status(st,error(ChildDebt));return;}
 if(r->close_selected){status(st,error(PhysicalUnknown,true));return;}
 r->close_selected=true;Result z=r->held?r->held->close():Result{};r->remember(z);
 const bool done=!r->held||z.physical_done;
 if(done){r->held.reset();if(r->counted){if(!r->binding||!r->binding->roles){status(st,error(Internal,true));return;}--r->binding->roles;r->counted=false;}
  r->binding.reset();r->source.reset();auto&i=inventory();std::lock_guard<std::mutex>l(i.mutex);i.roles.erase(*p);*p=nullptr;}
 auto result=r->first;if(!done)result.unknown=true;status(st,result,done);
 });}
