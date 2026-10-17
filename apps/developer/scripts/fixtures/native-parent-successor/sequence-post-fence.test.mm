#import <Foundation/Foundation.h>
#include <cassert>
static uint64_t testNow=1000;
@interface YNXTestDate : NSObject
+ (NSDate *)date;
@end
@implementation YNXTestDate
+ (NSDate *)date {return [NSDate dateWithTimeIntervalSince1970:(double)testNow/1000];}
@end
// Compile the actual production implementation with deterministic date reads.
// The Source below is a PUBLIC test double, never an enrolled authority.
#define NSDate YNXTestDate
#include "original-ide-parent-source-binding.mm"
#undef NSDate
static NSDictionary *testSelection;
static bool advanceDuringSequence=false,changeDuringSequence=false,missingSequence=false;
static unsigned sequenceCalls=0;
@implementation YNXAuthIdentitySourceAuthority
// This control supplies only the three callbacks exercised below. An
// unexpected production dependency must fail, never gain fixture authority.
+ (instancetype)acquireOriginalSource:(NSError **)error {(void)error;abort();}
+ (instancetype)acquireOriginalIDEConsumerSource:(NSError **)error {(void)error;abort();}
+ (instancetype)acquireOriginalIDEParentSource:(NSError **)error {(void)error;abort();}
- (BOOL)assertCurrent:(NSError **)error {(void)error;abort();}
- (void)retire {abort();}
- (BOOL)join:(NSError **)error {(void)error;abort();}
- (BOOL)close:(NSError **)error {(void)error;abort();}
- (BOOL)assertAuthenticatedNativePurpose:(NSError **)error {(void)error;return YES;}
- (NSDictionary *)copyOriginalSelection:(NSError **)error {(void)error;return testSelection;}
- (NSNumber *)copyOriginalCurrentSequence:(NSError **)error {
 (void)error;++sequenceCalls;if(missingSequence)return nil;if(advanceDuringSequence)testNow=2000;
 if(changeDuringSequence){NSMutableDictionary *changed=[testSelection mutableCopy];changed[@"receiptDirectory"]=@"/changed";testSelection=changed;}
 return @7;
}
@end
static NSDictionary *selection(){
 NSString *digest=[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0];
 NSString *nonce=[@"A" stringByPaddingToLength:43 withString:@"A" startingAtIndex:0];
 NSString *code=[[[NSString stringWithFormat:@"01234567890123456789"] dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0];
 NSDictionary *request=@{@"version":@1,@"purpose":@"wallet-product-session-v2-service-admission/v1",@"service":@"wallet-product-session-v2",@"productId":@"developer",@"platform":@"macos",@"applicationId":@"com.ynxweb4.developer.testnetpreview",@"gatewayOrigin":@"https://wallet-auth.ynxweb4.com",@"registryDigest":digest,@"consumerManifestDigest":digest,@"gatewayManifestDigest":digest,@"instanceId":@"test",@"currentReference":digest,@"operations":@[@"beginYNX",@"handleReturn",@"restore",@"disconnect"],@"requestNonce":nonce,@"requestedAtMs":@1000,@"expiresAtMs":@2000};
 return @{@"expectedRequest":request,@"association":@{@"productId":@"developer",@"platform":@"macos",@"applicationId":@"com.ynxweb4.developer.testnetpreview"},@"ideParentBinding":@{@"walletCodeIdentity":code,@"ideCodeIdentity":code,@"nodeCodeIdentity":code,@"nodeSHA256":digest,@"entrySHA256":digest,@"provenanceSHA256":digest},@"sourceSelection":@{@"rootPath":@"/public/root",@"rootDigest":digest,@"rolePath":@"/public/role",@"roleDigest":digest},@"receiptSelection":@{@"receiptPath":[@"/receipts/" stringByAppendingString:[nonce stringByAppendingString:@".admission.json"]],@"receiptDigest":digest},@"receiptDirectory":@"/receipts"};
}
static void run(bool advance,bool change,bool missing=false){
 testNow=1000;advanceDuringSequence=false;changeDuringSequence=false;missingSequence=false;sequenceCalls=0;testSelection=selection();
 ynx_auth_ide_private::SourceBinding binding;NSError *error=nil;
 assert(binding.capture([YNXAuthIdentitySourceAuthority new],&error));
 advanceDuringSequence=advance;changeDuringSequence=change;missingSequence=missing;
 NSNumber *value=binding.currentSequence(&error);
 assert(sequenceCalls==1);
 if(advance||change||missing){assert(value==nil);assert(error!=nil);NSError *first=error;
  testNow=1000;testSelection=selection();advanceDuringSequence=false;changeDuringSequence=false;
  assert(binding.currentSequence(&error)==nil);assert(error==first);assert(sequenceCalls==1);
 }else{assert([value isEqual:@7]);assert(error==nil);}
}
int main(){@autoreleasepool{run(false,false);run(true,false);run(false,true);run(false,false,true);puts("PASS actual SourceBinding: normal, expiry, binding change, nil sequence; sticky first error and no callback retry; PUBLIC double only");}return 0;}
