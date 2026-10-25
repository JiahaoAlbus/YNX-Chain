#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
// Native App-only observer. This is not a Node Source, HTTP approval, signer,
// or serialized capability. Failure may return a partial owner plus error:
// retain that owner and its first close result until custody is resolved.
@interface YNXIDEProjectServiceObserver : NSObject
+ (instancetype)acquireOriginalObserver:(NSError **)error;
- (NSDictionary *)copyCurrentServiceRegistration:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@end
#endif
