#pragma once
#include "DeviceV4SourceBackendPrivate.hpp"
#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import "original-auth-identity-source-authority.h"
@interface YNXAuthIdentitySourceAuthority(DeviceV4NativeBorrowPrivate)
- (id)reserveOriginalDeviceV4NativeReadLoan:(NSError**)error;
- (BOOL)releaseOriginalDeviceV4NativeReadLoan:(id)token released:(BOOL*)released error:(NSError**)error;
- (NSDictionary*)copyOriginalDeviceV4NativeReadSnapshot:(id)token notBefore:(uint64_t*)begin expires:(uint64_t*)end error:(NSError**)error;
- (NSDictionary*)copyOriginalDeviceV4AccountNamespaceForNativeRead:(id)token error:(NSError**)error;
- (BOOL)originalDeviceV4NativePhysicalClosed;
@end
namespace ynx::auth::devicev4 {
// Only fixed native code calls this after DeviceV4Original(env,self), or the
// dedicated zero-input Source constructor. Exact Source class/dedicated current
// is independently checked again. Never exported as a JS setter or C DTO API.
BackendAcquisition borrowRecognizedSource(YNXAuthIdentitySourceAuthority*)noexcept;
}
#endif
