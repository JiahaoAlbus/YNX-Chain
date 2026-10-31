#pragma once
// PRIVATE native custody port, not NAPI/renderer DATA or a loader callback.
#import "original-auth-identity-source-authority.h"
#include <memory>
#include <string>
#include <cstdint>
namespace ynx_auth_private {
struct OriginalRuntimeImageViewV1 {
 std::string imagePath,imageSHA256,normalPackageRoot,privateModulePath,privateModuleURI;
 uint64_t imageDevice=0,imageInode=0,imageBytes=0;
 // Deliberately no Source/Root/admitted Boolean and no caller-supplied address.
};
class OriginalRuntimeImageReadLeaseV1 final {
 struct State;std::unique_ptr<State>state_;
 explicit OriginalRuntimeImageReadLeaseV1(YNXAuthIdentitySourceAuthority*,const void*,NSError**);
 friend std::shared_ptr<OriginalRuntimeImageReadLeaseV1>borrowOriginalRuntimeImageReadLeaseV1(YNXAuthIdentitySourceAuthority*,const void*,NSError**);
public:
 ~OriginalRuntimeImageReadLeaseV1();
 OriginalRuntimeImageReadLeaseV1(const OriginalRuntimeImageReadLeaseV1&)=delete;
 void assertCurrent();
 const OriginalRuntimeImageViewV1&readOriginalRuntimeImageView();
 void retire()noexcept;
 bool close()noexcept; // sticky first result; never reopens/reloads on failure.
};
std::shared_ptr<OriginalRuntimeImageReadLeaseV1>borrowOriginalRuntimeImageReadLeaseV1(YNXAuthIdentitySourceAuthority*,const void*actualNativeCallerAddress,NSError**);
}
@interface YNXAuthIdentitySourceAuthority(RuntimeImageNativePrivateV1)
// Pass a real function address in the SAME implementing .node, e.g. the fixed
// NAPI entry's address, not JS bytes/path/address/Boolean. Implementation must
// compare dladdr(caller) and its OWN native marker with the held signed image.
// Capture a nonnull lease BEFORE interpreting NSError/late-current failure.
- (std::shared_ptr<ynx_auth_private::OriginalRuntimeImageReadLeaseV1>)borrowOriginalRuntimeImageReadLeaseForNativeAddress:(const void*)actualNativeCallerAddress error:(NSError**)error;
@end
