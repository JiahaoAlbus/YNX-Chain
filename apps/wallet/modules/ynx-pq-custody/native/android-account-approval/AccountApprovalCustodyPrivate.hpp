#pragma once

#include <AndroidV4AccountApprovalPlanPrivate.h>
#include "../../android/src/main/cpp/auth-ordinary/NativeBackupFormat.h"
#include <cstdint>
#include <optional>
#include <thread>
#include <vector>

namespace ynx::mobilepq::android_account_approval {

// Private to the signer translation unit. The original Wallet review owns
// its loan and durable once claim. This class never returns raw bytes outside
// the fixed native signer implementation or retains a caller-selected key.
class AccountApprovalCustody final {
public:
 using Holder=ynx_original_wallet_v4_account_approval_v1;
 using Failure=ynx_auth_android_provision_failure_v1;
 using Drain=ynx_auth_android_provision_drain_v1;
 using Plan=ynx_wallet_v4_account_approval_plan_data_v1;
 using OpenedBackup=ynx::auth::android_ordinary::OpenedBackup;

 explicit AccountApprovalCustody(Holder*) noexcept;
 AccountApprovalCustody(const AccountApprovalCustody&)=delete;
 AccountApprovalCustody& operator=(const AccountApprovalCustody&)=delete;
 ~AccountApprovalCustody();

 Failure open() noexcept;
 Failure current() noexcept;
 const Plan& originalPlan() const noexcept {return plan_;}
 const OpenedBackup* opened() const noexcept {return backup_?&*backup_:nullptr;}
 bool hadLoan() const noexcept {return loanAcquired_;}
 Drain close() noexcept;

private:
 const std::thread::id actor_;
 Holder* const holder_;
 ynx_original_wallet_v4_account_key_loan_v1* loan_=nullptr;
 Plan plan_{};
 std::vector<uint8_t> originalBytes_;
 std::optional<OpenedBackup> backup_;
 Failure first_{};
 Drain closedResult_{};
 bool selected_=false;
 bool loanAcquired_=false;
 bool closeSelected_=false;
};

}
