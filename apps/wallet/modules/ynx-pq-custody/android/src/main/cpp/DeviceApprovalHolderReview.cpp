#include "DeviceApprovalHolderPrivate.hpp"

namespace {
using Holder = ynx_original_wallet_v4_account_approval_v1;
using Review = ynx::wallet::device_approval::OriginalReview;
using Failure = Review::Failure;
using Journal = ynx::wallet::device_approval::JournalBridge;
constexpr Failure unavailable{1, 74602, 0x57415052, 0};

bool failed(const Failure& value) {
    return value.present || value.code || value.origin || value.platform_code;
}

bool sameActor(const Holder* holder) {
    return holder && holder->actor == std::this_thread::get_id();
}

Failure current(Holder* holder) {
    if (!sameActor(holder) || (holder->claimSelected && !holder->decision.current())) return unavailable;
    return holder->review.current();
}
}

extern "C" void ynx_wallet_v4_account_approval_current_v1(Holder* holder, Failure* failure) {
    if (failure) *failure = current(holder);
}

extern "C" void ynx_wallet_v4_account_approval_copy_plan_v1(Holder* holder,
        uint8_t* buffer, size_t capacity, ynx_wallet_v4_account_approval_plan_data_v1* plan,
        Failure* failure) {
    if (!failure) return;
    *failure = unavailable;
    if (!sameActor(holder) || !holder->entered || holder->claimSelected
            || !buffer || !capacity || !plan) return;
    *plan = {};
    *failure = current(holder);
    if (failed(*failure)) return;
    *failure = holder->review.copyPlan(buffer, capacity, *plan);
    if (!failed(*failure)) *failure = current(holder);
    if (failed(*failure)) *plan = {};
}

extern "C" void ynx_wallet_v4_account_approval_claim_backup_once_v1(Holder* holder,
        Review::Loan** loan, Review::Bytes* encrypted, Review::Bytes* credential,
        Failure* failure) {
    if (!failure) return;
    *failure = unavailable;
    if (!loan || *loan || !encrypted || !credential || !sameActor(holder)
            || !holder->entered || holder->claimSelected) return;
    *encrypted = {};
    *credential = {};
    *failure = current(holder);
    if (failed(*failure)) return;
    holder->claimSelected = true;
    if (holder->journal.claimKeyAttempt() != Journal::Entry::Inserted) {
        *failure = unavailable;
        return;
    }
    // A persisted claim alone is not a claim ACK. A lost Java acknowledgement
    // retires this attempt; it must not be reselected or signed.
    if (!holder->decision.acknowledgeInsertedClaim()) return;
    *failure = current(holder);
    if (failed(*failure)) return;
    *failure = holder->review.claimBackup(holder->loan, *encrypted, *credential);
    // Publish the same partial loan even if acquisition or the last check failed.
    *loan = holder->loan;
    if (!failed(*failure)) *failure = *loan ? current(holder) : unavailable;
    if (failed(*failure)) {
        *encrypted = {};
        *credential = {};
    }
}

extern "C" void ynx_wallet_v4_account_approval_backup_current_v1(Holder* holder,
        Review::Loan* loan, Failure* failure) {
    if (!failure) return;
    *failure = unavailable;
    if (!sameActor(holder) || !loan || holder->loan != loan || holder->releaseSelected) return;
    *failure = current(holder);
    if (!failed(*failure)) *failure = holder->review.backupCurrent(loan);
    if (!failed(*failure)) *failure = current(holder);
}

extern "C" void ynx_wallet_v4_account_approval_release_backup_v1(Holder* holder,
        Review::Loan** loan, Review::Drain* drain) {
    if (!drain) return;
    *drain = {unavailable, 1, 0};
    if (!sameActor(holder) || !loan || !*loan || holder->loan != *loan
            || holder->releaseSelected) return;
    holder->releaseSelected = true;
    // Release is allowed after retirement. Never reacquire or retry a selected close.
    *drain = holder->review.releaseBackup(holder->loan);
    *loan = holder->loan;
}
