#import "original-artifact-publisher-store.h"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <CommonCrypto/CommonDigest.h>
#include <unistd.h>
#include <cstring>

// PUBLIC unit linkage replaces these two calls only at compile time. There is
// no runtime provider injection or alternative keychain in the normal binary.
#if defined(YNX_PUBLISHER_STORE_PUBLIC_TEST)
extern "C" OSStatus YNXPublisherStoreTestAdd(CFDictionaryRef, CFTypeRef *);
extern "C" OSStatus YNXPublisherStoreTestCopy(CFDictionaryRef, CFTypeRef *);
#define PublisherAdd YNXPublisherStoreTestAdd
#define PublisherCopy YNXPublisherStoreTestCopy
#else
#define PublisherAdd SecItemAdd
#define PublisherCopy SecItemCopyMatching
#endif

static NSString *const PublisherService=@"com.ynxweb4.wallet.artifact-publisher.v1";
static NSError *StoreError(NSString *phase,OSStatus status,BOOL uncertain){
 return [NSError errorWithDomain:@"YNXArtifactPublisherStorage" code:status userInfo:@{NSLocalizedDescriptionKey:@"Publisher storage did not complete. Preserve the original record; do not generate a replacement key.",@"phase":phase,@"operationMayHaveCommitted":@(uncertain)}];
}
static BOOL Reject(NSError **error,NSString *phase,OSStatus status,BOOL uncertain){if(error)*error=StoreError(phase,status,uncertain);return NO;}
static NSData *Snapshot(NSData *value,NSUInteger maximum){
 if(![value isKindOfClass:NSData.class]||value.length==0||value.length>maximum)return nil;
 return [NSData dataWithBytes:value.bytes length:value.length];
}
// Validate ONLY Main's internal plaintext storage layout. This is not the
// Protocol R13 parser or KEY7 mathematical verifier; those remain SDK owners.
static BOOL MatchesRecord(NSData *record,NSData *r){
 ynx_wallet_private::PublisherMaterialBorrow borrowed;
 return record&&r&&ynx_wallet_private::borrowPublisherRecord(record.bytes,record.length,r.bytes,r.length,borrowed);
}
static BOOL Actor(NSError **error){
 // A privileged helper must never substitute its root keychain for the
 // original user's Wallet. No UID supplied by a request or caller is accepted.
 return getuid()!=0&&getuid()==geteuid()?YES:Reject(error,@"original-user",errSecAuthFailed,NO);
}
static NSMutableDictionary *Query(NSData *r){
 unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256(r.bytes,(CC_LONG)r.length,digest);
 NSMutableString *address=[NSMutableString stringWithCapacity:64];for(unsigned char byte:digest)[address appendFormat:@"%02x",byte];
 LAContext *context=[LAContext new];context.interactionNotAllowed=YES;
 // The hash is a LOCAL item address, never an Auth RegistrationRef/grant.
 return [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
  (__bridge id)kSecAttrService:PublisherService,(__bridge id)kSecAttrAccount:address,
  (__bridge id)kSecAttrSynchronizable:@NO,(__bridge id)kSecUseDataProtectionKeychain:@YES,
  (__bridge id)kSecUseAuthenticationContext:context} mutableCopy];
}
@implementation YNXOriginalArtifactPublisherStore
- (NSMutableData *)copyOriginalRecordForPublicOriginal:(NSData *)input error:(NSError **)error{
 @synchronized(self){
  if(error)*error=nil;if(!Actor(error))return nil;
  NSData *r=Snapshot(input,8192);if(!r){Reject(error,@"original-R",errSecParam,NO);return nil;}
  NSMutableDictionary *query=Query(r);query[(__bridge id)kSecReturnData]=@YES;query[(__bridge id)kSecReturnAttributes]=@YES;query[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne;
  CFTypeRef result=nullptr;OSStatus status=PublisherCopy((__bridge CFDictionaryRef)query,&result);
  if(status!=errSecSuccess){if(result)CFRelease(result);Reject(error,@"read",status,NO);return nil;}
  if(!result||CFGetTypeID(result)!=CFDictionaryGetTypeID()){if(result)CFRelease(result);Reject(error,@"read-type",errSecDecode,NO);return nil;}
  NSDictionary *attributes=CFBridgingRelease(result);
  if(![attributes[(__bridge id)kSecAttrService]isEqual:PublisherService]||![attributes[(__bridge id)kSecAttrAccount]isEqual:query[(__bridge id)kSecAttrAccount]]||![attributes[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]||![attributes[(__bridge id)kSecAttrAccessible]isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly]){Reject(error,@"read-protection",errSecDecode,NO);return nil;}
  NSData *body=attributes[(__bridge id)kSecValueData];
  if(![body isKindOfClass:NSData.class]||body.length==0||body.length>16384){Reject(error,@"read-bound",errSecDecode,NO);return nil;}
  NSMutableData *record=[NSMutableData dataWithBytes:body.bytes length:body.length];
  if(!MatchesRecord(record,r)){[record resetBytesInRange:NSMakeRange(0,record.length)];Reject(error,@"record-binding",errSecDecode,NO);return nil;}
  return record;
 }
}
- (BOOL)createOriginalRecord:(NSData *)input forPublicOriginal:(NSData *)publicOriginal error:(NSError **)error{
 @synchronized(self){
  if(error)*error=nil;if(!Actor(error))return NO;
  NSData *r=Snapshot(publicOriginal,8192);NSMutableData *record=nil;
  // Own one mutable private copy, not an additional immutable intermediate
  // that could not be wiped in the finally path below.
  if([input isKindOfClass:NSData.class]&&input.length>0&&input.length<=16384)record=[NSMutableData dataWithBytes:input.bytes length:input.length];
  if(!MatchesRecord(record,r)){[record resetBytesInRange:NSMakeRange(0,record.length)];return Reject(error,@"record-input",errSecParam,NO);}
  @try{
   NSMutableDictionary *attributes=Query(r);attributes[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;attributes[(__bridge id)kSecValueData]=record;
   OSStatus status=PublisherAdd((__bridge CFDictionaryRef)attributes,nullptr);
   if(status!=errSecSuccess)return Reject(error,@"create",status,status!=errSecDuplicateItem);
   NSError *readError=nil;NSMutableData *readback=[self copyOriginalRecordForPublicOriginal:r error:&readError];
   BOOL equal=readback&&[readback isEqualToData:record];[readback resetBytesInRange:NSMakeRange(0,readback.length)];
   if(!equal){
    if(error){NSError *failure=StoreError(@"create-readback",readError?(OSStatus)readError.code:errSecDecode,YES);NSMutableDictionary *info=[failure.userInfo mutableCopy];if(readError)info[NSUnderlyingErrorKey]=readError;*error=[NSError errorWithDomain:failure.domain code:failure.code userInfo:info];}
    return NO;
   }
   return YES;
  }@finally{[record resetBytesInRange:NSMakeRange(0,record.length)];}
 }
}
@end
