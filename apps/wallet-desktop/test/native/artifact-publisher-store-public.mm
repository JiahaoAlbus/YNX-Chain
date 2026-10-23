#if !defined(YNX_PUBLISHER_STORE_PUBLIC_TEST)
#error This fixture must never link the system keychain operations.
#endif
#import "../../native/original-artifact-publisher-store.h"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <cassert>
#include <cstdio>

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
 std::puts("PUBLIC_KEYCHAIN_SEAM_ONLY systemKeychainOperations=0 sourceGrant=0 approval=0 signature=0");
 }}
