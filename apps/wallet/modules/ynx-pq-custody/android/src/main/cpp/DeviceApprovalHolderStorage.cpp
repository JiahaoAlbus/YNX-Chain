#include "DeviceApprovalHolderPrivate.hpp"
#include <AccountApprovalReceiptPrivate.h>

namespace {
using Holder = ynx_original_wallet_v4_account_approval_v1;
using Failure = ynx_auth_android_provision_failure_v1;
using Journal = ynx::wallet::device_approval::JournalBridge;
constexpr int32_t unavailable = 74601;
constexpr uint32_t origin = 0x57415052;

bool begin(Holder* holder, Failure* failure) {
    if (!failure) return false;
    *failure = {1, unavailable, origin, 0};
    return holder && holder->actor == std::this_thread::get_id();
}

// These bounded buffers contain only original public evidence. Clear a Java
// allocation/copy failure so independent evidence can still be retained.
jbyteArray copy(JNIEnv* env, const void* bytes, size_t size) {
    auto result = env->NewByteArray(static_cast<jsize>(size));
    if (result && size && !env->ExceptionCheck()) {
        env->SetByteArrayRegion(result, 0, static_cast<jsize>(size),
            static_cast<const jbyte*>(bytes));
    }
    if (!env->ExceptionCheck()) return result;
    env->ExceptionClear();
    if (result) env->DeleteLocalRef(result);
    return nullptr;
}
}

extern "C" void ynx_wallet_v4_account_approval_state_v1(
        Holder* holder, uint32_t* phase, Failure* failure) {
    if (phase) *phase = UINT32_MAX;
    if (!begin(holder, failure) || !phase) return;
    jobjectArray snapshot = nullptr;
    switch (holder->journal.readSnapshot(snapshot)) {
        case Journal::Read::Unavailable: return;
        case Journal::Read::Absent: *phase = YNX_WALLET_V4_APPROVAL_EMPTY; break;
        case Journal::Read::Entered: *phase = YNX_WALLET_V4_APPROVAL_ENTERED; break;
        case Journal::Read::Committed: *phase = YNX_WALLET_V4_APPROVAL_COMMITTED; break;
    }
    if (snapshot) holder->env->DeleteLocalRef(snapshot);
    *failure = {};
}

extern "C" void ynx_wallet_v4_account_approval_enter_v1(Holder* holder, Failure* failure) {
    if (!begin(holder, failure) || holder->entered) return;
    if (holder->journal.enter() != Journal::Entry::Inserted) return;
    holder->entered = true;
    *failure = {};
}

extern "C" void ynx_wallet_v4_account_approval_record_native_receipt_v1(
        Holder* holder, const ynx_wallet_v4_account_approval_native_receipt_v1* receipt,
        Failure* failure) {
    if (!begin(holder, failure) || !holder->entered || holder->receiptSelected
            || !receipt || receipt->version != 1 || receipt->size != sizeof(*receipt)) return;
    holder->receiptSelected = true;
    auto original = copy(holder->env, receipt, sizeof(*receipt));
    if (!original) return;
    const bool saved = holder->journal.recordReceipt(original);
    holder->env->DeleteLocalRef(original);
    if (saved) *failure = {};
}

extern "C" void ynx_wallet_v4_account_approval_retain_v1(Holder* holder,
        const uint8_t* member, size_t size, const Failure* first,
        uint32_t* retained, Failure* failure) {
    if (retained) *retained = 0;
    if (!begin(holder, failure) || !holder->entered || !retained || !first
            || size > YNX_WALLET_V4_APPROVAL_MEMBER_MAX || (size && !member)) return;
    auto original = copy(holder->env, member, size);
    if (!original) return;
    auto cause = copy(holder->env, first, sizeof(*first));
    const bool saved = cause && holder->journal.retain(original, cause);
    if (cause) holder->env->DeleteLocalRef(cause);
    holder->env->DeleteLocalRef(original);
    if (saved) {
        *retained = 1;
        *failure = {};
    }
}
