#pragma once
#import "original-auth-identity-source-authority.h"
#import "original-auth-identity-joint-owner.h"
@interface YNXAuthIdentityCurrentOwner(AITaskActionV6Original)
+ (instancetype)acquireOriginalAITaskActionV6ClientProfile:(NSError**)error;
- (BOOL)closeOriginalIDERegistryChildFirst:(NSError**)error;
@end
@interface YNXAuthIdentitySourceAuthority(AITaskActionV6Original)
+ (instancetype)acquireOriginalAITaskActionV6ClientSource:(NSError**)error;
- (BOOL)assertOriginalAITaskActionV6ClientCurrent:(NSError**)error;
- (NSDictionary*)copyOriginalAITaskActionV6ClientContext:(NSError**)error;
- (NSDictionary*)retainOriginalAITaskActionV6ClientParent:(NSError**)error;
- (void)releaseOriginalAITaskActionV6ClientParent;
- (BOOL)closeOriginalAITaskActionV6ClientSource:(NSError**)error;
@end
