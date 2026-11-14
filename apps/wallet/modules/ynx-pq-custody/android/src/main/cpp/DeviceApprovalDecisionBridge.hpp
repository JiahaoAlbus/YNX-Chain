#pragma once
#include <jni.h>
#include <thread>

namespace ynx::wallet::device_approval {
// Borrowed JNI references for one synchronous operation on the same original
// actor. This bridge does not create an approval or an account binding.
class DecisionBridge final {
public:
    DecisionBridge(JNIEnv* env, jobject review, jstring operation, jbyteArray binding)
        : env_(env), review_(review), operation_(operation), binding_(binding),
          actor_(std::this_thread::get_id()) {
        if (!env_ || !review_ || !operation_ || !binding_ || env_->ExceptionCheck()) return;
        type_ = env_->GetObjectClass(review_);
        if (!type_ || env_->ExceptionCheck()) return;
        acknowledge_ = env_->GetMethodID(type_, "acknowledgeInsertedClaim", "()V");
        if (!acknowledge_ || env_->ExceptionCheck()) return;
        current_ = env_->GetMethodID(type_, "originalClaimCurrent", "(Ljava/lang/String;[B)Z");
    }
    ~DecisionBridge() { if (type_) env_->DeleteLocalRef(type_); }
    DecisionBridge(const DecisionBridge&) = delete;
    DecisionBridge& operator=(const DecisionBridge&) = delete;

    bool acknowledgeInsertedClaim() {
        if (!ready() || selected_) return false;
        selected_ = true;
        env_->CallVoidMethod(review_, acknowledge_);
        acknowledged_ = !failed();
        return acknowledged_;
    }
    bool current() {
        if (!ready() || !acknowledged_) return false;
        auto result = env_->CallBooleanMethod(review_, current_, operation_, binding_);
        return !failed() && result == JNI_TRUE;
    }
private:
    bool ready() const {
        return env_ && actor_ == std::this_thread::get_id() && acknowledge_ && current_
            && !env_->ExceptionCheck();
    }
    bool failed() {
        if (!env_->ExceptionCheck()) return false;
        env_->ExceptionClear();
        return true;
    }
    JNIEnv* const env_;
    jobject const review_;
    jstring const operation_;
    jbyteArray const binding_;
    const std::thread::id actor_;
    jclass type_ = nullptr;
    jmethodID acknowledge_ = nullptr, current_ = nullptr;
    bool selected_ = false, acknowledged_ = false;
};
}
