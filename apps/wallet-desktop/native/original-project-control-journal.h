#pragma once
#import <Foundation/Foundation.h>
// Main-private persistence primitive, NOT Source/current verification or an
// approval producer. Auth's dedicated codec and the original Native capture
// must validate all original bytes BEFORE this method. No JS/NAPI export.
// The identity is the original request binding, not a newly generated review
// UUID/nonce. Unknown/duplicate reservation never authorizes another decision.
@interface YNXOriginalProjectControlJournal : NSObject
- (BOOL)reserveOriginalDecision:(NSData *)decision
            forOriginalRequest:(NSData *)request error:(NSError **)error;
- (NSData *)copyOriginalDecisionForRequest:(NSData *)request error:(NSError **)error;
@end
