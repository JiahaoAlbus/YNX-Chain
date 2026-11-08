#include "OriginalServices.hpp"
#include "ynx_auth_registered_main_pair_read_private_v1.h"
#include <cstring>
#include <pthread.h>
#include <unistd.h>

namespace ynx::social::joint::original {
namespace {
constexpr std::int32_t Invalid=-41501,Malformed=-41502,Pending=-41503,
 Actor=-41504,Missing=-41505,Internal=-41506;
Result fail(std::int32_t code,bool unknown=false)noexcept{return {true,code,unknown,false};}
bool valid(const ynx_social_joint_status_v1&s,bool closing=false)noexcept {
 return s.version==1&&s.size==sizeof(s)&&s.error_present<=1&&s.unknown<=1&&
  s.physical_done<=1&&(closing||!s.physical_done)&&(s.error_present||!s.original_first);
}
Result read(const ynx_social_joint_status_v1&s,bool closing=false)noexcept {
 if(!valid(s,closing))return fail(Malformed,true);
 return {s.error_present!=0,s.original_first,s.unknown!=0,s.physical_done!=0};
}
struct ActorOwner {
 const pid_t pid=getpid();const uid_t uid=getuid();const pthread_t thread=pthread_self();
 bool same()const noexcept{return pid==getpid()&&uid==getuid()&&pthread_equal(thread,pthread_self());}
};
struct Use{bool&busy;explicit Use(bool&b):busy(b){busy=true;}~Use(){busy=false;}};
class RegisteredPair;
class RegisteredView final:public SocialView {
 ActorOwner actor_;
 std::shared_ptr<RegisteredPair>parent_;
 ynx_auth_registered_main_pair_view_v1*view_=nullptr;
 std::array<unsigned char,YNX_SOCIAL_MAIN_PAIR_STORAGE_V1>storage_{};
 ynx_social_main_pair_view_v1 raw_{};
 SocialData data_;
 AccountNamespace account_;
 Result first_;
 bool release_selected_=false,released_=false,absence_known_=true;
 void remember(Result r)noexcept{r.physical_done=false;if(!r.ok()&&first_.ok())first_=r;}
 bool span(ynx_social_joint_bytes_v1 s,std::size_t max)const noexcept {
  if(s.size>max)return false;if(!s.size)return true;
  const auto base=reinterpret_cast<std::uintptr_t>(storage_.data());
  const auto p=reinterpret_cast<std::uintptr_t>(s.data);
  return p>=base&&p-base<=storage_.size()&&s.size<=storage_.size()-(p-base);
 }
 bool projectionValid()const noexcept {
  if(raw_.version!=1||raw_.size!=sizeof(raw_)||!raw_.view)return false;
  for(auto s:raw_.application)if(!span(s,128))return false;
  return span(raw_.classic_public,33)&&raw_.classic_public.size==33&&
   span(raw_.pq_public,2592)&&raw_.pq_public.size==2592&&
   span(raw_.account_issuer,2048)&&raw_.account_issuer.size&&
   span(raw_.account_subject,2048)&&raw_.account_subject.size&&
   raw_.not_before_ms>=0&&raw_.expires_ms>raw_.not_before_ms&&raw_.expires_ms<=9007199254740991LL;
 }
public:
 explicit RegisteredView(std::shared_ptr<RegisteredPair>p):parent_(std::move(p)){}
 void open(Result&)noexcept;
 const SocialData&data()const noexcept override{return data_;}
 void copyAccount(AccountNamespace&out,Result&r)noexcept {
  if(!actor_.same()){if(r.ok())r=fail(Actor);return;}
  if(release_selected_||released_||account_.issuer.empty()||account_.subject.empty()){
   if(r.ok())r=fail(Missing,true);return;
  }
  try{out=account_;}catch(...){if(r.ok())r=fail(Internal,true);}
 }
 Result release()noexcept override;
};
class RegisteredPair final:public SocialHolder,public std::enable_shared_from_this<RegisteredPair> {
 friend class RegisteredView;
 ActorOwner actor_;
 // Native binding retains its Source until every holder physically closes.
 Source*const source_;
 ynx_auth_registered_main_pair_channel_v1*channel_=nullptr;
 std::size_t children_=0;
 std::vector<std::shared_ptr<SocialView>>pending_;
 Result first_;
 bool busy_=false,close_selected_=false,closed_=false,absence_known_=true;
 void remember(Result r)noexcept{r.physical_done=false;if(!r.ok()&&first_.ok())first_=r;}
 Result ready()const noexcept {
  if(!actor_.same())return fail(Actor);
  if(busy_||close_selected_)return fail(Pending,true);
  if(!first_.ok())return first_;
  return channel_?Result{}:fail(Missing);
 }
public:
 explicit RegisteredPair(Source&s):source_(&s){pending_.reserve(64);}
 void open(const Resource&f06,Result&r)noexcept {
  Use use(busy_);SourceInput in;copyOriginalCapturedSourceInputs(*source_,in,r);
  if(!r.ok()){remember(r);return;}
  ynx_social_joint_source_input_v1 request{};request.version=2;request.size=sizeof(request);
  std::memcpy(request.registered_source_resource,in.resource.data(),in.resource.size());
  ynx_social_joint_bytes_v1*spans[]={&request.registration,&request.issuer_credential,&request.anchor_credential,&request.history_envelope};
  for(std::size_t i=0;i<4;++i){if(in.originals[i].empty()||in.originals[i].size()>OriginalMax){r=fail(Invalid);remember(r);return;}
   *spans[i]={in.originals[i].data(),in.originals[i].size()};}
  // The role's Go reference is NEVER a channel operand or wire capability.
  request.same_process_capture_reference=0;
  ynx_social_joint_status_v1 status{};absence_known_=false;
  ynx_auth_registered_main_pair_open_v1(&request,f06.data(),f06.size(),&channel_,&status);
  absence_known_=!channel_&&valid(status);r=read(status);
  if(r.ok()&&!channel_)r=fail(Missing,true);
  if(r.ok())r=source_->current();remember(r);
 }
 Result current()noexcept override {
  auto r=ready();if(!r.ok())return r;
  Use use(busy_);r=source_->current();
  if(r.ok()){ynx_social_joint_status_v1 status{};
   ynx_auth_registered_main_pair_current_v1(channel_,&status);r=read(status);}
  if(r.ok())r=source_->current();remember(r);return r;
 }
 void view(std::shared_ptr<SocialView>&out,Result&r)noexcept override {
  out.reset();r=ready();if(!r.ok())return;
  if(children_>=64){r=fail(Pending);return;}
  try{auto child=std::make_shared<RegisteredView>(shared_from_this());++children_;out=child;
   Use use(busy_);child->open(r);remember(r);
  }catch(...){r=fail(Internal,true);remember(r);}
 }
 void copyAccount(AccountNamespace&out,Result&r)noexcept {
  std::shared_ptr<SocialView>child;view(child,r);if(!child)return;
  auto*actual=dynamic_cast<RegisteredView*>(child.get());
  if(actual)actual->copyAccount(out,r);else if(r.ok())r=fail(Malformed,true);
  if(r.ok())r=current();
  auto released=child->release();if(!released.physical_done)pending_.push_back(std::move(child));
  if(r.ok())r=released;if(!released.physical_done)r.unknown=true;
  r.physical_done=false;remember(r);
 }
 Result close()noexcept override {
  if(!actor_.same())return fail(Actor);
  if(closed_){auto r=first_;r.physical_done=true;return r;}
  if(busy_||children_)return fail(Pending,true);
  if(close_selected_){auto r=first_;if(r.ok())r=fail(Pending,true);r.unknown=true;return r;}
  close_selected_=true;Use use(busy_);
  if(!channel_)closed_=absence_known_;
  else{ynx_social_joint_status_v1 status{};
   ynx_auth_registered_main_pair_close_v1(&channel_,&status);auto r=read(status,true);
   remember(r);closed_=!channel_&&r.physical_done;}
  auto r=first_;r.physical_done=closed_;if(!closed_){if(r.ok())r=fail(Pending,true);r.unknown=true;}return r;
 }
};
void RegisteredView::open(Result&r)noexcept {
 r=parent_->source_->current();if(!r.ok()){remember(r);return;}
 ynx_social_joint_status_v1 status{};absence_known_=false;
 ynx_auth_registered_main_pair_view_open_v1(parent_->channel_,&view_,&status);
 absence_known_=!view_&&valid(status);r=read(status);
 if(r.ok()&&!view_)r=fail(Missing,true);
 if(view_){
  ynx_social_joint_status_v1 copied{};
  ynx_auth_registered_main_pair_view_copy_v1(parent_->channel_,view_,storage_.data(),storage_.size(),&raw_,&copied);
  auto copy_result=read(copied);if(r.ok())r=copy_result;
  if(projectionValid())try{
   for(std::size_t i=0;i<6;++i)if(raw_.application[i].size)data_.application[i].assign(
    reinterpret_cast<const char*>(raw_.application[i].data),raw_.application[i].size);
   data_.classic_public.assign(raw_.classic_public.data,raw_.classic_public.data+raw_.classic_public.size);
   data_.pq_public.assign(raw_.pq_public.data,raw_.pq_public.data+raw_.pq_public.size);
   data_.window={raw_.not_before_ms,raw_.expires_ms};
   account_.issuer.assign(reinterpret_cast<const char*>(raw_.account_issuer.data),raw_.account_issuer.size);
   account_.subject.assign(reinterpret_cast<const char*>(raw_.account_subject.data),raw_.account_subject.size);
  }catch(...){if(r.ok())r=fail(Internal,true);}
  else if(r.ok())r=fail(Malformed,true);
  if(r.ok()){ynx_social_joint_status_v1 current{};
   ynx_auth_registered_main_pair_view_current_v1(parent_->channel_,view_,&current);r=read(current);}
 }
 if(r.ok())r=parent_->source_->current();remember(r);
}
Result RegisteredView::release()noexcept {
 if(!actor_.same())return fail(Actor);
 if(released_){auto r=first_;r.physical_done=true;return r;}
 if(!parent_||parent_->busy_)return fail(Pending,true);
 if(release_selected_){auto r=first_;if(r.ok())r=fail(Pending,true);r.unknown=true;return r;}
 release_selected_=true;auto parent=parent_;Use use(parent->busy_);
 bool done=!view_&&absence_known_;
 if(view_){ynx_social_joint_status_v1 status{};
  ynx_auth_registered_main_pair_view_release_v1(parent->channel_,&view_,&status);
  auto r=read(status,true);remember(r);done=!view_&&r.physical_done;}
 if(done){if(!parent->children_){remember(fail(Internal,true));done=false;}
  else{--parent->children_;released_=true;parent_.reset();}}
 auto r=first_;r.physical_done=done;if(!done){if(r.ok())r=fail(Pending,true);r.unknown=true;}
 parent->remember(r);return r;
}
}
void acquireRegisteredMainPair(Source&source,const Resource&resource,
 std::shared_ptr<SocialHolder>&out,Result&r)noexcept {
 out.reset();r={};try{auto held=std::make_shared<RegisteredPair>(source);out=held;held->open(resource,r);}
 catch(...){r={true,Internal,true,false};}
}
bool copyRegisteredMainPairAccountNamespace(SocialHolder&holder,AccountNamespace&out,Result&r)noexcept {
 auto*actual=dynamic_cast<RegisteredPair*>(&holder);if(!actual)return false;
 actual->copyAccount(out,r);return true;
}
} // namespace ynx::social::joint::original
