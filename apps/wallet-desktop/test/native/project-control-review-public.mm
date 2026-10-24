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
 NSData*principal=bytes(@"{\"CurrentRef\":\"PUBLIC-current\"}"),*command=bytes(request);NSString*network=[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0];NSMutableData*raw=[NSMutableData data];unsigned char count[4]={0,0,0,8};[raw appendBytes:count length:4];NSMutableData*chain=[NSMutableData dataWithLength:32];memset(chain.mutableBytes,0xaa,32);
 for(NSData*part in @[bytes(@"YNX-IDE-PROJECT-CONTROL-REQUEST/v1"),bytes(@"YNX-BATCH/v0.1"),bytes(@"ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"),bytes(@"IDE-PROJECT-CONTROL"),chain,bytes(@"PUBLIC-caller"),principal,command]){uint32_t n=(uint32_t)part.length;unsigned char len[4]={(unsigned char)(n>>24),(unsigned char)(n>>16),(unsigned char)(n>>8),(unsigned char)n};[raw appendBytes:len length:4];[raw appendData:part];}
 publicCapture=@{@"requestOriginal":raw,@"principalOriginal":principal,@"commandOriginal":command,@"expiresAtMs":[NSString stringWithFormat:@"%llu",(unsigned long long)end],@"review":@{@"reviewId":request,@"account":@"PUBLIC-owner",@"networkId":network,@"command":@{@"RequestID":request,@"ProjectID":@"PUBLIC-project"}}};sourceLive=YES;readStatus=addStatus=errSecSuccess;commitUnknown=corruptRead=NO;
}
int main(){@autoreleasepool{
 items=[NSMutableDictionary new];NSError*e=nil;capture(@"PUBLIC approve");auto first=[YNXOriginalProjectControlReview captureOriginal:&e];assert(first&&!e&&[first copyOriginalReview:&e]);
 assert([first selectOriginalDecision:@"PUBLIC approve" decision:@"approve" error:&e]);assert([[[first copyOriginalDecision:&e]objectForKey:@"phase"]isEqual:@"decision-retained"]);
 assert(![first selectOriginalDecision:@"PUBLIC approve" decision:@"approve" error:&e]);assert([[[first copyOriginalDecision:&e]objectForKey:@"decision"]isEqual:@"approve"]);assert([first close:&e]);
 capture(@"PUBLIC cancel");auto cancelled=[YNXOriginalProjectControlReview captureOriginal:&e];assert([cancelled selectOriginalDecision:@"PUBLIC cancel" decision:@"cancel" error:&e]);[cancelled retire];sourceLive=NO;assert([[[cancelled copyOriginalDecision:&e]objectForKey:@"phase"]isEqual:@"cancelled"]);assert([cancelled close:&e]);
 capture(@"PUBLIC changed");auto changed=[YNXOriginalProjectControlReview captureOriginal:&e];NSUInteger before=adds;capture(@"PUBLIC different original");assert(![changed assertCurrent:&e]);assert(![changed selectOriginalDecision:@"PUBLIC changed" decision:@"approve" error:&e]);assert(adds==before);
 capture(@"PUBLIC unknown readback");auto unknown=[YNXOriginalProjectControlReview captureOriginal:&e];readStatus=errSecInteractionNotAllowed;assert(![unknown selectOriginalDecision:@"PUBLIC unknown readback" decision:@"approve" error:&e]);assert(![unknown close:&e]);readStatus=errSecSuccess;assert([[[unknown copyOriginalDecision:&e]objectForKey:@"phase"]isEqual:@"decision-retained"]);assert([unknown close:&e]);
 capture(@"PUBLIC join pending");auto pending=[YNXOriginalProjectControlReview captureOriginal:&e];sourceJoinPending=YES;assert(![pending close:&e]);sourceJoinPending=NO;assert([pending close:&e]);
 capture(@"PUBLIC effect signed partial");auto proofOwner=[YNXOriginalProjectControlReview captureOriginal:&e];assert([proofOwner selectOriginalDecision:@"PUBLIC effect signed partial" decision:@"approve" error:&e]);NSDictionary*context=[proofOwner selectOriginalApprovalEffectForReview:@"PUBLIC effect signed partial" error:&e];assert(context&&!e);assert(![proofOwner selectOriginalApprovalEffectForReview:@"PUBLIC effect signed partial" error:&e]);
 // A PUBLIC effect seam only: member bytes below are not actual crypto.
 // Prepare before the deliberate second-selection refusal above poisoned
 // current; use a separate owner for the complete retention scenario.
 capture(@"PUBLIC complete effect");auto complete=[YNXOriginalProjectControlReview captureOriginal:&e];assert([complete selectOriginalDecision:@"PUBLIC complete effect" decision:@"approve" error:&e]);assert([complete selectOriginalApprovalEffectForReview:@"PUBLIC complete effect" error:&e]);
 NSDictionary*binding=@{@"networkId":[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0],@"owner":[@"0x" stringByPaddingToLength:42 withString:@"1" startingAtIndex:0],@"keyVersion":@"1",@"executionHeight":@"1",@"callerIdentity":@"PUBLIC-caller",@"sourceCurrentRef":@"PUBLIC-current"};assert([complete prepareOriginalApprovalInputForBinding:binding error:&e]);
 unsigned char member[]={1,2,3};NSData*envelope=[complete envelopeForOriginalMember:[NSData dataWithBytes:member length:3]error:&e];assert(envelope&&!e);
 // An otherwise canonical result from another registered owner/pair context
 // must not be admitted just because its network is the same.
 NSDictionary*completeCapture=publicCapture;NSMutableDictionary*foreignBinding=[binding mutableCopy];foreignBinding[@"owner"]=[@"0x" stringByPaddingToLength:42 withString:@"2" startingAtIndex:0];
 capture(@"PUBLIC foreign binding");auto foreign=[YNXOriginalProjectControlReview captureOriginal:&e];assert([foreign selectOriginalDecision:@"PUBLIC foreign binding" decision:@"approve" error:&e]);assert([foreign selectOriginalApprovalEffectForReview:@"PUBLIC foreign binding" error:&e]);assert([foreign prepareOriginalApprovalInputForBinding:binding error:&e]);
 NSData*foreignOriginal=[foreign envelopeForOriginalMember:[NSData dataWithBytes:member length:3]error:&e];NSMutableDictionary*foreignEnvelope=[[NSJSONSerialization JSONObjectWithData:foreignOriginal options:0 error:nil]mutableCopy];foreignEnvelope[@"binding"]=foreignBinding;NSData*foreignBytes=[NSJSONSerialization dataWithJSONObject:foreignEnvelope options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
 NSDictionary*wrong=@{@"requestOriginal":publicCapture[@"requestOriginal"],@"reviewId":@"PUBLIC foreign binding",@"decision":@"approve",@"envelopeOriginal":foreignBytes,@"effectEntered":@YES,@"hasSignedResult":@YES,@"resultStored":@NO,@"phase":@"signed",@"errorCode":NSNull.null,@"cleanupPending":@NO};assert(![foreign retainOriginalApprovalResult:wrong cause:nil error:&e]);assert(![[foreign copyOriginalDecision:&e][@"hasSignedResult"]boolValue]);assert(![foreign close:&e]);
 // Restore only the PUBLIC source fixture for the already captured complete
 // operation. This is not a Source reacquisition by production code.
 publicCapture=completeCapture;
 NSDictionary*effect=@{@"requestOriginal":publicCapture[@"requestOriginal"],@"reviewId":@"PUBLIC complete effect",@"decision":@"approve",@"envelopeOriginal":envelope,@"effectEntered":@YES,@"hasSignedResult":@YES,@"resultStored":@NO,@"phase":@"signed",@"errorCode":NSNull.null,@"cleanupPending":@NO};
 sourceLive=NO;[complete retire];NSError*callback=[NSError errorWithDomain:@"PUBLIC-late-error" code:23 userInfo:nil];assert(![complete retainOriginalApprovalResult:effect cause:callback error:&e]&&e==callback);NSDictionary*kept=[complete copyOriginalDecision:&e];assert([kept[@"hasSignedResult"]boolValue]&&[kept[@"resultStored"]boolValue]&&![kept[@"approved"]boolValue]);assert([[complete copyOriginalApprovalProof:&e]isEqual:envelope]);NSUInteger writes=adds;assert([complete retainOriginalApprovalResult:effect cause:nil error:&e]);assert(adds==writes);assert([complete close:&e]);
 capture(@"PUBLIC cancel effect refusal");auto noSign=[YNXOriginalProjectControlReview captureOriginal:&e];assert([noSign selectOriginalDecision:@"PUBLIC cancel effect refusal" decision:@"cancel" error:&e]);NSUInteger noWrites=adds;assert(![noSign selectOriginalApprovalEffectForReview:@"PUBLIC cancel effect refusal" error:&e]);assert(adds==noWrites);
 puts("{\"cases\":9,\"systemKeychainCalls\":0,\"SourceQualified\":false,\"signing\":false}");
}return 0;}
