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
    receipt_ = env_->GetMethodID(type_, "recordReceipt", "(Ljava/lang/String;[B[B)V");
    if (!receipt_ || env_->ExceptionCheck()) return;
    retain_ = env_->GetMethodID(type_, "retain", "(Ljava/lang/String;[B[B[B)V");
    if (!retain_ || env_->ExceptionCheck()) return;
    read_ = env_->GetMethodID(type_, "readAttempt", "(Ljava/lang/String;[B)[[B");
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

JournalBridge::Read JournalBridge::readAttempt(jobjectArray& attempt) {
    attempt = nullptr;
    if (!read_ || env_->ExceptionCheck()) return Read::Unavailable;
    auto result = static_cast<jobjectArray>(
        env_->CallObjectMethod(journal_, read_, operation_, binding_));
    if (takeJavaFailure(env_)) return Read::Unavailable;
    if (!result) return Read::Absent;
    attempt = result;
    return Read::Found;
}

}
