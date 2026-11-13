#pragma once

#include "DeviceApprovalJournalBridge.hpp"
#include <AndroidV4AccountApprovalPrivate.h>
#include <thread>

// Only the Wallet's verified review actor may construct this holder, using
// the original protected journal and canonical binding. Local JNI references
// are borrowed for one synchronous coordinator call on that actor.
struct ynx_original_wallet_v4_account_approval_v1 final {
    ynx_original_wallet_v4_account_approval_v1(
        JNIEnv* env, jobject journal, jstring operation, jbyteArray binding)
        : env(env), journal(env, journal, operation, binding),
          actor(std::this_thread::get_id()) {}

    JNIEnv* const env;
    ynx::wallet::device_approval::JournalBridge journal;
    const std::thread::id actor;
    bool entered = false;
    bool receiptSelected = false;
};
