#pragma once
#import "ide-original-session-store-private.h"
#include "pay_root_public_hold_private.hpp"
#include <vector>
namespace ynx_auth_private {
// PRIVATE independently reviewed release locators, not a Root wire/approval
// schema. Empty until the original release owner admits actual existing inputs.
// Source identity/account/product are ALSO checked against real Source-v2 math.
struct IDEOriginalReadRelease {
 NSString *sourceId,*account,*applicationId;
 YNXIDEOriginalSessionStoreReference store;
 ynx::wallet::pay::root_physical::Spec registry;
 uint32_t gatewayTimeoutMs;
};
inline const std::vector<IDEOriginalReadRelease>&originalIDEReadReleases(){
#ifdef YNX_IDE_HELD_SESSION_PUBLIC_FACTORY_CONTROLS
 extern const std::vector<IDEOriginalReadRelease>&PUBLICIDEReadReleases();return PUBLICIDEReadReleases();
#else
 static const std::vector<IDEOriginalReadRelease> original;return original;
#endif
}
}
