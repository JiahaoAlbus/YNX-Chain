#pragma once
// P09 private normal-launch mother. No exported C ABI, JS entry, FD setter,
// Source factory or permission is defined here. Only the dedicated original
// Native/Core host consumes its original parent's stdin capsule once.
#include <array>
#include <chrono>
#include <cstdint>
#include <memory>
#include <string>

namespace ynx::auth::mobile::receipt { struct OriginalEngineSource; }
namespace ynx::network::freshscope {class FreshScopeBroker;class OriginalFreshStopControl;}
namespace ynx::network::accountproof {
class GenuineAccountChannel;
class SourceBoundAccountAcquisition;
struct SourceAcquisition;
}
namespace ynx::network::current4launch {
using Deadline = std::chrono::steady_clock::time_point;
enum class Role : uint8_t { CoreProducer = 1, NativeClient = 2 };
enum class Failure { None, AlreadyEntered, Deadline, Input, Frame, Endpoint,
                     Process, IndependentImage, Retired, Transferred, CloseUnknown };
struct ProcessIdentity {
  uint32_t pid = 0, uid = 0;
  std::string startIdentity, imagePath;
  std::array<uint8_t,32> imageSHA256{};
};
// Supply these from the original independent build/qualified host closure,
// never from the received capsule. Matching bytes still grant no Root/Source.
struct IndependentImages {
  std::array<uint8_t,32> parentCreator{}, coreChild{}, nativeChild{};
};
struct Readback {
  Role role{};
  uint64_t generation = 0;
  ProcessIdentity parentCreator, coreChild, nativeChild;
};
struct LocalDrain { bool physicalComplete = false; Failure first = Failure::None;
                    bool remoteCompletionKnown = false;
                    bool endpointTransferred = false; };
class OriginalLaunch;
struct Capture { std::unique_ptr<OriginalLaunch> owner; Failure failure = Failure::None; };
class OriginalLaunch final {
 public:
  ~OriginalLaunch();
  OriginalLaunch(const OriginalLaunch&) = delete;
  OriginalLaunch& operator=(const OriginalLaunch&) = delete;
  const Readback& readback() const;
  // The independent EXPECTED image pins supplied to capture, never hashes
  // reinterpreted from the received launch capsule as independent authority.
  IndependentImages independentlyExpectedImages() const;
  Failure firstFailure() const;
  bool current();
  // Only the original private WireClient/Core constructor may adopt this once.
  // A transfer is local custody, never a policy CAPTURE or authorization.
  int takeEndpointOnce();
  // v2 only: independently captured account purpose, never the Current4 FD.
  // Minted once; caller adopts the genuine holder before interpreting errors.
  std::unique_ptr<accountproof::GenuineAccountChannel> takeAccountChannelOnce();
  // Defined ONLY in the separate qualified Native source-acquisition TU.
  // Ordinary C25/physical-only callers need not link Auth or this new TU.
  accountproof::SourceAcquisition acquireSourceBoundAccount(
      ynx::auth::mobile::receipt::OriginalEngineSource*);
  std::unique_ptr<freshscope::FreshScopeBroker> takeFreshScopeBrokerOnce();
  std::unique_ptr<freshscope::OriginalFreshStopControl> takeFreshStopControlOnce();
  LocalDrain closeLocal();
 private:
  struct SourceParentEndpoint { int descriptor=-1; uint64_t device=0,inode=0; };
  SourceParentEndpoint takeSourceParentForAcquisition();
  SourceParentEndpoint takeFreshBrokerEndpoint();
  SourceParentEndpoint takeFreshStopEndpoint();
  struct Impl;
  std::unique_ptr<Impl> impl_;
  explicit OriginalLaunch(std::unique_ptr<Impl>);
  friend Capture captureOriginalLaunch(Role,const IndependentImages&,Deadline);
  friend class accountproof::SourceBoundAccountAcquisition;
};
// Reads only STDIN_FILENO, bounded YNC4LCH1 + exact EOF, not a caller FD/path.
// Nonnull partial owners must be adopted before inspecting failure. This is a
// process-entry operation, once per process. It is not exposed to page IPC.
Capture captureOriginalLaunch(Role,const IndependentImages&,Deadline);
namespace detail {
// Fixed original mother custody check shared with its private account holder.
// This validates DATA only: no constructor, adoption, selector or Root grant.
bool validateInheritedEndpoint(const Readback&,const IndependentImages&,
                               int,uint64_t,uint64_t,Deadline);
// Private origin selected only by Native-created scope constructors. Existing
// inherited pair validation remains unchanged.
bool validateNativeCreatedScopeEndpoint(const Readback&,const IndependentImages&,
                               int,uint64_t,uint64_t,Deadline);
bool validateParentControlEndpoint(const Readback&,const IndependentImages&,
                               int,uint64_t,uint64_t,Deadline);
}
}
