#pragma once

#include "DeviceApprovalJournalBridge.hpp"
#include <AndroidV4AccountApprovalPlanPrivate.h>
#include <thread>

namespace ynx::wallet::device_approval {

// Borrowed from the original verified review actor. Implementations bind the
// SDK plan and account backup to the same authenticated review and policy.
class OriginalReview {
public:
    using Failure = ynx_auth_android_provision_failure_v1;
    using Bytes = ynx_auth_android_provision_bytes_v1;
    using Loan = ynx_original_wallet_v4_account_key_loan_v1;
    using Drain = ynx_auth_android_provision_drain_v1;
    virtual Failure current() noexcept = 0;
    virtual Failure copyPlan(uint8_t*, size_t, ynx_wallet_v4_account_approval_plan_data_v1&) noexcept = 0;
    virtual Failure claimBackup(Loan*&, Bytes&, Bytes&) noexcept = 0;
    virtual Failure backupCurrent(Loan*) noexcept = 0;
    virtual Drain releaseBackup(Loan*&) noexcept = 0;

protected:
    ~OriginalReview() = default;
};

}

// Only the Wallet's verified review actor may construct this holder, using
// the original protected journal and canonical binding. Local JNI references
// are borrowed for one synchronous coordinator call on that actor.
struct ynx_original_wallet_v4_account_approval_v1 final {
    ynx_original_wallet_v4_account_approval_v1(
        JNIEnv* env, jobject journal, jstring operation, jbyteArray binding,
        ynx::wallet::device_approval::OriginalReview& original)
        : env(env), journal(env, journal, operation, binding),
          actor(std::this_thread::get_id()), review(original) {}

    JNIEnv* const env;
    ynx::wallet::device_approval::JournalBridge journal;
    const std::thread::id actor;
    ynx::wallet::device_approval::OriginalReview& review;
    ynx_original_wallet_v4_account_key_loan_v1* loan = nullptr;
    bool claimSelected = false;
    bool releaseSelected = false;
    bool entered = false;
    bool receiptSelected = false;
};
