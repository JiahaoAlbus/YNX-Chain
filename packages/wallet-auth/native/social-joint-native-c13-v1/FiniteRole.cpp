#include "OriginalServices.hpp"
#include "ynx_social_finite_joint_custodian_private_v1.h"
#include <cstring>
#include <pthread.h>
#include <unistd.h>

namespace ynx::social::joint::original {
namespace {
constexpr std::int32_t Invalid=-41201,Malformed=-41202,Selected=-41203,
 Actor=-41204,Missing=-41205,Internal=-41206;
Result failure(std::int32_t code,bool unknown=false) noexcept {
 return {true,code,unknown,false};
}
Result read(const ynx_social_finite_joint_status_v1&s,bool closing=false) noexcept {
 if(s.version!=1||s.size!=sizeof(s)||s.error_present>1||s.unknown>1||
    s.physical_done>1||(!closing&&s.physical_done)||
    (!s.error_present&&s.original_first))return failure(Malformed,true);
 return {s.error_present!=0,s.original_first,s.unknown!=0,s.physical_done!=0};
}
bool nonzero(const Resource&r) noexcept {
 for(auto c:r)if(c)return true;
 return false;
}
class FiniteRole final:public Role {
 using Status=ynx_social_finite_joint_status_v1;
 using Call=void(*)(ynx_social_finite_joint_custodian_v1*,Status*);
 using Copy=void(*)(ynx_social_finite_joint_custodian_v1*,unsigned char*,
                   std::size_t,std::size_t*,Status*);
 ynx_social_finite_joint_custodian_v1* owner_=nullptr;
 const pid_t pid_=getpid();
 const uid_t uid_=getuid();
 const pthread_t thread_=pthread_self();
 Result first_,open_result_,retire_result_,join_result_;
 bool entered_=false,enter_selected_=false,sign_selected_=false;
 bool retire_selected_=false,retired_=false,join_selected_=false,joined_=false;
 bool close_selected_=false,closed_=false;
 bool same()const noexcept {
  return pid_==getpid()&&uid_==getuid()&&pthread_equal(thread_,pthread_self());
 }
 void remember(Result r)noexcept {if(!r.ok()&&first_.ok())first_=r;}
 Result call(Call fn)noexcept {
  if(!same())return failure(Actor);
  if(!owner_||retire_selected_||close_selected_)return failure(Selected);
  Status s{};fn(owner_,&s);auto r=read(s);remember(r);return r;
 }
 Result copy(Copy fn,Bytes&out,bool query)noexcept {
  if(!same())return failure(Actor);
  if(!owner_||retire_selected_||close_selected_)return failure(Selected);
  if(!query&&(!sign_selected_||!first_.ok()))return first_.ok()?failure(Selected):first_;
  // Allocate before crossing the service boundary. Never lose a returned
  // public envelope to an allocation failure after a remote operation.
  try {
   Bytes bytes(OriginalMax);std::size_t written=0;Status s{};
   fn(owner_,bytes.data(),bytes.size(),&written,&s);
   auto r=read(s);
   if(written>bytes.size()){if(r.ok())r=failure(Malformed,true);}
   else {bytes.resize(written);out.swap(bytes);if(r.ok()&&out.empty())r=failure(Missing);}
   remember(r);return r;
  }catch(...){auto r=failure(Internal,true);remember(r);return r;}
 }
public:
 void open(const ynx_social_finite_joint_request_v1&request,Result&r)noexcept {
  Status s{};
  ynx_social_finite_joint_custodian_open_v1(&request,&owner_,&s);
  // Nonnull output belongs to THIS retained adapter before status is read.
  r=read(s);if(r.ok()&&!owner_)r=failure(Missing,true);
  open_result_=r;remember(r);
 }
 void observe(Result r)noexcept {remember(r);if(!r.ok()&&open_result_.ok())open_result_=r;}
 Result current()noexcept override {
  if(!same())return failure(Actor);
  if(!open_result_.ok())return open_result_;
  return call(ynx_social_finite_joint_custodian_current_v1);
 }
 Result enterOriginalOnce()noexcept override {
  if(!same())return failure(Actor);
  if(!open_result_.ok())return open_result_;
  if(!first_.ok())return first_;
  if(enter_selected_||retire_selected_||close_selected_)return failure(Selected,true);
  enter_selected_=true;
  auto r=call(ynx_social_finite_joint_custodian_enter_original_once_v1);
  entered_=r.ok();return r;
 }
 Result durableOriginalIntentCurrent()noexcept override {
  if(!same())return failure(Actor);
  if(!entered_||!first_.ok())return first_.ok()?failure(Selected):first_;
  return call(ynx_social_finite_joint_custodian_durable_original_intent_current_v1);
 }
 Result signOnceOriginalSourceProof()noexcept override {
  if(!same())return failure(Actor);
  if(sign_selected_)return failure(Selected,true);
  auto r=durableOriginalIntentCurrent();if(!r.ok())return r;
  sign_selected_=true;
  return call(ynx_social_finite_joint_custodian_sign_once_v1);
 }
 Result copyOriginal(Bytes&out)noexcept override {
  return copy(ynx_social_finite_joint_custodian_copy_original_v1,out,false);
 }
 Result queryOriginal(Bytes&out)noexcept override {
  // A cold open may hold an already UNKNOWN original. Query does not depend
  // on a successful open/enter/sign and carries NO replacement request.
  return copy(ynx_social_finite_joint_custodian_query_original_v1,out,true);
 }
 Result retire()noexcept override {
  if(!same())return failure(Actor);
  if(retire_selected_)return retire_result_;
  retire_selected_=true;
  if(!owner_){retired_=true;return {};}
  Status s{};ynx_social_finite_joint_custodian_retire_v1(owner_,&s);
  retire_result_=read(s);retired_=retire_result_.ok();remember(retire_result_);
  return retire_result_;
 }
 Result join()noexcept override {
  if(!same())return failure(Actor);
  if(!retired_)return retire_selected_?retire_result_:failure(Selected);
  if(join_selected_)return join_result_;
  join_selected_=true;
  if(!owner_){joined_=true;return {};}
  Status s{};ynx_social_finite_joint_custodian_join_v1(owner_,&s);
  join_result_=read(s);joined_=join_result_.ok();remember(join_result_);
  return join_result_;
 }
 Result close()noexcept override {
  if(!same())return failure(Actor);
  if(closed_){auto r=first_;r.physical_done=true;return r;}
  if(close_selected_){auto r=first_;if(r.ok())r=failure(Selected,true);r.unknown=true;return r;}
  if(!retired_||!joined_)return failure(Selected,true);
  close_selected_=true;
  if(!owner_)closed_=true;
  else {
   Status s{};ynx_social_finite_joint_custodian_close_v1(&owner_,&s);
   auto r=read(s,true);remember(r);closed_=!owner_&&r.physical_done;
  }
  auto r=first_;r.physical_done=closed_;
  if(!closed_){if(r.ok())r=failure(Missing,true);r.unknown=true;}
  return r;
 }
};
}
void acquireOriginalFiniteRole(Source&source,SocialHolder&social,DeviceHolder&device,
 const Resource&binding,const Resource&role_resource,std::uint32_t role,
 const Bytes&body,const Bytes&frame,std::shared_ptr<Role>&out,Result&r)noexcept {
 try {
  out.reset();r={};
  if((role!=1&&role!=2)||!nonzero(binding)||!nonzero(role_resource)||
     body.empty()||body.size()>BodyMax||frame.empty()||frame.size()>49152){r=failure(Invalid);return;}
  SourceInput original;
  copyOriginalCapturedSourceInputs(source,original,r);if(!r.ok())return;
  for(const auto&bytes:original.originals)if(bytes.empty()||bytes.size()>OriginalMax){r=failure(Invalid);return;}
  r=social.current();if(r.ok())r=device.current();if(!r.ok())return;
  ynx_social_finite_joint_request_v1 request{};request.version=1;request.size=sizeof(request);
  std::memcpy(request.source_resource,original.resource.data(),original.resource.size());
  std::memcpy(request.binding_resource,binding.data(),binding.size());
  std::memcpy(request.role_resource,role_resource.data(),role_resource.size());request.role=role;
  for(std::size_t i=0;i<4;++i)request.originals[i]={original.originals[i].data(),original.originals[i].size()};
  request.body_original={body.data(),body.size()};request.source_frame_original={frame.data(),frame.size()};
  auto held=std::make_shared<FiniteRole>();out=held;held->open(request,r);
  if(r.ok())r=source.current();if(r.ok())r=social.current();if(r.ok())r=device.current();
  held->observe(r);
 }catch(...){r=failure(Internal,true);}
}
} // namespace ynx::social::joint::original
