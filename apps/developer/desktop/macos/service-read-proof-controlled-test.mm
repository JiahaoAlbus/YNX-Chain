#import "ynx-wallet-device-bridge.h"
#import <objc/runtime.h>
#include <assert.h>
// PUBLIC isolated controls. This fake observation is not original Source,
// a registered service, a user approval, or an installed App.
@interface PublicReadObserver : NSObject <YNXProjectServiceObservationReader>
@property NSDictionary *data;
@property NSInteger reads;
@property NSInteger failAt;
@property NSError *failure;
@property BOOL failClose;
@end
@implementation PublicReadObserver
- (NSDictionary*)readCurrent:(NSError**)error{++_reads;if(_failAt&&_reads>=_failAt){if(error)*error=_failure;return nil;}return _data;}
- (void)retire{}
- (BOOL)finish:(NSError**)error{if(_failClose){if(error)*error=_failure;return NO;}return YES;}
@end
@interface PublicDevice : YNXWalletDeviceBridge
@property NSDictionary *sessionData;
@property BOOL loginAllowed;
@end
@implementation PublicDevice
- (BOOL)loadKeyCreating:(BOOL)c error:(NSError**)e{return YES;}
- (BOOL)consented{return _loginAllowed;}
- (NSString*)stored:(NSString*)key error:(NSError**)e{return [key isEqual:YNXDeviceStorageBase]?YNXDeviceCanonical(_sessionData):nil;}
- (NSString*)rawStored:(NSString*)key error:(NSError**)e{return [key hasPrefix:@"native-session-anchor:"]?YNXDeviceDigest(@"YNX_DEVELOPER_NATIVE_SESSION_ANCHOR_V1",_sessionData):nil;}
@end
static NSString *iso(NSTimeInterval d){NSISO8601DateFormatter*f=[NSISO8601DateFormatter new];f.formatOptions=NSISO8601DateFormatWithInternetDateTime|NSISO8601DateFormatWithFractionalSeconds;return [f stringFromDate:[NSDate dateWithTimeIntervalSinceNow:d]];}
static NSString *token(char c){return [@"" stringByPaddingToLength:64 withString:[NSString stringWithFormat:@"%c",c] startingAtIndex:0];}
static PublicDevice *device(void){
 PublicDevice*b=[[PublicDevice alloc]initWithTag:@"PUBLIC-NOT-KEYCHAIN" storageService:@"PUBLIC-NOT-KEYCHAIN" lockDirectory:@"/PUBLIC/NEVER-OPENED"];
 b.loginAllowed=YES;
 SecKeyRef key=SecKeyCreateRandomKey((__bridge CFDictionaryRef)@{(__bridge id)kSecAttrKeyType:(__bridge id)kSecAttrKeyTypeECSECPrimeRandom,(__bridge id)kSecAttrKeySizeInBits:@256,(__bridge id)kSecAttrIsPermanent:@NO},NULL);assert(key);
 Ivar ivar=class_getInstanceVariable(YNXWalletDeviceBridge.class,"_privateKey");memcpy((char *)(__bridge void*)b+ivar_getOffset(ivar),&key,sizeof(key)); // fixture key owned/released by bridge
 NSMutableDictionary*s=[@{@"version":@"2",@"sessionBinding":YNXDeviceHash(@"PUBLIC-session"),@"chainId":@"ynx_6423-1",@"productId":@"developer",@"clientId":@"ynx-developer-v1",@"platform":@"macos",@"applicationId":@"com.ynxweb4.developer.testnetpreview",@"bundleId":@"com.ynxweb4.developer.testnetpreview",@"packageId":NSNull.null,@"origin":@"app://macos/com.ynxweb4.developer.testnetpreview",@"callback":@"ynxdeveloper://wallet-auth/callback",@"account":@"ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",@"deviceId":@"ynx-developer-macos-device-v2",@"deviceAlgorithm":@"p256-sha256",@"deviceKey":b.publicKey,@"nonce":token('a'),@"state":token('b'),@"scopes":@[@"account:read",@"developer:deploy"],@"requestDigest":YNXDeviceHash(@"request"),@"approvalDigest":YNXDeviceHash(@"approval"),@"issuedAt":iso(-1),@"expiresAt":iso(120)}mutableCopy];
 NSMutableDictionary*binding=[NSMutableDictionary new];for(NSString*k in @[@"chainId",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"deviceId",@"deviceAlgorithm",@"deviceKey"])binding[k]=s[k];s[@"deviceBinding"]=YNXDeviceDigest(@"YNX_PRODUCT_SESSION_DEVICE_V2",binding);b.sessionData=s;assert([b validSession:s]);return b;
}
static PublicReadObserver *observer(PublicDevice*b){
 PublicReadObserver*o=[PublicReadObserver new];o.failure=[NSError errorWithDomain:@"PUBLIC-NOT-SOURCE" code:7 userInfo:nil];
 o.data=@{@"principal":@{@"account":b.sessionData[@"account"],@"deviceId":b.sessionData[@"deviceId"],@"sessionRef":b.sessionData[@"sessionBinding"]},@"project":@{@"projectId":@"PUBLIC-project",@"read":@YES},@"serviceRegistration":@{@"version":@"YNX-IDE-SERVICE-REGISTRATION/v1",@"revoked":@NO,@"account":b.sessionData[@"account"],@"projectId":@"PUBLIC-project",@"apiEndpoint":@"https://PUBLIC.invalid/api/v1",@"scopes":@[@"account:read"]},@"expiresMS":@((long long)(NSDate.date.timeIntervalSince1970*1000)+60000)};return o;
}
static NSString *rid=@"00000000-0000-4000-8000-000000000001";
static NSString *route(BOOL logs){return [@"/api/v1/ide/deployments/00000000-0000-4000-8000-000000000001" stringByAppendingString:logs?@"/logs":@""];}
static NSDictionary *proof(PublicDevice*b,NSString*method,NSString*path,char nonce){
 NSMutableDictionary*v=[NSMutableDictionary new];for(NSString*k in @[@"version",@"sessionBinding",@"productId",@"clientId",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"deviceId",@"deviceKey"])v[k]=b.sessionData[k];
 v[@"method"]=method;v[@"path"]=path;v[@"bodyDigest"]=YNXDeviceHash([method isEqual:@"GET"]?@"":YNXDeviceCanonical(@{@"requiredScopes":b.sessionData[@"scopes"]}));v[@"nonce"]=token(nonce);v[@"issuedAt"]=iso(0);v[@"expiresAt"]=iso(30);
 NSData*raw=[[NSString stringWithFormat:@"YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n%@",YNXDeviceCanonical(v)]dataUsingEncoding:NSUTF8StringEncoding];
 return @{@"purpose":@"http-proof",@"algorithm":@"p256-sha256",@"deviceKey":b.publicKey,@"payload":YNXDeviceB64(raw)};
}
static void check(BOOL ok){assert(ok);}
int main(int argc,const char *argv[]){@autoreleasepool{
 PublicDevice*b=device();NSError*e=nil;NSDictionary*p=proof(b,@"GET",route(NO),'c');
 if(argc>1&&strcmp(argv[1],"ports")==0){
    check(![b performServiceReadPort:@{@"operation":@"context"} requestID:rid error:&e]);e=nil;
    PublicReadObserver*o=observer(b);check([b approveServiceRead:o requestID:rid error:&e]);
    NSDictionary *context=[b performServiceReadPort:@{@"operation":@"context"} requestID:rid error:&e];
    check(context&&!e&&[context[@"requestId"] isEqual:rid]&&[context[@"source"][@"principal"][@"sessionRef"] isEqual:b.sessionData[@"sessionBinding"]]);
    check([[b performServiceReadPort:@{@"operation":@"get",@"key":YNXDeviceStorageBase} requestID:rid error:&e]isEqual:YNXDeviceCanonical(b.sessionData)]);
    check([b performServiceReadPort:@{@"operation":@"get",@"key":[YNXDeviceStorageBase stringByAppendingString:@":revoke"]} requestID:rid error:&e]==NSNull.null);
    check(![b performServiceReadPort:@{@"operation":@"get",@"key":@"native-session-anchor:foreign"} requestID:rid error:&e]);e=nil;
    check(![b performServiceReadPort:@{@"operation":@"context"} requestID:@"other" error:&e]);e=nil;
    check(![b performServiceReadPort:@{@"operation":@"set",@"key":YNXDeviceStorageBase,@"value":@"foreign"} requestID:rid error:&e]);e=nil;
    // Even the presence of real login consent cannot lend POST signing to this port.
    check(b.loginAllowed);
    check([b performServiceReadPort:@{@"operation":@"network",@"method":@"GET",@"url":@"https://wallet-auth.ynxweb4.com/v2/product-sessions/time"} requestID:rid error:&e]);
    check([b performServiceReadPort:@{@"operation":@"network",@"method":@"GET",@"url":[@"https://PUBLIC.invalid" stringByAppendingString:route(NO)]} requestID:rid error:&e]);
    check(![b performServiceReadPort:@{@"operation":@"network",@"method":@"POST",@"url":@"https://wallet-auth.ynxweb4.com/v2/product-sessions/time"} requestID:rid error:&e]);e=nil;
    check(![b performServiceReadPort:@{@"operation":@"network",@"method":@"GET",@"url":@"https://unregistered.invalid/api/v1/ide/deployments/other"} requestID:rid error:&e]);e=nil;

    check(![b performServiceReadPort:@{@"operation":@"sign",@"input":proof(b,@"POST",@"/v2/product-sessions/introspect",'s')} requestID:rid error:&e]);e=nil;
    check([b performServiceReadPort:@{@"operation":@"sign",@"input":proof(b,@"GET",route(NO),'t')} requestID:rid error:&e]);check(!e);
    check([b endServiceRead:&e]);check(![b performServiceReadPort:@{@"operation":@"context"} requestID:rid error:&e]);e=nil;
    b=device();b.loginAllowed=NO;o=observer(b);check([b approveServiceRead:o requestID:rid error:&e]);
    check([b performServiceReadPort:@{@"operation":@"context"} requestID:rid error:&e]);check([b endServiceRead:&e]);
    puts("PRIVATE_READ_PORTS_EXACT_EXISTING_SESSION_GET_ONLY_PASS");return 0;
 }
 if(argc>1&&strcmp(argv[1],"read-only")==0){b.loginAllowed=NO;PublicReadObserver*read=observer(b);if(![b approveServiceRead:read requestID:rid error:&e]){fputs("READ_REVIEW_WRONGLY_REQUIRES_OLD_LOGIN_CONSENT\n",stderr);return 2;}assert([b sign:p error:&e]);assert(![b sign:proof(b,@"POST",@"/v2/product-sessions/introspect",'m') error:&e]);e=nil;assert([b endServiceRead:&e]);assert(![b sign:proof(b,@"GET",route(NO),'n') error:&e]);puts("INDEPENDENT_READ_APPROVAL_GET_ONLY_NOT_LOGIN_PASS");return 0;}
 if(argc>1){NSMutableDictionary *bad=[p mutableCopy];bad[@"payload"]=YNXDeviceB64([@"YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n[]" dataUsingEncoding:NSUTF8StringEncoding]);@try{assert(![b sign:bad error:&e]);puts("MALFORMED_PROOF_REFUSED_WITHOUT_EXCEPTION");return 0;}@catch(id cause){fprintf(stderr,"MALFORMED_PROOF_THREW_EXCEPTION\n");return 2;}}
 assert(![b sign:p error:&e]);e=nil;
 PublicReadObserver*o=observer(b);assert([b approveServiceRead:o requestID:rid error:&e]);assert(!e);
 assert([b sign:p error:&e]);assert(!e);assert(![b sign:p error:&e]);e=nil;
 assert([b sign:proof(b,@"GET",route(YES),'d') error:&e]);assert(!e);
 assert(![b sign:proof(b,@"GET",@"/api/v1/ide/deployments/00000000-0000-4000-8000-000000000002",'e') error:&e]);e=nil;
 assert(![b sign:proof(b,@"POST",route(NO),'f') error:&e]);e=nil;
 assert([b endServiceRead:&e]);assert([b sign:proof(b,@"POST",@"/v2/product-sessions/introspect",'g') error:&e]);assert(!e);

 b=device();o=observer(b);NSMutableDictionary*wrong=[o.data mutableCopy],*principal=[wrong[@"principal"]mutableCopy];principal[@"sessionRef"]=YNXDeviceHash(@"PUBLIC-other-session");wrong[@"principal"]=principal;o.data=wrong;
 assert(![b approveServiceRead:o requestID:rid error:&e]);e=nil;

 b=device();o=observer(b);assert([b approveServiceRead:o requestID:rid error:&e]);
 NSMutableDictionary*newer=[b.sessionData mutableCopy];newer[@"sessionBinding"]=YNXDeviceHash(@"PUBLIC-new-session");b.sessionData=newer;
 assert(![b sign:proof(b,@"GET",route(NO),'h') error:&e]);e=nil;

 b=device();o=observer(b);assert([b approveServiceRead:o requestID:rid error:&e]);o.failAt=3;
 assert(![b sign:proof(b,@"GET",route(NO),'i') error:&e]);assert(e==o.failure);
 Ivar seen=class_getInstanceVariable(YNXWalletDeviceBridge.class,"_signedNonces");NSSet*nonces=object_getIvar(b,seen);assert([nonces containsObject:token('i')]);e=nil;

 b=device();o=observer(b);assert([b approveServiceRead:o requestID:rid error:&e]);o.failClose=YES;
 assert(![b endServiceRead:&e]&&e==o.failure);e=nil;
 assert(![b approveServiceRead:observer(b) requestID:rid error:&e]);e=nil;
 assert(![b sign:proof(b,@"GET",route(NO),'j') error:&e]);e=nil;

 b=device();o=observer(b);assert([b approveServiceRead:o requestID:rid error:&e]);
 Ivar budget=class_getInstanceVariable(YNXWalletDeviceBridge.class,"_serviceReadBudget");NSTimeInterval expired=-1;memcpy((char*)(__bridge void*)b+ivar_getOffset(budget),&expired,sizeof(expired));
 assert(![b sign:proof(b,@"GET",route(NO),'k') error:&e]);e=nil;

 b=device();o=observer(b);assert([b approveServiceRead:o requestID:rid error:&e]);
 wrong=[o.data mutableCopy];NSMutableDictionary*r=[wrong[@"serviceRegistration"]mutableCopy];r[@"revoked"]=@YES;wrong[@"serviceRegistration"]=r;o.data=wrong;
 assert(![b sign:proof(b,@"GET",route(NO),'l') error:&e]);
 puts("PUBLIC_NATIVE_SERVICE_READ_PROOF_CONTROLS_PASS_NO_ROOT_NO_KEYCHAIN_NO_HTTP");
}}

