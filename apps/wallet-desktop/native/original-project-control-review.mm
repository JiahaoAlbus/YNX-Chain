#import "original-project-control-review.h"
#import "original-project-control-journal.h"
#import "original-auth-identity-source-authority.h"
#import <AppKit/AppKit.h>
#include <unistd.h>
#include <pthread.h>
#include <chrono>
// Auth-owned dedicated resource, not an arbitrary provider/signer. Exact
// snapshot: review (public UI DATA), requestOriginal, principalOriginal,
// commandOriginal (NSData), expiresAtMs (decimal NSString). The original
// request binding is stable across new reviews/nonce/capture attempts.
// These selectors are deliberately separate from artifact-release methods.
@interface YNXAuthIdentitySourceAuthority (WalletProjectControlCapture)
+ (instancetype)acquireOriginalIDEProjectControlAuthoritySource:(NSError **)error;
- (NSDictionary *)copyOriginalIDEProjectControlCapture:(NSError **)error;
@end
static BOOL ControlReviewFocused(){
#if defined(YNX_CONTROL_REVIEW_PUBLIC_TEST)
 return YES;
#else
 return NSRunningApplication.currentApplication.active;
#endif
}
static BOOL ControlReviewBytes(id value,NSUInteger maximum){return [value isKindOfClass:NSData.class]&&[value length]>0&&[value length]<=maximum;}
static NSDictionary*ControlReviewSnapshot(NSDictionary*input){
 if(![input isKindOfClass:NSDictionary.class]||input.count!=5||![input[@"review"]isKindOfClass:NSDictionary.class]||!ControlReviewBytes(input[@"requestOriginal"],65536)||!ControlReviewBytes(input[@"principalOriginal"],16384)||!ControlReviewBytes(input[@"commandOriginal"],16384)||![input[@"expiresAtMs"]isKindOfClass:NSString.class])return nil;
 NSError*error=nil;NSData*encoded=[NSPropertyListSerialization dataWithPropertyList:input format:NSPropertyListBinaryFormat_v1_0 options:0 error:&error];
 if(error||!encoded.length||encoded.length>131072)return nil;
 id result=[NSPropertyListSerialization propertyListWithData:encoded options:NSPropertyListImmutable format:nullptr error:&error];return error?nil:result;
}
@implementation YNXOriginalProjectControlReview {
 YNXAuthIdentitySourceAuthority*_source;NSDictionary*_capture,*_result;NSString*_decision;NSError*_first,*_storage;
 BOOL _checking,_selected,_retired,_busy,_stored,_closed;NSError*_cleanup;uint64_t _floor,_expires;std::chrono::steady_clock::time_point _deadline;
}
- (instancetype)initPrivate{return [super init];}
- (BOOL)refuse:(NSString*)message cause:(NSError*)cause error:(NSError**)error {if(!_first)_first=cause?:[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];if(error)*error=_first;return NO;}
- (BOOL)assertCurrent:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_checking||_retired||_first||!_source||!_capture||!pthread_main_np()||getuid()==0||getuid()!=geteuid()||!ControlReviewFocused())return [self refuse:@"CONTROL_ORIGINAL_CURRENT_REQUIRED" cause:nil error:error];
 _checking=YES;@try{
  uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);if(now<_floor||now>=_expires||std::chrono::steady_clock::now()>=_deadline)return [self refuse:@"CONTROL_EXPIRED" cause:nil error:error];
  NSError*e=nil;if(![_source assertCurrent:&e]||e)return [self refuse:@"CONTROL_SOURCE_CURRENT_REFUSED" cause:e error:error];
  NSDictionary*snapshot=ControlReviewSnapshot([_source copyOriginalIDEProjectControlCapture:&e]);if(e||!snapshot||![_capture isEqual:snapshot])return [self refuse:@"CONTROL_CAPTURE_CHANGED" cause:e error:error];
  uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);if(after<now||after>=_expires||_retired||std::chrono::steady_clock::now()>=_deadline||!ControlReviewFocused())return [self refuse:@"CONTROL_POST_CURRENT_REFUSED" cause:nil error:error];_floor=after;return YES;
 }@catch(NSException*){return [self refuse:@"CONTROL_CURRENT_UNKNOWN" cause:nil error:error];}@finally{_checking=NO;}
}}
+ (instancetype)captureOriginal:(NSError**)error {
 if(error)*error=nil;auto owner=[[self alloc]initPrivate];
 @try{
  if(!pthread_main_np()||getuid()==0||getuid()!=geteuid()||!ControlReviewFocused()){[owner refuse:@"CONTROL_ORIGINAL_ACTOR_REQUIRED" cause:nil error:error];return owner;}
  if(![YNXAuthIdentitySourceAuthority respondsToSelector:@selector(acquireOriginalIDEProjectControlAuthoritySource:)]){[owner refuse:@"CONTROL_DEDICATED_SOURCE_CALLEE_NOT_SUPPLIED" cause:nil error:error];return owner;}
  NSError*e=nil;owner->_source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEProjectControlAuthoritySource:&e];
  if(e||owner->_source.class!=YNXAuthIdentitySourceAuthority.class||![owner->_source respondsToSelector:@selector(copyOriginalIDEProjectControlCapture:)]){[owner refuse:@"CONTROL_DEDICATED_SOURCE_REQUIRED" cause:e error:error];return owner;}
  if(![owner->_source assertCurrent:&e]||e){[owner refuse:@"CONTROL_SOURCE_CURRENT_REFUSED" cause:e error:error];return owner;}
  owner->_capture=ControlReviewSnapshot([owner->_source copyOriginalIDEProjectControlCapture:&e]);
  if(e||!owner->_capture){[owner refuse:@"CONTROL_ORIGINAL_CAPTURE_REQUIRED" cause:e error:error];return owner;}
  NSString*expiry=owner->_capture[@"expiresAtMs"];NSScanner*scanner=[NSScanner scannerWithString:expiry];scanner.charactersToBeSkipped=nil;unsigned long long end=0;uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  if(![scanner scanUnsignedLongLong:&end]||!scanner.isAtEnd||![[NSString stringWithFormat:@"%llu",end]isEqual:expiry]||end<=now||end-now>30000){[owner refuse:@"CONTROL_CAPTURE_WINDOW_REQUIRED" cause:nil error:error];return owner;}
  owner->_floor=now;owner->_expires=end;owner->_deadline=std::chrono::steady_clock::now()+std::chrono::milliseconds(end-now);[owner assertCurrent:error];return owner;
 }@catch(NSException*){[owner refuse:@"CONTROL_CAPTURE_UNKNOWN" cause:nil error:error];return owner;}
}
- (NSDictionary*)copyOriginalReview:(NSError**)error {@synchronized(self){return [self assertCurrent:error]?_capture[@"review"]:nil;}}
- (BOOL)selectOriginalDecision:(NSString*)identifier decision:(NSString*)decision error:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_busy||_selected||![@[@"approve",@"reject",@"cancel"]containsObject:decision]||![_capture[@"review"][@"reviewId"]isEqual:identifier])return [self refuse:@"CONTROL_DECISION_ONCE_REFUSED" cause:nil error:error];
 _selected=YES;_decision=[decision copy];_busy=YES;
 @try{
  if(![self assertCurrent:error])return NO;
  NSDictionary*record=@{@"version":@"YNX-WALLET-CONTROL-CHOICE/v1",@"reviewId":identifier,@"decision":decision,@"dataOnly":@YES,@"approved":@NO};NSError*e=nil;
  NSData*data=[NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys error:&e];
  if(e||![[YNXOriginalProjectControlJournal new]reserveOriginalDecision:data forOriginalRequest:_capture[@"requestOriginal"] error:&e]){_storage=e;return [self refuse:@"CONTROL_CHOICE_STORAGE_UNKNOWN" cause:e error:error];}
  _stored=YES;
  // Only local consent is retained here. Protected purpose-specific signing
  // and Auth's accepted Source/custodian capture are separate owning CODE.
  // Never call artifact CABI or a generic signer to fill this gap.
  _result=@{@"reviewId":identifier,@"decision":decision,@"recorded":@YES,@"phase":[decision isEqual:@"cancel"]?@"cancelled":[decision isEqual:@"reject"]?@"rejected":@"decision-retained",@"approved":@NO,@"committed":@NO};return YES;
 }@catch(NSException*){return [self refuse:@"CONTROL_DECISION_UNKNOWN" cause:nil error:error];}@finally{_busy=NO;}
}}
- (NSDictionary*)copyOriginalDecision:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_busy||!_selected){[self refuse:@"CONTROL_ORIGINAL_DECISION_REQUIRED" cause:nil error:error];return nil;}
 // No current/sign/reacquire checks: locked/retired operations keep their
 // already held public result. No record means UNKNOWN, not not-selected.
 if(_result)return _result;
 // Reconcile the SAME create-only choice after uncertain add/readback. This
 // reads only; it cannot create, replace, approve or enter a signing effect.
 NSError*readError=nil;NSData*held=[[YNXOriginalProjectControlJournal new]copyOriginalDecisionForRequest:_capture[@"requestOriginal"]error:&readError];
 NSDictionary*expected=@{@"version":@"YNX-WALLET-CONTROL-CHOICE/v1",@"reviewId":_capture[@"review"][@"reviewId"],@"decision":_decision,@"dataOnly":@YES,@"approved":@NO};
 NSData*exact=[NSJSONSerialization dataWithJSONObject:expected options:NSJSONWritingSortedKeys error:nil];
 if(!readError&&[held isEqual:exact]){_stored=YES;_result=@{@"reviewId":_capture[@"review"][@"reviewId"],@"decision":_decision,@"recorded":@YES,@"phase":[_decision isEqual:@"cancel"]?@"cancelled":[_decision isEqual:@"reject"]?@"rejected":@"decision-retained",@"approved":@NO,@"committed":@NO};return _result;}
 return @{@"reviewId":_capture[@"review"][@"reviewId"],@"decision":_decision,@"recorded":@(_stored),@"phase":@"unknown",@"approved":@NO,@"committed":@NO};
}}
- (BOOL)saveOriginalLifecycle:(NSData*)input error:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_busy||!_capture||!ControlReviewBytes(input,65536))return [self refuse:@"CONTROL_LIFECYCLE_REQUIRED" cause:nil error:error];
 NSError*e=nil;NSDictionary*record=[NSJSONSerialization JSONObjectWithData:input options:0 error:&e];NSString*sequence=record[@"sequence"];
 if(e||![record isKindOfClass:NSDictionary.class]||![record[@"reviewId"]isEqual:_capture[@"review"][@"reviewId"]]||![record[@"account"]isEqual:_capture[@"review"][@"account"]]||![record[@"command"]isEqual:_capture[@"review"][@"command"]]||![record[@"dataOnly"]isEqual:@YES]||![record[@"approved"]isEqual:@NO]||![record[@"committed"]isEqual:@NO]||![record[@"retryAuthorized"]isEqual:@NO]||![sequence isKindOfClass:NSString.class]||sequence.length==0||sequence.length>16||[sequence rangeOfCharacterFromSet:NSCharacterSet.decimalDigitCharacterSet.invertedSet].location!=NSNotFound||[sequence hasPrefix:@"0"]){return [self refuse:@"CONTROL_LIFECYCLE_BINDING_REFUSED" cause:e error:error];}
 NSMutableData*identity=[_capture[@"requestOriginal"]mutableCopy];[identity appendData:[[@"\nLOCAL-LIFECYCLE:" stringByAppendingString:sequence]dataUsingEncoding:NSUTF8StringEncoding]];
 return [[YNXOriginalProjectControlJournal new]reserveOriginalDecision:input forOriginalRequest:identity error:error];
}}
- (void)retire {@synchronized(self){if(_retired)return;_retired=YES;if(_source)[_source retire];}}
- (BOOL)close:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_closed)return YES;if(_busy||_checking)return NO;if(_selected&&!_stored){if(error)*error=[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:2 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_CHOICE_STORAGE_PENDING"}];return NO;}if(_cleanup){if(error)*error=_cleanup;return NO;}
 [self retire];if(!_source){_closed=YES;return YES;}NSError*e=nil;
 if(![_source join:&e]||e){if(error)*error=e;return NO;}
 if(![_source close:&e]||e){_cleanup=e?:[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:2 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_SOURCE_CLOSE_UNKNOWN"}];if(error)*error=_cleanup;return NO;}
 _closed=YES;_source=nil;return YES;
}}
@end
