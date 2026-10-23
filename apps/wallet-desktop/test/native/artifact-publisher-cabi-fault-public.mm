#import "../../native/original-artifact-publisher-cabi.h"
#include <cassert>
#include <cstdio>
// Controlled C ABI output-boundary faults only. This executable NEVER links
// the real crypto archive. Separate actual-archive tests establish real math.
static unsigned mode,calls;
extern "C" int32_t YNXArtifactPublicationSignV1(YNXArtifactPublicationRequestV1*,uint8_t*output,size_t capacity,size_t*length,uint32_t*cleanup){
 calls++;assert(capacity==98304);assert(*length==0&&*cleanup==YNX_ARTIFACT_CLEANUP_UNKNOWN_V1);
 if(mode==5)@throw [NSException exceptionWithName:@"PUBLIC C ABI boundary" reason:@"controlled exception" userInfo:nil];
 output[0]=7;output[1]=8;output[2]=9;*length=mode==2?capacity+1:3;
 *cleanup=mode==0?YNX_ARTIFACT_CLEANUP_UNKNOWN_V1:mode==1?YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1:YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1;
 return mode==3?YNX_ARTIFACT_SIGNING_V1:YNX_ARTIFACT_OK_V1;
}
static NSData*registration(){
 NSArray*parts=@[[@"YNX-IDE-ARTIFACT-PUBLISHER/v1" dataUsingEncoding:NSUTF8StringEncoding],[@"YNX-BATCH/v0.1" dataUsingEncoding:NSUTF8StringEncoding],[@"ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512" dataUsingEncoding:NSUTF8StringEncoding],[@"ARTIFACT-RELEASE" dataUsingEncoding:NSUTF8StringEncoding],[@"ide-artifact-publisher" dataUsingEncoding:NSUTF8StringEncoding],[NSMutableData dataWithLength:32],[@"0x1111111111111111111111111111111111111111" dataUsingEncoding:NSUTF8StringEncoding],[@"PUBLIC-account" dataUsingEncoding:NSUTF8StringEncoding],[@"PUBLIC-project" dataUsingEncoding:NSUTF8StringEncoding],[@"PUBLIC-publisher" dataUsingEncoding:NSUTF8StringEncoding],[@"1" dataUsingEncoding:NSUTF8StringEncoding],[NSMutableData dataWithLength:2592],[NSMutableData dataWithLength:64]];
 uint8_t count[4]={0,0,0,13};NSMutableData*out=[NSMutableData dataWithBytes:count length:4];
 for(NSData*b in parts){uint32_t n=(uint32_t)b.length;uint8_t size[4]={(uint8_t)(n>>24),(uint8_t)(n>>16),(uint8_t)(n>>8),(uint8_t)n};[out appendBytes:size length:4];[out appendData:b];}return out;
}
static NSMutableData*record(NSData*r){
 NSMutableData*out=[NSMutableData dataWithBytes:"YNX-PUBLISHER-CUSTODY/v1\n" length:sizeof("YNX-PUBLISHER-CUSTODY/v1\n")-1];
 for(NSData*b in @[r,[NSMutableData dataWithLength:54],[NSMutableData dataWithLength:150],[NSMutableData dataWithLength:2592],[NSMutableData dataWithLength:64]]){uint32_t n=(uint32_t)b.length;uint8_t size[4]={(uint8_t)(n>>24),(uint8_t)(n>>16),(uint8_t)(n>>8),(uint8_t)n};[out appendBytes:size length:4];[out appendData:b];}return out;
}
int main(){@autoreleasepool{
 NSData*r=registration(),*manifest=[@"PUBLIC non-crypto boundary manifest" dataUsingEncoding:NSUTF8StringEncoding];NSDictionary*binding=SourceProjectR13(r);assert(binding);
 for(mode=0;mode<6;mode++){
  auto privateRecord=record(r);unsigned before=calls;bool caught=false;
  @try{auto result=ynx_wallet_private::invokeOriginalPublisherCABI(privateRecord,r,binding,manifest);assert(result.invoked);if(mode==4)assert(result.member.length==3);else assert(!result.member);}
  @catch(NSException*e){caught=true;assert(mode==5&&[e.name isEqual:@"PUBLIC C ABI boundary"]);}
  assert(calls==before+1&&caught==(mode==5));for(NSUInteger i=0;i<privateRecord.length;i++)assert(static_cast<const uint8_t*>(privateRecord.bytes)[i]==0);
  std::puts("PASS controlled output/cleanup/exception boundary never retries and wipes original private bytes");
 }
 std::puts("PUBLIC_CABI_BOUNDARY_DOUBLES_ONLY actualCrypto=0 Source=0 userApproval=0");return 0;
}}
