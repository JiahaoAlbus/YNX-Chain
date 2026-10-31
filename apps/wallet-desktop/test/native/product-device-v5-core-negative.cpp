// Actual formal Core archive, PUBLIC negative calls only. No private material,
// generated keys, positive signing, Source acquisition or HTTP operation.
#include "product-device-v5-public-data.h"
#include <iostream>
int main(int argc,char**argv){assert(argc==2);PUBLICFixture f;auto request=f.request();std::array<uint8_t,98304>out;out.fill(0xa5);size_t len=777;uint32_t cleanup=888;
 request.version=4;assert(YNXProductSessionHTTPProofSignV5(&request,out.data(),out.size(),&len,&cleanup)==YNX_HTTP_V5_INVALID_ARGUMENT);assert(len==777&&cleanup==888&&out[0]==0xa5);
 request.version=5;assert(YNXProductSessionHTTPProofSignV5(&request,out.data(),out.size()-1,&len,&cleanup)==YNX_HTTP_V5_CAPACITY);assert(len==777&&cleanup==888&&out[0]==0xa5);
 request.actual_body.length=YNX_PRODUCT_SESSION_HTTP_V5_BODY_MAX+1;assert(YNXProductSessionHTTPProofSignV5(&request,out.data(),out.size(),&len,&cleanup)==YNX_HTTP_V5_BOUNDS);assert(len==777&&cleanup==888&&out[0]==0xa5);request=f.request();
 f.journal.open(argv[1],"v5-negative");auto once=f.make();once->reserve();const auto result=invokeOriginalProductDeviceV5HTTPBorrow(*once,request);assert(result.primitiveCalled&&result.result==YNX_HTTP_V5_PUBLIC_BINDING&&result.cleanup==YNX_HTTP_V5_CLEANUP_NOT_REQUIRED&&result.reportedLength==0&&result.member.empty()&&result.terminalRecorded&&!result.mathCompleted);assert(!result.authorized&&!result.usableHTTP);refused([&]{invokeOriginalProductDeviceV5HTTPBorrow(*once,request);});assert(f.journal.close());
 PUBLICFixture cold;cold.journal.open(argv[1],"v5-negative");auto original=cold.make();refused([&]{original->reserve();});assert(original->recoveredDATA()&&original->resultDATA()==YNX_HTTP_V5_PUBLIC_BINDING&&original->cleanupDATA()==YNX_HTTP_V5_CLEANUP_NOT_REQUIRED&&original->reportedLengthDATA()==0);refused([&]{original->selectPrimitiveEntry();});assert(cold.journal.close());std::cout<<"ACTUAL_CORE_V5_NEGATIVE_4_PREFLIGHTS_COLD_UNKNOWN_PASS math=false Source=false HTTP=false\n";
}
