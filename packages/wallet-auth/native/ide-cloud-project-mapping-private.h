#pragma once
#import <Foundation/Foundation.h>
@class YNXAuthIdentitySourceAuthority, YNXOriginalIDENodeDelivery;
// PRIVATE same-image recognized parent/project source only. This is not a GET
// proof, E11 signer, caller path/JSON installer or new admission constructor.
// The original NAPI inventories must borrow both original owners before use.
@interface YNXOriginalIDECloudProjectMapping : NSObject
+(instancetype)borrowOriginalParent:(YNXOriginalIDENodeDelivery*)parent projectSource:(YNXAuthIdentitySourceAuthority*)project error:(NSError**)error;
-(BOOL)assertCurrent:(NSError**)error;
-(NSDictionary*)copyOriginalMappingDATA:(NSError**)error;
-(void)retire;
-(BOOL)join:(NSError**)error;
-(BOOL)close:(NSError**)error;
@property(nonatomic,readonly) BOOL cleanupComplete;
@property(nonatomic,readonly) NSError*firstCause;
@end
