#pragma once
#import "ynx-wallet-admission-parent.h"
// Existing factory/current/close ABI is preserved. This is an additional
// explicit, one-shot adoption of the actual successful posix_spawn child.
// child=0 current calls never select adoption. After spawn the IDE caller MUST
// call this before current(child>0); observation alone never adopts a child.
FOUNDATION_EXPORT BOOL YNXOriginalAdoptIDEAdmissionChild(id<YNXWalletAdmissionParentGuard> guard,pid_t actualChild,NSError **error);
// Retire fences this capability, not the ordinary local code-server process.
FOUNDATION_EXPORT void YNXOriginalRetireIDEAdmissionParent(id<YNXWalletAdmissionParentGuard> guard);
