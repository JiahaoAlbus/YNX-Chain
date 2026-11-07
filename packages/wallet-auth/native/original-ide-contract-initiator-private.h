#pragma once
#import <Foundation/Foundation.h>
#import "original-auth-identity-source-authority.h"
// Private native CODE qualification of the fixed normal initiator path.
// Not a project grant, wallet approval, Verify permission or JS provider.
@interface YNXAuthIdentitySourceAuthority (OriginalIDEInitiatorCode)
- (NSDictionary*)copyOriginalIDEContractInitiatorCodeInputsLocal:(NSError**)error;
@end
@interface YNXOriginalIDEContractInitiatorCodeBoundary : NSObject
+ (instancetype)captureFromOriginalSource:(YNXAuthIdentitySourceAuthority*)source error:(NSError**)error;
- (BOOL)assertCurrent:(NSError**)error;
- (void)retire;
- (BOOL)join:(NSError**)error;
- (BOOL)close:(NSError**)error;
@end
