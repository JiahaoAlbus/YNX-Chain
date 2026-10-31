#pragma once
#import "original-auth-identity-source-authority.h"
// Source implementation only; never exposed through NAPI/renderer DATA.
@interface YNXAuthIdentitySourceAuthority(RuntimeImageSourceInternal)
- (NSDictionary *)retainOriginalRuntimeImageBinding:(NSError **)error;
- (BOOL)checkOriginalRuntimeImageBinding:(NSDictionary *)binding error:(NSError **)error;
- (BOOL)finishOriginalRuntimeImageBinding:(NSDictionary *)binding error:(NSError **)error;
- (void)releaseOriginalRuntimeImageLoan;
@end
