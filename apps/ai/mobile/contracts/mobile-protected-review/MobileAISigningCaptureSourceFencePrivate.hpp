#pragma once
#include "MobileAITaskRuntimePrivate.h"
namespace ynx::auth::ai::mobile {
// Internal mathematical Source/review/context fence for the actual approval
// producer. This deliberately DOES NOT call approval_current: its public
// enclosing capture_current already ANDs approval and would otherwise recurse.
// The token must be a genuine retained capture in the same original inventory.
// No constructor, provider, approved flag, resource selector or key is supplied.
int32_t signingCaptureSourceCurrentOriginal(YNXAIMobileSigningCapture*) noexcept;
}
