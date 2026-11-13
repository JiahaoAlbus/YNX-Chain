#pragma once

#include <jni.h>

namespace ynx::wallet::device_approval {

// Borrow on the original Wallet actor for one synchronous native operation.
// The verified holder supplies the local journal, canonical operation and
// binding. This bridge is never exposed to JSI or a Java native method.
class JournalBridge final {
public:
    JournalBridge(JNIEnv* env, jobject journal, jstring operation, jbyteArray binding);
    ~JournalBridge();
    JournalBridge(const JournalBridge&) = delete;
    JournalBridge& operator=(const JournalBridge&) = delete;

    enum class Entry { Unknown, Existing, Inserted };
    Entry enter();
    Entry claimKeyAttempt();
    bool recordReceipt(jbyteArray receipt);
    bool retain(jbyteArray member, jbyteArray firstFailure);
    enum class Read { Unavailable, Absent, Found };
    // On Found the caller owns the local reference. An unavailable read cannot
    // be used as an absent row, including after a process restart.
    Read readAttempt(jobjectArray& attempt);

private:
    JNIEnv* env_;
    jobject journal_;
    jstring operation_;
    jbyteArray binding_;
    jclass type_ = nullptr;
    jmethodID enter_ = nullptr;
    jmethodID claim_ = nullptr;
    jmethodID receipt_ = nullptr;
    jmethodID retain_ = nullptr;
    jmethodID read_ = nullptr;
};

}
