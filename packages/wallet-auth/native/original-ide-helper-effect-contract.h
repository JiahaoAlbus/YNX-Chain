#pragma once
#import <Foundation/Foundation.h>
#import "original-auth-identity-source-authority.h"
// Exact original R91 private effect contract. Declaration is not a supplier;
// selectors remain fail-closed if original protected effect CODE is absent.
@protocol YNXOriginalIDEIdentityPrivateEffect<NSObject>
- (BOOL)assertCurrent:(NSError**)error;
- (id)invokeOriginal:(NSError**)error;
- (id)copyOriginalPublicResult:(NSError**)error;
- (void)retire;
- (BOOL)join:(NSError**)error;
- (BOOL)close:(NSError**)error;
@end
@interface YNXAuthIdentitySourceAuthority(OriginalIDEIdentityOperations)
- (id<YNXOriginalIDEIdentityPrivateEffect>)recoverOriginalIDEIdentityForRequest:(NSData*)request error:(NSError**)error;
- (id<YNXOriginalIDEIdentityPrivateEffect>)captureOriginalIDEProtectedKeyCall:(NSData*)invocation expectedRequest:(NSData*)request error:(NSError**)error;
@end
