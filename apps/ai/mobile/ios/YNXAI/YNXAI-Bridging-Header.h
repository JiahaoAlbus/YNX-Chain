//
#if YNX_AI_MATCHED_NATIVE_V6
// Exact common Native registration ABI, linked by A in the selected image.
void YNXOriginalAIMobileV6RegisterBeforeReactHost(void);
void YNXOriginalAIMobileV6RequestRetireBeforeHostInvalidation(void);
#include <stdbool.h>
bool YNXOriginalAIMobileV6DrainOnNativeTeardownExecutor(void);
#endif
// Use this file to import your target's public headers that you would like to expose to Swift.
//
