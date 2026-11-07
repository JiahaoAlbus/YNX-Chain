#include "OriginalServices.hpp"
#include "social_main_committed_pair_private.h"
#include <cstring>
#include <pthread.h>
#include <unistd.h>

namespace ynx::social::joint::original {
namespace {
constexpr std::int32_t Invalid=-41301,Malformed=-41302,Pending=-41303,
 Actor=-41304,Missing=-41305,Internal=-41306;
Result failure(std::int32_t code,bool unknown=false)noexcept{return {true,code,unknown,false};}
bool valid(const ynx_social_joint_status_v1&s,bool closing=false)noexcept {
 return s.version==1&&s.size==sizeof(s)&&s.error_present<=1&&s.unknown<=1&&
  s.physical_done<=1&&(closing||!s.physical_done)&&(s.error_present||!s.original_first);
}
Result read(const ynx_social_joint_status_v1&s,bool closing=false)noexcept {
 if(!valid(s,closing))return failure(Malformed,true);
 return {s.error_present!=0,s.original_first,s.unknown!=0,s.physical_done!=0};
}
struct ActorOwner {
 const pid_t pid=getpid();const uid_t uid=getuid();const pthread_t thread=pthread_self();
 bool same()const noexcept{return pid==getpid()&&uid==getuid()&&pthread_equal(thread,pthread_self());}
};
struct Use {
 bool&busy;explicit Use(bool&b):busy(b){busy=true;}~Use(){busy=false;}
};
class CommittedSocial;
class PairView final:public SocialView {
 ActorOwner actor_;
 std::shared_ptr<CommittedSocial> parent_;
 std::array<unsigned char,YNX_SOCIAL_MAIN_PAIR_STORAGE_V1> storage_{};
 ynx_social_main_pair_view_v1 raw_{};
 SocialData data_;
 Result first_;
 bool release_selected_=false,released_=false,absence_known_=true;
 void remember(Result r)noexcept{if(!r.ok()&&first_.ok())first_=r;}
 bool span(ynx_social_joint_bytes_v1 s,std::size_t maximum)const noexcept {
  if(s.size>maximum)return false;
  if(!s.size)return true;
  auto begin=reinterpret_cast<std::uintptr_t>(storage_.data());
  auto ptr=reinterpret_cast<std::uintptr_t>(s.data);
  return ptr>=begin&&ptr-begin<=storage_.size()&&s.size<=storage_.size()-(ptr-begin);
 }
 bool dataValid()const noexcept {
  if(raw_.version!=1||raw_.size!=sizeof(raw_)||!raw_.view)return false;
  for(auto s:raw_.application)if(!span(s,128))return false;
  return span(raw_.classic_public,33)&&raw_.classic_public.size==33&&
   span(raw_.pq_public,2592)&&raw_.pq_public.size==2592&&
   span(raw_.account_issuer,2048)&&span(raw_.account_subject,2048)&&
   raw_.not_before_ms>=0&&raw_.expires_ms>raw_.not_before_ms&&raw_.expires_ms<=9007199254740991LL;
 }
public:
 explicit PairView(std::shared_ptr<CommittedSocial>p):parent_(std::move(p)){}
 void open(Result&)noexcept;
 void copyAccount(AccountNamespace&out,Result&r)noexcept {
  if(!actor_.same()){if(r.ok())r=failure(Actor);return;}
  if(released_||release_selected_){if(r.ok())r=failure(Pending,true);return;}
  if(!dataValid()||!raw_.account_issuer.size||!raw_.account_subject.size){
   if(r.ok())r=failure(Malformed,true);return;
  }
  try {
   AccountNamespace copy;
   copy.issuer.assign(reinterpret_cast<const char*>(raw_.account_issuer.data),raw_.account_issuer.size);
   copy.subject.assign(reinterpret_cast<const char*>(raw_.account_subject.data),raw_.account_subject.size);
   out=std::move(copy);
  }catch(...){if(r.ok())r=failure(Internal,true);}
 }
 const SocialData&data()const noexcept override{return data_;}
 Result release()noexcept override;
};
class CommittedSocial final:public SocialHolder,public std::enable_shared_from_this<CommittedSocial> {
 friend class PairView;
 ActorOwner actor_;
 std::uint64_t owner_=0;
 std::size_t children_=0;
 std::vector<std::shared_ptr<SocialView>> pending_;
 Result first_;
 bool busy_=false,close_selected_=false,closed_=false,absence_known_=true;
 void remember(Result r)noexcept{r.physical_done=false;if(!r.ok()&&first_.ok())first_=r;}
 Result ready()const noexcept {
  if(!actor_.same())return failure(Actor);
  if(busy_||close_selected_)return failure(Pending,true);
  if(!first_.ok())return first_;
  if(!owner_)return failure(Missing);
  return {};
 }
public:
 CommittedSocial(){pending_.reserve(64);}
 void open(std::uint64_t loan,const Resource&resource,Result&r)noexcept {
  Use use(busy_);ynx_social_joint_status_v1 status{};
  // The C ABI accepts a mutable buffer; provide an exact private clone.
  Resource locator=resource;
  absence_known_=false;
  ynx_social_main_committed_pair_open_v1(loan,locator.data(),locator.size(),&owner_,&status);
  absence_known_=!owner_&&valid(status);
  r=read(status);if(r.ok()&&!owner_)r=failure(Missing,true);remember(r);
 }
 void observe(Result r)noexcept{remember(r);}
 void copyAccount(AccountNamespace&out,Result&r)noexcept {
  std::shared_ptr<SocialView> child;view(child,r);
  if(!child)return;
  auto*actual=dynamic_cast<PairView*>(child.get());
  if(actual)actual->copyAccount(out,r);else if(r.ok())r=failure(Malformed,true);
  if(r.ok())r=current();
  auto released=child->release();
  // A temporary namespace read must not drop an uncertain physical child.
  // Capacity was reserved before any acquisition; at most64 children exist.
  if(!released.physical_done)pending_.push_back(std::move(child));
  if(r.ok())r=released;
  if(!released.physical_done)r.unknown=true;
  r.physical_done=false;remember(r);
 }
 Result current()noexcept override {
  auto r=ready();if(!r.ok())return r;
  Use use(busy_);ynx_social_joint_status_v1 status{};
  ynx_social_main_committed_pair_current_v1(owner_,&status);r=read(status);remember(r);return r;
 }
 void view(std::shared_ptr<SocialView>&out,Result&r)noexcept override {
  out.reset();r=ready();if(!r.ok())return;
  if(children_>=64){r=failure(Pending);return;}
  try {
   auto child=std::make_shared<PairView>(shared_from_this());
   ++children_;out=child; // child debt exists before the service is entered
   Use use(busy_);child->open(r);remember(r);
  }catch(...){r=failure(Internal,true);remember(r);}
 }
 Result close()noexcept override {
  if(!actor_.same())return failure(Actor);
  if(closed_){auto r=first_;r.physical_done=true;return r;}
  if(busy_||children_)return failure(Pending,true);
  if(close_selected_){auto r=first_;if(r.ok())r=failure(Pending,true);r.unknown=true;return r;}
  close_selected_=true;Use use(busy_);
  if(!owner_)closed_=absence_known_;
  else {
   ynx_social_joint_status_v1 status{};
   ynx_social_main_committed_pair_close_v1(&owner_,&status);
   auto r=read(status,true);remember(r);closed_=!owner_&&r.physical_done;
  }
  auto r=first_;r.physical_done=closed_;
  if(!closed_){if(r.ok())r=failure(Missing,true);r.unknown=true;}
  return r;
 }
};
void PairView::open(Result&r)noexcept {
 ynx_social_joint_status_v1 status{};
 absence_known_=false;
 ynx_social_main_committed_pair_view_open_v1(parent_->owner_,storage_.data(),storage_.size(),&raw_,&status);
 absence_known_=!raw_.view&&valid(status);
 // raw_.view is retained even when the DATA/header/status is malformed.
 r=read(status);
 if(dataValid()) {
  try {
   for(std::size_t i=0;i<6;++i)if(raw_.application[i].size)
    data_.application[i].assign(reinterpret_cast<const char*>(raw_.application[i].data),raw_.application[i].size);
   data_.classic_public.assign(raw_.classic_public.data,raw_.classic_public.data+raw_.classic_public.size);
   data_.pq_public.assign(raw_.pq_public.data,raw_.pq_public.data+raw_.pq_public.size);
   data_.window={raw_.not_before_ms,raw_.expires_ms};
  }catch(...){if(r.ok())r=failure(Internal,true);}
 }else if(r.ok())r=failure(Malformed,true);
 remember(r);
}
Result PairView::release()noexcept {
 if(!actor_.same())return failure(Actor);
 if(released_){auto r=first_;r.physical_done=true;return r;}
 if(!parent_||!parent_->actor_.same())return failure(Actor);
 if(parent_->busy_)return failure(Pending,true);
 if(release_selected_){auto r=first_;if(r.ok())r=failure(Pending,true);r.unknown=true;return r;}
 release_selected_=true;auto parent=parent_;Use use(parent->busy_);
 bool done=!raw_.view&&absence_known_;
 if(raw_.view){ynx_social_joint_status_v1 status{};
  ynx_social_main_committed_pair_view_release_v1(parent->owner_,&raw_.view,&status);
  auto r=read(status);remember(r);
  // This ABI's release receipt is its cleared view field. physical_done is
  // reserved for holder-close; a valid late first0 does not hide that receipt.
  done=!raw_.view&&valid(status);
 }
 if(done){if(!parent->children_){auto r=failure(Internal,true);remember(r);done=false;}
  else {--parent->children_;released_=true;parent_.reset();}}
 auto r=first_;r.physical_done=done;
 if(!done){if(r.ok())r=failure(Pending,true);r.unknown=true;}
 parent->remember(r);return r;
}
}
void acquireCommittedSocialPair(Source&source,const Resource&resource,
 std::shared_ptr<SocialHolder>&out,Result&r)noexcept {
 out.reset();r={};
 try {
  std::uint64_t loan=0;r=borrowCapturedSourceLoan(source,loan);if(!r.ok())return;
  if(!loan){r=failure(Missing);return;}
  auto held=std::make_shared<CommittedSocial>();out=held;held->open(loan,resource,r);
  if(r.ok())r=source.current();held->observe(r);
 }catch(...){r=failure(Internal,true);}
}
void copyOriginalCommittedPairAccountNamespace(SocialHolder&holder,
 AccountNamespace&out,Result&r)noexcept {
 out.issuer.clear();out.subject.clear();
 auto*actual=dynamic_cast<CommittedSocial*>(&holder);
 if(!actual){r=failure(Invalid);return;}
 actual->copyAccount(out,r);
}
} // namespace ynx::social::joint::original
