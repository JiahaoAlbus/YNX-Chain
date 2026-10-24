#pragma once
#import <Foundation/Foundation.h>
@class YNXAuthIdentitySourceAuthority;
// Main-private typed capture. Auth supplies this dedicated Native boundary in
// R196 / SDK23; R199 separately verifies actual CONTROL CABI interoperability.
// A matching real Source/custody role is still required for activation. No fallback
// to project publication authority, ordinary login or caller dictionaries.
@interface YNXOriginalProjectControlReview : NSObject
+ (instancetype)captureOriginal:(NSError **)error;
- (NSDictionary *)copyOriginalReview:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
- (BOOL)selectOriginalDecision:(NSString *)reviewId decision:(NSString *)decision error:(NSError **)error;
- (NSDictionary *)copyOriginalDecision:(NSError **)error;
// Main's fixed dedicated CABI adapter only; never NAPI/JS provider entry.
// Reserve/persist once before custody. Returned context is public DATA, not
// a Root/key grant. The actual CABI adapter remains a separately matched input.
- (NSDictionary *)selectOriginalApprovalEffectForReview:(NSString *)reviewId error:(NSError **)error;
// Pure original-byte construction for the fixed private CABI caller. Binding
// comes from independently qualified current registered custody, never IPC.
- (NSDictionary *)prepareOriginalApprovalInputForBinding:(NSDictionary *)binding error:(NSError **)error;
- (NSData *)envelopeForOriginalMember:(NSData *)member error:(NSError **)error;
- (BOOL)retainOriginalApprovalResult:(NSDictionary *)result cause:(NSError *)cause error:(NSError **)error;
- (NSData *)copyOriginalApprovalProof:(NSError **)error;
- (BOOL)saveOriginalApprovalResult:(NSError **)error;
- (BOOL)saveOriginalLifecycle:(NSData *)record error:(NSError **)error;
- (void)retire;
- (BOOL)close:(NSError **)error;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end
