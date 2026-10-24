#pragma once
#import <Foundation/Foundation.h>
@class YNXAuthIdentitySourceAuthority;
// Main-private typed capture. These Source methods are a proposed private
// Auth Native boundary, NOT supplied by SDK20/R194's JS codec. The actual
// dedicated Source role must implement them before activation. No fallback
// to project publication authority, ordinary login or caller dictionaries.
@interface YNXOriginalProjectControlReview : NSObject
+ (instancetype)captureOriginal:(NSError **)error;
- (NSDictionary *)copyOriginalReview:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
- (BOOL)selectOriginalDecision:(NSString *)reviewId decision:(NSString *)decision error:(NSError **)error;
- (NSDictionary *)copyOriginalDecision:(NSError **)error;
- (BOOL)saveOriginalLifecycle:(NSData *)record error:(NSError **)error;
- (void)retire;
- (BOOL)close:(NSError **)error;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end
