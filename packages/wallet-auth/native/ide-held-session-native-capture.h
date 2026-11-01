#pragma once
#import <Foundation/Foundation.h>
@class YNXAuthIdentitySourceAuthority;
// PRIVATE same native image. The caller supplies only the actual recognized
// original Source owner, never paths, registry DATA, a session or an approval.
@interface YNXIDEHeldSessionNativeCapture : NSObject
+ (instancetype)holdUsingOriginalSource:(YNXAuthIdentitySourceAuthority *)source error:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
- (NSDictionary *)readMetadata:(NSError **)error;
- (NSString *)readOriginal:(NSString *)key error:(NSError **)error;
- (BOOL)revocationRequested;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@property(nonatomic,readonly) BOOL closed;
@end
