#import "../../native/original-publisher-registration-cabi.h"
#include <cassert>
#include <cstdio>
#include <initializer_list>
// No real archive, entropy, signatures, keychain or Source. These are public
// structural buffers exercising Main's actual three private adapter bodies.
static unsigned mode=0,generation=0,popCalls=0,custodianCalls=0;
static NSData*R;
static NSMutableData*publicRecord(NSData*r,bool control=false){
 const char*magic=control?"YNX-PROJECT-CONTROL-CUSTODY/v1\n":"YNX-PUBLISHER-CUSTODY/v1\n";
 NSMutableData*out=[NSMutableData dataWithBytes:magic length:std::strlen(magic)];
 NSMutableArray*parts=[NSMutableArray new];if(!control)[parts addObject:r];
 for(NSNumber*n in @[@54,@150,@2592,@64]){NSMutableData*b=[NSMutableData dataWithLength:n.unsignedIntegerValue];if(control)std::memset(b.mutableBytes,1,b.length);[parts addObject:b];}
 for(NSData*b in parts){uint32_t n=CFSwapInt32HostToBig((uint32_t)b.length);[out appendBytes:&n length:4];[out appendData:b];}return out;
}
static void allZero(NSData*b){for(NSUInteger i=0;i<b.length;i++)assert(((const uint8_t*)b.bytes)[i]==0);}
static int32_t output(uint8_t*b,size_t cap,size_t*n,uint32_t*c){
 assert(cap==131072&&*n==0&&*c==YNX_ARTIFACT_CLEANUP_UNKNOWN_V1);
 if(mode==5)@throw[NSException exceptionWithName:@"PUBLIC" reason:nil userInfo:nil];
 b[0]=1;b[1]=2;*n=mode==2?cap+1:2;*c=mode==0?YNX_ARTIFACT_CLEANUP_UNKNOWN_V1:mode==1?YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1:YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1;
 return mode==3?YNX_ARTIFACT_SIGNING_V1:YNX_ARTIFACT_OK_V1;
}
extern "C" int32_t YNXPublisherGenerateV1(YNXPublisherGenerateRequestV1*q,uint8_t*b,size_t cap,size_t*n,uint8_t*p,size_t pcap,size_t*pn,uint32_t*c){
 generation++;assert(q->abi_version==1&&q->struct_size==sizeof(*q)&&cap==16384&&pcap==8192&&*n==0&&*pn==0&&*c==0);
 if(mode==5)@throw[NSException exceptionWithName:@"PUBLIC" reason:nil userInfo:nil];
 NSMutableData*record=publicRecord(R);std::memcpy(b,record.bytes,record.length);std::memcpy(p,R.bytes,R.length);*n=mode==2?cap+1:record.length;*pn=R.length;
 *c=mode==0?0:mode==1?1:2;if(mode==6)b[0]^=1;allZero([NSData data]);return mode==3?YNX_ARTIFACT_KEY_MATERIAL_V1:YNX_ARTIFACT_OK_V1;
}
extern "C" int32_t YNXPublisherPoPSignV1(YNXPublisherPoPRequestV1*q,uint8_t*b,size_t cap,size_t*n,uint32_t*c){popCalls++;assert(q->abi_version==1&&q->struct_size==sizeof(*q)&&q->public_original.length==R.length&&q->pkcs8_a.length==54&&q->pkcs8_b.length==150&&q->observed_at_ms==7);return output(b,cap,n,c);}
extern "C" int32_t YNXPublisherCustodianSignV1(YNXPublisherCustodianRequestV1*q,uint8_t*b,size_t cap,size_t*n,uint32_t*c){custodianCalls++;assert(q->abi_version==1&&q->struct_size==sizeof(*q)&&q->pop_member_original.length==2&&q->pk_a.bytes[0]==1&&q->publisher.pk_a.bytes[0]==0&&q->observed_at_ms==7);return output(b,cap,n,c);}
int main(){@autoreleasepool{
 R=[@"PUBLIC-only R framing; NOT crypto" dataUsingEncoding:NSUTF8StringEncoding];
 auto network=[NSMutableData dataWithLength:32],pkA=[NSMutableData dataWithLength:2592],pkB=[NSMutableData dataWithLength:64],ca=[NSMutableData dataWithLength:2592],cb=[NSMutableData dataWithLength:64];std::memset(ca.mutableBytes,1,ca.length);std::memset(cb.mutableBytes,1,cb.length);
 const auto span=[](NSData*b)->YNXArtifactBytesV1{return{(const uint8_t*)b.bytes,b.length};};
 NSData*owner=[@"0x1111111111111111111111111111111111111111" dataUsingEncoding:NSUTF8StringEncoding],*label=[@"PUBLIC" dataUsingEncoding:NSUTF8StringEncoding],*version=[@"1" dataUsingEncoding:NSUTF8StringEncoding];
 YNXPublisherIdentityV1 identity={span(network),span(owner),span(label),span(label),span(label),span(version)};
 YNXArtifactPublisherExpectedV1 expected={span(network),span(owner),span(label),span(label),span(label),span(version),span(pkA),span(pkB)};
 YNXProjectControlExpectedV1 custodian{};custodian.network_id={(const uint8_t*)network.bytes,network.length};custodian.pk_a={(const uint8_t*)ca.bytes,ca.length};custodian.pk_b={(const uint8_t*)cb.bytes,cb.length};
 NSData*pop=[NSData dataWithBytes:"PP" length:2];
 for(mode=0;mode<7;mode++){
  bool threw=false;unsigned before=generation;@try{auto result=ynx_wallet_private::invokeOriginalPublisherGenerateCABI(identity);assert(result.invoked);assert((result.record!=nil)==(mode==4));if(result.record){assert([result.publicOriginal isEqual:R]);ynx_wallet_private::wipePublisherRegistrationBuffer(result.record);allZero(result.record);}}@catch(NSException*){threw=true;assert(mode==5);}assert(generation==before+1&&threw==(mode==5));std::puts("PASS generation fixed output/cleanup/malformed record/exception single call");
 }
 for(mode=0;mode<6;mode++){
  for(bool custodianMode:{false,true}){
   auto record=publicRecord(R,custodianMode);unsigned before=custodianMode?custodianCalls:popCalls;bool threw=false;
   @try{auto result=custodianMode?ynx_wallet_private::invokeOriginalPublisherCustodianCABI(record,R,label,label,label,pop,expected,custodian,7):ynx_wallet_private::invokeOriginalPublisherPoPCABI(record,R,label,label,label,expected,7);assert(result.invoked);assert((result.member!=nil)==(mode==4));}@catch(NSException*){threw=true;assert(mode==5);}
   assert((custodianMode?custodianCalls:popCalls)==before+1&&threw==(mode==5));allZero(record);std::puts("PASS fixed PoP/custodian output/cleanup/exception single call and private wipe");
  }
 }
 mode=4;auto malformed=publicRecord(R);((uint8_t*)malformed.mutableBytes)[0]^=1;unsigned before=popCalls;auto bad=ynx_wallet_private::invokeOriginalPublisherPoPCABI(malformed,R,label,label,label,expected,7);assert(!bad.invoked&&popCalls==before);allZero(malformed);
 auto same=publicRecord(R,true);custodian.pk_b=expected.pk_b.length?YNXProjectControlBytesV1{expected.pk_b.bytes,expected.pk_b.length}:YNXProjectControlBytesV1{};before=custodianCalls;auto rejected=ynx_wallet_private::invokeOriginalPublisherCustodianCABI(same,R,label,label,label,pop,expected,custodian,7);assert(!rejected.invoked&&custodianCalls==before);allZero(same);std::puts("PASS malformed or same-pair refuses before ABI and wipes");
 std::puts("PUBLIC_ADAPTER_DOUBLES_ONLY actualCrypto=0 realGeneration=0 Source=0 userApproval=0 keychain=0");return 0;
}}
