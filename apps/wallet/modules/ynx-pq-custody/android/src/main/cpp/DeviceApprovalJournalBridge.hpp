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
    // Original Wallet actor only, after the fixed SDK verifies and attaches
    // the Member. A false result requires cold readback of the same row.
    bool commitVerified(jbyteArray member, jbyteArray approvalOriginal,
        jbyteArray policyOriginal, jbyteArray requestOriginal);
    enum class Read { Unavailable, Absent, Entered, Committed };
    // On Committed the caller owns the local reference to all three originals.
    // An unavailable read cannot be used as an absent row after a restart.
    Read readCommitted(jobjectArray& originals);
    // Snapshot includes receipt, member, first failure, three originals and claim.
    // On Entered or Committed the caller owns the returned local reference.
    Read readSnapshot(jobjectArray& snapshot);

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
    jmethodID commit_ = nullptr;
    jmethodID read_ = nullptr;
    jmethodID snapshot_ = nullptr;
};

}
