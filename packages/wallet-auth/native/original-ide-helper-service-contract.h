#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
// Source namespace only, NOT a registered/installed identity or Root grant.
FOUNDATION_EXPORT NSString *const YNXIDEIdentityHelperService;
FOUNDATION_EXPORT NSString *const YNXIDEIdentityHelperPlist;
// Existing three actions stay independent. Server must obtain user identity
// from its OS-authenticated connection, never from any method argument.
@protocol YNXIDEIdentityReceiverService
// Actual same-source readiness DATA, no installation or proof/operation grant.
- (void)prepareOriginalReceiveRequest:(NSData*)request reply:(void(^)(NSDictionary*,NSError*))reply;
- (void)receiveOriginalRequest:(NSData *)request proof:(NSData *)proof reply:(void(^)(NSDictionary *,NSError *))reply;
- (void)recoverOriginalRequest:(NSData *)request proof:(NSData *)proof reply:(void(^)(NSDictionary *,NSError *))reply;
- (void)invokeOriginalRequest:(NSData *)request invocation:(NSData *)invocation proof:(NSData *)proof reply:(void(^)(NSDictionary *,NSError *))reply;
@end
// Only original Native/Main UI installation code may own this object. No
// renderer UID/path/requirement/ENV/signer/approval boolean enters these APIs.
// registerRequestedService is an explicit future system-install action; it is
// never called by acquire/status or by the source-only tests in this delivery.
@interface YNXIDEHelperBundledService:NSObject
+ (instancetype)acquireBundledCandidate:(NSError **)error;
- (NSDictionary *)copySystemStatus:(NSError **)error;
- (NSDictionary *)registerRequestedService:(NSError **)error;
@end
#endif
