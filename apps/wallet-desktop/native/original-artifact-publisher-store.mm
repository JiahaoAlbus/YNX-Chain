#import "original-artifact-publisher-store.h"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <CommonCrypto/CommonDigest.h>
#include <unistd.h>
#include <cstring>
#include <pthread.h>
#include <chrono>
#import <AppKit/AppKit.h>
#import "../../../packages/wallet-auth/native/original-auth-identity-source-authority.h"
#import "../../../packages/wallet-auth/native/original-ide-publication-artifact.h"
#import "../../../packages/wallet-auth/native/original-ide-wallet-identity-source.h"
#import "../../../packages/wallet-auth/native/original-ide-wallet-peer-launch.h"
// Reuse original Auth's bounded DATA parsers, not a parallel R13 or request
// signature implementation. Their Native Source already verifies registration.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-function"
#import "../../../packages/wallet-auth/native/original-ide-project-authority-data.h"
#pragma clang diagnostic pop

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

static BOOL PublisherApprovalFocused(){
#if defined(YNX_PUBLISHER_STORE_PUBLIC_TEST)
 return YES; // PUBLIC control seam, never compiled into the normal user addon.
#else
 return NSRunningApplication.currentApplication.active;
#endif
}
@implementation YNXOriginalArtifactReleaseApproval {
 YNXOriginalIDEWalletIdentitySource *_wallet;YNXOriginalIDEWalletPeerLaunch *_transport;
 YNXOriginalArtifactPublisherCurrent *_publisher;
 NSDictionary *_packet,*_request,*_manifest,*_binding;
 NSString *_reviewId,*_approvalRef;NSData *_rawRequest,*_rawManifest;
 NSError *_first;BOOL _checking,_decisionSelected,_approved,_signSelected,_retired,_closed;
 uint64_t _floor,_expires;std::chrono::steady_clock::time_point _deadline;
}
- (instancetype)initPrivate {return [super init];}
- (BOOL)refuse:(NSString *)code cause:(NSError *)cause error:(NSError **)error {
 if(!_first)_first=cause?:[NSError errorWithDomain:@"YNXArtifactReleaseApproval" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=_first;return NO;
}
- (NSDictionary *)current:(NSError **)error {
 if(!pthread_main_np()||getuid()==0||getuid()!=geteuid())return [self refuse:@"PUBLISHER_APPROVAL_ORIGINAL_ACTOR_REQUIRED" cause:nil error:error],nil;
 if(_checking)return [self refuse:@"PUBLISHER_APPROVAL_REENTRANT" cause:nil error:error],nil;
 if(_first||_retired||_closed)return [self refuse:@"PUBLISHER_APPROVAL_RETIRED" cause:nil error:error],nil;
 _checking=YES;
 @try{
  const uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  if(before<_floor||before>=_expires||std::chrono::steady_clock::now()>=_deadline)return [self refuse:@"PUBLISHER_APPROVAL_EXPIRED" cause:nil error:error],nil;
  NSError *e=nil;
  if(![_wallet assertCurrent:&e]||e||![_transport assertCurrent:&e]||e)return [self refuse:@"PUBLISHER_APPROVAL_CHANNEL_REFUSED" cause:e error:error],nil;
  NSDictionary*packet=[_transport copyCapturedRequest:&e];NSData*request=[_wallet copyRequest:&e];
  if(e||![packet isEqual:_packet]||![request isEqual:_rawRequest])return [self refuse:@"PUBLISHER_APPROVAL_ORIGINAL_CHANGED" cause:e error:error],nil;
  NSDictionary*snapshot=[_publisher copyOriginalPublisherSnapshot:&e];
  if(e||!snapshot)return [self refuse:@"PUBLISHER_APPROVAL_CURRENT_REFUSED" cause:e error:error],nil;
  NSDictionary*binding=SourceProjectR13(snapshot[@"publisherOriginal"]);
  if(!binding||![binding[@"subjectOwner"]isEqual:_request[@"owner"]]||![binding[@"networkId"]isEqual:_request[@"networkId"]]||![binding[@"account"]isEqual:snapshot[@"publisher"][@"account"]]||![binding[@"projectId"]isEqual:_manifest[@"projectId"]]||![binding[@"publisherId"]isEqual:snapshot[@"publisher"][@"publisherId"]]||(_binding&&![_binding isEqual:binding]))return [self refuse:@"PUBLISHER_APPROVAL_BINDING_CHANGED" cause:nil error:error],nil;
  NSDictionary*last=[_transport copyCapturedRequest:&e];request=[_wallet copyRequest:&e];
  const uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  if(e||![last isEqual:_packet]||![request isEqual:_rawRequest]||after<before||after>=_expires||std::chrono::steady_clock::now()>=_deadline||_retired||_closed||_first)return [self refuse:@"PUBLISHER_APPROVAL_POST_CURRENT_REFUSED" cause:e error:error],nil;
  if(!_binding)_binding=[binding copy];_floor=after;return snapshot;
 }@catch(NSException*){return [self refuse:@"PUBLISHER_APPROVAL_CURRENT_UNKNOWN" cause:nil error:error],nil;}@finally{_checking=NO;}
}
+ (instancetype)captureWalletSource:(YNXOriginalIDEWalletIdentitySource*)wallet transport:(YNXOriginalIDEWalletPeerLaunch*)transport error:(NSError**)error {
 if(error)*error=nil;auto owner=[[self alloc]initPrivate];owner->_reviewId=NSUUID.UUID.UUIDString.lowercaseString;
 @try{
  if(!pthread_main_np()||getuid()==0||getuid()!=geteuid()||!wallet||wallet.class!=YNXOriginalIDEWalletIdentitySource.class||!transport||transport.class!=YNXOriginalIDEWalletPeerLaunch.class){[owner refuse:@"PUBLISHER_APPROVAL_ORIGINAL_CHANNEL_REQUIRED" cause:nil error:error];return owner;}
  owner->_wallet=wallet;owner->_transport=transport;NSError*e=nil;
  if(![wallet assertCurrent:&e]||e||![transport assertCurrent:&e]||e){[owner refuse:@"PUBLISHER_APPROVAL_CHANNEL_REFUSED" cause:e error:error];return owner;}
  NSDictionary*packet=[transport copyCapturedRequest:&e];NSString*raw=packet[@"requestRaw"],*invocation=packet[@"invocationRaw"];
  if(e||![raw isKindOfClass:NSString.class]||![invocation isKindOfClass:NSString.class]){[owner refuse:@"PUBLISHER_APPROVAL_PACKET_REQUIRED" cause:e error:error];return owner;}
  owner->_rawRequest=[raw dataUsingEncoding:NSUTF8StringEncoding];owner->_rawManifest=[invocation dataUsingEncoding:NSUTF8StringEncoding];owner->_packet=[packet copy];
  owner->_request=SourceProofDictionary(owner->_rawRequest,16384);owner->_manifest=YNXParseOriginalIDEPublicationManifest(owner->_rawManifest,&e);
  uint64_t issued=0,expires=0,now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  if(e||!owner->_request||!owner->_manifest||![owner->_request[@"requestId"]isKindOfClass:NSString.class]||![owner->_request[@"requestId"]length]||![owner->_request[@"purpose"]isEqual:@"AUTH-PROTECTED-KEY-CALL"]||!SourceProofU64(owner->_request[@"issuedAtMs"],issued,true)||!SourceProofU64(owner->_request[@"expiresAtMs"],expires,true)||expires<=issued||expires-issued>30000||now<issued||now>=expires){[owner refuse:@"PUBLISHER_APPROVAL_REQUEST_WINDOW_REFUSED" cause:e error:error];return owner;}
  owner->_expires=expires;owner->_floor=now;owner->_deadline=std::chrono::steady_clock::now()+std::chrono::milliseconds(expires-now);
  owner->_publisher=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:owner->_rawManifest error:&e]; // adopt partial first
  if(e||!owner->_publisher){[owner refuse:@"PUBLISHER_APPROVAL_PUBLISHER_REQUIRED" cause:e error:error];return owner;}
  [owner current:error];return owner;
 }@catch(NSException*){[owner refuse:@"PUBLISHER_APPROVAL_CAPTURE_UNKNOWN" cause:nil error:error];return owner;}
}
- (NSDictionary*)copyOriginalReview:(NSError**)error {@synchronized(self){if(error)*error=nil;NSDictionary*s=[self current:error];if(!s)return nil;
 NSMutableDictionary*v=[@{@"reviewId":_reviewId,@"requestId":_request[@"requestId"],@"purpose":@"ARTIFACT-RELEASE",@"account":_binding[@"subjectOwner"],@"networkId":_binding[@"networkId"],@"publication":_manifest,@"publisherId":_binding[@"publisherId"],@"publisherKeyVersion":_binding[@"publisherKeyVersion"],@"publisherRegistrationRef":s[@"publisher"][@"registrationRef"],@"publisherRevision":s[@"publisher"][@"revision"],@"approved":@(_approved),@"signingSelected":@(_signSelected),@"workspaceFDQualified":@NO,@"artifactVerified":@NO}mutableCopy];if(_approvalRef)v[@"actualApprovalRef"]=_approvalRef;return [v copy];}}
- (BOOL)approveOriginalReview:(NSString*)reviewId error:(NSError**)error {@synchronized(self){if(error)*error=nil;
 if(_decisionSelected||![reviewId isKindOfClass:NSString.class]||![_reviewId isEqual:reviewId])return [self refuse:@"PUBLISHER_APPROVAL_DECISION_REFUSED" cause:nil error:error];
 _decisionSelected=YES; // before any original/current callback; never reissue
 if(!PublisherApprovalFocused()||![self current:error])return [self refuse:@"PUBLISHER_APPROVAL_CONTEXT_REFUSED" cause:nil error:error];
 _approvalRef=NSUUID.UUID.UUIDString.lowercaseString;_approved=YES;return YES;
}}
- (BOOL)assertOriginalApprovalCurrent:(NSString*)ref error:(NSError**)error {@synchronized(self){if(error)*error=nil;
 if(!_approved||![ref isKindOfClass:NSString.class]||![_approvalRef isEqual:ref])return [self refuse:@"PUBLISHER_APPROVAL_UNAVAILABLE" cause:nil error:error];
 if(!PublisherApprovalFocused())return [self refuse:@"PUBLISHER_APPROVAL_CONTEXT_REFUSED" cause:nil error:error];return [self current:error]!=nil;
}}
- (NSDictionary*)selectOriginalSigning:(NSString*)ref error:(NSError**)error {@synchronized(self){if(error)*error=nil;
 if(!_approved||_signSelected||![ref isKindOfClass:NSString.class]||![_approvalRef isEqual:ref])return [self refuse:@"PUBLISHER_SIGNING_ALREADY_SELECTED_OR_UNAPPROVED" cause:nil error:error],nil;
 _signSelected=YES; // before source/custody/crypto; failure is UNKNOWN, not retry
 if(!PublisherApprovalFocused())return [self refuse:@"PUBLISHER_APPROVAL_CONTEXT_REFUSED" cause:nil error:error],nil;
 NSDictionary*snapshot=[self current:error];if(!snapshot)return nil;
 // Persist the exact original once selection BEFORE returning a context that
 // could read private custody. A duplicate/uncertain write cannot rearm this
 // owner, and a fresh owner meets the same create-only request fence.
 NSDictionary*intent=@{@"version":@"YNX-WALLET-ARTIFACT-RELEASE-JOURNAL/v1",@"requestOriginal":_packet[@"requestRaw"],@"manifestOriginal":_packet[@"invocationRaw"],@"reviewId":_reviewId,@"actualApprovalRef":_approvalRef,@"publisherOriginal":[[[[snapshot[@"publisherOriginal"]base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"]stringByReplacingOccurrencesOfString:@"=" withString:@""],@"publisherRegistrationRef":snapshot[@"publisher"][@"registrationRef"],@"publisherRevision":snapshot[@"publisher"][@"revision"],@"publisherKeyVersion":_binding[@"publisherKeyVersion"],@"phase":@"signing-selected"};
 NSError*storedError=nil;auto journal=[YNXOriginalArtifactReleaseJournal new];
 if(![journal createOriginalIntent:intent error:&storedError]||storedError)return [self refuse:@"PUBLISHER_SIGNING_INTENT_UNCONFIRMED" cause:storedError error:error],nil;
 if(!PublisherApprovalFocused())return [self refuse:@"PUBLISHER_SIGNING_INTENT_POST_CURRENT" cause:nil error:error],nil;
 return [self current:error];
}}
- (void)retire {@synchronized(self){_retired=YES;_approved=NO;[_publisher retire];}}
- (BOOL)close:(NSError**)error {@synchronized(self){if(error)*error=nil;if(_checking)return [self refuse:@"PUBLISHER_APPROVAL_CALL_PENDING" cause:nil error:error];if(_closed)return YES;
 [self retire];if(_publisher&&![_publisher close:error])return NO;_closed=YES;_wallet=nil;_transport=nil;return YES;
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

static NSString*const ReleaseJournalVersion=@"YNX-WALLET-ARTIFACT-RELEASE-JOURNAL/v1";
static NSArray*ReleaseJournalBaseKeys(){return @[@"version",@"requestOriginal",@"manifestOriginal",@"reviewId",@"actualApprovalRef",@"publisherOriginal",@"publisherRegistrationRef",@"publisherRevision",@"publisherKeyVersion",@"phase"];}
static BOOL ReleaseJournalUUID(id value){
 if(![value isKindOfClass:NSString.class]||[value length]!=36)return NO;
 NSUUID*uuid=[[NSUUID alloc]initWithUUIDString:value];return uuid&&[uuid.UUIDString.lowercaseString isEqual:value]&&[value characterAtIndex:14]=='4'&&[@"89ab" rangeOfString:[value substringWithRange:NSMakeRange(19,1)]].location!=NSNotFound;
}
static NSData*ReleaseJournalText(id value,NSUInteger maximum){
 if(![value isKindOfClass:NSString.class]||![value length]||![value canBeConvertedToEncoding:NSUTF8StringEncoding]||[value lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>maximum)return nil;
 return [value dataUsingEncoding:NSUTF8StringEncoding];
}
static NSData*ReleaseJournalMember(id value){
 if(![value isKindOfClass:NSString.class]||![value length]||[value length]>131072)return nil;
 NSString*s=[[value stringByReplacingOccurrencesOfString:@"-" withString:@"+"]stringByReplacingOccurrencesOfString:@"_" withString:@"/"];if(s.length%4==1)return nil;while(s.length%4)s=[s stringByAppendingString:@"="];
 NSData*b=[[NSData alloc]initWithBase64EncodedString:s options:0];NSString*again=[[[[b base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"]stringByReplacingOccurrencesOfString:@"=" withString:@""];
 return b.length&&b.length<=98304&&[again isEqual:value]?b:nil;
}
static BOOL ReleaseJournalErrorCode(id value){
 if(value==NSNull.null)return YES;if(![value isKindOfClass:NSString.class]||![value length]||[value length]>128)return NO;
 for(NSUInteger i=0;i<[value length];i++){unichar c=[value characterAtIndex:i];if(!((c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'))return NO;}return YES;
}
static NSData*ReleaseJournalCapture(NSDictionary*record,BOOL result){
 NSArray*base=ReleaseJournalBaseKeys();NSArray*keys=result?[base arrayByAddingObjectsFromArray:@[@"memberOriginal",@"status",@"cleanup",@"invoked",@"errorCode"]]:base;
 if(!SourceProjectKeys(record,keys)||![record[@"version"]isEqual:ReleaseJournalVersion]||!ReleaseJournalUUID(record[@"reviewId"])||!ReleaseJournalUUID(record[@"actualApprovalRef"]))return nil;
 NSData*raw=ReleaseJournalText(record[@"requestOriginal"],16384),*manifest=ReleaseJournalText(record[@"manifestOriginal"],16384),*r=SourceProjectBase64(record[@"publisherOriginal"]);
 NSDictionary*request=SourceProofDictionary(raw,16384),*publisher=SourceProjectR13(r);NSError*error=nil;NSDictionary*parsedManifest=YNXParseOriginalIDEPublicationManifest(manifest,&error);uint64_t issued=0,expires=0,revision=0;
 if(!request||!publisher||!parsedManifest||error||![request[@"purpose"]isEqual:@"AUTH-PROTECTED-KEY-CALL"]||!ReleaseJournalText(request[@"requestId"],256)||![request[@"owner"]isEqual:publisher[@"subjectOwner"]]||![request[@"networkId"]isEqual:publisher[@"networkId"]]||!SourceProofU64(request[@"issuedAtMs"],issued,true)||!SourceProofU64(request[@"expiresAtMs"],expires,true)||expires<=issued||expires-issued>30000||![parsedManifest[@"projectId"]isEqual:publisher[@"projectId"]]||![record[@"publisherKeyVersion"]isEqual:publisher[@"publisherKeyVersion"]]||!SourceProjectText(record[@"publisherRegistrationRef"])||!SourceProofU64(record[@"publisherRevision"],revision,true))return nil;
 if(!result){if(![record[@"phase"]isEqual:@"signing-selected"])return nil;}
 else {
  NSString*phase=record[@"phase"];uint64_t status=0,cleanup=0;id member=record[@"memberOriginal"];
  BOOL invoked=SourceProofBoolean(record[@"invoked"],true),notInvoked=SourceProofBoolean(record[@"invoked"],false),hasMember=member!=NSNull.null;
  if(![@[@"signed-unhanded",@"failed",@"unknown",@"cancelled"]containsObject:phase]||(!invoked&&!notInvoked)||!SourceProofU64(record[@"status"],status)||status>10||!SourceProofU64(record[@"cleanup"],cleanup)||cleanup>3||!ReleaseJournalErrorCode(record[@"errorCode"])||(hasMember&&!ReleaseJournalMember(member)))return nil;
  if(hasMember&&(!invoked||status!=0||cleanup!=2))return nil;
  if([phase isEqual:@"signed-unhanded"]&&(!hasMember||record[@"errorCode"]!=NSNull.null))return nil;
  if([phase isEqual:@"failed"]&&(hasMember||status==0||record[@"errorCode"]==NSNull.null))return nil;
  if([phase isEqual:@"cancelled"]&&(hasMember||invoked||status!=1||cleanup!=0))return nil;
 }
 NSMutableDictionary*stored=[record mutableCopy];stored[@"dataOnly"]=@YES;stored[@"handoffAuthorized"]=@NO;stored[@"retryAuthorized"]=@NO;
 NSData*bytes=SourceProofCanonical(stored);return bytes.length&&bytes.length<=262144?bytes:nil;
}
static NSMutableDictionary*ReleaseJournalQuery(NSData*request,BOOL result){
 NSMutableDictionary*q=Query(request);q[(__bridge id)kSecAttrService]=result?@"com.ynxweb4.wallet.artifact-release-result.v1":@"com.ynxweb4.wallet.artifact-release-intent.v1";return q;
}
static NSDictionary*ReleaseJournalRead(NSData*request,BOOL isResult,NSError**error){
 if(!Actor(error))return nil;request=Snapshot(request,16384);if(!request){Reject(error,@"release-request",errSecParam,NO);return nil;}
 NSMutableDictionary*q=ReleaseJournalQuery(request,isResult);q[(__bridge id)kSecReturnData]=@YES;q[(__bridge id)kSecReturnAttributes]=@YES;q[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne;
 CFTypeRef raw=nullptr;OSStatus status=PublisherCopy((__bridge CFDictionaryRef)q,&raw);
 if(status!=errSecSuccess){if(raw)CFRelease(raw);Reject(error,@"release-read",status,NO);return nil;}
 if(!raw||CFGetTypeID(raw)!=CFDictionaryGetTypeID()){if(raw)CFRelease(raw);Reject(error,@"release-read-type",errSecDecode,NO);return nil;}
 NSDictionary*a=CFBridgingRelease(raw);NSData*bytes=a[(__bridge id)kSecValueData];
 if(![a[(__bridge id)kSecAttrService]isEqual:q[(__bridge id)kSecAttrService]]||![a[(__bridge id)kSecAttrAccount]isEqual:q[(__bridge id)kSecAttrAccount]]||![a[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]||![a[(__bridge id)kSecAttrAccessible]isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly]){Reject(error,@"release-read-protection",errSecDecode,NO);return nil;}
 NSDictionary*body=SourceProofDictionary(bytes,262144);NSMutableDictionary*input=[body mutableCopy];
 if(!SourceProofBoolean(input[@"dataOnly"],true)||!SourceProofBoolean(input[@"handoffAuthorized"],false)||!SourceProofBoolean(input[@"retryAuthorized"],false)){Reject(error,@"release-read-authority",errSecDecode,NO);return nil;}
 [input removeObjectsForKeys:@[@"dataOnly",@"handoffAuthorized",@"retryAuthorized"]];
 if(![ReleaseJournalCapture(input,isResult)isEqual:bytes]||![ReleaseJournalText(input[@"requestOriginal"],16384)isEqual:request]){Reject(error,@"release-read-binding",errSecDecode,NO);return nil;}
 return [body copy];
}
static BOOL ReleaseJournalCreate(NSDictionary*record,BOOL isResult,NSError**error){
 if(error)*error=nil;if(!Actor(error))return NO;
 NSData*bytes=ReleaseJournalCapture(record,isResult);if(!bytes)return Reject(error,@"release-input",errSecParam,NO);
 NSData*request=ReleaseJournalText(record[@"requestOriginal"],16384);
 if(isResult){
  NSError*intentError=nil;NSDictionary*intent=ReleaseJournalRead(request,NO,&intentError);
  if(!intent){if(error)*error=intentError;return NO;}
  for(NSString*key in ReleaseJournalBaseKeys())if(![key isEqual:@"phase"]&&![record[key]isEqual:intent[key]])return Reject(error,@"release-intent-result-binding",errSecDecode,NO);
 }
 NSMutableDictionary*q=ReleaseJournalQuery(request,isResult);q[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;q[(__bridge id)kSecValueData]=bytes;
 OSStatus status=PublisherAdd((__bridge CFDictionaryRef)q,nullptr);
 // Even a byte-identical duplicate intent NEVER reopens signing. Only the
 // result slot may confirm an already stored identical public outcome.
 if(status!=errSecSuccess&&!(isResult&&status==errSecDuplicateItem))return Reject(error,@"release-create",status,status!=errSecDuplicateItem);
 NSError*readError=nil;NSDictionary*saved=ReleaseJournalRead(request,isResult,&readError);
 if(!saved||![SourceProofCanonical(saved)isEqual:bytes]){
  if(error){NSError*failure=StoreError(@"release-create-readback",readError?(OSStatus)readError.code:errSecDecode,YES);NSMutableDictionary*info=[failure.userInfo mutableCopy];if(readError)info[NSUnderlyingErrorKey]=readError;*error=[NSError errorWithDomain:failure.domain code:failure.code userInfo:info];}return NO;
 }
 return YES;
}
@implementation YNXOriginalArtifactReleaseJournal
- (BOOL)createOriginalIntent:(NSDictionary*)record error:(NSError**)error {@synchronized(self){return ReleaseJournalCreate(record,NO,error);}}
- (BOOL)createOriginalResult:(NSDictionary*)record error:(NSError**)error {@synchronized(self){return ReleaseJournalCreate(record,YES,error);}}
- (NSDictionary*)copyOriginalIntentForRequest:(NSData*)request error:(NSError**)error {@synchronized(self){if(error)*error=nil;return ReleaseJournalRead(request,NO,error);}}
- (NSDictionary*)copyOriginalResultForRequest:(NSData*)request error:(NSError**)error {@synchronized(self){if(error)*error=nil;return ReleaseJournalRead(request,YES,error);}}
@end

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
