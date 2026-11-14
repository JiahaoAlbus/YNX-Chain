#include "DeviceApprovalJournalBridge.hpp"

namespace ynx::wallet::device_approval {
namespace {
bool takeJavaFailure(JNIEnv* env) {
    if (!env->ExceptionCheck()) return false;
    env->ExceptionClear();
    return true;
}
}

JournalBridge::JournalBridge(JNIEnv* env, jobject journal, jstring operation, jbyteArray binding)
    : env_(env), journal_(journal), operation_(operation), binding_(binding) {
    if (env_->ExceptionCheck() || !journal_ || !operation_ || !binding_) return;
    type_ = env_->GetObjectClass(journal_);
    if (!type_ || env_->ExceptionCheck()) return;
    enter_ = env_->GetMethodID(type_, "enter", "(Ljava/lang/String;[B)Z");
    if (!enter_ || env_->ExceptionCheck()) return;
    claim_ = env_->GetMethodID(type_, "claimKeyAttempt", "(Ljava/lang/String;[B)Z");
    if (!claim_ || env_->ExceptionCheck()) return;
    receipt_ = env_->GetMethodID(type_, "recordReceipt", "(Ljava/lang/String;[B[B)V");
    if (!receipt_ || env_->ExceptionCheck()) return;
    retain_ = env_->GetMethodID(type_, "retain", "(Ljava/lang/String;[B[B[B)V");
    if (!retain_ || env_->ExceptionCheck()) return;
    read_ = env_->GetMethodID(type_, "readCommitted", "(Ljava/lang/String;[B)[[B");
    if (!read_ || env_->ExceptionCheck()) return;
    snapshot_ = env_->GetMethodID(type_, "readSnapshot", "(Ljava/lang/String;[B)[[B");
    if (!snapshot_ || env_->ExceptionCheck()) return;
    commit_ = env_->GetMethodID(type_, "commitVerified", "(Ljava/lang/String;[B[B[B[B[B)V");
}

JournalBridge::~JournalBridge() {
    if (type_) env_->DeleteLocalRef(type_);
}

JournalBridge::Entry JournalBridge::enter() {
    if (!read_ || env_->ExceptionCheck()) return Entry::Unknown;
    const auto inserted = env_->CallBooleanMethod(journal_, enter_, operation_, binding_);
    if (takeJavaFailure(env_)) return Entry::Unknown;
    return inserted == JNI_TRUE ? Entry::Inserted : Entry::Existing;
}

JournalBridge::Entry JournalBridge::claimKeyAttempt() {
    if (!read_ || env_->ExceptionCheck()) return Entry::Unknown;
    const auto claimed = env_->CallBooleanMethod(journal_, claim_, operation_, binding_);
    if (takeJavaFailure(env_)) return Entry::Unknown;
    return claimed == JNI_TRUE ? Entry::Inserted : Entry::Existing;
}

bool JournalBridge::recordReceipt(jbyteArray receipt) {
    if (!read_ || !receipt || env_->ExceptionCheck()) return false;
    env_->CallVoidMethod(journal_, receipt_, operation_, binding_, receipt);
    return !takeJavaFailure(env_);
}

bool JournalBridge::retain(jbyteArray member, jbyteArray firstFailure) {
    if (!read_ || !member || !firstFailure || env_->ExceptionCheck()) return false;
    env_->CallVoidMethod(journal_, retain_, operation_, binding_, member, firstFailure);
    return !takeJavaFailure(env_);
}

bool JournalBridge::commitVerified(jbyteArray member, jbyteArray approvalOriginal,
        jbyteArray policyOriginal, jbyteArray requestOriginal) {
    if (!commit_ || !member || !approvalOriginal || !policyOriginal || !requestOriginal
            || env_->ExceptionCheck()) return false;
    env_->CallVoidMethod(journal_, commit_, operation_, binding_, member,
        approvalOriginal, policyOriginal, requestOriginal);
    return !takeJavaFailure(env_);
}

JournalBridge::Read JournalBridge::readCommitted(jobjectArray& originals) {
    originals = nullptr;
    if (!read_ || env_->ExceptionCheck()) return Read::Unavailable;
    auto result = static_cast<jobjectArray>(
        env_->CallObjectMethod(journal_, read_, operation_, binding_));
    if (takeJavaFailure(env_)) return Read::Unavailable;
    if (!result) return Read::Absent;
    const auto count = env_->GetArrayLength(result);
    const bool failed = takeJavaFailure(env_);
    if (!failed && count == 3) {
        originals = result;
        return Read::Committed;
    }
    env_->DeleteLocalRef(result);
    return !failed && count == 0 ? Read::Entered : Read::Unavailable;
}

JournalBridge::Read JournalBridge::readSnapshot(jobjectArray& snapshot) {
    snapshot = nullptr;
    if (!snapshot_ || env_->ExceptionCheck()) return Read::Unavailable;
    auto result = static_cast<jobjectArray>(
        env_->CallObjectMethod(journal_, snapshot_, operation_, binding_));
    if (takeJavaFailure(env_)) return Read::Unavailable;
    if (!result) return Read::Absent;
    const auto count = env_->GetArrayLength(result);
    const bool failed = takeJavaFailure(env_);
    if (failed || count != 7) {
        env_->DeleteLocalRef(result);
        return Read::Unavailable;
    }
    auto original = env_->GetObjectArrayElement(result, 3);
    if (takeJavaFailure(env_)) {
        env_->DeleteLocalRef(result);
        return Read::Unavailable;
    }
    const auto state = original ? Read::Committed : Read::Entered;
    if (original) env_->DeleteLocalRef(original);
    snapshot = result;
    return state;
}

}
