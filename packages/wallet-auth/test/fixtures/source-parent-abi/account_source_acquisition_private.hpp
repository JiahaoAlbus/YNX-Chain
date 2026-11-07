#pragma once
// Normal Native source-bound account acquisition. No constructor from detached
// context, selector, descriptor, URL, engineReference registry or provider.
#include "account_proof_channel_private.hpp"
#include "MobileLedgerProofBackendPrivate.hpp"
#include <memory>
namespace ynx::network::freshscope {class FreshScopeBroker;class NativeCreatorOrigin;class ScopeTransferDebt;}

namespace ynx::native::accountproof { struct OriginalAccountPurposeChild; }
namespace ynx::network::accountproof {
using OriginalEngineSource = ynx::auth::mobile::receipt::OriginalEngineSource;
using OriginalAccountPurposeChild = ynx::native::accountproof::OriginalAccountPurposeChild;
using AuthFailure = ynx::core::mobile::registered::Failure;
enum class SourceLocalFailure {
  None, Allocation, WrongLaunch, NoChannel, WrongActor, Retired, ContextChanged,
  InvalidChild, ChildDrainPending, InvalidDrainToken, Busy, PhysicalPending,
  SourceReleasePending, NotClosed, ParentDrainPending, InvalidParent, NoSourceParent,
  FreshCopiesCloseUnknown
};
enum class SourceParentFailure { None, Endpoint, Identity, Frame, Deadline, Unknown, Closed };
struct SourceOutcome {
  AuthFailure sourceFailure{}; // preserve ORIGINAL presence AND code, even0
  current4launch::Failure launchFailure = current4launch::Failure::None;
  Failure channelFailure = Failure::None;
  SourceParentFailure parentFailure = SourceParentFailure::None;
  SourceLocalFailure local = SourceLocalFailure::None;
  bool failed() const noexcept {
    return sourceFailure.present || launchFailure != current4launch::Failure::None || channelFailure != Failure::None || parentFailure != SourceParentFailure::None ||
           local != SourceLocalFailure::None;
  }
};
struct OriginalAccountContext {
  ynx::auth::mobile::receipt::EngineSelection selection;
  current4launch::Readback originalProcesses;
  current4launch::IndependentImages independentlyExpectedImages;
};
struct SourceDrain {
  bool localCallsDrained = false, originalChildDrained = false;
  bool localPhysicalClosed = false, sourceBorrowHeld = false;
  bool originalParentHeld = false, complete = false;
  bool remoteCompletionKnown = false, remotePhysicalComplete = false;
  SourceOutcome failure;
};
class SourceBoundAccountAcquisition;
// SAME original Source parent. It is not a Go context, timeout constructor,
// detached deadline-to-authority adapter, or public cancellation setter. Only
// the original purpose child can obtain/settle its one strong bridge borrow.
class OriginalSourceParent final {
 public:
  OriginalSourceParent(const OriginalSourceParent&) = delete;
  OriginalSourceParent& operator=(const OriginalSourceParent&) = delete;
  uint64_t originalDeadlineMs() const noexcept;
  SourceOutcome current() noexcept;
  bool cancellationRequested() const noexcept;
  // waitLimit bounds a LOCAL wait; it never substitutes/renews the Source
  // deadline. Auth's SAME source current enforces the original clock/window.
  bool waitForCancellation(Deadline waitLimit) noexcept;
 private:
  explicit OriginalSourceParent(SourceBoundAccountAcquisition&) noexcept;
  ~OriginalSourceParent() = default;
  SourceBoundAccountAcquisition* acquisition_;
  friend class SourceBoundAccountAcquisition;
};
struct SourceAcquisition {
  SourceBoundAccountAcquisition* owner = nullptr; // adopt NONNULL before error
  SourceOutcome failure;
};

// Only the ORIGINAL Native purpose child can mint this one-use token after its
// actual SDK Reader/HostPort and protected Source-parent bridge have drained.
// The outer Auth Host waits for this child; it never issues this token itself.
// There is no public bool/FD/provider constructor. A fresh token cannot reset
// an earlier issued/consumed token or an UNKNOWN Source release attempt.
class OriginalChildDrainToken final {
 public:
  OriginalChildDrainToken(const OriginalChildDrainToken&) = delete;
  OriginalChildDrainToken& operator=(const OriginalChildDrainToken&) = delete;
  OriginalChildDrainToken(OriginalChildDrainToken&&) noexcept;
  OriginalChildDrainToken& operator=(OriginalChildDrainToken&&) = delete;
 private:
  SourceBoundAccountAcquisition* acquisition_ = nullptr;
  OriginalAccountPurposeChild* host_ = nullptr;
  OriginalEngineSource* source_ = nullptr;
  bool valid_ = false;
  OriginalChildDrainToken(SourceBoundAccountAcquisition&, OriginalAccountPurposeChild&) noexcept;
  friend class SourceBoundAccountAcquisition;
  friend struct ynx::native::accountproof::OriginalAccountPurposeChild;
};

class SourceBoundAccountAcquisition final {
 public:
  SourceBoundAccountAcquisition(const SourceBoundAccountAcquisition&) = delete;
  SourceBoundAccountAcquisition& operator=(const SourceBoundAccountAcquisition&) = delete;
  SourceOutcome current() noexcept;
  SourceOutcome readOriginalContext(OriginalAccountContext& ownedCopy) noexcept;
  // Logical retirement ONLY: seal productive/context access. Keep the SAME
  // physical channel available to the original host's cleanup-only borrow so
  // SDK RETIRE/JOIN/CLOSE can settle without an early socket shutdown.
  void retire() noexcept;
  SourceDrain join(Deadline) noexcept;
  SourceDrain close(Deadline) noexcept;
  bool isClosed() const noexcept;
  SourceOutcome firstFailure() const noexcept;
  SourceOutcome releaseClosed() noexcept; // only deletes after actual closure
 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  SourceBoundAccountAcquisition(OriginalEngineSource*, const current4launch::Readback&,
                                const current4launch::IndependentImages&);
#ifdef YNX_NETWORK_FRESH_SCOPE_BROKER
  SourceBoundAccountAcquisition(OriginalEngineSource*,const current4launch::Readback&,
     const current4launch::IndependentImages&,const freshscope::NativeCreatorOrigin&);
  SourceOutcome adoptFreshOriginalParent(int,uint64_t,uint64_t,
      std::shared_ptr<freshscope::ScopeTransferDebt>) noexcept;
#endif
  ~SourceBoundAccountAcquisition(); // cannot destruct a pending Source loan
  SourceOutcome initialize(std::unique_ptr<GenuineAccountChannel>) noexcept;
  SourceOutcome adoptOriginalParent(current4launch::OriginalLaunch::SourceParentEndpoint) noexcept;
  SourceOutcome publishOriginalBind() noexcept;
  SourceOutcome originalParentCurrent() noexcept;
  void cancelOriginalParent(uint32_t reason) noexcept;
  bool closeOriginalParent() noexcept;
  void recordFailure(SourceOutcome) noexcept;
  SourceOutcome bindOriginalChild(OriginalAccountPurposeChild&, OriginalEngineSource*) noexcept;
  SourceOutcome originalChannelForChild(OriginalAccountPurposeChild&, OriginalEngineSource*,
                                       GenuineAccountChannel*&) noexcept;
  SourceOutcome originalCleanupChannelForChild(OriginalAccountPurposeChild&, OriginalEngineSource*,
                                              GenuineAccountChannel*&) noexcept;
  SourceOutcome originalParentForChild(OriginalAccountPurposeChild&, OriginalEngineSource*,
                                       OriginalSourceParent*&) noexcept;
  SourceOutcome completeOriginalParentBridge(OriginalAccountPurposeChild&, OriginalSourceParent&) noexcept;
  SourceOutcome completeOriginalChildDrain(OriginalChildDrainToken&&) noexcept;
  friend class current4launch::OriginalLaunch;
  friend class OriginalChildDrainToken;
  friend class OriginalSourceParent;
  friend class freshscope::FreshScopeBroker;
  friend struct ynx::native::accountproof::OriginalAccountPurposeChild;
};
}
