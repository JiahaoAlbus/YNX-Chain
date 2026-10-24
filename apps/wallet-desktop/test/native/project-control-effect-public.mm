#define YNX_CONTROL_REVIEW_PUBLIC_NO_MAIN 1
#include "project-control-review-public.mm"
#import "original-ide-project-control-custody.h"
#include <ynx_project_control.h>
#include <initializer_list>
#include <CommonCrypto/CommonDigest.h>
static unsigned publicCryptoMode,publicCryptoCalls,publicCustodyReads;static OSStatus publicCustodyStatus;static NSMutableData*publicProtectedRecord;
static NSString*publicSHA(NSData*data){unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data.bytes,(CC_LONG)data.length,digest);NSMutableString*out=[NSMutableString new];for(unsigned char b:digest)[out appendFormat:@"%02x",b];return out;}
extern "C" OSStatus YNXControlCustodyPublicCopy(CFDictionaryRef raw,CFTypeRef*out){
 NSDictionary*q=(__bridge NSDictionary*)raw;publicCustodyReads++;assert([q[(__bridge id)kSecAttrService]isEqual:@"com.ynxweb4.wallet.project-control.v1"]);assert([q[(__bridge id)kSecAttrAccount]isEqual:publicControlContext[@"keychainAccount"]]);assert([q[(__bridge id)kSecUseDataProtectionKeychain]isEqual:@YES]);assert([q[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]);assert([q[(__bridge id)kSecUseAuthenticationContext]interactionNotAllowed]);
 *out=CFBridgingRetain(@{(__bridge id)kSecAttrService:q[(__bridge id)kSecAttrService],(__bridge id)kSecAttrAccount:q[(__bridge id)kSecAttrAccount],(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly,(__bridge id)kSecAttrSynchronizable:@NO,(__bridge id)kSecValueData:publicProtectedRecord});return publicCustodyStatus;
}
// Compile the actual original Auth body, replacing ONLY the OS read at this
// PUBLIC test boundary. No user Keychain, Root, Source or actual crypto is used.
#include YNX_CONTROL_CUSTODY_ORIGINAL_MM
#if !defined(YNX_CONTROL_EFFECT_ACTUAL_CABI)
extern "C" int32_t YNXProjectControlSignV1(YNXProjectControlRequestV1*r,uint8_t*out,size_t capacity,size_t*length,uint32_t*cleanup){
 publicCryptoCalls++;assert(r->abi_version==1&&capacity==98304&&*length==0&&*cleanup==0);assert(r->pkcs8_a.length==54&&r->pkcs8_b.length==150&&r->expected.pk_a.length==2592&&r->expected.pk_b.length==64);
 if(publicCryptoMode==4){*cleanup=1;return YNX_CONTROL_PUBLIC_BINDING_V1;}
 out[0]=1;out[1]=2;out[2]=3;*length=3;*cleanup=publicCryptoMode==1?0:2;
 if(publicCryptoMode==2)sourceLive=NO;if(publicCryptoMode==3)addStatus=errSecInteractionNotAllowed;return publicCryptoMode==1?YNX_CONTROL_CLEANUP_V1:0;
}
#endif
static YNXOriginalProjectControlReview*effect(NSString*request,NSString*choice=@"approve"){
 capture(request);publicReleaseFail=NO;publicCustodyStatus=errSecSuccess;publicCryptoMode=0;const char magic[]="YNX-PROJECT-CONTROL-CUSTODY/v1\n";publicProtectedRecord=[NSMutableData dataWithBytes:magic length:sizeof(magic)-1];NSMutableArray*parts=[NSMutableArray new];
 for(uint32_t n:{54,150,2592,64}){unsigned char length[4]={(unsigned char)(n>>24),(unsigned char)(n>>16),(unsigned char)(n>>8),(unsigned char)n};NSMutableData*b=[NSMutableData dataWithLength:n];memset(b.mutableBytes,7,n);[parts addObject:b];[publicProtectedRecord appendBytes:length length:4];[publicProtectedRecord appendData:b];}
 publicControlContext=@{@"networkId":publicCapture[@"review"][@"networkId"],@"owner":[@"0x" stringByPaddingToLength:42 withString:@"1" startingAtIndex:0],@"keyVersion":@"1",@"executionHeight":@"1",@"callerIdentity":@"PUBLIC-caller",@"sourceCurrentRef":@"PUBLIC-current",@"pkA":parts[2],@"pkB":parts[3],@"keychainAccount":[@"b" stringByPaddingToLength:64 withString:@"b" startingAtIndex:0],@"expiresAtMs":publicCapture[@"expiresAtMs"]};NSError*e=nil;auto own=[YNXOriginalProjectControlReview captureOriginal:&e];assert(own&&!e&&[own selectOriginalDecision:request decision:choice error:&e]);return own;
}
#if defined(YNX_CONTROL_EFFECT_ACTUAL_CABI)
int main(){@autoreleasepool{
 // Fresh ephemeral synthetic KEY7 input only. The protected OS read and Source
 // below remain PUBLIC doubles; Main/Auth/CABI bodies are their actual code.
 NSData*wire=[NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];assert(wire.length>0&&wire.length<32768);const uint8_t*p=(const uint8_t*)wire.bytes;NSUInteger at=0;NSMutableArray<NSData*>*parts=[NSMutableArray new];
 for(unsigned i=0;i<16;i++){assert(wire.length-at>=4);uint32_t n=0;for(unsigned j=0;j<4;j++)n=(n<<8)|p[at++];assert(n>0&&n<=wire.length-at);[parts addObject:[NSData dataWithBytes:p+at length:n]];at+=n;}assert(at==wire.length);
 auto text=[](NSData*b){return[[NSString alloc]initWithData:b encoding:NSUTF8StringEncoding];};NSString*network=text(parts[3]),*requestID=text(parts[12]);NSDictionary*command=[NSJSONSerialization JSONObjectWithData:parts[15]options:0 error:nil];assert(command);
 items=[NSMutableDictionary new];sourceLive=YES;readStatus=addStatus=errSecSuccess;commitUnknown=corruptRead=NO;publicReleaseFail=NO;publicCustodyStatus=errSecSuccess;publicProtectedRecord=[parts[0]mutableCopy];
 publicCapture=@{@"requestOriginal":parts[13],@"principalOriginal":parts[1],@"commandOriginal":parts[2],@"expiresAtMs":text(parts[11]),@"review":@{@"reviewId":@"PUBLIC-actual-main-native-effect",@"account":text(parts[14]),@"networkId":network,@"command":command}};
 publicControlContext=@{@"networkId":network,@"owner":text(parts[4]),@"keyVersion":text(parts[5]),@"executionHeight":text(parts[6]),@"callerIdentity":text(parts[7]),@"sourceCurrentRef":text(parts[8]),@"pkA":parts[9],@"pkB":parts[10],@"keychainAccount":[@"b" stringByPaddingToLength:64 withString:@"b" startingAtIndex:0],@"expiresAtMs":text(parts[11])};
 NSError*e=nil;auto own=[YNXOriginalProjectControlReview captureOriginal:&e];assert(own&&!e);assert([own selectOriginalDecision:@"PUBLIC-actual-main-native-effect" decision:@"approve" error:&e]);BOOL signedOK=[own signOriginalApproval:&e];if(!signedOK)fprintf(stderr,"PUBLIC actual native effect: %s\n",e.localizedDescription.UTF8String);assert(signedOK&&!e);
 NSDictionary*state=[own copyOriginalDecision:&e];NSData*proof=[own copyOriginalApprovalProof:&e];assert(proof&&!e&&[state[@"hasSignedResult"]boolValue]&&[state[@"resultStored"]boolValue]&&![state[@"cleanupPending"]boolValue]);unsigned reads=publicCustodyReads;assert(![own signOriginalApproval:&e]&&publicCustodyReads==reads);assert([own close:&e]);
 NSDictionary*out=@{@"approvalOriginal":[[NSString alloc]initWithData:proof encoding:NSUTF8StringEncoding],@"actualMainBody":@YES,@"actualAuthCustodyBody":@YES,@"actualCABI":@YES,@"syntheticOnly":@YES,@"systemKeychain":@NO,@"Source":@NO,@"realUserConsent":@NO};NSData*json=[NSJSONSerialization dataWithJSONObject:out options:NSJSONWritingSortedKeys error:nil];assert(json);[NSFileHandle.fileHandleWithStandardOutput writeData:json];[publicProtectedRecord resetBytesInRange:NSMakeRange(0,publicProtectedRecord.length)];
}return 0;}
#else
int main(){@autoreleasepool{
 items=[NSMutableDictionary new];NSError*e=nil;auto normal=effect(@"PUBLIC normal production call");BOOL normalOK=[normal signOriginalApproval:&e];if(!normalOK||e)fprintf(stderr,"PUBLIC normal error: %s\n",e.localizedDescription.UTF8String);assert(normalOK&&!e);NSDictionary*s=[normal copyOriginalDecision:&e];assert([s[@"hasSignedResult"]boolValue]&&[s[@"resultStored"]boolValue]&&![s[@"cleanupPending"]boolValue]);assert([normal close:&e]);
 for(NSString*choice in @[@"cancel",@"reject"]){auto no=effect([@"PUBLIC no borrow " stringByAppendingString:choice],choice);unsigned reads=publicCustodyReads,calls=publicCryptoCalls;assert(![no signOriginalApproval:&e]);assert(publicCustodyReads==reads&&publicCryptoCalls==calls);assert([no close:&e]);}
 auto unknown=effect(@"PUBLIC crypto cleanup unknown");publicCryptoMode=1;assert(![unknown signOriginalApproval:&e]);s=[unknown copyOriginalDecision:&e];assert(![s[@"hasSignedResult"]boolValue]&&[s[@"cleanupPending"]boolValue]);
 NSData*unknownKey=bytes([@"YNX-CONTROL-EFFECT-UNKNOWN/v1:" stringByAppendingString:publicSHA(publicCapture[@"requestOriginal"])]);NSData*unknownBytes=[[YNXOriginalProjectControlJournal new]copyOriginalDecisionForRequest:unknownKey error:&e];assert(unknownBytes&&!e);NSDictionary*savedUnknown=[NSPropertyListSerialization propertyListWithData:unknownBytes options:NSPropertyListImmutable format:nullptr error:&e];assert(!e&&[savedUnknown[@"cabiCleanup"]isEqual:@"0"]&&[savedUnknown[@"cabiStatus"]isEqual:@"9"]);
 assert(![unknown close:&e]);unsigned calls=publicCryptoCalls;assert([unknown saveOriginalApprovalResult:&e]&&publicCryptoCalls==calls);assert(![unknown signOriginalApproval:&e]&&publicCryptoCalls==calls);
 auto lost=effect(@"PUBLIC post crypto Source retired");publicCryptoMode=2;assert(![lost signOriginalApproval:&e]&&e);s=[lost copyOriginalDecision:&e];assert([s[@"hasSignedResult"]boolValue]&&[s[@"resultStored"]boolValue]);assert([lost close:&e]);
 auto save=effect(@"PUBLIC result save refused");publicCryptoMode=3;NSUInteger beforeSave=adds;assert(![save signOriginalApproval:&e]);assert(adds==beforeSave+2); // one intent, one failed outcome write; NO automatic second attempt
 s=[save copyOriginalDecision:&e];assert([s[@"hasSignedResult"]boolValue]&&![s[@"resultStored"]boolValue]);calls=publicCryptoCalls;addStatus=errSecSuccess;assert([save saveOriginalApprovalResult:&e]);s=[save copyOriginalDecision:&e];assert([s[@"resultStored"]boolValue]&&![s[@"cleanupPending"]boolValue]&&publicCryptoCalls==calls);assert([save close:&e]);
 auto partial=effect(@"PUBLIC OS partial plus error");publicCustodyStatus=errSecInteractionNotAllowed;calls=publicCryptoCalls;assert(![partial signOriginalApproval:&e]);s=[partial copyOriginalDecision:&e];assert([s[@"phase"]isEqual:@"approval-failed"]&&[s[@"resultStored"]boolValue]&&![s[@"cleanupPending"]boolValue]&&publicCryptoCalls==calls);assert([partial close:&e]);
 auto failed=effect(@"PUBLIC explicit preflight failure");publicCryptoMode=4;assert(![failed signOriginalApproval:&e]);s=[failed copyOriginalDecision:&e];assert([s[@"phase"]isEqual:@"approval-failed"]&&![s[@"hasSignedResult"]boolValue]&&![s[@"cleanupPending"]boolValue]);assert([failed close:&e]);
 auto cleanup=effect(@"PUBLIC cleanup first failure");publicReleaseFail=YES;assert(![cleanup signOriginalApproval:&e]);s=[cleanup copyOriginalDecision:&e];assert([s[@"hasSignedResult"]boolValue]&&[s[@"cleanupPending"]boolValue]);assert(![cleanup close:&e]);
 puts("{\"cases\":9,\"actualMainBody\":true,\"actualAuthCustodyBody\":true,\"actualCrypto\":false,\"systemKeychain\":false,\"Source\":false,\"realUserConsent\":false}");
}return 0;}
#endif
