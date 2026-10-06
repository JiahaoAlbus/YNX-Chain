#include "ynx-wallet-device-bridge.h"
#include <assert.h>
#include <objc/runtime.h>
// Controlled filesystem provider ONLY; never calls SecItem or creates keys.
@interface ControlledBridge : YNXWalletDeviceBridge
@property NSString *directory;
@property NSUInteger writes;
@property BOOL failBeforeWrite;
@property BOOL failReadback;
@property BOOL failNextRead;
@end
@implementation ControlledBridge
- (BOOL)loadKeyCreating:(BOOL)create error:(NSError **)error {return YES;}
- (NSString *)publicKey {return @"AkFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB";}
- (NSString *)path:(NSString *)key {return [_directory stringByAppendingPathComponent:YNXDeviceHash(key)];}
- (NSString *)protectedRead:(NSString *)key error:(NSError **)error {if(_failNextRead){_failNextRead=NO;[self fail:error reason:@"QA_READBACK_FAILED"];return nil;}NSString *p=[self path:key];if(![NSFileManager.defaultManager fileExistsAtPath:p])return nil;return [NSString stringWithContentsOfFile:p encoding:NSUTF8StringEncoding error:error];}
- (BOOL)protectedReplace:(NSString *)value key:(NSString *)key error:(NSError **)error {if(_failBeforeWrite)return [self fail:error reason:@"QA_COMMIT_INTERRUPTED"];_writes++;BOOL ok=[value writeToFile:[self path:key] atomically:YES encoding:NSUTF8StringEncoding error:error];if(ok&&_failReadback){_failReadback=NO;_failNextRead=YES;}return ok;}
@end
static ControlledBridge *bridge(NSString *root) {ControlledBridge *b=[[ControlledBridge alloc]initWithTag:@"QA-only-no-key" storageService:@"QA-only-no-keychain" lockDirectory:root];b.directory=root;return b;}
static NSString *token(NSString *prefix){return [prefix stringByPaddingToLength:43 withString:@"a" startingAtIndex:0];}
static NSString *intent(ControlledBridge *b,NSString *identifier,id target){return YNXDeviceCanonical(@{@"version":@1,@"intentId":identifier,@"scope":[b revocationScope],@"session":target?:NSNull.null});}
static NSString *receipt(ControlledBridge *b,NSString *identifier,id target,NSString *outcome){return YNXDeviceCanonical(@{@"version":@1,@"intentId":identifier,@"scope":[b revocationScope],@"targetDigest":target?YNXDeviceDigest(@"YNX_PRODUCT_SESSION_REVOKED_TARGET_V1",target):NSNull.null,@"sessionBinding":target?target[@"sessionBinding"]:NSNull.null,@"outcome":outcome});}
static NSDictionary *session(ControlledBridge *b,NSString *name){NSMutableDictionary *s=[@{@"version":@"2",@"sessionBinding":YNXDeviceHash(name),@"chainId":@"ynx_6423-1",@"productId":@"developer",@"clientId":@"ynx-developer-v1",@"platform":@"macos",@"applicationId":@"com.ynxweb4.developer.testnetpreview",@"bundleId":@"com.ynxweb4.developer.testnetpreview",@"packageId":NSNull.null,@"origin":@"app://macos/com.ynxweb4.developer.testnetpreview",@"callback":@"ynxdeveloper://wallet-auth/callback",@"account":@"ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",@"deviceId":@"ynx-developer-macos-device-v2",@"deviceAlgorithm":@"p256-sha256",@"deviceKey":b.publicKey,@"nonce":token(name),@"state":token(@"state"),@"scopes":@[@"account:read",@"developer:deploy"],@"requestDigest":YNXDeviceHash(@"request"),@"approvalDigest":YNXDeviceHash(@"approval"),@"issuedAt":@"2026-01-01T00:00:00.000Z",@"expiresAt":@"2026-01-01T00:03:00.000Z"} mutableCopy];NSMutableDictionary *binding=[NSMutableDictionary new];for(NSString *k in @[@"chainId",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"deviceId",@"deviceAlgorithm",@"deviceKey"])binding[k]=s[k];s[@"deviceBinding"]=YNXDeviceDigest(@"YNX_PRODUCT_SESSION_DEVICE_V2",binding);return s;}
int main(int argc,const char **argv){@autoreleasepool{assert(argc>=3);NSString *mode=@(argv[1]),*root=@(argv[2]);ControlledBridge *b=bridge(root);NSError *e=nil;
 if([mode isEqual:@"completion"]){
 // A transient QA P256 key, never permanent and never stored in a Keychain.
 SecKeyRef key=SecKeyCreateRandomKey((__bridge CFDictionaryRef)@{(__bridge id)kSecAttrKeyType:(__bridge id)kSecAttrKeyTypeECSECPrimeRandom,(__bridge id)kSecAttrKeySizeInBits:@256,(__bridge id)kSecAttrIsPermanent:@NO},NULL);assert(key);
 Ivar ivar=class_getInstanceVariable(YNXWalletDeviceBridge.class,"_privateKey");memcpy((char *)(__bridge void *)b+ivar_getOffset(ivar),&key,sizeof(key)); // bridge owns release
 assert([b beginUserOperation:&e]);NSMutableDictionary *request=[session(b,@"signed") mutableCopy];for(NSString *k in @[@"sessionBinding",@"account",@"deviceBinding",@"requestDigest",@"approvalDigest"]) [request removeObjectForKey:k];request[@"purpose"]=@"QA signed completion";
 NSMutableDictionary *approval=[request mutableCopy];approval[@"account"]=session(b,@"signed")[@"account"];
 NSMutableDictionary *challenge=[approval mutableCopy];challenge[@"requestDigest"]=YNXDeviceDigest(@"YNX_PRODUCT_SESSION_REQUEST_V2",request);challenge[@"approvalDigest"]=YNXDeviceDigest(@"YNX_PRODUCT_SESSION_APPROVAL_V2",approval);
 NSData *bytes=[[NSString stringWithFormat:@"YNX_PRODUCT_SESSION_CHALLENGE_V2\n%@",YNXDeviceCanonical(challenge)] dataUsingEncoding:NSUTF8StringEncoding];NSData *sig=CFBridgingRelease(SecKeyCreateSignature(key,kSecKeyAlgorithmECDSASignatureMessageX962SHA256,(__bridge CFDataRef)bytes,NULL));assert(sig);
 NSString *encoded=[[sig base64EncodedStringWithOptions:0] stringByReplacingOccurrencesOfString:@"+" withString:@"-"];encoded=[[encoded stringByReplacingOccurrencesOfString:@"/" withString:@"_"] stringByReplacingOccurrencesOfString:@"=" withString:@""];
 NSString *wrapper=YNXDeviceCanonical(@{@"request":request,@"approval":approval,@"completion":@{@"challenge":challenge,@"deviceSignature":encoded}});
 assert(![b fullBinding:YNXAtomicJSON(wrapper)]);assert([b rawStore:wrapper key:YNXAtomicKeys()[3] error:&e]);assert([[b stored:YNXAtomicKeys()[3] error:&e] isEqual:wrapper]);assert([b remove:YNXAtomicKeys()[3] error:&e]);assert(![b stored:YNXAtomicKeys()[3] error:&e]);assert(!e);[b endUserOperation];puts("SIGNED_COMPLETION_PASS");return 0;
 }
 if([mode isEqual:@"locked"]){assert(![b beginUserOperation:&e]);assert(e);puts("LOCK_REFUSED");return 0;}
 if([mode isEqual:@"read"]){assert([[b getRevocationCompletion:YNXAtomicKeys()[5] intentId:token(@"id") error:&e] isEqual:@(argv[3])]);assert(!e&&b.writes==0);puts("COLD_READ_PASS");return 0;}
 if([mode isEqual:@"migration"]){
    NSString *base=YNXDeviceCanonical(session(b,@"legacy"));assert([b protectedReplace:base key:YNXDeviceStorageBase error:&e]);
    assert([b protectedReplace:@"{bad" key:YNXAtomicKeys()[1] error:&e]);assert([b beginUserOperation:&e]);e=nil;NSUInteger writes=b.writes;
    assert(![b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:intent(b,token(@"migrate"),nil) error:&e]);assert(e&&writes==b.writes);e=nil;assert([[b protectedRead:YNXDeviceStorageBase error:&e] isEqual:base]);
    // Remove only fixture-created malformed input, then verify explicit v1 import.
    assert([NSFileManager.defaultManager removeItemAtPath:[b path:YNXAtomicKeys()[1]] error:&e]);
    NSString *raw=intent(b,token(@"migrate"),nil);assert([b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:raw error:&e]);NSString *envelope=[b protectedRead:YNXDeviceStorageBase error:&e];assert([YNXAtomicJSON(envelope)[@"format"] isEqual:YNXAtomicFormat]);assert([[b stored:YNXDeviceStorageBase error:&e] isEqual:base]);
    // A retired writer can only change its stale suffix; authoritative v1 never
    // falls back to it. The original base-shape guard rejects this envelope.
    assert(![b fullBinding:YNXAtomicJSON(envelope)]);assert([b protectedReplace:@"legacy pending pollution" key:YNXAtomicKeys()[1] error:&e]);assert(![b stored:YNXAtomicKeys()[1] error:&e]);assert(!e);
    NSMutableDictionary *foreign=[YNXAtomicJSON(raw) mutableCopy];foreign[@"scope"]=YNXDeviceHash(@"foreign");writes=b.writes;assert(![b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:YNXDeviceCanonical(foreign) error:&e]);assert(writes==b.writes);e=nil;
    raw=[b stored:YNXAtomicKeys()[4] error:&e];NSString *done=receipt(b,token(@"migrate"),session(b,@"legacy"),@"authority-expired");assert([b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:raw receiptRaw:done error:&e]);
    // Numeric booleans/noncanonical receipt cannot be accepted as version one.
    NSString *noncanonical=[done stringByAppendingString:@" "];writes=b.writes;assert(![b acknowledgeRevocationCompletion:YNXAtomicKeys()[5] expectedReceiptRaw:noncanonical error:&e]);assert(writes==b.writes);e=nil;
    NSDictionary *state=YNXAtomicJSON([b protectedRead:YNXDeviceStorageBase error:&e]);NSMutableDictionary *records=[state[@"records"] mutableCopy];records[YNXAtomicKeys()[5]]=@"[] ";NSMutableDictionary *corrupt=[state mutableCopy];corrupt[@"records"]=records;assert([b protectedReplace:YNXDeviceCanonical(corrupt) key:YNXDeviceStorageBase error:&e]);writes=b.writes;assert(![b getRevocationCompletions:YNXAtomicKeys()[5] error:&e]);assert(e&&writes==b.writes);
    [b endUserOperation];puts("MIGRATION_CORRUPTION_PASS");return 0;
 }
 assert([b beginUserOperation:&e]);assert(!e);
 // An independent process cannot mutate/read during the original physical lock.
 NSTask *child=[NSTask new];child.executableURL=[NSURL fileURLWithPath:@(argv[0])];child.arguments=@[@"locked",root];assert([child launchAndReturnError:&e]);[child waitUntilExit];assert(child.terminationStatus==0);
 NSString *raw=intent(b,token(@"id"),nil),*done=receipt(b,token(@"id"),nil,@"local-only");assert([[b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:raw error:&e] isEqual:raw]);NSUInteger count=b.writes;
 assert([[b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:intent(b,token(@"other"),nil) error:&e] isEqual:raw]);assert(b.writes==count);
 b.failBeforeWrite=YES;assert(![b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:raw receiptRaw:done error:&e]);assert([e.localizedDescription hasPrefix:@"UNKNOWN"]);b.failBeforeWrite=NO;e=nil;assert([[b rawStored:YNXAtomicKeys()[4] error:&e] isEqual:raw]);
 b.failReadback=YES;assert(![b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:raw receiptRaw:done error:&e]);assert([e.localizedDescription hasPrefix:@"UNKNOWN"]);e=nil;assert(![b rawStored:YNXAtomicKeys()[4] error:&e]);assert([[b getRevocationCompletion:YNXAtomicKeys()[5] intentId:token(@"id") error:&e] isEqual:done]);count=b.writes;assert([[b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:raw receiptRaw:done error:&e] isEqual:done]);assert(count==b.writes);
 [b endUserOperation];child=[NSTask new];child.executableURL=[NSURL fileURLWithPath:@(argv[0])];child.arguments=@[@"read",root,done];assert([child launchAndReturnError:&e]);[child waitUntilExit];assert(child.terminationStatus==0);assert([b beginUserOperation:&e]);
 // New session survives old intent cleanup and exact acknowledgement.
 NSDictionary *old=session(b,@"old"),*newer=session(b,@"new");assert([b revocationSession:old]);assert([b rawStore:YNXDeviceCanonical(old) key:YNXDeviceStorageBase error:&e]);raw=intent(b,token(@"target"),old);done=receipt(b,token(@"target"),old,@"server-revoked");assert([b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:raw error:&e]);assert(![b rawStore:YNXDeviceCanonical(newer) key:YNXDeviceStorageBase error:&e]);assert([e.localizedDescription isEqual:@"REVOCATION_PENDING"]);e=nil;/* Simulate a retained newer state from another already-authoritative writer. */assert([b atomicOperation:^id(NSMutableDictionary *r,NSError **err){r[YNXDeviceStorageBase]=YNXDeviceCanonical(newer);return @YES;} error:&e]);
 NSString *different=receipt(b,token(@"target"),newer,@"server-revoked");assert(![b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:raw receiptRaw:different error:&e]);e=nil;assert([[b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:raw receiptRaw:done error:&e] isEqual:done]);assert([[b stored:YNXDeviceStorageBase error:&e] isEqual:YNXDeviceCanonical(newer)]);
 assert(![b acknowledgeRevocationCompletion:YNXAtomicKeys()[5] expectedReceiptRaw:receipt(b,token(@"target"),old,@"authority-expired") error:&e]);e=nil;assert([b acknowledgeRevocationCompletion:YNXAtomicKeys()[5] expectedReceiptRaw:done error:&e]);assert([b acknowledgeRevocationCompletion:YNXAtomicKeys()[5] expectedReceiptRaw:done error:&e]);assert([[b stored:YNXDeviceStorageBase error:&e] isEqual:YNXDeviceCanonical(newer)]);
 // Exact target cleanup removes only its session/anchor, in the same commit.
 NSString *anchor=[@"native-session-anchor:" stringByAppendingString:newer[@"sessionBinding"]];assert([b rawStore:YNXDeviceDigest(@"YNX_DEVELOPER_NATIVE_SESSION_ANCHOR_V1",newer) key:anchor error:&e]);raw=intent(b,token(@"matching"),newer);done=receipt(b,token(@"matching"),newer,@"authority-expired");assert([b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:raw error:&e]);count=b.writes;assert([b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:raw receiptRaw:done error:&e]);assert(b.writes==count+1);assert(![b stored:YNXDeviceStorageBase error:&e]);assert(![b rawStored:anchor error:&e]);assert([b acknowledgeRevocationCompletion:YNXAtomicKeys()[5] expectedReceiptRaw:done error:&e]);
 // c5 recovery upgrades null targets for the same intent only, including
 // completion-derived structurally valid targets (no base persisted yet).
 raw=intent(b,token(@"upgrade"),nil);assert([b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:raw error:&e]);
 NSString *up=intent(b,token(@"upgrade"),old);assert([[b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:up error:&e] isEqual:up]);
 assert([[b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:intent(b,token(@"upgrade"),newer) error:&e] isEqual:up]);
 done=receipt(b,token(@"upgrade"),old,@"authority-expired");assert([b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:up receiptRaw:done error:&e]);assert([b acknowledgeRevocationCompletion:YNXAtomicKeys()[5] expectedReceiptRaw:done error:&e]);
 // A late in-flight base publication upgrades the same null intent atomically.
 raw=intent(b,token(@"inflight"),nil);assert([b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:raw error:&e]);assert([b rawStore:YNXDeviceCanonical(old) key:YNXDeviceStorageBase error:&e]);up=intent(b,token(@"inflight"),old);assert([[b stored:YNXAtomicKeys()[4] error:&e] isEqual:up]);done=receipt(b,token(@"inflight"),old,@"authority-expired");assert([b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:up receiptRaw:done error:&e]);assert([b acknowledgeRevocationCompletion:YNXAtomicKeys()[5] expectedReceiptRaw:done error:&e]);
 // Pending-only local cancellation must leave all three suffixes empty.
 NSMutableDictionary *request=[old mutableCopy];request[@"purpose"]=@"QA cancellation";for(NSString *k in @[@"sessionBinding",@"account",@"deviceBinding",@"requestDigest",@"approvalDigest"]) [request removeObjectForKey:k];
 assert([b rawStore:YNXDeviceCanonical(request) key:YNXAtomicKeys()[1] error:&e]);raw=intent(b,token(@"localpending"),nil);assert([b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:raw error:&e]);
 assert(![b rawStore:YNXDeviceCanonical(request) key:YNXAtomicKeys()[1] error:&e]);assert([e.localizedDescription isEqual:@"REVOCATION_PENDING"]);e=nil;
 done=receipt(b,token(@"localpending"),nil,@"local-only");assert([b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:raw receiptRaw:done error:&e]);for(NSUInteger n=1;n<=3;n++)assert(![b stored:YNXAtomicKeys()[n] error:&e]);assert([b acknowledgeRevocationCompletion:YNXAtomicKeys()[5] expectedReceiptRaw:done error:&e]);
 // Fill 64 entries: the 65th completion must preserve its pending intent.
 for(int i=1;i<64;i++){NSString *iD=token([NSString stringWithFormat:@"capacity%d",i]);NSString *r=intent(b,iD,nil);assert([b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:r error:&e]);assert([b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:r receiptRaw:receipt(b,iD,nil,@"local-only") error:&e]);}
 raw=intent(b,token(@"full"),nil);assert([b saveRevocationIntent:YNXAtomicKeys()[4] rawIntent:raw error:&e]);assert(![b finishRevocationIntentWithCompletion:YNXAtomicKeys()[4] expectedRawIntent:raw receiptRaw:receipt(b,token(@"full"),nil,@"local-only") error:&e]);assert([e.localizedDescription isEqual:@"REVOCATION_COMPLETION_FULL"]);e=nil;assert([[b rawStored:YNXAtomicKeys()[4] error:&e] isEqual:raw]);
 [b endUserOperation];puts("CONTROLLED_ATOMIC_PASS");return 0;}}
