#pragma once
#include "MobileAITaskRuntimePrivate.h"
namespace ynx::auth::ai::mobile {
// Private readonly view of the SAME inventory-owned capture. No new authority,
// setter, key resource, claim or signature. Spans are borrowed, same actor only,
// and valid only while the existing operation retains its capture/review.
// Caller must recheck full current after copying/using these public originals.
struct SigningCaptureReadResult {
 YNXAIMobileSigningOriginalDATA originals{};
 YNXAIMobileFailureV6 failure{};
 int32_t status=0;
};
SigningCaptureReadResult captureOriginalAgentBinding(YNXAIMobileSigningCapture*)noexcept;
// Read an already observed Source/review failure; never invokes approval.
YNXAIMobileFailureV6 signingCaptureSourceFailureOriginal(YNXAIMobileSigningCapture*)noexcept;
// Sticky first approval failure, including present=true/code=0. No UI call.
YNXAIMobileFailureV6 approvalOriginalFailure(YNXAIMobileApproval*)noexcept;
// Presentation DATA from the same prepared/reviewed intent, before approval.
// This is Source-qualified only: it must NEVER be treated as user approval.
// bodyOriginal is the actual body validated and retained by prepare(), not a
// caller replacement or a digest reconstruction. No secret/key resource read.
struct ProtectedReviewOriginalDATA {
 YNXAIMobileSpanV6 unsignedOriginal{},messageOriginal{},bodyOriginal{};
 YNXAIMobileSpanV6 scopeOriginal{},requestDigest{},agentExpectedOriginal{};
};
struct ProtectedReviewReadResult {
 ProtectedReviewOriginalDATA originals{};
 YNXAIMobileFailureV6 failure{};
 int32_t status=0;
};
ProtectedReviewReadResult readOriginalProtectedReviewDATA(YNXAIMobileSigningCapture*)noexcept;
}
