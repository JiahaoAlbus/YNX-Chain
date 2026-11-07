#pragma once
#include <stdbool.h>
#ifdef __cplusplus
extern "C" {
#endif
// Invoke before RN host construction in P01/P08, using A's ONE combined image.
void YNXOriginalAIMobileV6RegisterBeforeReactHost(void);
void YNXOriginalAIMobileV6RequestRetireBeforeHostInvalidation(void);
// Native teardown executor only. false retains all partial/UNKNOWN cleanup debt.
bool YNXOriginalAIMobileV6DrainOnNativeTeardownExecutor(void);
#ifdef __cplusplus
}
#endif
