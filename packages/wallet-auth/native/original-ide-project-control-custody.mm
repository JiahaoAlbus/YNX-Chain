#import "original-ide-project-control-custody.h"
#import "original-auth-identity-source-authority.h"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include "original-ide-project-control-key-record.h"
#include <objc/runtime.h>
#include <unistd.h>
#include <pthread.h>
#include <chrono>
#if defined(YNX_ORIGINAL_CONTROL_CUSTODY_PUBLIC_TEST)
#if YNX_ORIGINAL_CONTROL_CUSTODY_PUBLIC_TEST != 1
#error "PUBLIC_CONTROL_CUSTODY_TEST_FLAG_REQUIRES_ONE"
#endif
extern "C" OSStatus YNXControlCustodyPublicCopy(CFDictionaryRef,CFTypeRef*);
#define ControlKeyCopy YNXControlCustodyPublicCopy
#else
#define ControlKeyCopy SecItemCopyMatching
#endif

@interface YNXAuthIdentitySourceAuthority(OriginalControlKeyChildren)
- (id)reserveOriginalControlKeyBorrow:(NSError**)error;
- (BOOL)releaseOriginalControlKeyBorrow:(id)token error:(NSError**)error;
@end
static NSString*const ControlKeyService=@"com.ynxweb4.wallet.project-control.v1";
static NSError*ControlKeyError(NSString*code,NSInteger status=1){return[NSError errorWithDomain:@"YNXAuthOriginalProjectControlCustody" code:status userInfo:@{NSLocalizedDescriptionKey:code}];}
static BOOL ControlKeyActor(){return pthread_main_np()&&getuid()!=0&&getuid()==geteuid();}
static BOOL ControlRecordZero(NSData*record){unsigned char all=0;for(NSUInteger i=0;i<record.length;i++)all|=((const unsigned char*)record.bytes)[i];return all==0;}

@implementation YNXAuthOriginalProjectControlCustody {
 YNXAuthIdentitySourceAuthority*_source;id _token,_osResponse;NSDictionary*_capture,*_context,*_binding;
 NSMutableData*_record;NSError*_first,*_closeCause,*_completionCause;
 BOOL _borrowSelected,_borrowActive,_completionSelected,_completionComplete,_retired,_checking,_closeSelected,_closeComplete;
 std::chrono::steady_clock::time_point _started;uint64_t _budgetMS;NSUInteger _recordLength;const void*_recordAddress;
}
- (NSString*)description{return @"YNXAuthOriginalProjectControlCustody{private material redacted}";}
- (NSString*)debugDescription{return[self description];}
- (BOOL)refuse:(NSString*)code cause:(NSError*)cause error:(NSError**)error{if(!_first)_first=cause?:ControlKeyError(code);if(error)*error=_first;return NO;}
+ (instancetype)acquireForOriginalSource:(YNXAuthIdentitySourceAuthority*)source error:(NSError**)error {
 if(error)*error=nil;YNXAuthOriginalProjectControlCustody*owner=[self new];owner->_started=std::chrono::steady_clock::now();owner->_source=source;
 @try{
  if(!ControlKeyActor()||object_getClass(source)!=YNXAuthIdentitySourceAuthority.class){[owner refuse:@"IDE_CONTROL_ORIGINAL_SOURCE_REQUIRED" cause:nil error:error];return owner;}
  NSError*e=nil;owner->_capture=[source copyOriginalIDEProjectControlCapture:&e];if(!owner->_capture||e){[owner refuse:@"IDE_CONTROL_CAPTURE_REQUIRED" cause:e error:error];return owner;}
  owner->_context=[source copyOriginalIDEProjectControlSigningContext:&e];if(!owner->_context||e){[owner refuse:@"IDE_CONTROL_ROLE_CURRENT_REQUIRED" cause:e error:error];return owner;}
  // No caller path/alias/role/PK/clock is accepted by this factory.
  uint64_t expires=[owner->_context[@"expiresAtMs"]longLongValue],now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000);
  if(now>=expires||expires-now>30000){[owner refuse:@"IDE_CONTROL_KEY_WINDOW_INVALID" cause:nil error:error];return owner;}owner->_budgetMS=expires-now;owner->_started=std::chrono::steady_clock::now();
  NSMutableDictionary*binding=[NSMutableDictionary dictionary];for(NSString*k in @[@"networkId",@"owner",@"keyVersion",@"executionHeight",@"callerIdentity",@"sourceCurrentRef",@"pkA",@"pkB"]){id v=owner->_context[k];if(!v){[owner refuse:@"IDE_CONTROL_EXPECTED_BINDING_REQUIRED" cause:nil error:error];return owner;}binding[k]=v;}owner->_binding=[binding copy];
  owner->_token=[source reserveOriginalControlKeyBorrow:&e];if(!owner->_token||e){[owner refuse:@"IDE_CONTROL_KEY_SELECTION_ONCE" cause:e error:error];return owner;}
  LAContext*auth=[LAContext new];auth.interactionNotAllowed=YES;
  NSDictionary*q=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:ControlKeyService,(__bridge id)kSecAttrAccount:owner->_context[@"keychainAccount"],(__bridge id)kSecAttrSynchronizable:@NO,(__bridge id)kSecUseDataProtectionKeychain:@YES,(__bridge id)kSecUseAuthenticationContext:auth,(__bridge id)kSecReturnData:@YES,(__bridge id)kSecReturnAttributes:@YES,(__bridge id)kSecMatchLimit:(__bridge id)kSecMatchLimitOne};
  CFTypeRef original=nullptr;OSStatus status=ControlKeyCopy((__bridge CFDictionaryRef)q,&original);owner->_osResponse=CFBridgingRelease(original); // retain partial BEFORE status
  id item=owner->_osResponse;id data=[item isKindOfClass:NSDictionary.class]?item[(__bridge id)kSecValueData]:nil;
  if([data isKindOfClass:NSData.class]&&[data length]<=4096){owner->_record=[data mutableCopy];(void)owner->_record.mutableBytes;} // materialize owned writable storage before borrow identity
  if(status!=errSecSuccess||![item isKindOfClass:NSDictionary.class]||![item[(__bridge id)kSecAttrService]isEqual:ControlKeyService]||![item[(__bridge id)kSecAttrAccount]isEqual:owner->_context[@"keychainAccount"]]||![item[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]||![item[(__bridge id)kSecAttrAccessible]isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly]){[owner refuse:@"IDE_CONTROL_PROTECTED_KEY_NOT_SUPPLIED" cause:ControlKeyError(@"IDE_CONTROL_PROTECTED_KEY_NOT_SUPPLIED",status) error:error];return owner;}
  ynx_auth_private::ControlKeyRecordView record;
  if(!ynx_auth_private::inspectOriginalControlKeyRecord(owner->_record.bytes,owner->_record.length,record)||owner->_binding[@"pkA"]==nil||owner->_binding[@"pkB"]==nil||record.pkA.length!=[owner->_binding[@"pkA"]length]||record.pkB.length!=[owner->_binding[@"pkB"]length]||std::memcmp(record.pkA.bytes,[owner->_binding[@"pkA"]bytes],record.pkA.length)||std::memcmp(record.pkB.bytes,[owner->_binding[@"pkB"]bytes],record.pkB.length)){[owner refuse:@"IDE_CONTROL_PROTECTED_PAIR_MISMATCH" cause:nil error:error];return owner;}
  owner->_osResponse=nil; // original OS immutable result retired; no physical-erasure claim
  if(![owner assertOriginalCurrent:&e]){if(error)*error=e;return owner;}
  return owner;
 }@catch(NSException*){[owner refuse:@"IDE_CONTROL_KEY_ACQUISITION_UNKNOWN" cause:nil error:error];return owner;}
}
- (BOOL)assertOriginalCurrent:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(!ControlKeyActor()||_checking||_first||_retired||_closeSelected||!_source||!_token)return[self refuse:@"IDE_CONTROL_KEY_CURRENT_UNAVAILABLE" cause:nil error:error];_checking=YES;
 @try{
  NSError*e=nil;NSDictionary*capture=[_source copyOriginalIDEProjectControlCapture:&e],*context=capture?[_source copyOriginalIDEProjectControlSigningContext:&e]:nil;
  auto elapsed=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-_started).count();uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000);
  if(e||![_capture isEqual:capture]||![_context isEqual:context]||elapsed<0||(uint64_t)elapsed>=_budgetMS||now>=[_context[@"expiresAtMs"]longLongValue])return[self refuse:@"IDE_CONTROL_KEY_POST_CURRENT_CHANGED" cause:e error:error];
  return YES;
 }@catch(NSException*){return[self refuse:@"IDE_CONTROL_KEY_CURRENT_UNKNOWN" cause:nil error:error];}@finally{_checking=NO;}
}}
- (NSDictionary*)copyOriginalExpectedBinding:(NSError**)error {@synchronized(self){return[self assertOriginalCurrent:error]?[_binding copy]:nil;}}
- (NSMutableData*)borrowOriginalControlRecord:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_borrowSelected||!_record||![self assertOriginalCurrent:error]){if(error&&!*error)*error=ControlKeyError(@"IDE_CONTROL_KEY_BORROW_ONCE");return nil;}
 _borrowSelected=YES;_borrowActive=YES;_recordLength=_record.length;_recordAddress=_record.bytes;return _record;
}}
- (BOOL)completeOriginalControlBorrow:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_completionSelected){if(error)*error=_completionCause;return _completionComplete;}
 _completionSelected=YES;
 if(!ControlKeyActor()||!_borrowSelected||!_borrowActive||_record.length!=_recordLength||_record.bytes!=_recordAddress||!ControlRecordZero(_record)){_completionCause=ControlKeyError(@"IDE_CONTROL_KEY_BORROW_WIPE_UNCONFIRMED");if(error)*error=_completionCause;return NO;}
 _borrowActive=NO;_completionComplete=YES;return YES;
}}
- (void)retire {@synchronized(self){_retired=YES;}}
- (BOOL)join:(NSError**)error {@synchronized(self){if(error)*error=nil;if(!ControlKeyActor()||!_retired||_checking||_borrowActive){if(error)*error=ControlKeyError(@"IDE_CONTROL_KEY_BORROW_JOIN_PENDING");return NO;}return YES;}}
- (BOOL)close:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(_closeSelected){if(error)*error=_closeCause;return _closeComplete;}[self retire];if(![self join:error])return NO;_closeSelected=YES;
 @try{
  if(_record){[_record resetBytesInRange:NSMakeRange(0,_record.length)];if(!ControlRecordZero(_record)){_closeCause=ControlKeyError(@"IDE_CONTROL_KEY_CLOSE_WIPE_UNKNOWN");if(error)*error=_closeCause;return NO;}}
  _record=nil;_osResponse=nil;
  if(_token){NSError*e=nil;if(![_source releaseOriginalControlKeyBorrow:_token error:&e]||e){_closeCause=e?:ControlKeyError(@"IDE_CONTROL_KEY_CHILD_RELEASE_UNKNOWN");if(error)*error=_closeCause;return NO;}_token=nil;}
  _source=nil;_closeComplete=YES;return YES;
 }@catch(NSException*){_closeCause=ControlKeyError(@"IDE_CONTROL_KEY_CLOSE_UNKNOWN");if(error)*error=_closeCause;return NO;}
}}
@end
