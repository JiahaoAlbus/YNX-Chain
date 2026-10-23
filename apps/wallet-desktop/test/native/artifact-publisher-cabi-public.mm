#import "../../native/original-artifact-publisher-cabi.h"
#include <cassert>
#include <cstdio>
// Only ephemeral original Protocol SYNTHETIC-ONLY fixture material. No Source,
// keychain, user key/approval, network, persistence grant or transaction exists.
static NSData*read(NSString*dir,NSString*name){NSData*b=[NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:name]];assert(b.length);return b;}
static NSMutableData*custody(NSString*dir,NSData*r){
 NSMutableData*out=[NSMutableData dataWithBytes:"YNX-PUBLISHER-CUSTODY/v1\n" length:sizeof("YNX-PUBLISHER-CUSTODY/v1\n")-1];
 for(NSData*b in @[r,read(dir,@"SYNTHETIC-ONLY-a.der"),read(dir,@"SYNTHETIC-ONLY-b.der"),read(dir,@"pk-a.bin"),read(dir,@"pk-b.bin")]){
  uint32_t n=(uint32_t)b.length;uint8_t length[4]={(uint8_t)(n>>24),(uint8_t)(n>>16),(uint8_t)(n>>8),(uint8_t)n};[out appendBytes:length length:4];[out appendData:b];
 }return out;
}
static void wiped(NSMutableData*b){for(NSUInteger i=0;i<b.length;i++)assert(static_cast<const uint8_t*>(b.bytes)[i]==0);}
int main(int argc,char**argv){@autoreleasepool{
 assert(argc==3);NSString*input=[NSString stringWithUTF8String:argv[1]],*output=[NSString stringWithUTF8String:argv[2]];
 NSData*r=read(input,@"registration.bin"),*manifest=read(input,@"manifest.json");NSDictionary*binding=SourceProjectR13(r);assert(binding);
 using namespace ynx_wallet_private;
 for(NSString*name in @[@"memberOriginal.bin",@"memberOriginal-second.bin"]){
  // Two separate standalone math test invocations, NOT retrying a Wallet
  // request. The live original approval once-state has its own Native tests.
  NSMutableData*record=custody(input,r);auto result=invokeOriginalPublisherCABI(record,r,binding,manifest);wiped(record);
  assert(result.invoked&&result.status==YNX_ARTIFACT_OK_V1&&result.cleanup==YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1&&result.member.length>0&&result.member.length<=98304);
  assert([result.member writeToFile:[output stringByAppendingPathComponent:name]options:NSDataWritingWithoutOverwriting error:nil]);
 }
 std::puts("PASS actual fixed archive CABI returns bounded public member and wipes original custody");
 {
  auto record=custody(input,r);auto bytes=static_cast<uint8_t*>(record.mutableBytes);const size_t offset=sizeof("YNX-PUBLISHER-CUSTODY/v1\n")-1+4+r.length+4;bytes[offset]^=1;
  auto result=invokeOriginalPublisherCABI(record,r,binding,manifest);wiped(record);assert(result.invoked&&result.status!=YNX_ARTIFACT_OK_V1&&!result.member);
 }std::puts("PASS malformed private DER cannot yield a public result and original custody is wiped");
 {
  auto record=custody(input,r);NSMutableData*other=[r mutableCopy];static_cast<uint8_t*>(other.mutableBytes)[other.length-1]^=1;auto otherBinding=SourceProjectR13(other);assert(otherBinding);
  auto result=invokeOriginalPublisherCABI(record,other,otherBinding,manifest);wiped(record);assert(!result.invoked&&!result.member);
 }std::puts("PASS custody registration cannot substitute independent current Source registration");
 {
  auto record=custody(input,r);NSMutableDictionary*other=[binding mutableCopy];other[@"projectId"]=@"PUBLIC-other-project";auto result=invokeOriginalPublisherCABI(record,r,other,manifest);wiped(record);assert(!result.invoked&&!result.member);
 }std::puts("PASS mismatched independently captured public metadata refuses before private CABI import");
 {
  auto record=custody(input,r);auto result=invokeOriginalPublisherCABI(record,r,binding,[@"{}" dataUsingEncoding:NSUTF8StringEncoding]);wiped(record);assert(result.invoked&&result.status!=YNX_ARTIFACT_OK_V1&&!result.member);
 }std::puts("PASS malformed original manifest refuses without sizing or replacement signing call");
 {
  auto record=custody(input,r);[record appendBytes:"x" length:1];auto result=invokeOriginalPublisherCABI(record,r,binding,manifest);wiped(record);assert(!result.invoked&&!result.member);
 }std::puts("PASS trailing custody bytes refuse before call and are wiped too");
 {
  auto record=custody(input,r);auto result=invokeOriginalPublisherCABI(record,r,nil,manifest);wiped(record);assert(!result.invoked&&!result.member);
 }std::puts("PASS missing current binding never borrows custody as its own approval");
 std::puts("SYNTHETIC_ONLY actualCABI=1 userKeys=0 Source=0 approval=0 broadcast=0 physicalEraseClaimed=0");
 return 0;
}}
