#pragma once
#if !defined(__OBJC__) || defined(NAPI_VERSION)
#include <node_api.h>
#endif
#ifdef __OBJC__
#import "original-auth-identity-source-authority.h"
#import "original-auth-identity-joint-owner.h"
@interface YNXAuthIdentityCurrentOwner (DesktopTaskGrantOriginal)
+ (instancetype)acquireOriginalDesktopTaskGrantAuthorityProfile:(NSError**)error;
@end
@interface YNXAuthIdentitySourceAuthority (DesktopTaskGrantOriginal)
+ (instancetype)acquireOriginalDesktopTaskGrantAuthoritySource:(NSError**)error;
- (BOOL)assertOriginalDesktopTaskGrantAuthorityCurrent:(NSError**)error;
- (NSDictionary*)copyOriginalDesktopTaskGrantAuthorityContext:(NSError**)error;
- (NSDictionary*)copyOriginalDesktopTaskGrantCallerRegistration:(NSError**)error;
- (NSDictionary*)copyOriginalDesktopTaskGrantLINKRegistration:(NSError**)error;
- (NSString*)copyOriginalDesktopTaskGrantBootstrapModule:(NSError**)error;
- (NSString*)copyOriginalDesktopTaskGrantLINKModule:(NSError**)error;
- (BOOL)holdOriginalDesktopTaskGrantNativeAddress:(const void*)address error:(NSError**)error;
- (BOOL)closeOriginalDesktopTaskGrantAuthority:(NSError**)error;
@end
#endif
// Called only by the original addon initializer. No Source/owner injection API.
#if !defined(__OBJC__) || defined(NAPI_VERSION)
void RegisterOriginalTaskGrantAuthorityBackendV1(napi_env env,napi_value exports);
#endif
