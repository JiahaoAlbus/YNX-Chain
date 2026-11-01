#pragma once
#import "original-auth-identity-source-authority.h"
#import "original-auth-identity-joint-owner.h"
/* Private original native methods. No public JS/C provider installation. */
@interface YNXAuthIdentityCurrentOwner(BrowserSelectedPagesOriginal)
+ (instancetype)acquireOriginalBrowserSelectedPagesProfile:(NSError**)error;
- (BOOL)closeOriginalIDERegistryChildFirst:(NSError**)error;
@end
@interface YNXAuthIdentitySourceAuthority(BrowserSelectedPagesOriginal)
+ (instancetype)acquireOriginalBrowserSelectedPagesSource:(NSError**)error;
- (BOOL)assertOriginalBrowserSelectedPagesCurrent:(NSError**)error;
- (NSDictionary*)copyOriginalBrowserSelectedPagesContext:(NSError**)error;
- (NSDictionary*)retainOriginalBrowserSelectedPagesParent:(NSError**)error;
- (void)releaseOriginalBrowserSelectedPagesParent;
- (BOOL)closeOriginalBrowserSelectedPagesSource:(NSError**)error;
@end
