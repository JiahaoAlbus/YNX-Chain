#import "original-artifact-publisher-store.h"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <CommonCrypto/CommonDigest.h>
#include <unistd.h>
#include <cstring>
#include <pthread.h>
#import "../../../packages/wallet-auth/native/original-auth-identity-source-authority.h"
#import "../../../packages/wallet-auth/native/original-ide-publication-artifact.h"

@implementation YNXOriginalArtifactPublisherCurrent {
 YNXAuthIdentitySourceAuthority *_source;
 NSDictionary *_manifest,*_view,*_snapshot;
 NSError *_first,*_closeCause;
 BOOL _entered,_closing,_retired,_retireSelected,_closeSelected,_closed;
}
- (instancetype)initPrivate {return [super init];}
- (BOOL)refuse:(NSString *)code cause:(NSError *)cause error:(NSError **)error {
 if(!_first)_first=cause?:[NSError errorWithDomain:@"YNXArtifactPublisherCurrent" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];
 if(error)*error=_first;return NO;
}
- (NSDictionary *)readHeld:(NSError **)error {
 if(!pthread_main_np()||getuid()==0||getuid()!=geteuid()){[self refuse:@"PUBLISHER_ORIGINAL_USER_THREAD_REQUIRED" cause:nil error:error];return nil;}
 if(_entered){[self refuse:@"PUBLISHER_CURRENT_REENTRANT" cause:nil error:error];return nil;}
 if(_first||_retired||_closeSelected||_closed||!_source){[self refuse:@"PUBLISHER_CURRENT_UNAVAILABLE" cause:nil error:error];return nil;}
 _entered=YES;
 @try{
  NSError *e=nil;
  if(![_source assertCurrent:&e]||e){[self refuse:@"PUBLISHER_SOURCE_CURRENT_REFUSED" cause:e error:error];return nil;}
  NSDictionary *first=[_source copyOriginalIDEProjectSelectionLocal:&e];
  if(e||![first isKindOfClass:NSDictionary.class]){[self refuse:@"PUBLISHER_SELECTION_UNAVAILABLE" cause:e error:error];return nil;}
  NSDictionary *selection=first[@"selection"],*authority=first[@"authority"];
  if(![selection isKindOfClass:NSDictionary.class]||![authority isKindOfClass:NSDictionary.class]){[self refuse:@"PUBLISHER_SELECTION_BINDING_REFUSED" cause:nil error:error];return nil;}
  NSString *project=selection[@"projectId"],*publisher=selection[@"publisherId"];
  if(![project isKindOfClass:NSString.class]||![publisher isKindOfClass:NSString.class]||!publisher.length||![project isEqual:_manifest[@"projectId"]]){[self refuse:@"PUBLISHER_SELECTION_BINDING_REFUSED" cause:nil error:error];return nil;}
  // This original SDK getter enforces Publish; local selection DATA cannot
  // lend it. Keep actual fullR + registrationRef/revision, never a local hash.
  NSDictionary *snapshot=[_source copyOriginalIDECurrentPublisher:publisher forProject:project error:&e];
  if(e||![snapshot isKindOfClass:NSDictionary.class]){[self refuse:@"PUBLISHER_PUBLISH_CURRENT_REFUSED" cause:e error:error];return nil;}
  NSData *r=snapshot[@"publisherOriginal"];NSDictionary *key=snapshot[@"publisher"];
  if(![r isKindOfClass:NSData.class]||!r.length||r.length>8192||![key isKindOfClass:NSDictionary.class]||![key[@"registrationRef"]isKindOfClass:NSString.class]||![key[@"registrationRef"]length]||![key[@"revision"]isKindOfClass:NSString.class]||![key[@"projectId"]isEqual:project]||![key[@"publisherId"]isEqual:publisher]){[self refuse:@"PUBLISHER_ORIGINAL_BINDING_REFUSED" cause:nil error:error];return nil;}
  for(NSString *name in @[@"principal",@"project",@"publisher",@"publisherOriginal",@"expiresMS"])if(![snapshot[name]isEqual:authority[name]]){[self refuse:@"PUBLISHER_SNAPSHOT_CHANGED" cause:nil error:error];return nil;}
  NSDictionary *last=[_source copyOriginalIDEProjectSelectionLocal:&e];
  if(e||!last||![first isEqual:last]||(_view&&![_view isEqual:last])||(_snapshot&&![_snapshot isEqual:snapshot])||_first||_retired||_closeSelected){[self refuse:@"PUBLISHER_POST_CURRENT_CHANGED" cause:e error:error];return nil;}
  // Last original getter already applies current/time post-completion fences.
  // Do not refresh Source after the comparison and return an older snapshot.
  if(!_view){_view=[last copy];_snapshot=[snapshot copy];}
  return [_snapshot copy];
 }@catch(NSException *){[self refuse:@"PUBLISHER_CURRENT_EXCEPTION" cause:nil error:error];return nil;}
 @finally{_entered=NO;}
}
+ (instancetype)acquireForOriginalManifest:(NSData *)input error:(NSError **)error {
 if(error)*error=nil;YNXOriginalArtifactPublisherCurrent *owner=[[self alloc]initPrivate];
 @try{
  if(!pthread_main_np()||getuid()==0||getuid()!=geteuid()){[owner refuse:@"PUBLISHER_ORIGINAL_USER_THREAD_REQUIRED" cause:nil error:error];return owner;}
  if(![input isKindOfClass:NSData.class]||!input.length||input.length>16384){[owner refuse:@"PUBLISHER_MANIFEST_REQUIRED" cause:nil error:error];return owner;}
  NSData *manifest=[NSData dataWithBytes:input.bytes length:input.length];NSError *e=nil;
  owner->_manifest=YNXParseOriginalIDEPublicationManifest(manifest,&e);
  if(e||!owner->_manifest){[owner refuse:@"PUBLISHER_MANIFEST_REFUSED" cause:e error:error];return owner;}
  if(![YNXAuthIdentitySourceAuthority respondsToSelector:@selector(acquireOriginalIDEProjectAuthoritySource:)]){[owner refuse:@"PUBLISHER_PROJECT_SOURCE_CALLEE_REQUIRED" cause:nil error:error];return owner;}
  owner->_source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEProjectAuthoritySource:&e]; // capture partial first
  if(e||!owner->_source||[owner->_source class]!=YNXAuthIdentitySourceAuthority.class){[owner refuse:@"PUBLISHER_ORIGINAL_SOURCE_UNAVAILABLE" cause:e error:error];return owner;}
  if(![owner->_source respondsToSelector:@selector(copyOriginalIDEProjectSelectionLocal:)]){[owner refuse:@"PUBLISHER_PROJECT_SELECTION_CALLEE_REQUIRED" cause:nil error:error];return owner;}
  [owner readHeld:error];return owner;
 }@catch(NSException *){[owner refuse:@"PUBLISHER_ACQUISITION_UNKNOWN" cause:nil error:error];return owner;}
}
- (BOOL)assertCurrent:(NSError **)error {@synchronized(self){if(error)*error=nil;return [self readHeld:error]!=nil;}}
- (NSDictionary *)copyOriginalPublisherSnapshot:(NSError **)error {@synchronized(self){if(error)*error=nil;return [self readHeld:error];}}
- (void)retire {@synchronized(self){_retired=YES;if(_source&&!_retireSelected){_retireSelected=YES;@try{[_source retire];}@catch(NSException *){_closeCause=[NSError errorWithDomain:@"YNXArtifactPublisherCurrent" code:2 userInfo:@{NSLocalizedDescriptionKey:@"PUBLISHER_RETIRE_UNKNOWN"}];}}}}
- (BOOL)close:(NSError **)error {@synchronized(self){
 if(error)*error=nil;
 if(!pthread_main_np()||getuid()==0||getuid()!=geteuid()){if(error)*error=[NSError errorWithDomain:@"YNXArtifactPublisherCurrent" code:3 userInfo:@{NSLocalizedDescriptionKey:@"PUBLISHER_ORIGINAL_USER_THREAD_REQUIRED"}];return NO;}
 if(_entered||_closing){if(error)*error=[NSError errorWithDomain:@"YNXArtifactPublisherCurrent" code:3 userInfo:@{NSLocalizedDescriptionKey:@"PUBLISHER_CURRENT_CALL_PENDING"}];return NO;}
 if(_closed)return YES;
 if(_closeCause){if(error)*error=_closeCause;return NO;}
 _closing=YES;
 @try{
  [self retire];if(_closeCause){if(error)*error=_closeCause;return NO;}
  if(!_source){_closed=YES;return YES;}
  NSError *e=nil;
  if(![_source join:&e]||e){if(error)*error=e?:[NSError errorWithDomain:@"YNXArtifactPublisherCurrent" code:3 userInfo:@{NSLocalizedDescriptionKey:@"PUBLISHER_JOIN_PENDING"}];return NO;}
  if(_closeSelected){if(error)*error=_closeCause;return NO;}_closeSelected=YES;
  if(![_source close:&e]||e){_closeCause=e?:[NSError errorWithDomain:@"YNXArtifactPublisherCurrent" code:2 userInfo:@{NSLocalizedDescriptionKey:@"PUBLISHER_CLOSE_UNKNOWN"}];if(error)*error=_closeCause;return NO;}
  _closed=YES;_source=nil;return YES;
 }@catch(NSException *){_closeCause=[NSError errorWithDomain:@"YNXArtifactPublisherCurrent" code:2 userInfo:@{NSLocalizedDescriptionKey:@"PUBLISHER_CLEANUP_EXCEPTION"}];if(error)*error=_closeCause;return NO;}@finally{_closing=NO;}
}}
@end

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
- (NSMutableData *)copyOriginalRecordForCurrentPublisher:(YNXOriginalArtifactPublisherCurrent *)current error:(NSError **)error {
 if(error)*error=nil;
 if(!current||[current class]!=YNXOriginalArtifactPublisherCurrent.class){Reject(error,@"current-owner",errSecAuthFailed,NO);return nil;}
 NSDictionary *snapshot=[current copyOriginalPublisherSnapshot:error];if(!snapshot)return nil;
 NSMutableData *record=[self copyOriginalRecordForPublicOriginal:snapshot[@"publisherOriginal"]error:error];if(!record)return nil;
 if(![current assertCurrent:error]){[record resetBytesInRange:NSMakeRange(0,record.length)];return nil;}
 return record;
}
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
