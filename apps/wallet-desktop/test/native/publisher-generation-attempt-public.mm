#define main publicAdaptersMain
#include "publisher-registration-cabi-public.mm"
#undef main
#include "../../native/original-publisher-generation-attempt.h"
// Deliberately isolated exact-class storage double. No OS keychain access.
// Actual protected-store behavior has its separate Native regression target.
static NSMutableSet*intents;
static NSMutableDictionary*records,*originals;
static unsigned storeFault=0,adds=0;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wincomplete-implementation"
@implementation YNXOriginalArtifactPublisherStore
- (BOOL)beginOriginalGenerationForRequest:(NSData*)request error:(NSError**)error {
 if(error)*error=nil;if([intents containsObject:request]){if(error)*error=[NSError errorWithDomain:@"PUBLIC duplicate" code:1 userInfo:nil];return NO;}[intents addObject:request];
 if(storeFault==1){if(error)*error=[NSError errorWithDomain:@"PUBLIC intent committed, callback unknown" code:2 userInfo:nil];return NO;}return YES;
}
- (BOOL)saveOriginalGeneratedRecord:(NSData*)record forPublicOriginal:(NSData*)r requestOriginal:(NSData*)request error:(NSError**)error {
 if(error)*error=nil;adds++;assert([intents containsObject:request]);
 if(storeFault==2){if(error)*error=[NSError errorWithDomain:@"PUBLIC save interrupted" code:3 userInfo:nil];return NO;}
 if(records[request])assert([records[request]isEqual:record]&&[originals[request]isEqual:r]);else{records[request]=[NSData dataWithBytes:record.bytes length:record.length];originals[request]=r;}
 if(storeFault==3){if(error)*error=[NSError errorWithDomain:@"PUBLIC result committed, callback unknown" code:4 userInfo:nil];return NO;}return YES;
}
- (NSData*)copyOriginalGeneratedPublicOriginalForRequest:(NSData*)request error:(NSError**)error {if(error)*error=nil;return originals[request];}
@end
#pragma clang diagnostic pop
int main(){@autoreleasepool{
 assert(publicAdaptersMain()==0);intents=[NSMutableSet new];records=[NSMutableDictionary new];originals=[NSMutableDictionary new];mode=4;
 auto network=[NSMutableData dataWithLength:32];NSData*owner=[@"0x1111111111111111111111111111111111111111" dataUsingEncoding:NSUTF8StringEncoding],*label=[@"PUBLIC" dataUsingEncoding:NSUTF8StringEncoding],*version=[@"1" dataUsingEncoding:NSUTF8StringEncoding];
 const auto span=[](NSData*b)->YNXArtifactBytesV1{return{(const uint8_t*)b.bytes,b.length};};YNXPublisherIdentityV1 identity={span(network),span(owner),span(label),span(label),span(label),span(version)};
 for(storeFault=0;storeFault<4;storeFault++){
  NSData*request=[[NSString stringWithFormat:@"PUBLIC-original-%u",storeFault]dataUsingEncoding:NSUTF8StringEncoding];auto store=[YNXOriginalArtifactPublisherStore new];ynx_wallet_private::PublisherGenerationAttempt attempt(store,request);unsigned before=generation;NSError*error=nil;
  bool ok=attempt.execute(identity,&error);assert(ok==(storeFault==0));assert(generation==before+(storeFault==1?0:1));assert([attempt.status()[@"selected"]boolValue]);
  assert(!attempt.execute(identity,&error)&&generation==before+(storeFault==1?0:1));
  // Simulate lock/current loss AFTER execute: storage observation and exact
  // retained-result save require no renewed signing/current/key acquisition.
  if(storeFault>=2){assert([attempt.status()[@"privateResultPending"]boolValue]);assert(!attempt.close(&error));unsigned saved=storeFault;storeFault=0;assert(attempt.saveOriginalResult(&error));assert([attempt.status()[@"firstCausePresent"]boolValue]&&[attempt.status()[@"storageCausePresent"]boolValue]);storeFault=saved;assert(generation==before+1);}
  if(storeFault!=1){assert(attempt.copyOriginalPublic());assert([attempt.status()[@"resultStored"]boolValue]);assert(![attempt.status()[@"privateResultPending"]boolValue]);}
  assert(attempt.close(&error));
  ynx_wallet_private::PublisherGenerationAttempt cold([YNXOriginalArtifactPublisherStore new],request);unsigned coldBefore=generation;assert(!cold.execute(identity,&error)&&generation==coldBefore);std::puts("PASS_ONCE durable intent, first result, explicit save and cold no-regeneration");
 }
 storeFault=0;mode=5;NSData*request=[@"PUBLIC-throw-original" dataUsingEncoding:NSUTF8StringEncoding];ynx_wallet_private::PublisherGenerationAttempt interrupted([YNXOriginalArtifactPublisherStore new],request);NSError*error=nil;unsigned before=generation;assert(!interrupted.execute(identity,&error)&&generation==before+1);assert([interrupted.status()[@"effectEntered"]boolValue]&&[interrupted.status()[@"firstCausePresent"]boolValue]);assert(!interrupted.execute(identity,&error)&&generation==before+1);assert(!interrupted.close(&error));std::puts("PASS_ONCE thrown ABI remains entered UNKNOWN, never re-generated");
 std::puts("PUBLIC_GENERATION_LIFECYCLE actualCrypto=0 realKeychain=0 realConsent=0 Source=0 registration=0");return 0;
}}
