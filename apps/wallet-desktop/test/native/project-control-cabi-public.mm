#import "../../native/original-project-control-cabi.h"
#include <cassert>
#include <cstdio>
#include <initializer_list>
using namespace ynx_wallet_private;
static unsigned mode,calls;
extern "C" int32_t YNXProjectControlSignV1(YNXProjectControlRequestV1*r,uint8_t*out,size_t capacity,size_t*length,uint32_t*cleanup){
 calls++;assert(r->abi_version==1&&r->struct_size==sizeof(*r)&&r->pkcs8_a.length==54&&r->pkcs8_b.length==150&&r->pk_a.length==2592&&r->pk_b.length==64&&r->observed_at_ms==12345);assert(capacity==98304&&*length==0&&*cleanup==0);
 if(mode==4)@throw [NSException exceptionWithName:@"PUBLIC crypto exception" reason:@"no real cryptography" userInfo:nil];
 out[0]=1;out[1]=2;out[2]=3;*length=mode==3?capacity+1:3;*cleanup=mode==1?0:mode==2?3:2;return mode==2?9:0;
}
static NSMutableData*record(){
 const char magic[]="YNX-PROJECT-CONTROL-CUSTODY/v1\n";NSMutableData*out=[NSMutableData dataWithBytes:magic length:sizeof(magic)-1];
 for(uint32_t size:{54,150,2592,64}){unsigned char n[4]={(unsigned char)(size>>24),(unsigned char)(size>>16),(unsigned char)(size>>8),(unsigned char)size};[out appendBytes:n length:4];NSMutableData*part=[NSMutableData dataWithLength:size];memset(part.mutableBytes,7,size);[out appendData:part];}return out;
}
static void wiped(NSData*data){for(NSUInteger i=0;i<data.length;i++)assert(((const unsigned char*)data.bytes)[i]==0);}
int main(){@autoreleasepool{
 NSMutableData*source=record();ControlMaterialBorrow spans;assert(borrowOriginalControlMaterial(source.bytes,source.length,spans));unsigned char network[32]={};YNXProjectControlExpectedV1 expected{};expected.network_id={network,32};expected.pk_a={spans.pkA.bytes,2592};expected.pk_b={spans.pkB.bytes,64};NSData*publicData=[@"PUBLIC original bytes" dataUsingEncoding:NSUTF8StringEncoding];
 for(mode=0;mode<4;mode++){NSMutableData*own=record();auto r=invokeOriginalProjectControlCABI(own,publicData,publicData,publicData,expected,12345);assert(r.invoked);assert((r.member!=nil)==(mode==0));assert(r.outputValid==(mode==0));wiped(own);}
 mode=4;NSMutableData*thrown=record();BOOL caught=NO;@try{invokeOriginalProjectControlCABI(thrown,publicData,publicData,publicData,expected,12345);}@catch(NSException*){caught=YES;}assert(caught);wiped(thrown);
 unsigned before=calls;NSMutableData*bad=[NSMutableData dataWithLength:100];auto invalid=invokeOriginalProjectControlCABI(bad,publicData,publicData,publicData,expected,12345);assert(!invalid.invoked&&calls==before);wiped(bad);
 unsigned char foreign[2592]={};expected.pk_a={foreign,sizeof(foreign)};NSMutableData*mismatch=record();auto noCall=invokeOriginalProjectControlCABI(mismatch,publicData,publicData,publicData,expected,12345);assert(!noCall.invoked&&calls==before);wiped(mismatch);
 puts("{\"cases\":7,\"calls\":5,\"actualGoCrypto\":false,\"SourceQualified\":false,\"realKeys\":false}");
}return 0;}
