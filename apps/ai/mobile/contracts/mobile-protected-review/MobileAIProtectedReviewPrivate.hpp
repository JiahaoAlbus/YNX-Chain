#pragma once
#include "MobileAITaskRuntimePrivate.h"
namespace ynx::platform::ai::review {
// Required owning P08 protected Native UI. No implementation/default approval,
// public setter, callback table or JS/RN-approved value is supplied by Auth.
// Every input is the SAME genuine Auth capture, not a parsed caller object.
struct OriginalReview;
struct Failure{bool present=false;int32_t code=0;};
struct Result{Failure failure;bool physicalDone=false;};
struct Acquisition{OriginalReview*owner=nullptr;Failure failure;};
// Original UI must recognize the installed App and selected Native account /
// current epoch independently. Display the exact capture action/target/budget/
// expiry and digest. Read via the original capture getter and the PRIVATE
// no-approval Source fence, never public capture_current (which calls approval).
// Nonnull partial is adopted first. Pending/denial/cancel are not approvals.
Acquisition acquireOriginalProtectedReview(YNXAIMobileSigningCapture*)noexcept;
Failure currentOriginalProtectedReview(OriginalReview*,YNXAIMobileSigningCapture*)noexcept;
// Select once even on UNKNOWN; only actual approved same Native review may
// succeed. Capture/Root/account epoch/digest changes, rejection, expiry or
// cancellation fail closed. No signature, key access or task effect here.
Failure claimOriginalProtectedReview(OriginalReview*,YNXAIMobileSigningCapture*)noexcept;
void retireOriginalProtectedReview(OriginalReview*)noexcept;
// These remain legal after Source expiry/revoke. done is ONLY real UI/owned
// callback dismissal/drain, independent from sticky first failure including 0.
Result joinOriginalProtectedReview(OriginalReview*)noexcept;
Result closeOriginalProtectedReview(OriginalReview*)noexcept;
// If physicalDone is true the input pointer has actually been released and
// must never be re-entered. Auth preserves the prior first failure separately.
Result releaseClosedOriginalProtectedReview(OriginalReview*)noexcept;
}
