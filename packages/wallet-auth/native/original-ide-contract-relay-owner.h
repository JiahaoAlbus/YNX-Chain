#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
// Native-only local owner. Not registered in Node until the independent
// dedicated Source schema and actual WalletConnect egress closure qualify.
@interface YNXOriginalIDEContractRelayOwner : NSObject
// Partial owner is returned before qualification errors. Adopt before error.
+ (instancetype)captureForActualRunningEntry:(NSString*)entry error:(NSError**)error;
+ (instancetype)captureForActualRunningEntry:(NSString*)entry localContext:(NSDictionary*)context error:(NSError**)error;
- (BOOL)assertLocalCurrent:(NSError**)error;
- (NSDictionary*)copyScopeLocal:(NSError**)error;
- (BOOL)observeLocalRevocation:(dispatch_block_t)callback error:(NSError**)error;
- (BOOL)pollLocalRevocation:(NSError**)error;
- (void)removeLocalRevocationObserver;
- (BOOL)cancelLocal:(NSError**)error;
- (BOOL)revokeLocal:(NSError**)error;
- (BOOL)retire:(NSError**)error;
- (BOOL)join:(NSError**)error;
- (BOOL)close:(NSError**)error;
@end
#endif
