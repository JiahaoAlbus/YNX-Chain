#pragma once
// Private physical account-purpose transport. A channel is minted only by the
// original launch mother, never by a caller descriptor/path/engineReference.
#include "current4_launch_private.hpp"
#include <cstddef>
#include <vector>
namespace ynx::network::freshscope {class FreshScopeBroker;class NativeCreatorOrigin;}

namespace ynx::network::accountproof {
using Deadline = current4launch::Deadline;
using Bytes = std::vector<uint8_t>;
inline constexpr char purpose[] = "wallet-mobile-committed-account-proof-v1";
inline constexpr size_t originalHeaderBytes = 97;
inline constexpr size_t maxOriginalPayloadBytes = (36u << 20) + (64u << 10);
inline constexpr size_t maxOriginalFrameBytes = originalHeaderBytes + maxOriginalPayloadBytes;
enum class Failure { None, Retired, Deadline, Identity, Custody, Busy, FrameBound,
                     Unknown, CloseUnknown };
struct ExchangeResult {
  bool complete = false, unknown = false;
  size_t requestBytesWritten = 0, replyBytesRead = 0;
  Failure failure = Failure::None;
  bool rootAdmission = false, sourceAdmission = false;
};
struct LocalDrain {
  bool localUsersDrained = false, physicalComplete = false;
  bool remoteCompletionKnown = false, remotePhysicalComplete = false;
  Failure first = Failure::None;
};
class GenuineAccountChannel final {
 public:
  ~GenuineAccountChannel();
  GenuineAccountChannel(const GenuineAccountChannel&) = delete;
  GenuineAccountChannel& operator=(const GenuineAccountChannel&) = delete;
  // These are bounded physical checks, not Source window renewal or grants.
  bool current();
  bool current(Deadline);
  void retire();
  LocalDrain join(Deadline);
  LocalDrain close(Deadline);
  bool isClosed() const;
  Failure firstFailure() const;
  // One flight, no retry/reconnect. SDK owns original frame shape, reader and
  // sequence checks. Only the fixed original header's bounded length is read
  // here; complete response replaces reply atomically, failures leave it intact.
  ExchangeResult originalFrameExchange(const Bytes& originalRequest,
                                       Bytes& originalReply, Deadline);
 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  GenuineAccountChannel(int, uint64_t, uint64_t,
                       const current4launch::Readback&,
                       const current4launch::IndependentImages&);
  GenuineAccountChannel(int,uint64_t,uint64_t,const current4launch::Readback&,
                       const current4launch::IndependentImages&,
                       const freshscope::NativeCreatorOrigin&);
  friend class current4launch::OriginalLaunch;
  friend class freshscope::FreshScopeBroker;
};
}
