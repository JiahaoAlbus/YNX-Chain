#if !defined(YNX_PUBLISHER_STORE_PUBLIC_TEST)
#error This fixture must never link the system keychain operations.
#endif
#import "../../native/original-artifact-publisher-store.h"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <cassert>
#include <cstdio>
#include <thread>
#import "../../../../packages/wallet-auth/native/original-auth-identity-source-authority.h"
#import "../../../../packages/wallet-auth/native/original-ide-wallet-identity-source.h"
#import "../../../../packages/wallet-auth/native/original-ide-wallet-peer-launch.h"

// PUBLIC compile-only Source double, never linked into the normal binary.
// Only Main's consumer/lifetime code executes; no Source/Root is admitted.
static NSDictionary *sourceView;
static NSError *sourceAcquireError,*sourcePublishError,*sourceCloseError;
static NSUInteger sourceAcquires,sourceViews,sourcePublishes,sourceRetires,sourceJoins,sourceCloses;
static BOOL sourceJoinPending,sourceSnapshotMismatch;
static void (^selectionHook)(void),(^joinHook)(void),(^recordHook)(void);
static NSDictionary *walletPacket;static NSData *walletRequest;static BOOL walletLive=YES;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wincomplete-implementation"
@implementation YNXAuthIdentitySourceAuthority
+ (instancetype)acquireOriginalIDEProjectAuthoritySource:(NSError **)error {sourceAcquires++;if(error)*error=sourceAcquireError;return [self new];}
- (BOOL)assertCurrent:(NSError **)error {if(error)*error=nil;return YES;}
- (NSDictionary *)copyOriginalIDEProjectSelectionLocal:(NSError **)error {sourceViews++;if(error)*error=nil;void(^hook)(void)=selectionHook;selectionHook=nil;if(hook)hook();return sourceView;}
- (NSDictionary *)copyOriginalIDECurrentPublisher:(NSString *)publisher forProject:(NSString *)project error:(NSError **)error {
 sourcePublishes++;if(error)*error=nil;
 if(sourcePublishError){if(error)*error=sourcePublishError;return nil;}
 NSDictionary*a=sourceView[@"authority"];
 if(![a[@"project"][@"publish"]boolValue]||![a[@"project"][@"projectId"]isEqual:project]||![a[@"publisher"][@"publisherId"]isEqual:publisher]){if(error)*error=[NSError errorWithDomain:@"PUBLIC Source" code:1 userInfo:nil];return nil;}
 NSMutableDictionary *result=[NSMutableDictionary dictionary];for(NSString*k in @[@"principal",@"project",@"publisher",@"publisherOriginal",@"expiresMS"])result[k]=a[k];
 if(sourceSnapshotMismatch){NSMutableDictionary*key=[result[@"publisher"]mutableCopy];key[@"revision"]=@"8";result[@"publisher"]=key;}
 return [result copy];
}
- (void)retire {sourceRetires++;}
- (BOOL)join:(NSError **)error {sourceJoins++;if(error)*error=nil;void(^hook)(void)=joinHook;joinHook=nil;if(hook)hook();if(sourceJoinPending){if(error)*error=[NSError errorWithDomain:@"PUBLIC join pending" code:1 userInfo:nil];return NO;}return YES;}
- (BOOL)close:(NSError **)error {sourceCloses++;if(error)*error=sourceCloseError;return sourceCloseError==nil;}
@end
@implementation YNXOriginalIDEWalletIdentitySource
- (BOOL)assertCurrent:(NSError**)error {if(error)*error=walletLive?nil:[NSError errorWithDomain:@"PUBLIC wallet retired" code:1 userInfo:nil];return walletLive;}
- (NSData*)copyRequest:(NSError**)error {return [self assertCurrent:error]?walletRequest:nil;}
@end
@implementation YNXOriginalIDEWalletPeerLaunch
- (BOOL)assertCurrent:(NSError**)error {if(error)*error=walletLive?nil:[NSError errorWithDomain:@"PUBLIC transport retired" code:1 userInfo:nil];return walletLive;}
- (NSDictionary*)copyCapturedRequest:(NSError**)error {return [self assertCurrent:error]?walletPacket:nil;}
@end
#pragma clang diagnostic pop

static NSMutableData *observedRecord;
@interface YNXPublicObservedStore : YNXOriginalArtifactPublisherStore
@end
@implementation YNXPublicObservedStore
- (NSMutableData *)copyOriginalRecordForPublicOriginal:(NSData *)r error:(NSError **)error {observedRecord=[super copyOriginalRecordForPublicOriginal:r error:error];if(recordHook)recordHook();return observedRecord;}
@end

static NSMutableDictionary *items;
static NSUInteger adds=0,reads=0;
static OSStatus addStatus=errSecSuccess,readStatus=errSecSuccess;
static BOOL commitDespiteError=NO,corruptReadback=NO,wrongR=NO,weakerProtection=NO;
static NSMutableData *mutateCaller=nil;
static NSString *address(NSDictionary *query){
 assert([query[(__bridge id)kSecClass]isEqual:(__bridge id)kSecClassGenericPassword]);
 assert([query[(__bridge id)kSecAttrService]isEqual:@"com.ynxweb4.wallet.artifact-publisher.v1"]);
 assert([query[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]);
 assert([query[(__bridge id)kSecUseDataProtectionKeychain]isEqual:@YES]);
 LAContext *context=query[(__bridge id)kSecUseAuthenticationContext];assert([context isKindOfClass:LAContext.class]&&context.interactionNotAllowed);
 assert(!query[(__bridge id)kSecUseKeychain]&&!query[(__bridge id)kSecReturnPersistentRef]);
 NSString *a=query[(__bridge id)kSecAttrAccount];assert(a.length==64);return a;
}
extern "C" OSStatus YNXPublisherStoreTestAdd(CFDictionaryRef raw,CFTypeRef *){
 adds++;NSDictionary *q=(__bridge NSDictionary *)raw;NSString *a=address(q);
 assert([q[(__bridge id)kSecAttrAccessible]isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly]);
 if(items[a])return errSecDuplicateItem;
 if(addStatus==errSecSuccess||commitDespiteError)items[a]=[q[(__bridge id)kSecValueData]copy];
 if(mutateCaller)[mutateCaller resetBytesInRange:NSMakeRange(0,mutateCaller.length)];
 return addStatus;
}
extern "C" OSStatus YNXPublisherStoreTestCopy(CFDictionaryRef raw,CFTypeRef *result){
 reads++;NSDictionary *q=(__bridge NSDictionary *)raw;NSString *a=address(q);
 assert([q[(__bridge id)kSecReturnData]isEqual:@YES]);assert([q[(__bridge id)kSecMatchLimit]isEqual:(__bridge id)kSecMatchLimitOne]);
 assert([q[(__bridge id)kSecReturnAttributes]isEqual:@YES]);
 if(readStatus!=errSecSuccess)return readStatus;
 NSData *item=items[a];if(!item)return errSecItemNotFound;
 NSMutableData *returned=[item mutableCopy];
 if(corruptReadback)((uint8_t *)returned.mutableBytes)[returned.length-1]^=1;
 if(wrongR)((uint8_t *)returned.mutableBytes)[[@"YNX-PUBLISHER-CUSTODY/v1\n" lengthOfBytesUsingEncoding:NSUTF8StringEncoding]+4]^=1;
 *result=CFBridgingRetain(@{(__bridge id)kSecAttrService:q[(__bridge id)kSecAttrService],(__bridge id)kSecAttrAccount:a,(__bridge id)kSecAttrSynchronizable:@NO,(__bridge id)kSecAttrAccessible:weakerProtection?(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly,(__bridge id)kSecValueData:returned});return errSecSuccess;
}
static NSData *R(NSString *label){return [label dataUsingEncoding:NSUTF8StringEncoding];}
static NSMutableData *record(NSData *r){
 NSMutableData *out=[NSMutableData dataWithData:[@"YNX-PUBLISHER-CUSTODY/v1\n" dataUsingEncoding:NSUTF8StringEncoding]];
 auto append=[&](NSData *part){uint32_t n=CFSwapInt32HostToBig((uint32_t)part.length);[out appendBytes:&n length:4];[out appendData:part];};
 append(r);const size_t sizes[]={54,150,2592,64};for(size_t n:sizes)append([NSMutableData dataWithLength:n]);return out;
}
static NSDictionary *publisherView(NSData*r,NSString*project= @"PUBLIC-project",id publisher= @"PUBLIC-publisher",BOOL publish=YES,NSString*revision= @"7"){
 NSDictionary*principal=@{@"account":@"PUBLIC-original-account"},*p=@{@"projectId":project,@"publish":@(publish)};
 NSDictionary*key=@{@"account":@"PUBLIC-original-account",@"projectId":project,@"publisherId":publisher,@"registrationRef":@"PUBLIC-original-registration-not-R-hash",@"revision":revision};
 return @{@"authority":@{@"principal":principal,@"project":p,@"publisher":key,@"publisherOriginal":r,@"expiresMS":@900719925000},@"selection":@{@"projectId":project,@"publisherId":publisher,@"projectRevision":@"3",@"catalogRevision":@"4",@"workspace":@"PUBLIC-signed-path-is-not-FD-owner"}};
}
static NSData *manifest(){NSDictionary*d=@{@"byteSize":@1,@"contentDigest":[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0],@"projectId":@"PUBLIC-project",@"publishPurpose":@"release",@"targetEnvironment":@"testnet",@"version":@"PUBLIC-v1"};return [NSJSONSerialization dataWithJSONObject:d options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];}
static void resetSource(NSData*r){sourceView=publisherView(r);sourceAcquireError=sourcePublishError=sourceCloseError=nil;sourceAcquires=sourceViews=sourcePublishes=sourceRetires=sourceJoins=sourceCloses=0;sourceJoinPending=sourceSnapshotMismatch=NO;selectionHook=joinHook=recordHook=nil;observedRecord=nil;}
static void currentCases(YNXOriginalArtifactPublisherStore*store,NSData*r,NSData*wire){
 NSError *e=nil;resetSource(r);auto c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];assert(c&&!e);
 NSDictionary*s=[c copyOriginalPublisherSnapshot:&e];assert(s&&!e&&[s[@"publisherOriginal"]isEqual:r]);assert([s[@"publisher"][@"registrationRef"]isEqual:@"PUBLIC-original-registration-not-R-hash"]&&[s[@"publisher"][@"revision"]isEqual:@"7"]);
 NSMutableData *read=[store copyOriginalRecordForCurrentPublisher:c error:&e];assert([read isEqual:wire]&&!e);[read resetBytesInRange:NSMakeRange(0,read.length)];assert(sourceAcquires==1&&sourcePublishes>0);assert([c close:&e]&&[c close:&e]&&sourceCloses==1&&sourceRetires==1);
 std::puts("PASS independent original publisher selection retains full R and actual registration ref/revision");
 for(unsigned mode=0;mode<4;mode++){resetSource(r);if(mode==0)sourceView=publisherView(r,@"PUBLIC-other-project");if(mode==1)sourceView=publisherView(r,@"PUBLIC-project",NSNull.null);if(mode==2)sourceView=publisherView(r,@"PUBLIC-project",@"PUBLIC-publisher",NO);if(mode==3)sourceSnapshotMismatch=YES;
  NSUInteger before=reads;c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];assert(c&&e&&![store copyOriginalRecordForCurrentPublisher:c error:&e]&&reads==before);assert([c close:&e]);}
 std::puts("PASS null publisher/project mismatch/Publish denial/changed original snapshot never read private storage");
 resetSource(r);sourceAcquireError=[NSError errorWithDomain:@"PUBLIC original partial" code:9 userInfo:nil];NSError*first=sourceAcquireError;c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];assert(c&&e==first&&sourceViews==0);assert(![c assertCurrent:&e]&&e==first);assert([c close:&e]&&sourceAcquires==1&&sourceCloses==1);
 std::puts("PASS acquisition error preserves original cleanup partial and first cause without reacquire");
 resetSource(r);c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];assert(!e);sourceView=publisherView(r,@"PUBLIC-project",@"PUBLIC-publisher",YES,@"8");NSUInteger before=reads;assert(![c assertCurrent:&e]&&e);assert(![store copyOriginalRecordForCurrentPublisher:c error:&e]&&reads==before);assert([c close:&e]&&sourceAcquires==1);
 std::puts("PASS late publisher revision change permanently refuses old current owner and key read");
 resetSource(r);c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];assert(!e);recordHook=^{sourceView=publisherView(r,@"PUBLIC-project",@"PUBLIC-publisher",YES,@"8");};auto observed=[YNXPublicObservedStore new];assert(![observed copyOriginalRecordForCurrentPublisher:c error:&e]&&e&&observedRecord);for(NSUInteger i=0;i<observedRecord.length;i++)assert(((const uint8_t*)observedRecord.bytes)[i]==0);recordHook=nil;assert([c close:&e]);
 std::puts("PASS current refusal after actual private copy wipes caller-owned late result before return");
 resetSource(r);c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];assert(!e);selectionHook=^{NSError*n=nil;assert(![c copyOriginalPublisherSnapshot:&n]&&n);};assert(![c assertCurrent:&e]&&e);assert(![c copyOriginalPublisherSnapshot:&e]&&e&&sourceAcquires==1);assert([c close:&e]);
 std::puts("PASS current getter reentry cannot produce a snapshot or rearm a failed owner");
 resetSource(r);c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];sourceCloseError=[NSError errorWithDomain:@"PUBLIC close unknown" code:8 userInfo:nil];first=sourceCloseError;assert(![c close:&e]&&e==first);assert(![c close:&e]&&e==first&&sourceCloses==1&&sourceRetires==1);
 resetSource(r);c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];sourceJoinPending=YES;assert(![c close:&e]&&sourceCloses==0);sourceJoinPending=NO;assert([c close:&e]&&sourceJoins==2&&sourceCloses==1);
 std::puts("PASS unknown close is sticky/never repeated while known join pending stays drainable");
 resetSource(r);c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];joinHook=^{NSError*n=nil;assert(![c close:&n]&&n);};assert([c close:&e]&&sourceJoins==1&&sourceCloses==1);
 resetSource(r);c=[YNXOriginalArtifactPublisherCurrent acquireForOriginalManifest:manifest()error:&e];std::thread worker([c](){@autoreleasepool{NSError*n=nil;assert(![c assertCurrent:&n]&&n);}});worker.join();assert(![c assertCurrent:&e]&&e);assert([c close:&e]&&sourceAcquires==1);
 std::puts("PASS cleanup reentry and worker current access cannot duplicate cleanup or lend authority");
}
static NSData *approvalPublicR(){
 // PUBLIC structural R13 bytes only. Native Source double admits no Root,
 // and this zero-key fixture is never imported or used by a crypto signer.
 NSArray*parts=@[R(@"YNX-IDE-ARTIFACT-PUBLISHER/v1"),R(@"YNX-BATCH/v0.1"),R(@"ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"),R(@"ARTIFACT-RELEASE"),R(@"ide-artifact-publisher"),[NSMutableData dataWithLength:32],R(@"0x1111111111111111111111111111111111111111"),R(@"PUBLIC-original-account"),R(@"PUBLIC-project"),R(@"PUBLIC-publisher"),R(@"5"),[NSMutableData dataWithLength:2592],[NSMutableData dataWithLength:64]];
 uint32_t count=CFSwapInt32HostToBig(13);NSMutableData*out=[NSMutableData dataWithBytes:&count length:4];for(NSData*p in parts){uint32_t n=CFSwapInt32HostToBig((uint32_t)p.length);[out appendBytes:&n length:4];[out appendData:p];}return out;
}
static void setupApproval(NSDictionary*patch=nil){
 resetSource(approvalPublicR());walletLive=YES;
 uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
 NSMutableDictionary*body=[@{@"purpose":@"AUTH-PROTECTED-KEY-CALL",@"requestId":@"PUBLIC-original-native-request",@"owner":@"0x1111111111111111111111111111111111111111",@"networkId":[@"0" stringByPaddingToLength:64 withString:@"0" startingAtIndex:0],@"issuedAtMs":[NSString stringWithFormat:@"%llu",(unsigned long long)now],@"expiresAtMs":[NSString stringWithFormat:@"%llu",(unsigned long long)(now+30000)]}mutableCopy];if(patch)[body addEntriesFromDictionary:patch];
 walletRequest=[NSJSONSerialization dataWithJSONObject:body options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
 walletPacket=@{@"requestRaw":[[NSString alloc]initWithData:walletRequest encoding:NSUTF8StringEncoding],@"invocationRaw":[[NSString alloc]initWithData:manifest()encoding:NSUTF8StringEncoding]};
}
static YNXOriginalArtifactReleaseApproval *captureApproval(NSError**e){return [YNXOriginalArtifactReleaseApproval captureWalletSource:[YNXOriginalIDEWalletIdentitySource new]transport:[YNXOriginalIDEWalletPeerLaunch new]error:e];}
static void approvalCases(){
 NSError*e=nil;setupApproval();NSUInteger privateReads=reads;auto a=captureApproval(&e);assert(a&&!e);NSDictionary*v=[a copyOriginalReview:&e];assert(v&&!e&&![v[@"approved"]boolValue]&&!v[@"actualApprovalRef"]);assert([v[@"publisherKeyVersion"]isEqual:@"5"]&&[v[@"publisherRevision"]isEqual:@"7"]&&reads==privateReads);
 assert([a approveOriginalReview:v[@"reviewId"]error:&e]);v=[a copyOriginalReview:&e];NSString*ref=v[@"actualApprovalRef"];assert(ref.length==36&&[v[@"approved"]boolValue]);assert([a assertOriginalApprovalCurrent:ref error:&e]);assert(reads==privateReads&&[a close:&e]);
 std::puts("PASS approval reference is issued only by explicit original decision with separate publisher key version");
 setupApproval();a=captureApproval(&e);v=[a copyOriginalReview:&e];assert(![a selectOriginalSigning:@"PUBLIC invented approval" error:&e]&&e);assert([a close:&e]);
 std::puts("PASS pending review or a fabricated approval reference cannot select signing");
 setupApproval();a=captureApproval(&e);v=[a copyOriginalReview:&e];assert([a approveOriginalReview:v[@"reviewId"]error:&e]);assert(![a approveOriginalReview:v[@"reviewId"]error:&e]&&e);assert([a close:&e]);
 std::puts("PASS repeated explicit approval cannot mint a second reference");
 setupApproval();a=captureApproval(&e);v=[a copyOriginalReview:&e];assert([a approveOriginalReview:v[@"reviewId"]error:&e]);ref=[a copyOriginalReview:&e][@"actualApprovalRef"];assert([a selectOriginalSigning:ref error:&e]&&!e);assert([a assertOriginalApprovalCurrent:ref error:&e]);assert(![a selectOriginalSigning:ref error:&e]&&e);assert([a close:&e]);
 std::puts("PASS signing entry is consumed once while decision current is not a second signing permission");
 setupApproval();a=captureApproval(&e);v=[a copyOriginalReview:&e];selectionHook=^{NSError*n=nil;assert(![a approveOriginalReview:v[@"reviewId"]error:&n]&&n);};assert(![a approveOriginalReview:v[@"reviewId"]error:&e]&&e);assert([a close:&e]);
 std::puts("PASS decision reservation precedes reentrant original-current callbacks");
 for(NSString*key in @[@"purpose",@"owner",@"networkId",@"expiresAtMs"]){NSDictionary*patch=@{key:[key isEqual:@"purpose"]?@"AUTH-IDENTITY-RECEIVE":[key isEqual:@"owner"]?@"0x2222222222222222222222222222222222222222":[key isEqual:@"networkId"]?[@"f" stringByPaddingToLength:64 withString:@"f" startingAtIndex:0]:@"1"};setupApproval(patch);a=captureApproval(&e);assert(a&&e&&![a copyOriginalReview:&e]);assert([a close:&e]);}
 std::puts("PASS wrong purpose/owner/network or expired request never creates an approval");
 setupApproval();a=captureApproval(&e);v=[a copyOriginalReview:&e];NSMutableDictionary*changed=[walletPacket mutableCopy];changed[@"invocationRaw"]=@"{}";walletPacket=changed;assert(![a approveOriginalReview:v[@"reviewId"]error:&e]&&e);assert([a close:&e]);
 std::puts("PASS exact bound original invocation cannot be substituted after visible review");
 setupApproval();a=captureApproval(&e);v=[a copyOriginalReview:&e];assert([a approveOriginalReview:v[@"reviewId"]error:&e]);ref=[a copyOriginalReview:&e][@"actualApprovalRef"];walletLive=NO;assert(![a assertOriginalApprovalCurrent:ref error:&e]&&e);walletLive=YES;assert(![a selectOriginalSigning:ref error:&e]&&e);assert([a close:&e]);
 std::puts("PASS parent channel retirement permanently revokes a live approval without reacquisition");
 setupApproval();a=captureApproval(&e);v=[a copyOriginalReview:&e];assert([a approveOriginalReview:v[@"reviewId"]error:&e]);ref=[a copyOriginalReview:&e][@"actualApprovalRef"];[a retire];assert(![a assertOriginalApprovalCurrent:ref error:&e]&&e);assert(![a selectOriginalSigning:ref error:&e]&&e);assert([a close:&e]);
 std::puts("PASS explicit retire revokes the exact approval without deleting its once-selection history");
 setupApproval();a=captureApproval(&e);v=[a copyOriginalReview:&e];assert([a approveOriginalReview:v[@"reviewId"]error:&e]);ref=[a copyOriginalReview:&e][@"actualApprovalRef"];sourceView=publisherView(approvalPublicR(),@"PUBLIC-project",@"PUBLIC-publisher",YES,@"8");assert(![a selectOriginalSigning:ref error:&e]&&e);sourceView=publisherView(approvalPublicR());assert(![a selectOriginalSigning:ref error:&e]&&e);assert([a close:&e]);assert(reads==privateReads);
 std::puts("PASS failed once-entry current check cannot be repaired into a new key attempt");
}
int main(int argc,char **argv){@autoreleasepool{
 items=[NSMutableDictionary new];auto store=[YNXOriginalArtifactPublisherStore new];NSError *e=nil;
 NSData *r=R(@"PUBLIC fake original R:1");NSMutableData *wire=record(r);
 {
  using namespace ynx_wallet_private;
  PublisherMaterialBorrow view;const uint8_t*p=(const uint8_t*)wire.bytes;
  assert(borrowPublisherRecord(p,wire.length,r.bytes,r.length,view));
  assert(view.registration.bytes==p+sizeof("YNX-PUBLISHER-CUSTODY/v1\n")-1+4);
  assert(view.pkcs8A.length==54&&view.pkcs8B.length==150&&view.pkA.length==2592&&view.pkB.length==64);
  assert(view.pkcs8A.bytes==view.registration.bytes+view.registration.length+4);
  assert(view.pkcs8B.bytes==view.pkcs8A.bytes+54+4&&view.pkA.bytes==view.pkcs8B.bytes+150+4&&view.pkB.bytes==view.pkA.bytes+2592+4);
  for(size_t n=0;n<wire.length;n++){
   assert(!borrowPublisherRecord(p,n,r.bytes,r.length,view));
   assert(!view.registration.bytes&&!view.pkcs8A.bytes&&!view.pkcs8B.bytes&&!view.pkA.bytes&&!view.pkB.bytes);
   assert(!view.registration.length&&!view.pkcs8A.length&&!view.pkcs8B.length&&!view.pkA.length&&!view.pkB.length);
  }
  for(NSData*bad in @[R(@"PUBLIC other registered R"),[NSData data]])assert(!borrowPublisherRecord(p,wire.length,bad.bytes,bad.length,view));
  NSMutableData *extra=[wire mutableCopy];uint8_t one=1;[extra appendBytes:&one length:1];assert(!borrowPublisherRecord(extra.bytes,extra.length,r.bytes,r.length,view));
  const size_t head=sizeof("YNX-PUBLISHER-CUSTODY/v1\n")-1,offsets[]={head,head+4+r.length,head+4+r.length+4+54,head+4+r.length+4+54+4+150,head+4+r.length+4+54+4+150+4+2592};
  for(size_t offset:offsets){
   NSMutableData*bad=[wire mutableCopy];std::memset((uint8_t*)bad.mutableBytes+offset,0xff,4);assert(!borrowPublisherRecord(bad.bytes,bad.length,r.bytes,r.length,view));
  }
  assert(!borrowPublisherRecord(nullptr,wire.length,r.bytes,r.length,view));
  assert(!borrowPublisherRecord(p,wire.length,nullptr,r.length,view));
  assert(!borrowPublisherRecord(p,wire.length,r.bytes,8193,view));
  NSMutableData *longR=[NSMutableData dataWithLength:8192],*longRecord=record(longR);
  assert(borrowPublisherRecord(longRecord.bytes,longRecord.length,longR.bytes,longR.length,view)&&view.registration.length==8192);
  assert(adds==0&&reads==0);
  std::puts("PASS private synchronous material spans; no copy or authority");
 }
 assert([store createOriginalRecord:wire forPublicOriginal:r error:&e]&&!e&&adds==1&&reads==1);
 NSMutableData *read=[store copyOriginalRecordForPublicOriginal:r error:&e];assert([read isEqual:wire]);[read resetBytesInRange:NSMakeRange(0,read.length)];
 assert([[store copyOriginalRecordForPublicOriginal:r error:&e]isEqual:wire]);
 std::puts("PASS private purpose/DP/local/noninteractive/create/read and independent mutable read copy");
 NSMutableData *changed=[wire mutableCopy];((uint8_t *)changed.mutableBytes)[changed.length-1]=9;
 NSUInteger oldReads=reads;assert(![store createOriginalRecord:changed forPublicOriginal:r error:&e]&&e.code==errSecDuplicateItem&&![e.userInfo[@"operationMayHaveCommitted"]boolValue]&&reads==oldReads);
 assert([[store copyOriginalRecordForPublicOriginal:r error:&e]isEqual:wire]);
 std::puts("PASS duplicate never updates/deletes/replaces the original");
 NSData *r2=R(@"PUBLIC fake original R:2");NSMutableData *wire2=record(r2);addStatus=errSecNotAvailable;commitDespiteError=YES;
 NSUInteger before=adds;assert(![store createOriginalRecord:wire2 forPublicOriginal:r2 error:&e]&&[e.userInfo[@"operationMayHaveCommitted"]boolValue]&&adds==before+1);
 addStatus=errSecSuccess;commitDespiteError=NO;assert([[store copyOriginalRecordForPublicOriginal:r2 error:&e]isEqual:wire2]);assert(adds==before+1);
 std::puts("PASS uncertain committed add is retained and recovered read-only without re-add");
 readStatus=errSecInteractionNotAllowed;before=reads;assert(![store copyOriginalRecordForPublicOriginal:r error:&e]&&e.code==errSecInteractionNotAllowed&&reads==before+1);readStatus=errSecSuccess;
 std::puts("PASS unavailable protection refuses without UI or fallback");
 NSData *rLocked=R(@"PUBLIC fake original R:post-add-lock");NSMutableData *wireLocked=record(rLocked);readStatus=errSecInteractionNotAllowed;before=adds;
 assert(![store createOriginalRecord:wireLocked forPublicOriginal:rLocked error:&e]&&adds==before+1&&[e.userInfo[@"operationMayHaveCommitted"]boolValue]);
 NSError *underlying=e.userInfo[NSUnderlyingErrorKey];assert(underlying.code==errSecInteractionNotAllowed&&[underlying.userInfo[@"phase"]isEqual:@"read"]);
 readStatus=errSecSuccess;assert([[store copyOriginalRecordForPublicOriginal:rLocked error:&e]isEqual:wireLocked]&&adds==before+1);
 std::puts("PASS post-add read error preserves underlying first cause and uncertain record");
 weakerProtection=YES;assert(![store copyOriginalRecordForPublicOriginal:r error:&e]&&e.code==errSecDecode);weakerProtection=NO;
 std::puts("PASS returned weaker item protection is refused before private data copy");
 NSData *r3=R(@"PUBLIC fake original R:3");NSMutableData *wire3=record(r3);corruptReadback=YES;assert(![store createOriginalRecord:wire3 forPublicOriginal:r3 error:&e]&&[e.userInfo[@"operationMayHaveCommitted"]boolValue]);corruptReadback=NO;assert([[store copyOriginalRecordForPublicOriginal:r3 error:&e]isEqual:wire3]);
 std::puts("PASS post-add readback mismatch preserves uncertain original, not success");
 wrongR=YES;assert(![store copyOriginalRecordForPublicOriginal:r error:&e]&&e.code==errSecDecode);wrongR=NO;
 std::puts("PASS foreign original R cannot return material");
 before=adds;assert(![store createOriginalRecord:[NSData dataWithBytes:"x" length:1]forPublicOriginal:r error:&e]);assert(![store createOriginalRecord:wire forPublicOriginal:r2 error:&e]);assert(adds==before);
 std::puts("PASS bad framing or mismatched R is rejected before system-operation boundary");
 NSData *r4=R(@"PUBLIC fake original R:4");NSMutableData *wire4=record(r4),*expected=[wire4 mutableCopy];mutateCaller=wire4;
 assert([store createOriginalRecord:wire4 forPublicOriginal:r4 error:&e]);mutateCaller=nil;assert([[store copyOriginalRecordForPublicOriginal:r4 error:&e]isEqual:expected]);
 std::puts("PASS callback mutation cannot replace captured original record");
 assert(argc==2);NSData *jsRecord=[NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]];NSData *jsR=R(@"PUBLIC-JS-to-Native");
 assert([store createOriginalRecord:jsRecord forPublicOriginal:jsR error:&e]);NSMutableData *jsRead=[store copyOriginalRecordForPublicOriginal:jsR error:&e];assert([jsRead isEqual:jsRecord]);[jsRead resetBytesInRange:NSMakeRange(0,jsRead.length)];
 std::puts("PASS actual Main JS storage framing interoperates with native parser using PUBLIC fake material only");
 currentCases(store,r,wire);
 approvalCases();
 std::puts("PUBLIC_KEYCHAIN_SOURCE_SEAMS_ONLY systemKeychainOperations=0 sourceGrant=0 approval=0 signature=0 workspaceFDQualified=0");
 }}
