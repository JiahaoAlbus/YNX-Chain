#pragma once
#include <AndroidDeviceRegistrationPrivate.h>
#include <atomic>
#include <memory>
#include <sys/types.h>
#include <thread>
#include <vector>
namespace ynx::mobilepq::android_pending {
using Failure=ynx_auth_android_provision_failure_v1;
using Source=ynx_auth_android_pending_source_v1;
using Review=ynx_auth_android_pending_review_data_v1;
// Private owning gate over an actual Auth token, not a Source constructor.
// Same Source mother must outlive every child. Captures no keys/OS/platform.
class PendingReviewOwner final {
 const pid_t pid_;const uid_t uid_;const gid_t gid_;const std::thread::id actor_;
 Source*const source_;
 std::atomic<bool>retired_{false};
 Failure first_{};bool captured_=false,borrowSelected_=false;
 std::vector<uint8_t>storage_,approvalStorage_;Review review_{};
 Failure capture()noexcept;
 Failure remember(Failure)noexcept;
 Failure localFence()const noexcept;
 explicit PendingReviewOwner(Source*);
public:
 static Failure acquire(Source*,std::shared_ptr<PendingReviewOwner>&)noexcept;
 PendingReviewOwner(const PendingReviewOwner&)=delete;
 bool sameActor()const noexcept;
 Failure current()noexcept;
 Failure requireIndependentApproval()noexcept;
 // Latch before calling the physical once callee, including failed/UNKNOWN.
 // This is not a final permission: the SAME Native pair owner must call its
 // own current() immediately before the actual private callee, so Native
 // retire cannot be replaced by the Root-only external Source current.
 Failure selectPrivateBorrowOnce()noexcept;
 void retire()noexcept{retired_.store(true,std::memory_order_release);}
 // SAME-actor internal DATA only. It is not a key, permission or new handle.
 const Review*originalReviewForNative()const noexcept;
 Source*originalSourceForNative()const noexcept{return source_;}
 Failure firstFailureForNative()const noexcept;
};
}
