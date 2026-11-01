#pragma once
#include <node_api.h>
// Installed only into the SAME existing qualified common image.
// No runtime provider, URI, callback or key/Root setter is exposed.
napi_value RegisterOriginalAITaskActionClientV6(napi_env env,napi_value exports);
// Actual five exports registered by that same common-image entry:
// acquireOriginalAITaskActionClientV6Source() -> sync explicit owner/errorPresent
// isOriginalAITaskActionV6Review(value) -> native env/actor/type_tag/inventory
// isOriginalAITaskClientRootV6(value) -> original startup/root custody only
// openOriginalAITaskActionClientV6LoaderV1(SAMEstartup) -> exact port4
// waitOriginalAITaskActionClientV6Ready(SAMEstartup) -> SAME Promise<void>
// port4={version:1,clientURI,assertCurrent,acceptCompleted}. The port retains
// startup until its functions are GC'd; stale port calls fail after retire/close.
// acceptCompleted adopts namespace then calls the Root-held fixed SDK loader's
// is/consumeOriginalAITaskActionClientV6ModuleImportDATA(owner,SAMEns), exactly
// once; it cannot approve namespace shape, matching exports or a caller path.
// No Source method is usable before ready, except own retire/join/close.
