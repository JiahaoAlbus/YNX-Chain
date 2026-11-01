#pragma once
#include <node_api.h>
#include "device_management_v4_root_private.hpp"
namespace ynx_auth_private {
struct ManagementApprovalFactory;
// Final Native inventory owner, created ONLY by the fixed Main six-function
// producer after recognizing SAME Native review/context and real Main peer.
class OriginalManagementApprovalLoan final{
 struct State;std::shared_ptr<State>state_;
 explicit OriginalManagementApprovalLoan(std::shared_ptr<State>);
 friend struct ManagementApprovalFactory;
public:
 ~OriginalManagementApprovalLoan();
 bool current(std::string&)noexcept;
 bool matches(const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&,NSData*unsigned21)const noexcept;
 void retire()noexcept;bool join(std::string&)noexcept;bool close(std::string&)noexcept;
 napi_value originalCause(napi_env)const;
 bool causePresent()const noexcept;
};
napi_value CaptureOriginalDeviceV4ManagementApproval(napi_env,const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&,napi_value sameReview,napi_value sameContext,napi_value*actualPartialLoan=nullptr);
std::shared_ptr<OriginalManagementApprovalLoan>BorrowOriginalDeviceV4ManagementApproval(napi_env,napi_value actualNativeLoan);
napi_value DrainOriginalDeviceV4ManagementApproval(napi_env,napi_value actualNativeLoan,bool close);
}
