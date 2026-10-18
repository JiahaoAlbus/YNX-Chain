#pragma once
#import <Foundation/Foundation.h>
#import "../../../packages/wallet-auth/native/original-auth-identity-source-authority.h"
// Original Native callee contracts. These are not renderer-supplied providers,
// signer callbacks, permission flags or a public factory/installer.
@protocol YNXOriginalIDEIdentityPrivateEffect <NSObject>
- (BOOL)assertCurrent:(NSError **)error;
- (id)invokeOriginal:(NSError **)error;
- (id)copyOriginalPublicResult:(NSError **)error;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@end
@interface YNXAuthIdentitySourceAuthority (OriginalIDEIdentityRequest)
- (NSData *)copyOriginalIDEIdentityRequestForPurpose:(NSString *)purpose invocation:(NSData *)invocation error:(NSError **)error;
- (BOOL)assertOriginalIDEIdentityRequestCurrent:(NSData *)request invocation:(NSData *)invocation error:(NSError **)error;
@end
@interface YNXAuthIdentitySourceAuthority (OriginalIDEIdentityOperations)
- (BOOL)assertOriginalIDEIdentityProofConsumerReady:(NSData *)request error:(NSError **)error;
- (BOOL)assertOriginalIDEIdentityReceiveExecutionAvailable:(NSError **)error;
// Sole SDK Auth N1 verification + independent original registration/purpose,
// not first-enter/transaction/session verification. Missing implementation
// remains a precise owning CODE gap, never a fallback to a different proof.
- (BOOL)verifyOriginalIDEIdentityProof:(NSData *)wire expectedRequest:(NSData *)request invocation:(NSData *)invocation error:(NSError **)error;
- (id<YNXOriginalIDEIdentityPrivateEffect>)recoverOriginalIDEIdentityForRequest:(NSData *)request error:(NSError **)error;
- (id<YNXOriginalIDEIdentityPrivateEffect>)captureOriginalIDEProtectedKeyCall:(NSData *)invocation expectedRequest:(NSData *)request error:(NSError **)error;
@end
