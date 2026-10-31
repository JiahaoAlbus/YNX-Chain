#pragma once
// Native-only custody ABI. Not NAPI/DATA input, not a public SDK constructor.
#import "original-auth-identity-source-authority.h"
#include "original-product-device-v4-provisioning.h"
namespace ynx_auth_private {
struct HTTPV5RegisteredOriginalView {
 std::string registrationOriginal,sessionOriginal;
 NSDictionary*__strong context=nil;
 DeviceAssociationIdentity sameItem; // PUBLIC metadata/ref/fullpair, no keys.
 uint64_t expiresAtMs=0;
};
class OriginalHTTPV5RegisteredReadLease final {
 struct State;std::unique_ptr<State>state_;
 explicit OriginalHTTPV5RegisteredReadLease(YNXAuthIdentitySourceAuthority*);
 friend std::shared_ptr<OriginalHTTPV5RegisteredReadLease>borrowOriginalHTTPV5RegisteredReadLease(YNXAuthIdentitySourceAuthority*,NSError**);
public:
 ~OriginalHTTPV5RegisteredReadLease();
 OriginalHTTPV5RegisteredReadLease(const OriginalHTTPV5RegisteredReadLease&)=delete;
 void assertCurrent();
 const HTTPV5RegisteredOriginalView&readOriginalRegisteredView();
 void retire()noexcept;
 bool close()noexcept; // no IO; first result sticky; parent count releases once.
};
std::shared_ptr<OriginalHTTPV5RegisteredReadLease>borrowOriginalHTTPV5RegisteredReadLease(YNXAuthIdentitySourceAuthority*,NSError**);
}
@interface YNXAuthIdentitySourceAuthority(HTTPV5NativeRegisteredPrivate)
- (std::shared_ptr<ynx_auth_private::OriginalHTTPV5RegisteredReadLease>)borrowOriginalProductSessionHTTPProofV5RegisteredReadLease:(NSError**)error;
// Internal production Source->lease read, never exported in JS or accepting DTO.
- (NSDictionary*)copyOriginalProductSessionHTTPProofV5RegisteredContext:(NSError**)error;
- (BOOL)retainOriginalHTTPV5RegisteredChild:(NSError**)error;
- (void)releaseOriginalHTTPV5RegisteredChild;
@end
