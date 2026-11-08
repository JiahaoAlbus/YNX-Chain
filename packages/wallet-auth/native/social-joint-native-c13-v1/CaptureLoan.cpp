#include "CaptureLoan.hpp"
#include "social_joint_profile_issuer_private.h"
#include <cstring>

namespace ynx::social::joint::original {
namespace {
Result read(const ynx_social_joint_status_v1&s,bool closing=false) noexcept {
 if(s.version!=1||s.size!=sizeof(s)||s.error_present>1||s.unknown>1||
   s.physical_done>1||(!closing&&s.physical_done)||(!s.error_present&&s.original_first))
  return {true,-41011,true,false};
 return {s.error_present!=0,s.original_first,s.unknown!=0,s.physical_done!=0};
}
}
void CaptureLoan::remember(Result r) noexcept {if(!r.ok()&&first_.ok())first_=r;}
void CaptureLoan::acquire(const SourceInput&in,Result&result) noexcept {
 if(loan_||retire_selected_||close_selected_||!in.same_process_capture_reference){result={true,-41001,false,false};remember(result);return;}
 ynx_social_joint_source_input_v1 input{};input.version=2;input.size=sizeof(input);
 std::memcpy(input.registered_source_resource,in.resource.data(),in.resource.size());
 ynx_social_joint_bytes_v1*spans[]={&input.registration,&input.issuer_credential,&input.anchor_credential,&input.history_envelope};
 for(std::size_t i=0;i<4;++i)*spans[i]={in.originals[i].data(),in.originals[i].size()};
 input.same_process_capture_reference=in.same_process_capture_reference;
 ynx_social_joint_status_v1 status{};
 ynx_auth_social_joint_capture_borrow_acquire_v1(in.same_process_capture_reference,&input,&loan_,&status);
 // The actual nonzero partial loan is already adopted even if status fails.
 result=read(status);if(result.ok()&&!loan_)result={true,-41004,true,false};remember(result);
}
Result CaptureLoan::current() noexcept {
 if(!first_.ok())return first_;
 if(!loan_||retire_selected_||close_selected_)return {true,-41005,false,false};
 ynx_social_joint_status_v1 status{};ynx_auth_social_joint_capture_borrow_current_v1(loan_,&status);
 Result result=read(status);remember(result);return result;
}
Result CaptureLoan::close() noexcept {
 if(closed_){auto result=first_;result.physical_done=true;return result;}
 if(close_selected_){auto result=first_;if(result.ok())result={true,-41010,true,false};result.unknown=true;return result;}
 if(!loan_){closed_=true;auto result=first_;result.physical_done=true;return result;}
 if(!retire_selected_){retire_selected_=true;ynx_social_joint_status_v1 status{};
  ynx_auth_social_joint_capture_borrow_retire_v1(loan_,&status);auto retired=read(status);
  remember(retired);retired_=retired.ok();}
 if(!retired_){auto result=first_;result.unknown=true;return result;}
 if(!join_selected_){join_selected_=true;ynx_social_joint_status_v1 status{};
  ynx_auth_social_joint_capture_borrow_join_v1(loan_,&status);auto joined=read(status);
  remember(joined);joined_=joined.ok();}
 if(!joined_){auto result=first_;if(result.ok())result={true,-41010,true,false};result.unknown=true;return result;}
 close_selected_=true;ynx_social_joint_status_v1 status{};
 ynx_auth_social_joint_capture_borrow_close_v1(&loan_,&status);
 auto closed=read(status,true);remember(closed);
 const bool done=loan_==0&&closed.physical_done;
 closed_=done;
 auto result=first_;result.physical_done=done;
 if(!done){result.unknown=true;if(result.ok())result.error_present=true;}
 return result;
}
}
