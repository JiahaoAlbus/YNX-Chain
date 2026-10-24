#define main PublicJournalFixtureMain
#include "project-control-journal-public.mm"
#undef main
#import "../../native/original-project-control-review.h"
#import "original-auth-identity-source-authority.h"
static NSDictionary*publicCapture;static BOOL sourceLive=YES,sourceJoinPending=NO;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wincomplete-implementation"
@implementation YNXAuthIdentitySourceAuthority
+ (instancetype)acquireOriginalIDEProjectControlAuthoritySource:(NSError**)error {if(error)*error=nil;return [self new];}
- (NSDictionary*)copyOriginalIDEProjectControlCapture:(NSError**)error {if(error)*error=nil;return publicCapture;}
- (BOOL)assertCurrent:(NSError**)error {if(error)*error=nil;return sourceLive;}
- (void)retire {}
- (BOOL)join:(NSError**)error {if(error)*error=nil;return !sourceJoinPending;}
- (BOOL)close:(NSError**)error {if(error)*error=nil;return YES;}
@end
#pragma clang diagnostic pop
static void capture(NSString*request){
 uint64_t end=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0)+20000;
 publicCapture=@{@"requestOriginal":bytes(request),@"principalOriginal":bytes(@"PUBLIC principal bytes, not Auth qualification"),@"commandOriginal":bytes(@"PUBLIC command bytes, not Go/codec proof"),@"expiresAtMs":[NSString stringWithFormat:@"%llu",(unsigned long long)end],@"review":@{@"reviewId":request,@"account":@"PUBLIC-owner",@"command":@{@"ProjectID":@"PUBLIC-project"}}};sourceLive=YES;readStatus=addStatus=errSecSuccess;commitUnknown=corruptRead=NO;
}
int main(){@autoreleasepool{
 items=[NSMutableDictionary new];NSError*e=nil;capture(@"PUBLIC approve");auto first=[YNXOriginalProjectControlReview captureOriginal:&e];assert(first&&!e&&[first copyOriginalReview:&e]);
 assert([first selectOriginalDecision:@"PUBLIC approve" decision:@"approve" error:&e]);assert([[[first copyOriginalDecision:&e]objectForKey:@"phase"]isEqual:@"decision-retained"]);
 assert(![first selectOriginalDecision:@"PUBLIC approve" decision:@"approve" error:&e]);assert([[[first copyOriginalDecision:&e]objectForKey:@"decision"]isEqual:@"approve"]);assert([first close:&e]);
 capture(@"PUBLIC cancel");auto cancelled=[YNXOriginalProjectControlReview captureOriginal:&e];assert([cancelled selectOriginalDecision:@"PUBLIC cancel" decision:@"cancel" error:&e]);[cancelled retire];sourceLive=NO;assert([[[cancelled copyOriginalDecision:&e]objectForKey:@"phase"]isEqual:@"cancelled"]);assert([cancelled close:&e]);
 capture(@"PUBLIC changed");auto changed=[YNXOriginalProjectControlReview captureOriginal:&e];NSUInteger before=adds;capture(@"PUBLIC different original");assert(![changed assertCurrent:&e]);assert(![changed selectOriginalDecision:@"PUBLIC changed" decision:@"approve" error:&e]);assert(adds==before);
 capture(@"PUBLIC unknown readback");auto unknown=[YNXOriginalProjectControlReview captureOriginal:&e];readStatus=errSecInteractionNotAllowed;assert(![unknown selectOriginalDecision:@"PUBLIC unknown readback" decision:@"approve" error:&e]);assert(![unknown close:&e]);readStatus=errSecSuccess;assert([[[unknown copyOriginalDecision:&e]objectForKey:@"phase"]isEqual:@"decision-retained"]);assert([unknown close:&e]);
 capture(@"PUBLIC join pending");auto pending=[YNXOriginalProjectControlReview captureOriginal:&e];sourceJoinPending=YES;assert(![pending close:&e]);sourceJoinPending=NO;assert([pending close:&e]);
 puts("{\"cases\":5,\"systemKeychainCalls\":0,\"SourceQualified\":false,\"signing\":false}");
}return 0;}
