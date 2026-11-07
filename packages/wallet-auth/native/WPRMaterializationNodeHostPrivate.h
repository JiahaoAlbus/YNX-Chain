#pragma once
#include <node_api.h>
#ifdef __cplusplus
extern "C" {
#endif
// Add to the existing original-auth-identity-node.mm normal addon initializer.
// Link the actual Native client/peer/RPC/SourceKernel implementation; no weak
// symbol, JS callback installer, alternate image or fallback is permitted.
napi_status YNXInstallWPRMaterializationLoanV1(napi_env,napi_value exports);
#ifdef __cplusplus
}
#endif
