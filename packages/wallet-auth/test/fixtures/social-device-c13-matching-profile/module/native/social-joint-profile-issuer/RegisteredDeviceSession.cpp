#include "OriginalServices.hpp"
#include "DeviceNamespace.hpp"
#include <pthread.h>
#include <unistd.h>

namespace ynx::social::joint::original {
namespace {
constexpr std::int32_t Invalid=-41601,Malformed=-41602,Pending=-41603,
 Actor=-41604,Missing=-41605,Internal=-41606;
using Failure=ynx_auth_device_v4_failure_v1;
using Drain=ynx_auth_device_v4_drain_v1;
Result fail(std::int32_t code,bool unknown=false)noexcept{return {true,code,unknown,false};}
bool valid(Failure f)noexcept{return f.present<=1&&(f.present||(!f.code&&!f.origin&&!f.platform_code));}
Result read(Failure f)noexcept {
 if(!valid(f))return fail(Malformed,true);
 return {f.present!=0,f.code,false,false};
}
Result read(Drain d)noexcept {
 if(d.unknown>1||d.physical_done>1)return fail(Malformed,true);
 auto r=read(d.failure);r.unknown=r.unknown||d.unknown!=0;
 // A malformed failure never qualifies a physical drain receipt.
 r.physical_done=valid(d.failure)&&d.physical_done!=0;return r;
}
struct ActorOwner {
 const pid_t pid=getpid();const uid_t uid=getuid();const pthread_t thread=pthread_self();
 bool same()const noexcept{return pid==getpid()&&uid==getuid()&&pthread_equal(thread,pthread_self());}
};
struct Use{bool&busy;explicit Use(bool&b):busy(b){busy=true;}~Use(){busy=false;}};
class RegisteredDevice;
class DeviceView final:public original::DeviceView {
 ActorOwner actor_;
 std::shared_ptr<RegisteredDevice>parent_;
 ynx_auth_device_v4_view_v1*view_=nullptr;
 DeviceData data_;
 std::array<Bytes,3>originals_;
 Result first_;
 Failure original_failure_{};
 bool absence_known_=true,release_selected_=false,released_=false;
 void remember(Result r)noexcept{r.physical_done=false;if(!r.ok()&&first_.ok())first_=r;}
 void observe(Failure f)noexcept{if(f.present&&!original_failure_.present)original_failure_=f;remember(read(f));}
 bool projectionValid(const ynx_auth_device_v4_view_data_v1&d)const noexcept {
  if(d.version!=1||d.size!=sizeof(d)||d.null_mask&~((1U<<8)|(1U<<9))||
     d.not_before_ms<0||d.expires_ms<=d.not_before_ms||d.expires_ms>9007199254740991LL)return false;
  for(std::size_t i=0;i<17;++i){const auto&s=d.expected[i];
   if(s.length>2048||((d.null_mask&(1U<<i))?s.length!=0:(!s.length||!s.bytes)))return false;}
  const ynx_auth_device_v4_bytes_v1 spans[]={d.context_original,d.registration_original,d.session_original};
  for(std::size_t i=0;i<3;++i)if(!spans[i].bytes||!spans[i].length||spans[i].length>(i?16384:OriginalMax))return false;
  return true;
 }
public:
 explicit DeviceView(std::shared_ptr<RegisteredDevice>p):parent_(std::move(p)){}
 void open(Result&)noexcept;
 const DeviceData&data()const noexcept override{return data_;}
 Result release()noexcept override;
};
class RegisteredDevice final:public DeviceHolder,public std::enable_shared_from_this<RegisteredDevice> {
 friend class DeviceView;
 ActorOwner actor_;
 // Native binding retains both parents until this holder physically closes.
 Source*const source_;
 SocialHolder*const social_;
 const AccountNamespace account_;
 ynx_auth_device_v4_source_v1*owner_=nullptr;
 std::vector<std::shared_ptr<original::DeviceView>>pending_;
 std::size_t children_=0;
 Result first_;
 Failure original_failure_{};
 bool busy_=false,matched_=false,absence_known_=true,retired_=false;
 bool close_selected_=false,backend_closed_=false,release_selected_=false,closed_=false;
 void remember(Result r)noexcept{r.physical_done=false;if(!r.ok()&&first_.ok())first_=r;}
 void observe(Failure f)noexcept{if(f.present&&!original_failure_.present)original_failure_=f;remember(read(f));}
 Result parents()noexcept {
  auto r=source_->current();if(r.ok())r=social_->current();return r;
 }
 Result ready(bool initial=false)const noexcept {
  if(!actor_.same())return fail(Actor);
  if(busy_||retired_||close_selected_)return fail(Pending,true);
  if(!first_.ok())return first_;
  if(!owner_||(!initial&&!matched_))return fail(Missing);
  return {};
 }
 void openView(std::shared_ptr<original::DeviceView>&out,Result&r,bool initial)noexcept {
  out.reset();r=ready(initial);if(!r.ok())return;
  if(children_>=64){r=fail(Pending);return;}
  try{auto child=std::make_shared<DeviceView>(shared_from_this());++children_;out=child;
   Use use(busy_);child->open(r);remember(r);
  }catch(...){r=fail(Internal,true);remember(r);}
 }
public:
 RegisteredDevice(Source&s,SocialHolder&m,AccountNamespace account):source_(&s),social_(&m),account_(std::move(account)){pending_.reserve(64);}
 void initialize(Result&r)noexcept {
  {Use use(busy_);absence_known_=false;const auto acquired=ynx_auth_device_v4_source_acquire_original_v1();
   owner_=acquired.owner;absence_known_=!owner_&&valid(acquired.failure);observe(acquired.failure);r=read(acquired.failure);
   if(r.ok()&&!owner_)r=fail(Missing,true);remember(r);}
  if(!r.ok())return;
  std::shared_ptr<original::DeviceView>child;openView(child,r,true);
  if(child){auto released=child->release();if(!released.physical_done)pending_.push_back(std::move(child));
   if(r.ok())r=released;if(!released.physical_done)r.unknown=true;r.physical_done=false;}
  if(r.ok())r=parents();if(r.ok())matched_=true;remember(r);
 }
 Result current()noexcept override {
  auto r=ready();if(!r.ok())return r;Use use(busy_);r=parents();
  if(r.ok()){auto f=ynx_auth_device_v4_source_current_v1(owner_);observe(f);r=read(f);}
  if(r.ok())r=parents();remember(r);return r;
 }
 void view(std::shared_ptr<original::DeviceView>&out,Result&r)noexcept override{openView(out,r,false);}
 Result close()noexcept override {
  if(!actor_.same())return fail(Actor);
  if(closed_){auto r=first_;r.physical_done=true;return r;}
  if(busy_||children_)return fail(Pending,true);
  Use use(busy_);
  if(!owner_){closed_=absence_known_;auto r=first_;r.physical_done=closed_;if(!closed_)r.unknown=true;return r;}
  if(!retired_){retired_=true;ynx_auth_device_v4_source_request_retire_v1(owner_);}
  if(!close_selected_){
   const auto joined=ynx_auth_device_v4_source_join_v1(owner_);observe(joined.failure);auto r=read(joined);remember(r);
   if(!r.physical_done){auto result=first_;if(result.ok())result=fail(Pending,true);result.unknown=true;
    result.original_drain_pending=true;return result;}
   close_selected_=true;
   const auto closed=ynx_auth_device_v4_source_close_v1(owner_);observe(closed.failure);r=read(closed);remember(r);
   backend_closed_=r.physical_done;
  }
  if(!backend_closed_){auto r=first_;if(r.ok())r=fail(Pending,true);r.unknown=true;return r;}
  if(!release_selected_){release_selected_=true;
   const auto released=ynx_auth_device_v4_source_release_closed_v1(owner_);observe(released.failure);auto r=read(released);remember(r);
   closed_=r.physical_done;if(closed_)owner_=nullptr;
  }
  auto r=first_;r.physical_done=closed_;if(!closed_){if(r.ok())r=fail(Pending,true);r.unknown=true;}return r;
 }
};
void DeviceView::open(Result&r)noexcept {
 r=parent_->parents();if(!r.ok()){remember(r);return;}
 absence_known_=false;const auto acquired=ynx_auth_device_v4_source_open_view_v1(parent_->owner_);
 view_=acquired.owner;absence_known_=!view_&&valid(acquired.failure);observe(acquired.failure);r=read(acquired.failure);
 if(r.ok()&&!view_)r=fail(Missing,true);
 if(view_){
  ynx_auth_device_v4_view_data_v1 data{};data.version=1;data.size=sizeof(data);
  const auto f=ynx_auth_device_v4_view_read_original_v1(view_,&data);observe(f);if(r.ok())r=read(f);
  if(projectionValid(data))try{
   data_.null_mask=data.null_mask;
   for(std::size_t i=0;i<17;++i)if(data.expected[i].length)data_.expected[i].assign(
    reinterpret_cast<const char*>(data.expected[i].bytes),data.expected[i].length);
   data_.window={data.not_before_ms,data.expires_ms};
   const ynx_auth_device_v4_bytes_v1 spans[]={data.context_original,data.registration_original,data.session_original};
   for(std::size_t i=0;i<3;++i)originals_[i].assign(spans[i].bytes,spans[i].bytes+spans[i].length);
  }catch(...){if(r.ok())r=fail(Internal,true);}
  else if(r.ok())r=fail(Malformed,true);
  if(r.ok()&&data_.expected[2]!=parent_->account_.subject)r=fail(Invalid);
  if(r.ok()){
   Failure namespace_failure{};
   r=matchQualifiedDeviceNamespace(view_,parent_->account_,namespace_failure);
   observe(namespace_failure);
  }
  if(r.ok()){const auto current=ynx_auth_device_v4_view_current_v1(view_);observe(current);r=read(current);}
 }
 if(r.ok())r=parent_->parents();remember(r);
}
Result DeviceView::release()noexcept {
 if(!actor_.same())return fail(Actor);
 if(released_){auto r=first_;r.physical_done=true;return r;}
 if(!parent_||parent_->busy_)return fail(Pending,true);
 if(release_selected_){auto r=first_;if(r.ok())r=fail(Pending,true);r.unknown=true;return r;}
 release_selected_=true;auto parent=parent_;Use use(parent->busy_);bool done=!view_&&absence_known_;
 if(view_){const auto drained=ynx_auth_device_v4_view_release_v1(view_);observe(drained.failure);auto r=read(drained);
  remember(r);done=r.physical_done;if(done)view_=nullptr;}
 if(done){if(!parent->children_){remember(fail(Internal,true));done=false;}
  else{--parent->children_;released_=true;parent_.reset();}}
 auto r=first_;r.physical_done=done;if(!done){if(r.ok())r=fail(Pending,true);r.unknown=true;}
 parent->remember(r);return r;
}
}
void acquireRegisteredDeviceSession(Source&source,SocialHolder&social,const Resource&,
 std::shared_ptr<DeviceHolder>&out,Result&r)noexcept {
 out.reset();r={};try{
  r=source.current();if(r.ok())r=social.current();if(!r.ok())return;
  AccountNamespace account;copyOriginalCommittedPairAccountNamespace(social,account,r);if(!r.ok())return;
  if(account.issuer.empty()||account.subject.empty()){r=fail(Invalid);return;}
  auto device=std::make_shared<RegisteredDevice>(source,social,std::move(account));out=device;device->initialize(r);
 }catch(...){r=fail(Internal,true);}
}
} // namespace ynx::social::joint::original
