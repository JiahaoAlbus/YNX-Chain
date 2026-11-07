#pragma once
#include "account_source_acquisition_private.hpp"
#include <memory>
#ifdef YNX_NETWORK_FRESH_SCOPE_BROKER
#include "fresh_scope_broker_private.hpp"
#endif
namespace ynx::network::freshscope {enum class Failure;}
namespace ynx::network::normalnative {
enum class Failure { None, NotSupplied, AlreadyStarted, StartupFailed, Retired, Pending, WrongActor };
struct Outcome {
  Failure failure=Failure::None;
  current4launch::Failure launchFailure=current4launch::Failure::None;
  freshscope::Failure freshFailure=static_cast<freshscope::Failure>(0);
  bool failed()const noexcept{return failure!=Failure::None||launchFailure!=current4launch::Failure::None||freshFailure!=static_cast<freshscope::Failure>(0);}
};
struct BackendBorrow;
struct AccountAcquisition;
class OriginalBackendLoan final {
 public:
  OriginalBackendLoan(const OriginalBackendLoan&)=delete;
  OriginalBackendLoan&operator=(const OriginalBackendLoan&)=delete;
  ~OriginalBackendLoan();
  Outcome current()noexcept;
  // Must remain owned until every nonnull source acquisition is actually
  // closed/released by its original Native child. Pending destruction retains
  // the process holder's debt count; it never silently cancels Source debt.
  // Destroying a pending loan loses the normal settlement handle, so the real
  // child must preserve it. This cannot keep an abnormally exiting OS process
  // alive; main exit80 explicitly reports UNKNOWN to the original parent.
  Outcome close()noexcept;
#ifdef YNX_NETWORK_FRESH_SCOPE_BROKER
  // Read only the status of THIS original offered scope; no caller scope ID,
  // FD resend, reset or new Source request is accepted.
  freshscope::QueryResult freshScopeStatus()noexcept;
#endif
 private:
  struct Impl;
  std::unique_ptr<Impl>impl_;
  explicit OriginalBackendLoan(std::unique_ptr<Impl>);
  accountproof::SourceOutcome releaseClosedOriginalAccount(
      accountproof::SourceBoundAccountAcquisition*)noexcept;
  // Sole Native child release path: do NOT separately call Source owner
  // releaseClosed first. This exact-pointer check + actual Source release
  // clears the loan together, preventing a dangling acquired owner pointer.
  friend struct BackendBorrow;
  friend BackendBorrow borrowOriginalNormalNativeBackend()noexcept;
  friend struct AccountAcquisition;
  friend AccountAcquisition acquireOriginalNormalSourceAccount(accountproof::OriginalEngineSource*)noexcept;
  friend struct ynx::native::accountproof::OriginalAccountPurposeChild;
};
struct BackendBorrow{std::unique_ptr<OriginalBackendLoan>owner;Outcome failure;};
struct AccountAcquisition{
  std::unique_ptr<OriginalBackendLoan>backend;
  accountproof::SourceAcquisition account;
  Outcome failure;
  // Read-only transport observations, never Source or SDK capabilities.
  uint64_t freshScope=0;
  uint32_t freshLocalStatus=0,freshReason=0;
  accountproof::AuthFailure freshReceiverFailure;
  bool freshUnknown=false;
};
// Normal process entry only. Fixed original qualified closure supplies pins;
// no argv/environment/capsule/FD/Source selector is accepted here.
Outcome startupOriginalNormalNativeBackend()noexcept;
BackendBorrow borrowOriginalNormalNativeBackend()noexcept;
AccountAcquisition acquireOriginalNormalSourceAccount(accountproof::OriginalEngineSource*)noexcept;
Outcome retireOriginalNormalNativeBackend()noexcept;
Outcome closeOriginalNormalNativeBackend()noexcept;
struct FreshStopObservation{bool requested=false;Outcome failure;};
// Qualified fresh-scope profile only. Local I/O wait is never Source authority.
FreshStopObservation pollOriginalFreshStop(current4launch::Deadline localIOLimit)noexcept;
Outcome acknowledgeOriginalFreshStop()noexcept;

// Required ORIGINAL qualified host symbols, deliberately not implemented by
// P09. Enabled only by YNX_NETWORK_QUALIFIED_NORMAL_NATIVE_HOST. Expectations
// come from the original external qualified image closure, avoiding embedding
// a binary's own digest into itself. No default/weak/provider implementation.
#ifdef YNX_NETWORK_QUALIFIED_NORMAL_NATIVE_HOST
namespace qualified {
struct Profile{current4launch::IndependentImages independentlyExpectedImages;};
Outcome readOriginalNormalHostProfile(Profile&)noexcept;
Outcome assertOriginalNormalHostProfileCurrent()noexcept;
Outcome retireOriginalNormalHostProfile()noexcept;
Outcome closeOriginalNormalHostProfile()noexcept;
int runOriginalNativeAccountHost()noexcept;
}
#endif
}
