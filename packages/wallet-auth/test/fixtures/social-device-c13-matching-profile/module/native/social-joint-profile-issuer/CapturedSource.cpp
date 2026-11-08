#include "OriginalServices.hpp"
#include "CaptureLoan.hpp"
#include "social_joint_profile_issuer_private.h"
#include <algorithm>
#include <cstring>

namespace ynx::social::joint::original {
namespace {
Result decode(const ynx_social_joint_status_v1&s) noexcept {
 if(s.version!=1||s.size!=sizeof(s)||s.error_present>1||s.unknown>1||s.physical_done||
    (!s.error_present&&s.original_first))return {true,-41011,true,false};
 return {s.error_present!=0,s.original_first,s.unknown!=0,false};
}
Result invalid() noexcept {return {true,-41009,false,false};}
struct Inspection {
 std::shared_ptr<SocialView> social;
 std::shared_ptr<DeviceView> device;
 bool social_release=false,device_release=false;
 Result release() noexcept {
  Result first;
  if(device&&!device_release){device_release=true;auto r=device->release();
   if(!r.ok())first=r;if(r.physical_done)device.reset();}
  if(device){if(first.ok())first={true,-41010,true,false};return first;}
  if(social&&!social_release){social_release=true;auto r=social->release();
   if(first.ok()&&!r.ok())first=r;if(r.physical_done)social.reset();}
  if(social&&first.ok())first={true,-41010,true,false};return first;
 }
 bool hasDebt()const noexcept{return bool(social)||bool(device);}
};
class CapturedSource final:public Source {
 const SourceInput input_;
 CaptureLoan loan_;
 Result first_,live_failure_;
 Window window_;
 bool window_held_=false,inspecting_=false;
 std::vector<std::shared_ptr<Inspection>> pending_;
 void remember(Result r)noexcept{if(!r.ok()&&first_.ok())first_=r;}
 Result readWindow(Window&out) noexcept {
  ynx_social_joint_source_window_v1 w{};ynx_social_joint_status_v1 s{};
  ynx_auth_social_joint_capture_borrow_window_v1(loan_.sameProcessLoan(),&w,&s);
  // Written immutable DATA is adopted before its paired late error.
  const bool written=w.version==1&&w.size==sizeof(w);
  if(written)out={w.not_before_ms,w.expires_ms};
  Result r=decode(s);if(!written&&r.ok())r={true,-41011,true,false};
  if(r.ok()&&written&&(out.not_before_ms<0||out.expires_ms<=out.not_before_ms||
       out.expires_ms>9007199254740991LL))r=invalid();
  return r;
 }
 Result bindingView(Inspection&view,ynx_social_joint_binding_view_v1&out) noexcept {
  if(!view.social||!view.device)return {true,-41004,false,false};
  const auto&s=view.social->data();const auto&d=view.device->data();
  out={};out.version=1;out.size=sizeof(out);
  for(std::size_t i=0;i<6;++i){if(s.application[i].size()>128)return invalid();
   out.application[i]={reinterpret_cast<const unsigned char*>(s.application[i].data()),s.application[i].size()};}
  if(s.classic_public.size()!=33||s.pq_public.size()!=2592||d.null_mask&~((1U<<8)|(1U<<9)))return invalid();
  out.classic_public={s.classic_public.data(),s.classic_public.size()};
  out.pq_public={s.pq_public.data(),s.pq_public.size()};
  for(std::size_t i=0;i<17;++i){if(d.expected[i].size()>2048||
    ((d.null_mask&(1U<<i))&&!d.expected[i].empty()))return invalid();
   out.expected[i]={reinterpret_cast<const unsigned char*>(d.expected[i].data()),d.expected[i].size()};}
  out.expected_null_mask=d.null_mask;
  out.not_before_ms=std::max({s.window.not_before_ms,d.window.not_before_ms,window_.not_before_ms});
  out.expires_ms=std::min({s.window.expires_ms,d.window.expires_ms,window_.expires_ms});
  return out.not_before_ms>=0&&out.expires_ms>out.not_before_ms?Result{}:invalid();
 }
public:
 explicit CapturedSource(const SourceInput&input):input_(input){pending_.reserve(64);}
 void initialize(Result&r) noexcept {
  loan_.acquire(input_,r);if(!r.ok()){remember(r);live_failure_=r;return;}
  r=readWindow(window_);window_held_=window_.expires_ms>window_.not_before_ms;
  remember(r);if(!r.ok())live_failure_=r;if(r.ok())r=current();
 }
 Result current()noexcept override {
  if(!live_failure_.ok())return live_failure_;
  Result r=loan_.current();
  if(r.ok()){Window current;r=readWindow(current);
   if(r.ok()&&(!window_held_||current.not_before_ms!=window_.not_before_ms||current.expires_ms!=window_.expires_ms))r=invalid();}
  remember(r);if(!r.ok())live_failure_=r;return r;
 }
 Window window()const noexcept override{return window_;}
 Result matchCurrentOriginals(const SourceInput&input)noexcept override {
  if(input.same_process_capture_reference!=input_.same_process_capture_reference||
     input.resource!=input_.resource||input.originals!=input_.originals){auto r=invalid();remember(r);return r;}
  return current();
 }
 Result matchBinding(SocialHolder&s,DeviceHolder&d)noexcept override {
  // Qualification of each original holder is its registered constructor's
  // responsibility. Both are held by Native binding, never expected17 DTOs.
  Result r=current();if(r.ok())r=s.current();if(r.ok())r=d.current();
  if(r.ok())r=current();remember(r);return r;
 }
 Result inspectOriginalBodyDATA(SocialHolder&s,DeviceHolder&d,const Bytes&body)noexcept override {
  if(inspecting_||pending_.size()>=64){Result r{true,-41012,false,false};remember(r);return r;}
  if(body.empty()||body.size()>BodyMax){auto r=invalid();remember(r);return r;}
  Result r=matchBinding(s,d);if(!r.ok())return r;
  std::shared_ptr<Inspection> view;
  try{view=std::make_shared<Inspection>();}catch(...){return {true,-41003,false,false};}
  inspecting_=true;
  s.view(view->social,r); // genuine child adopted before paired status
  if(r.ok()&&!view->social)r={true,-41004,false,false};
  if(r.ok())r=matchBinding(s,d);
  if(r.ok())d.view(view->device,r);
  if(r.ok()&&!view->device)r={true,-41004,false,false};
  ynx_social_joint_binding_view_v1 data{};
  if(r.ok())r=bindingView(*view,data);
  if(r.ok()){ynx_social_joint_status_v1 status{};
   ynx_auth_social_joint_capture_borrow_compare_body_v1(loan_.sameProcessLoan(),&data,{body.data(),body.size()},&status);
   r=decode(status);}
  if(r.ok())r=matchBinding(s,d);
  // Cleanup even after a first numeric-zero failure. No second release on
  // an ambiguous physical result; the source keeps the actual child debt.
  Result released=view->release();if(r.ok())r=released;
  if(view->hasDebt())pending_.push_back(std::move(view));
  // Preserve this object's original observation/cleanup failure for close,
  // without treating a pure body DATA mismatch as revocation of the original
  // registered Source. Actual current failures separately fence live calls.
  remember(r);inspecting_=false;return r;
 }
 void role(SocialHolder&s,DeviceHolder&d,const Resource&binding_id,const Resource&id,std::uint32_t role,
  const Bytes&body,const Bytes&frame,std::shared_ptr<Role>&out,Result&r)noexcept override {
  r=inspectOriginalBodyDATA(s,d,body);if(!r.ok())return;
  acquireOriginalFiniteRole(*this,s,d,binding_id,id,role,body,frame,out,r);
 }
 void publicOriginals(SourceInput&out,Result&r) noexcept {
  r=current();if(!r.ok())return;
  try{SourceInput copy=input_;out=std::move(copy);r=current();}
  catch(...){r={true,-41003,false,false};}
 }
 Result borrowLoan(std::uint64_t&out) noexcept {
  out=0;auto r=current();if(!r.ok())return r;
  const auto loan=loan_.sameProcessLoan();
  if(!loan)return {true,-41004,false,false};
  r=current();if(r.ok())out=loan;return r;
 }
 Result close()noexcept override {
  if(inspecting_||!pending_.empty())return {true,-41010,true,false};
  auto r=loan_.close();remember(r);auto result=first_;result.physical_done=r.physical_done;
  if(!r.physical_done)result.unknown=true;return result;
 }
};
}
void acquireRegisteredSource(const SourceInput&input,std::shared_ptr<Source>&out,Result&result)noexcept {
 out.reset();
 try{auto source=std::make_shared<CapturedSource>(input);out=source;
  source->initialize(result); // out owns even a failed acquired Go loan
 }catch(const std::bad_alloc&){result={true,-41003,false,false};}
 catch(...){result={true,-41011,true,false};}
}
void copyOriginalCapturedSourceInputs(Source&source,SourceInput&out,Result&result) noexcept {
 auto*actual=dynamic_cast<CapturedSource*>(&source);
 if(!actual){result={true,-41001,false,false};return;}
 actual->publicOriginals(out,result);
}
Result borrowCapturedSourceLoan(Source&source,std::uint64_t&out) noexcept {
 out=0;auto*actual=dynamic_cast<CapturedSource*>(&source);
 if(!actual)return {true,-41001,false,false};
 return actual->borrowLoan(out);
}
}
