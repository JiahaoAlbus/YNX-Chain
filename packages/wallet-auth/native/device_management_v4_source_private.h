#pragma once
#import "original-auth-identity-source-authority.h"
#import "original-auth-identity-joint-owner.h"
@interface YNXAuthIdentityCurrentOwner(DeviceV4ManagementOriginal)
+ (instancetype)acquireOriginalDeviceV4ManagementProfile:(NSError**)error;
@end
@interface YNXAuthIdentitySourceAuthority(DeviceV4ManagementOriginal)
+ (instancetype)acquireOriginalDeviceV4ManagementSource:(NSError**)error;
- (BOOL)assertOriginalDeviceV4ManagementCurrent:(NSError**)error;
- (NSDictionary*)copyOriginalDeviceV4ManagementContext:(NSError**)error;
- (BOOL)retainOriginalDeviceV4ManagementChild:(NSError**)error;
- (void)releaseOriginalDeviceV4ManagementChild;
- (BOOL)closeOriginalDeviceV4ManagementSource:(NSError**)error;
@end
