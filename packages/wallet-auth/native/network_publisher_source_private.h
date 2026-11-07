#pragma once
#import "original-auth-identity-source-authority.h"
#import "original-auth-identity-joint-owner.h"
@interface YNXAuthIdentityCurrentOwner(NetworkPublisherOriginal)
+ (instancetype)acquireOriginalNetworkCurrentPublisherProfile:(NSError**)error;
@end
@interface YNXAuthIdentitySourceAuthority(NetworkPublisherOriginal)
+ (instancetype)acquireOriginalNetworkCurrentPublisherSource:(NSError**)error;
- (BOOL)assertOriginalNetworkCurrentPublisherCurrent:(NSError**)error;
- (BOOL)assertOriginalNetworkCurrentPublisherCompletedCurrent:(NSError**)error;
- (NSDictionary*)copyOriginalNetworkCurrentPublisherContext:(NSError**)error;
- (BOOL)retainOriginalNetworkCurrentPublisherChild:(NSError**)error;
- (void)releaseOriginalNetworkCurrentPublisherChild;
- (BOOL)closeOriginalNetworkCurrentPublisherSource:(NSError**)error;
@end
