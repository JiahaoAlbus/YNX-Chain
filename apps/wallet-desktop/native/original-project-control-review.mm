#import "original-project-control-review.h"
#import "original-project-control-journal.h"
#import "original-auth-identity-source-authority.h"
#import <AppKit/AppKit.h>
#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>
#include <unistd.h>
#include <pthread.h>
#include <chrono>
#include <cmath>
#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI)
#import "original-ide-project-control-custody.h"
#include "original-project-control-cabi.h"
#endif
// Auth-owned dedicated resource, not an arbitrary provider/signer. Exact
// snapshot: review (public UI DATA), requestOriginal, principalOriginal,
// commandOriginal (NSData), expiresAtMs (decimal NSString). The original
// request binding is stable across new reviews/nonce/capture attempts.
// These selectors are deliberately separate from artifact-release methods.
@interface YNXAuthIdentitySourceAuthority (WalletProjectControlCapture)
+ (instancetype)acquireOriginalIDEProjectControlAuthoritySource:(NSError **)error;
- (NSDictionary *)copyOriginalIDEProjectControlCapture:(NSError **)error;
@end
static NSString*ControlSHA(NSData*data){unsigned char hash[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data.bytes,(CC_LONG)data.length,hash);NSMutableString*out=[NSMutableString stringWithCapacity:64];for(unsigned char b:hash)[out appendFormat:@"%02x",b];return out;}
static BOOL ControlKeys(NSDictionary*d,NSArray*keys){if(![d isKindOfClass:NSDictionary.class]||d.count!=keys.count)return NO;for(NSString*k in keys)if(!d[k])return NO;return YES;}
static BOOL ControlBool(id value){return value&&CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID();}
static BOOL ControlText(id value,NSUInteger max){if(![value isKindOfClass:NSString.class]||![value length]||[[value dataUsingEncoding:NSUTF8StringEncoding]length]>max)return NO;for(NSUInteger i=0;i<[value length];i++){unichar c=[value characterAtIndex:i];if(c<=32||c==127)return NO;}return YES;}
static BOOL ControlHex(id value,NSUInteger size){return [value isKindOfClass:NSString.class]&&[value length]==size&&[value rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"].invertedSet].location==NSNotFound;}
static BOOL ControlDecimal(id value,BOOL positive){if(![value isKindOfClass:NSString.class]||![value length]||[value length]>20||([value length]>1&&[value hasPrefix:@"0"]))return NO;NSScanner*s=[NSScanner scannerWithString:value];s.charactersToBeSkipped=nil;unsigned long long number=0;return [s scanUnsignedLongLong:&number]&&s.isAtEnd&&(!positive||number>0)&&[[NSString stringWithFormat:@"%llu",number]isEqual:value];}
static NSData*ControlCanonical(NSDictionary*value){return [NSJSONSerialization isValidJSONObject:value]?[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil]:nil;}
static NSData*ControlBase64URL(NSString*value,NSUInteger limit){
 if(![value isKindOfClass:NSString.class]||!value.length||value.length>(limit*4+2)/3||[value rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"].invertedSet].location!=NSNotFound)return nil;
 NSString*s=[[value stringByReplacingOccurrencesOfString:@"-" withString:@"+"]stringByReplacingOccurrencesOfString:@"_" withString:@"/"];while(s.length%4)s=[s stringByAppendingString:@"="];NSData*b=[[NSData alloc]initWithBase64EncodedString:s options:0];if(!b.length||b.length>limit)return nil;
 NSString*again=[[[[b base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"]stringByReplacingOccurrencesOfString:@"=" withString:@""];return [again isEqual:value]?b:nil;
}
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
 BOOL _effectSelected,_effectEntered,_hasSignedResult,_effectStored,_outcomeStored,_cleanupPending;NSData*_proof,*_outcomeOriginal;NSError*_effectCause;
 NSString*_nonce,*_confirmationRef,*_revocationRef;uint64_t _effectIssued;
 NSDictionary*_signingBinding;NSData*_decisionOriginal;
#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI)
 YNXAuthOriginalProjectControlCustody*_controlCustody;BOOL _controlBorrowSelected,_controlBorrowCompleted,_controlCustodyClosed;
 NSData*_cleanupReceiptOriginal,*_unknownOriginal;BOOL _cleanupReceiptStored,_unknownStored;
#endif
}
- (instancetype)initPrivate{return [super init];}
- (BOOL)refuse:(NSString*)message cause:(NSError*)cause error:(NSError**)error {if(!_first)_first=cause?:[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];if(error)*error=_first;return NO;}
- (NSDictionary*)decisionState:(NSString*)phase {return @{@"reviewId":_capture[@"review"][@"reviewId"],@"decision":_decision,@"recorded":@(_stored),@"phase":phase,@"effectSelected":@(_effectSelected),@"effectEntered":@(_effectEntered),@"hasSignedResult":@(_hasSignedResult),@"resultStored":@(_outcomeStored),@"producerResultStored":@(_effectStored),@"cleanupPending":@(_cleanupPending),@"approved":@NO,@"committed":@NO};}
- (BOOL)acceptOriginalEnvelope:(NSData*)data {
 NSError*e=nil;NSDictionary*envelope=[NSJSONSerialization JSONObjectWithData:data options:0 error:&e];
 if(e||!ControlKeys(envelope,@[@"version",@"binding",@"principalOriginal",@"commandOriginal",@"decisionOriginal",@"memberOriginal"])||![envelope[@"version"]isEqual:@"YNX-IDE-PROJECT-CONTROL-APPROVAL/v1"]||![ControlCanonical(envelope)isEqual:data])return NO;
 NSString*principal=[[NSString alloc]initWithData:_capture[@"principalOriginal"]encoding:NSUTF8StringEncoding],*command=[[NSString alloc]initWithData:_capture[@"commandOriginal"]encoding:NSUTF8StringEncoding];
 if(!principal||!command||![envelope[@"principalOriginal"]isEqual:principal]||![envelope[@"commandOriginal"]isEqual:command]||!ControlBase64URL(envelope[@"memberOriginal"],262144))return NO;
 NSString*raw=envelope[@"decisionOriginal"];if(![raw isKindOfClass:NSString.class])return NO;NSData*decisionBytes=[raw dataUsingEncoding:NSUTF8StringEncoding];if(!_decisionOriginal||![decisionBytes isEqual:_decisionOriginal])return NO;NSDictionary*d=[NSJSONSerialization JSONObjectWithData:decisionBytes options:0 error:&e];
 if(e||!ControlKeys(d,@[@"version",@"decision",@"requestId",@"principalSHA256",@"commandSHA256",@"reviewId",@"nonce",@"confirmationRef",@"revocationRef",@"issuedAtMs",@"expiresAtMs"])||![ControlCanonical(d)isEqual:decisionBytes]||![d[@"version"]isEqual:@"YNX-IDE-PROJECT-CONTROL-DECISION/v1"]||![d[@"decision"]isEqual:@"approve"]||![d[@"reviewId"]isEqual:_capture[@"review"][@"reviewId"]]||![d[@"requestId"]isEqual:_capture[@"review"][@"command"][@"RequestID"]]||![d[@"principalSHA256"]isEqual:ControlSHA(_capture[@"principalOriginal"])]||![d[@"commandSHA256"]isEqual:ControlSHA(_capture[@"commandOriginal"])])return NO;
 NSData*nonce=ControlBase64URL(d[@"nonce"],32);if(nonce.length!=32)return NO;BOOL nonzero=NO;for(NSUInteger i=0;i<nonce.length;i++)nonzero|=((const unsigned char*)nonce.bytes)[i]!=0;if(!nonzero)return NO;
 if(![d[@"nonce"]isEqual:_nonce]||![d[@"confirmationRef"]isEqual:_confirmationRef]||![d[@"revocationRef"]isEqual:_revocationRef])return NO;
 if(![d[@"issuedAtMs"]isKindOfClass:NSNumber.class]||ControlBool(d[@"issuedAtMs"])||![d[@"expiresAtMs"]isKindOfClass:NSNumber.class]||ControlBool(d[@"expiresAtMs"]))return NO;
 double issued=[d[@"issuedAtMs"]doubleValue],expires=[d[@"expiresAtMs"]doubleValue];if(!std::isfinite(issued)||!std::isfinite(expires)||issued!=_effectIssued||expires!=std::floor(expires)||expires>9007199254740991.0||expires<=issued||expires-issued>30000||expires>_expires)return NO;
 NSDictionary*b=envelope[@"binding"];return _signingBinding&&ControlKeys(b,@[@"networkId",@"owner",@"keyVersion",@"executionHeight",@"callerIdentity",@"sourceCurrentRef"])&&[b isEqual:_signingBinding];
}
- (BOOL)adoptOriginalEffect:(NSDictionary*)value error:(NSError**)error {
 if(!ControlKeys(value,@[@"requestOriginal",@"reviewId",@"decision",@"envelopeOriginal",@"effectEntered",@"hasSignedResult",@"resultStored",@"phase",@"errorCode",@"cleanupPending"])||![value[@"requestOriginal"]isEqual:_capture[@"requestOriginal"]]||![value[@"reviewId"]isEqual:_capture[@"review"][@"reviewId"]]||![value[@"decision"]isEqual:@"approve"]||!ControlBool(value[@"effectEntered"])||!ControlBool(value[@"hasSignedResult"])||!ControlBool(value[@"resultStored"])||!ControlBool(value[@"cleanupPending"])||![@[@"signed",@"unknown",@"failed"]containsObject:value[@"phase"]]||(value[@"errorCode"]!=NSNull.null&&(![value[@"errorCode"]isKindOfClass:NSString.class]||![value[@"errorCode"]length]||[value[@"errorCode"]length]>256)))return [self refuse:@"CONTROL_EFFECT_ORIGINAL_BINDING_REFUSED" cause:nil error:error];
 // Capture returned public bytes BEFORE any foreign/current/error boundary.
 id envelope=value[@"envelopeOriginal"];if(envelope!=NSNull.null){if(!ControlReviewBytes(envelope,393216)||(_proof&&![_proof isEqual:envelope]))return [self refuse:@"CONTROL_EFFECT_RESULT_CHANGED" cause:nil error:error];if(!_proof)_proof=[NSData dataWithBytes:[envelope bytes]length:[envelope length]];}
 BOOL signedResult=[value[@"hasSignedResult"]boolValue],entered=[value[@"effectEntered"]boolValue],stored=[value[@"resultStored"]boolValue];
 if((_hasSignedResult&&!signedResult)||(_effectEntered&&!entered)||(_effectStored&&!stored)||signedResult&&(!entered||!_proof||![self acceptOriginalEnvelope:_proof])||signedResult&&[value[@"phase"]isEqual:@"failed"]||[value[@"phase"]isEqual:@"signed"]&&!signedResult)return [self refuse:@"CONTROL_EFFECT_OUTCOME_REFUSED" cause:nil error:error];
 _effectEntered=entered;_hasSignedResult=signedResult;_effectStored=stored;_cleanupPending=[value[@"cleanupPending"]boolValue];
 if(_outcomeOriginal)return [self saveOriginalApprovalResult:error];
 _result=[self decisionState:signedResult?@"approval-proof-retained":[value[@"phase"]isEqual:@"failed"]?@"approval-failed":@"approval-outcome-unknown"];
 if(signedResult||[value[@"phase"]isEqual:@"failed"]){NSDictionary*record=@{@"version":@"YNX-WALLET-CONTROL-OUTCOME/v1",@"requestOriginal":_capture[@"requestOriginal"],@"status":_result,@"envelopeOriginal":_proof?:[NSData data],@"producerPhase":value[@"phase"],@"producerErrorCode":value[@"errorCode"]==NSNull.null?@"":value[@"errorCode"]};NSError*e=nil;NSData*data=[NSPropertyListSerialization dataWithPropertyList:record format:NSPropertyListBinaryFormat_v1_0 options:0 error:&e];if(e||!data||(_outcomeOriginal&&![_outcomeOriginal isEqual:data]))return [self refuse:@"CONTROL_EFFECT_STORAGE_BODY_UNKNOWN" cause:e error:error];if(!_outcomeOriginal)_outcomeOriginal=data;return [self saveOriginalApprovalResult:error];}
 return YES;
}
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
  _result=[self decisionState:[decision isEqual:@"cancel"]?@"cancelled":[decision isEqual:@"reject"]?@"rejected":@"decision-retained"];return YES;
 }@catch(NSException*){return [self refuse:@"CONTROL_DECISION_UNKNOWN" cause:nil error:error];}@finally{_busy=NO;}
}}
- (NSDictionary*)selectOriginalApprovalEffectForReview:(NSString*)identifier error:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_busy||_effectSelected||!_selected||!_stored||![_decision isEqual:@"approve"]||![_capture[@"review"][@"reviewId"]isEqual:identifier]){[self refuse:@"CONTROL_EFFECT_ONCE_REFUSED" cause:nil error:error];return nil;}
 _effectSelected=YES;_busy=YES;_result=[self decisionState:@"approval-outcome-unknown"];
 @try{
  if(![self assertCurrent:error])return nil;
  unsigned char nonce[32];if(SecRandomCopyBytes(kSecRandomDefault,sizeof(nonce),nonce)!=errSecSuccess){[self refuse:@"CONTROL_NONCE_UNAVAILABLE" cause:nil error:error];return nil;}
  NSData*nonceBytes=[NSData dataWithBytes:nonce length:sizeof(nonce)];_nonce=[[[[nonceBytes base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"]stringByReplacingOccurrencesOfString:@"=" withString:@""];
  _confirmationRef=NSUUID.UUID.UUIDString.lowercaseString;_revocationRef=NSUUID.UUID.UUIDString.lowercaseString;_effectIssued=_floor;
  NSDictionary*intent=@{@"version":@"YNX-WALLET-CONTROL-EFFECT-INTENT/v1",@"reviewId":identifier,@"requestSHA256":ControlSHA(_capture[@"requestOriginal"]),@"nonce":_nonce,@"confirmationRef":_confirmationRef,@"revocationRef":_revocationRef,@"issuedAtMs":@(_effectIssued),@"expiresAtMs":@(_expires)};
  NSData*key=[[@"YNX-CONTROL-EFFECT-INTENT/v1:" stringByAppendingString:ControlSHA(_capture[@"requestOriginal"])]dataUsingEncoding:NSUTF8StringEncoding];NSError*e=nil;
  if(![[YNXOriginalProjectControlJournal new]reserveOriginalDecision:ControlCanonical(intent) forOriginalRequest:key error:&e]){_storage=e;[self refuse:@"CONTROL_EFFECT_INTENT_STORAGE_UNKNOWN" cause:e error:error];return nil;}
  if(![self assertCurrent:error])return nil;
  return @{@"capture":_capture,@"reviewId":identifier,@"nonce":_nonce,@"confirmationRef":_confirmationRef,@"revocationRef":_revocationRef,@"issuedAtMs":@(_effectIssued),@"expiresAtMs":@(_expires)};
 }@catch(NSException*){[self refuse:@"CONTROL_EFFECT_SELECTION_UNKNOWN" cause:nil error:error];return nil;}@finally{_busy=NO;}
}}
- (BOOL)signOriginalApproval:(NSError**)error {@synchronized(self){
#if !defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI)
 return [self refuse:@"CONTROL_MATCHED_FIXED_CABI_REQUIRED" cause:nil error:error];
#else
 if(error)*error=nil;
 // Consume the SAME durable effect intent before Source custody acquisition.
 // No external descriptor, callback, key or purpose is accepted by this entry.
 if(![self selectOriginalApprovalEffectForReview:_capture[@"review"][@"reviewId"]error:error])return NO;
 NSMutableData*record=nil;NSError*cause=nil,*cleanupCause=nil;BOOL invoked=NO,returned=NO,retained=NO;NSData*envelope=nil;uint32_t logicalCleanup=YNX_CONTROL_CLEANUP_UNKNOWN_V1;int32_t status=YNX_CONTROL_INTERNAL_V1;
 @try{
  do{
   NSDictionary*context=[_source copyOriginalIDEProjectControlSigningContext:&cause];
   if(cause||!ControlKeys(context,@[@"networkId",@"owner",@"keyVersion",@"executionHeight",@"callerIdentity",@"sourceCurrentRef",@"pkA",@"pkB",@"keychainAccount",@"expiresAtMs"])||!ControlReviewBytes(context[@"pkA"],2592)||[context[@"pkA"]length]!=2592||!ControlReviewBytes(context[@"pkB"],64)||[context[@"pkB"]length]!=64||!ControlHex(context[@"keychainAccount"],64)||!ControlDecimal(context[@"expiresAtMs"],YES)||[context[@"expiresAtMs"]longLongValue]>(long long)_expires||[context[@"expiresAtMs"]longLongValue]<=(long long)_floor)break;
   _expires=std::min(_expires,(uint64_t)[context[@"expiresAtMs"]longLongValue]);
   NSMutableDictionary*binding=[NSMutableDictionary new];for(NSString*k in @[@"networkId",@"owner",@"keyVersion",@"executionHeight",@"callerIdentity",@"sourceCurrentRef"])binding[k]=context[k];
   NSDictionary*input=[self prepareOriginalApprovalInputForBinding:binding error:&cause];if(!input||cause)break;
   // Retain the actual cleanup partial BEFORE inspecting NSError. Never
   // reacquire a replacement Source/custody to repair refusal or unknown.
   _controlCustody=[YNXAuthOriginalProjectControlCustody acquireForOriginalSource:_source error:&cause];_cleanupPending=_controlCustody!=nil;
   if(cause||_controlCustody.class!=YNXAuthOriginalProjectControlCustody.class)break;
   NSMutableDictionary*expectedContext=[binding mutableCopy];expectedContext[@"pkA"]=context[@"pkA"];expectedContext[@"pkB"]=context[@"pkB"];
   NSDictionary*held=[_controlCustody copyOriginalExpectedBinding:&cause];
   if(cause||![held isEqual:expectedContext]||![_controlCustody assertOriginalCurrent:&cause]||cause||![self assertCurrent:&cause])break;
   _controlBorrowSelected=YES;record=[_controlCustody borrowOriginalControlRecord:&cause]; // adopt actual mutable borrow even on error
   if(cause||![record isKindOfClass:NSMutableData.class]||![_controlCustody assertOriginalCurrent:&cause]||cause||![self assertCurrent:&cause])break;
   // Re-observe the SAME immutable public context after the protected read.
   NSDictionary*post=[_controlCustody copyOriginalExpectedBinding:&cause];if(cause||![expectedContext isEqual:post])break;
   NSDictionary*postSource=[_source copyOriginalIDEProjectControlSigningContext:&cause];if(cause||![context isEqual:postSource])break;
   input=[self prepareOriginalApprovalInputForBinding:binding error:&cause];if(!input||cause)break;
   NSMutableData*network=[NSMutableData dataWithLength:32];for(unsigned i=0;i<32;i++){unsigned byte=0;NSScanner*s=[NSScanner scannerWithString:[context[@"networkId"]substringWithRange:NSMakeRange(i*2,2)]];[s scanHexInt:&byte];((uint8_t*)network.mutableBytes)[i]=(uint8_t)byte;}
   NSMutableArray<NSData*>*strings=[NSMutableArray new];for(NSString*k in @[@"owner",@"keyVersion",@"executionHeight",@"callerIdentity",@"sourceCurrentRef"])[strings addObject:[context[k]dataUsingEncoding:NSUTF8StringEncoding]];
   const auto bytes=[](NSData*b)->YNXProjectControlBytesV1{return{(const uint8_t*)b.bytes,b.length};};
   YNXProjectControlExpectedV1 expected{bytes(network),bytes(strings[0]),bytes(strings[1]),bytes(strings[2]),bytes(strings[3]),bytes(strings[4]),bytes(context[@"pkA"]),bytes(context[@"pkB"])};
   _busy=YES;_effectEntered=YES;_result=[self decisionState:@"approval-outcome-unknown"];
   auto outcome=ynx_wallet_private::invokeOriginalProjectControlCABI(record,input[@"principalOriginal"],input[@"commandOriginal"],input[@"decisionOriginal"],expected,[input[@"observedAtMs"]unsignedLongLongValue]);
   returned=YES;invoked=outcome.invoked;status=outcome.status;logicalCleanup=outcome.cleanup;
   if(outcome.member)envelope=[self envelopeForOriginalMember:outcome.member error:&cause];
   if(!envelope&&!cause)cause=[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:status userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_FIXED_CABI_OUTCOME_NOT_SIGNED"}];
  }while(false);
  if(!envelope&&!cause)cause=[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_ORIGINAL_CUSTODY_OR_CONTEXT_REFUSED"}];
 }@catch(NSException*){if(!cause)cause=[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_EFFECT_EXCEPTION_UNKNOWN"}];}
 @finally{
  _busy=NO;
  // Public result is adopted and saved BEFORE any foreign completion, current
  // or close callback. Returned bytes and error are separate retained facts.
  NSString*phase=envelope?@"signed":!_effectEntered||returned&&(!invoked||logicalCleanup==YNX_CONTROL_CLEANUP_NOT_REQUIRED_V1&&status>=YNX_CONTROL_INVALID_ARGUMENT_V1&&status<=YNX_CONTROL_KEY_MATERIAL_V1)?@"failed":@"unknown";
  NSString*errorCode=cause?[NSString stringWithFormat:@"NATIVE:%@:%ld;CABI:%d:%u:%d",ControlSHA([cause.domain dataUsingEncoding:NSUTF8StringEncoding]),(long)cause.code,status,logicalCleanup,invoked]:nil;
  NSDictionary*out=@{@"requestOriginal":_capture[@"requestOriginal"],@"reviewId":_capture[@"review"][@"reviewId"],@"decision":@"approve",@"envelopeOriginal":envelope?:NSNull.null,@"effectEntered":@(_effectEntered),@"hasSignedResult":@(envelope!=nil),@"resultStored":@NO,@"phase":phase,@"errorCode":errorCode?:NSNull.null,@"cleanupPending":@(_cleanupPending)};
  @try{NSError*saveCause=nil;retained=[self adoptOriginalEffect:out error:&saveCause];if(!cause)cause=saveCause;}@catch(NSException*){if(!cause)cause=[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_RESULT_RETENTION_EXCEPTION_UNKNOWN"}];}
  if([phase isEqual:@"unknown"]){@try{
   // The durable once intent fences re-entry; this separate observation also
   // retains exact public ABI status/cleanup on cold UNKNOWN recovery. A
   // later definite result has its own slot, never overwrites this record.
   NSDictionary*observation=@{@"version":@"YNX-WALLET-CONTROL-UNKNOWN/v1",@"requestOriginal":_capture[@"requestOriginal"],@"reviewId":_capture[@"review"][@"reviewId"],@"status":_result,@"cabiReturned":@(returned),@"cabiInvoked":@(invoked),@"cabiStatus":[NSString stringWithFormat:@"%d",status],@"cabiCleanup":[NSString stringWithFormat:@"%u",logicalCleanup],@"nativeErrorCode":errorCode?:@""};
   _unknownOriginal=[NSPropertyListSerialization dataWithPropertyList:observation format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil];NSError*saved=nil;if(![self saveOriginalApprovalResult:&saved]&&!cause)cause=saved;
  }@catch(NSException*){if(!cause)cause=[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_UNKNOWN_OBSERVATION_SAVE_UNKNOWN"}];}}
  // Post-effect current/foreground failure must be returned, but only AFTER
  // the original proof has been captured and saved. It never authorizes a
  // replacement signature or erases already produced public result bytes.
  if(envelope&&retained){@try{NSError*postCause=nil;if(![_controlCustody assertOriginalCurrent:&postCause]||postCause||![self assertCurrent:&postCause]||postCause){if(!cause)cause=postCause?:[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_POST_EFFECT_CURRENT_REFUSED"}];}}@catch(NSException*){if(!cause)cause=[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_POST_EFFECT_CURRENT_UNKNOWN"}];}}
  // The adapter already wiped normal/exception returns; also wipe a partial
  // borrow refused BEFORE CABI. The SAME owner's completion never signs.
  @try{if([record isKindOfClass:NSMutableData.class])[record resetBytesInRange:NSMakeRange(0,record.length)];if(_controlBorrowSelected)_controlBorrowCompleted=[_controlCustody completeOriginalControlBorrow:&cleanupCause]&&!cleanupCause;
   if(_controlCustody&&(!_controlBorrowSelected||_controlBorrowCompleted)){[_controlCustody retire];if([_controlCustody join:&cleanupCause]&&!cleanupCause)_controlCustodyClosed=[_controlCustody close:&cleanupCause]&&!cleanupCause;}
  }@catch(NSException*){cleanupCause=[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_CUSTODY_CLEANUP_UNKNOWN"}];}
  BOOL cryptoCleanupKnown=!_effectEntered||returned&&(!invoked||logicalCleanup==YNX_CONTROL_CLEANUP_NOT_REQUIRED_V1||logicalCleanup==YNX_CONTROL_CLEANUP_LOGICAL_COMPLETE_V1);
  if(_controlCustody&&_controlCustodyClosed&&(!_controlBorrowSelected||_controlBorrowCompleted)&&cryptoCleanupKnown&&!cleanupCause){
   // Separate append-only cleanup receipt: never rewrite the signed outcome
   // which was already saved while cleanup was still pending.
   _cleanupReceiptOriginal=ControlCanonical(@{@"version":@"YNX-WALLET-CONTROL-CLEANUP/v1",@"requestSHA256":ControlSHA(_capture[@"requestOriginal"]),@"reviewId":_capture[@"review"][@"reviewId"],@"outcomeSHA256":_outcomeOriginal?ControlSHA(_outcomeOriginal):@"",@"observationSHA256":_unknownOriginal?ControlSHA(_unknownOriginal):@"",@"borrowSelected":@(_controlBorrowSelected),@"borrowCompleted":@(_controlBorrowCompleted),@"custodyClosed":@YES,@"cryptoCleanupKnown":@YES,@"cryptoCleanupStatus":[NSString stringWithFormat:@"%u",logicalCleanup],@"nativeErrorDomainSHA256":cause?ControlSHA([cause.domain dataUsingEncoding:NSUTF8StringEncoding]):@"",@"nativeErrorStatus":cause?[NSString stringWithFormat:@"%ld",(long)cause.code]:@""});
   // A failed/unknown outcome save is NOT an automatic second write attempt.
   // Keep the cleanup receipt in memory for the explicit save-original route.
   if(_outcomeStored||_unknownStored){NSError*saved=nil;if(![self saveOriginalApprovalResult:&saved]&&!cause)cause=saved;}
  }
  if(cleanupCause){_cleanup=cleanupCause;_cleanupPending=YES;}if(cause){_effectCause=cause;if(!_first)_first=cause;}
 }
 if(!retained||cause||_cleanupPending){if(error)*error=_first?:_cleanup?:[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:1 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_APPROVAL_OUTCOME_UNKNOWN"}];return NO;}return _hasSignedResult;
#endif
}}
- (BOOL)retainOriginalApprovalResult:(NSDictionary*)result cause:(NSError*)cause error:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(!_effectSelected||_busy)return [self refuse:@"CONTROL_ORIGINAL_EFFECT_REQUIRED" cause:nil error:error];
 // Dedicated CABI caller adopts returned public output BEFORE considering
 // NSError/post-current/foreground. Retired requests may retain, never sign.
 NSError*prior=_first;BOOL retained=[self adoptOriginalEffect:result error:error];
 if(cause){_effectCause=cause;if(!prior)_first=cause;if(error)*error=_first;return NO;}return retained;
}}
- (NSDictionary*)prepareOriginalApprovalInputForBinding:(NSDictionary*)input error:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(!_effectSelected||!_nonce||_busy||![self assertCurrent:error])return nil;
 if(!ControlKeys(input,@[@"networkId",@"owner",@"keyVersion",@"executionHeight",@"callerIdentity",@"sourceCurrentRef"])||!ControlHex(input[@"networkId"],64)||![input[@"networkId"]isEqual:_capture[@"review"][@"networkId"]]||![input[@"owner"]isKindOfClass:NSString.class]||[input[@"owner"]length]!=42||![input[@"owner"]hasPrefix:@"0x"]||!ControlHex([input[@"owner"]substringFromIndex:2],40)||!ControlDecimal(input[@"keyVersion"],YES)||!ControlDecimal(input[@"executionHeight"],NO)||!ControlText(input[@"callerIdentity"],256)||!ControlText(input[@"sourceCurrentRef"],256)||(_signingBinding&&![_signingBinding isEqual:input])){[self refuse:@"CONTROL_ORIGINAL_SIGNING_BINDING_REFUSED" cause:nil error:error];return nil;}
 NSError*e=nil;NSDictionary*principal=[NSJSONSerialization JSONObjectWithData:_capture[@"principalOriginal"]options:0 error:&e];if(e||![principal isKindOfClass:NSDictionary.class]||![principal[@"CurrentRef"]isEqual:input[@"sourceCurrentRef"]]){[self refuse:@"CONTROL_PRINCIPAL_CURRENT_REF_CHANGED" cause:e error:error];return nil;}
 // Compare the actual caller and network in the immutable original E8 request.
 NSData*request=_capture[@"requestOriginal"];const auto*p=(const uint8_t*)request.bytes;size_t at=0;auto take32=[&](uint32_t&n){if(request.length-at<4)return false;n=0;for(unsigned i=0;i<4;i++)n=(n<<8)|p[at++];return true;};uint32_t count=0;if(!take32(count)||count!=8){[self refuse:@"CONTROL_ORIGINAL_REQUEST_FRAME_REFUSED" cause:nil error:error];return nil;}
 NSData*network=nil,*caller=nil;for(unsigned i=0;i<8;i++){uint32_t n=0;if(!take32(n)||n>request.length-at){[self refuse:@"CONTROL_ORIGINAL_REQUEST_FRAME_REFUSED" cause:nil error:error];return nil;}if(i==4)network=[NSData dataWithBytes:p+at length:n];if(i==5)caller=[NSData dataWithBytes:p+at length:n];at+=n;}
 NSMutableData*expectedNetwork=[NSMutableData dataWithLength:32];NSString*hex=input[@"networkId"];for(unsigned i=0;i<32;i++){unsigned byte=0;NSScanner*s=[NSScanner scannerWithString:[hex substringWithRange:NSMakeRange(i*2,2)]];[s scanHexInt:&byte];((uint8_t*)expectedNetwork.mutableBytes)[i]=(uint8_t)byte;}
 if(at!=request.length||![network isEqual:expectedNetwork]||![caller isEqual:[input[@"callerIdentity"]dataUsingEncoding:NSUTF8StringEncoding]]){[self refuse:@"CONTROL_CAPTURE_CALLER_CHANGED" cause:nil error:error];return nil;}
 if(!_signingBinding){_signingBinding=[input copy];NSDictionary*d=@{@"version":@"YNX-IDE-PROJECT-CONTROL-DECISION/v1",@"decision":@"approve",@"requestId":_capture[@"review"][@"command"][@"RequestID"],@"principalSHA256":ControlSHA(_capture[@"principalOriginal"]),@"commandSHA256":ControlSHA(_capture[@"commandOriginal"]),@"reviewId":_capture[@"review"][@"reviewId"],@"nonce":_nonce,@"confirmationRef":_confirmationRef,@"revocationRef":_revocationRef,@"issuedAtMs":@(_effectIssued),@"expiresAtMs":@(_expires)};_decisionOriginal=ControlCanonical(d);}
 if(!_decisionOriginal||![self assertCurrent:error])return nil;
 return @{@"principalOriginal":_capture[@"principalOriginal"],@"commandOriginal":_capture[@"commandOriginal"],@"decisionOriginal":_decisionOriginal,@"binding":_signingBinding,@"observedAtMs":@(_floor)};
}}
- (NSData*)envelopeForOriginalMember:(NSData*)member error:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(!_effectSelected||!_signingBinding||!_decisionOriginal||!ControlReviewBytes(member,98304)){[self refuse:@"CONTROL_ORIGINAL_MEMBER_REQUIRED" cause:nil error:error];return nil;}
 NSString*principal=[[NSString alloc]initWithData:_capture[@"principalOriginal"]encoding:NSUTF8StringEncoding],*command=[[NSString alloc]initWithData:_capture[@"commandOriginal"]encoding:NSUTF8StringEncoding],*decision=[[NSString alloc]initWithData:_decisionOriginal encoding:NSUTF8StringEncoding];if(!principal||!command||!decision)return nil;
 NSString*encoded=[[[[member base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"]stringByReplacingOccurrencesOfString:@"=" withString:@""];
 return ControlCanonical(@{@"version":@"YNX-IDE-PROJECT-CONTROL-APPROVAL/v1",@"binding":_signingBinding,@"principalOriginal":principal,@"commandOriginal":command,@"decisionOriginal":decision,@"memberOriginal":encoded});
}}
- (BOOL)saveOriginalApprovalResult:(NSError**)error {@synchronized(self){
 if(error)*error=nil;
 auto journal=[YNXOriginalProjectControlJournal new];NSError*e=nil;
#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI)
 if(!_outcomeOriginal&&_unknownOriginal){NSData*unknownKey=[[@"YNX-CONTROL-EFFECT-UNKNOWN/v1:" stringByAppendingString:ControlSHA(_capture[@"requestOriginal"])]dataUsingEncoding:NSUTF8StringEncoding];BOOL saved=_unknownStored||[journal reserveOriginalDecision:_unknownOriginal forOriginalRequest:unknownKey error:&e];if(!saved){if(!_storage)_storage=e;NSError*readError=nil;NSData*existing=[journal copyOriginalDecisionForRequest:unknownKey error:&readError];saved=!readError&&[existing isEqual:_unknownOriginal];}if(!saved)return [self refuse:@"CONTROL_UNKNOWN_OBSERVATION_SAVE_UNKNOWN" cause:e error:error];_unknownStored=YES;}
 else
#endif
 {
 if(!_outcomeOriginal)return [self refuse:@"CONTROL_ORIGINAL_OUTCOME_REQUIRED" cause:nil error:error];
 NSData*key=[[@"YNX-CONTROL-EFFECT-OUTCOME/v1:" stringByAppendingString:ControlSHA(_capture[@"requestOriginal"])]dataUsingEncoding:NSUTF8StringEncoding];
 BOOL saved=_outcomeStored||[journal reserveOriginalDecision:_outcomeOriginal forOriginalRequest:key error:&e];
 if(!saved){if(!_storage)_storage=e;NSError*readError=nil;NSData*existing=[journal copyOriginalDecisionForRequest:key error:&readError];if(!readError&&[existing isEqual:_outcomeOriginal])saved=YES;}
 if(!saved){return [self refuse:@"CONTROL_APPROVAL_RESULT_SAVE_UNKNOWN" cause:e error:error];}
 _outcomeStored=YES;
 }
#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI)
 if(_cleanupReceiptOriginal&&!_cleanupReceiptStored){NSData*cleanupKey=[[@"YNX-CONTROL-EFFECT-CLEANUP/v1:" stringByAppendingString:ControlSHA(_capture[@"requestOriginal"])]dataUsingEncoding:NSUTF8StringEncoding];NSError*cleanupError=nil;BOOL cleanupSaved=[journal reserveOriginalDecision:_cleanupReceiptOriginal forOriginalRequest:cleanupKey error:&cleanupError];if(!cleanupSaved){NSError*readError=nil;NSData*existing=[journal copyOriginalDecisionForRequest:cleanupKey error:&readError];cleanupSaved=!readError&&[existing isEqual:_cleanupReceiptOriginal];}if(!cleanupSaved){_storage=cleanupError;return [self refuse:@"CONTROL_CLEANUP_RECEIPT_SAVE_UNKNOWN" cause:cleanupError error:error];}_cleanupReceiptStored=YES;_cleanupPending=NO;}
#endif
 _result=[self decisionState:_hasSignedResult?@"approval-proof-retained":_outcomeStored?@"approval-failed":@"approval-outcome-unknown"];return YES;
}}
- (NSData*)copyOriginalApprovalProof:(NSError**)error {@synchronized(self){if(error)*error=nil;if(!_hasSignedResult||!_proof){[self refuse:@"CONTROL_ORIGINAL_PROOF_UNAVAILABLE" cause:nil error:error];return nil;}return [NSData dataWithBytes:_proof.bytes length:_proof.length];}}
- (NSDictionary*)copyOriginalDecision:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_busy||!_selected){[self refuse:@"CONTROL_ORIGINAL_DECISION_REQUIRED" cause:nil error:error];return nil;}
 // No current/sign/reacquire checks: locked/retired operations keep their
 // already held public result. No record means UNKNOWN, not not-selected.
 if(_result)return [self decisionState:_result[@"phase"]];
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
 if(error)*error=nil;if(_closed)return YES;if(_busy||_checking)return NO;if((_selected&&!_stored)||(_effectSelected&&!_outcomeStored)||_cleanupPending){if(error)*error=[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:2 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_CHOICE_EFFECT_OR_CLEANUP_PENDING"}];return NO;}if(_cleanup){if(error)*error=_cleanup;return NO;}
 [self retire];if(!_source){_closed=YES;return YES;}NSError*e=nil;
 if(![_source join:&e]||e){if(error)*error=e;return NO;}
 if(![_source close:&e]||e){_cleanup=e?:[NSError errorWithDomain:@"YNXOriginalProjectControlReview" code:2 userInfo:@{NSLocalizedDescriptionKey:@"CONTROL_SOURCE_CLOSE_UNKNOWN"}];if(error)*error=_cleanup;return NO;}
 _closed=YES;_source=nil;return YES;
}}
@end
