#import "../../native/original-project-control-cabi.h"
#include <cassert>
#include <cstdio>
// Synthetic-only stdin fixture. Private DER never enters argv, disk or stdout.
// PUBLIC historical originals/clock are explicit test DATA, not live consent.
int main(){@autoreleasepool{
 NSData*input=[NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];assert(input.length>0&&input.length<32768);const uint8_t*p=(const uint8_t*)input.bytes;NSUInteger at=0;NSMutableArray<NSData*>*parts=[NSMutableArray new];
 for(unsigned i=0;i<13;i++){assert(input.length-at>=4);uint32_t n=0;for(unsigned j=0;j<4;j++)n=(n<<8)|p[at++];assert(n>0&&n<=input.length-at);[parts addObject:[NSData dataWithBytes:p+at length:n]];at+=n;}assert(at==input.length);
 NSMutableData*record=[parts[0]mutableCopy];auto span=[](NSData*b)->YNXProjectControlBytesV1{return{(const uint8_t*)b.bytes,b.length};};
 YNXProjectControlExpectedV1 expected{span(parts[4]),span(parts[5]),span(parts[6]),span(parts[7]),span(parts[8]),span(parts[9]),span(parts[10]),span(parts[11])};
 NSString*clock=[[NSString alloc]initWithData:parts[12]encoding:NSUTF8StringEncoding];NSScanner*s=[NSScanner scannerWithString:clock];unsigned long long now=0;assert([s scanUnsignedLongLong:&now]&&s.isAtEnd);
 auto result=ynx_wallet_private::invokeOriginalProjectControlCABI(record,parts[1],parts[2],parts[3],expected,now);assert(result.invoked&&result.status==0&&result.cleanup==2&&result.outputValid&&result.member.length);
 for(NSUInteger i=0;i<record.length;i++)assert(((const uint8_t*)record.bytes)[i]==0);
 // Wipe fixture-side copies of the synthetic custody record as well. Immutable
 // Foundation/runtime allocations are not claimed to be physically erased.
 NSMutableData*privateInput=[input mutableCopy];[privateInput resetBytesInRange:NSMakeRange(0,privateInput.length)];
 NSDictionary*out=@{@"memberOriginalBase64":[result.member base64EncodedStringWithOptions:0],@"actualCABI":@YES,@"syntheticOnly":@YES,@"MainBorrowWiped":@YES,@"Root":@NO,@"Source":@NO,@"realUserConsent":@NO};NSData*json=[NSJSONSerialization dataWithJSONObject:out options:NSJSONWritingSortedKeys error:nil];assert(json);[NSFileHandle.fileHandleWithStandardOutput writeData:json];
}return 0;}
