#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
@class YNXAuthIdentitySourceAuthority;
// Original Wallet Native-only owner, never a Node/IDE/renderer export. Opening
// reads only an independently Root/current/role-selected protected item. It
// neither creates a key nor asserts Main user consent or durable once intent.
@interface YNXAuthOriginalProjectControlCustody : NSObject
+ (instancetype)acquireForOriginalSource:(YNXAuthIdentitySourceAuthority*)source error:(NSError**)error;
- (BOOL)assertOriginalCurrent:(NSError**)error;
- (NSDictionary*)copyOriginalExpectedBinding:(NSError**)error;
// Same mutable owner buffer, single synchronous Native borrow only. Main must
// invoke its fixed CONTROL CABI, then wipe in finally. Never copy/pass to JS.
- (NSMutableData*)borrowOriginalControlRecord:(NSError**)error;
- (BOOL)completeOriginalControlBorrow:(NSError**)error;
// No further signing on retirement; active/nonzero borrow blocks join/close.
// Close first result retained. Logical wipe is NOT Go/CIRCL physical erasure.
- (void)retire;
- (BOOL)join:(NSError**)error;
- (BOOL)close:(NSError**)error;
@end
#endif
