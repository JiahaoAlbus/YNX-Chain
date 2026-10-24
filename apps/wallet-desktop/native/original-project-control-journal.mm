#import "original-project-control-journal.h"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <CommonCrypto/CommonDigest.h>
#include <unistd.h>
#if defined(YNX_CONTROL_JOURNAL_PUBLIC_TEST)
extern "C" OSStatus YNXControlJournalPublicAdd(CFDictionaryRef,CFTypeRef*);
extern "C" OSStatus YNXControlJournalPublicCopy(CFDictionaryRef,CFTypeRef*);
#define ControlAdd YNXControlJournalPublicAdd
#define ControlCopy YNXControlJournalPublicCopy
#else
#define ControlAdd SecItemAdd
#define ControlCopy SecItemCopyMatching
#endif
static NSString*const ControlService=@"com.ynxweb4.wallet.ide-project-control-decision.v1";
static BOOL ControlError(NSError**out,NSString*stage,OSStatus status,BOOL unknown){
 if(out)*out=[NSError errorWithDomain:@"YNXOriginalProjectControlJournal" code:status userInfo:@{NSLocalizedDescriptionKey:stage,@"operationMayHaveCommitted":@(unknown)}];return NO;
}
static NSData*ControlCopyBytes(NSData*input,NSUInteger maximum){
 if(![input isKindOfClass:NSData.class]||!input.length||input.length>maximum)return nil;
 return [NSData dataWithBytes:input.bytes length:input.length];
}
static NSMutableDictionary*ControlQuery(NSData*request){
 unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256(request.bytes,(CC_LONG)request.length,digest);
 NSMutableString*account=[NSMutableString stringWithCapacity:64];for(unsigned char byte:digest)[account appendFormat:@"%02x",byte];
 LAContext*context=[LAContext new];context.interactionNotAllowed=YES;
 return [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:ControlService,(__bridge id)kSecAttrAccount:account,(__bridge id)kSecAttrSynchronizable:@NO,(__bridge id)kSecUseDataProtectionKeychain:@YES,(__bridge id)kSecUseAuthenticationContext:context}mutableCopy];
}
static BOOL ControlActor(NSError**error){return getuid()!=0&&getuid()==geteuid()?YES:ControlError(error,@"original-user-required",errSecAuthFailed,NO);}
@implementation YNXOriginalProjectControlJournal
- (NSData*)copyOriginalDecisionForRequest:(NSData*)input error:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(!ControlActor(error))return nil;NSData*request=ControlCopyBytes(input,65536);if(!request){ControlError(error,@"original-request-bound",errSecParam,NO);return nil;}
 NSMutableDictionary*q=ControlQuery(request);q[(__bridge id)kSecReturnData]=@YES;q[(__bridge id)kSecReturnAttributes]=@YES;q[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne;
 CFTypeRef result=nullptr;OSStatus status=ControlCopy((__bridge CFDictionaryRef)q,&result);
 if(status!=errSecSuccess){if(result)CFRelease(result);ControlError(error,@"decision-read",status,NO);return nil;}
 if(!result||CFGetTypeID(result)!=CFDictionaryGetTypeID()){if(result)CFRelease(result);ControlError(error,@"decision-read-type",errSecDecode,NO);return nil;}
 NSDictionary*a=CFBridgingRelease(result);
 if(![a[(__bridge id)kSecAttrService]isEqual:ControlService]||![a[(__bridge id)kSecAttrAccount]isEqual:q[(__bridge id)kSecAttrAccount]]||![a[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]||![a[(__bridge id)kSecAttrAccessible]isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly]){ControlError(error,@"decision-protection",errSecDecode,NO);return nil;}
 NSData*body=ControlCopyBytes(a[(__bridge id)kSecValueData],393216);if(!body){ControlError(error,@"decision-read-bound",errSecDecode,NO);return nil;}return body;
}}
- (BOOL)reserveOriginalDecision:(NSData*)input forOriginalRequest:(NSData*)original error:(NSError**)error {@synchronized(self){
 if(error)*error=nil;if(!ControlActor(error))return NO;
 NSData*request=ControlCopyBytes(original,65536),*decision=ControlCopyBytes(input,393216);
 if(!request||!decision)return ControlError(error,@"decision-input-bound",errSecParam,NO);
 NSMutableDictionary*q=ControlQuery(request);q[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;q[(__bridge id)kSecValueData]=decision;
 // Never update/delete. Duplicate and uncertain outcomes retain the original
 // tombstone. Readback is observation, never permission to retry SecItemAdd.
 OSStatus status=ControlAdd((__bridge CFDictionaryRef)q,nullptr);
 if(status!=errSecSuccess)return ControlError(error,@"decision-reserve",status,status!=errSecDuplicateItem);
 NSError*readError=nil;NSData*held=[self copyOriginalDecisionForRequest:request error:&readError];
 if(!held||![held isEqual:decision]){
  ControlError(error,@"decision-reserve-readback",readError?(OSStatus)readError.code:errSecDecode,YES);
  if(error&&readError){NSMutableDictionary*info=[(*error).userInfo mutableCopy];info[NSUnderlyingErrorKey]=readError;*error=[NSError errorWithDomain:(*error).domain code:(*error).code userInfo:info];}
  return NO;
 }
 return YES;
}}
@end
