#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
// Original Native Node owner only. No renderer UID/path/requirement/provider,
// Source/current boolean, Root, signer or installation callback is accepted.
@interface YNXIDEHelperClient:NSObject
+ (instancetype)acquireOriginalNodeClient:(NSError**)error;
- (NSDictionary*)prepareOriginalReceiveRequest:(NSData*)request error:(NSError**)error;
- (NSDictionary*)receiveOriginalRequest:(NSData*)request proof:(NSData*)proof error:(NSError**)error;
- (BOOL)assertTransportCurrent:(NSError**)error;
- (void)retire;
- (BOOL)join:(NSError**)error;
- (BOOL)close:(NSError**)error;
@end
#endif
