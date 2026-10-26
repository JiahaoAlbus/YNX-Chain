#pragma once
#import <Foundation/Foundation.h>
// Private Native only. This owner admits the ORIGINAL Wallet Source and binds
// the exact Node request. It neither signs nor accepts a JS approving callback.
@interface YNXOriginalIDEWalletIdentitySource : NSObject
+ (instancetype)acquire:(NSError **)error;
- (BOOL)bindRequest:(NSData *)request invocation:(NSData *)invocation error:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
- (NSData *)copyRequest:(NSError **)error;
- (NSDictionary *)copyRegistration:(NSError **)error;
// Private Native transport only, not user approval or a signing factory.
- (NSNumber *)copySourceExpiresAtMs:(NSError **)error;
- (BOOL)verifyProof:(NSData *)proof error:(NSError **)error;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@end
