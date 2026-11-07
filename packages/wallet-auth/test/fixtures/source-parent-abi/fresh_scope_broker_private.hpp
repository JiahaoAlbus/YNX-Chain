#pragma once
#include "account_source_acquisition_private.hpp"
namespace ynx::network::normalnative {struct OriginalBackendStopAccess;}
namespace ynx::network::freshscope {
using Deadline=current4launch::Deadline;
class FreshScopeBroker;
// Origin is minted only after original qualified broker custody is checked.
// No caller bool, PID/FD/provider can choose another validation origin.
class NativeCreatorOrigin final {
 private:
  NativeCreatorOrigin()=default;
  friend class FreshScopeBroker;
};
class ScopeTransferDebt final {
 private:
  struct Impl;std::unique_ptr<Impl>impl_;
  ScopeTransferDebt(int,int,uint64_t,uint64_t,uint64_t,uint64_t);
  bool closeLocalCopies()noexcept;
  void markSourceClosed()noexcept;
  bool sourceClosed()const noexcept;
  void bindSource(accountproof::SourceBoundAccountAcquisition*)noexcept;
  void retireSource()noexcept;
  friend class FreshScopeBroker;
  friend class accountproof::SourceBoundAccountAcquisition;
 public:
  ~ScopeTransferDebt();
};
enum class Failure { None, Retired, WrongActor, Custody, Identity, Allocation,
                     Frame, Deadline, Unknown, Rejected, Busy, CloseUnknown };
struct Acquisition {
  accountproof::SourceAcquisition account;
  Failure failure=Failure::None;
  uint64_t scope=0;
  bool unknown=false;
  uint32_t status=0,reason=0;
  accountproof::AuthFailure receiverFailure;
};
struct QueryResult{uint64_t scope=0;uint32_t status=0,reason=0;accountproof::AuthFailure receiverFailure;Failure failure=Failure::None;};
struct Drain {bool localComplete=false,remoteCompletionKnown=false;Failure first=Failure::None;};
class FreshScopeBroker final {
 public:
  ~FreshScopeBroker();
  FreshScopeBroker(const FreshScopeBroker&)=delete;
  FreshScopeBroker&operator=(const FreshScopeBroker&)=delete;
  Acquisition acquire(accountproof::OriginalEngineSource*)noexcept;
  bool current()noexcept;
  // Read only same-scope status query, never another OFFER or Source retry.
  // UNKNOWN permanently seals acquisition: at most one zero-prefix recovery
  // QUERY, partial frames continue, and a consumed recovery is not replayed or
  // cached as a new current observation. Late replies stay on the sealed FD.
  QueryResult query(uint64_t scope)noexcept;
  bool localScopesDrained()const noexcept;
  void retire()noexcept;
  Drain close()noexcept;
 private:
  struct Impl;std::unique_ptr<Impl>impl_;
  FreshScopeBroker(int,uint64_t,uint64_t,const current4launch::Readback&,
                   const current4launch::IndependentImages&);
  friend class current4launch::OriginalLaunch;
};
struct StopObservation{bool requested=false;Failure failure=Failure::None;uint64_t nonce=0;};
class OriginalFreshStopControl final{
 public:
  ~OriginalFreshStopControl();
  OriginalFreshStopControl(const OriginalFreshStopControl&)=delete;
  OriginalFreshStopControl&operator=(const OriginalFreshStopControl&)=delete;
  StopObservation poll(Deadline)noexcept;
  Drain close()noexcept;
 private:
  struct Impl;std::unique_ptr<Impl>impl_;
  OriginalFreshStopControl(int,uint64_t,uint64_t,const current4launch::Readback&,
                          const current4launch::IndependentImages&);
  Failure acknowledge(const FreshScopeBroker&,accountproof::AuthFailure)noexcept;
  friend class current4launch::OriginalLaunch;
  friend struct normalnative::OriginalBackendStopAccess;
};
}
