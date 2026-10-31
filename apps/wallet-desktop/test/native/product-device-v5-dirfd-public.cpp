// Actual original HostDirfdJournal filesystem; C ABI remains PUBLIC stub.
#include "product-device-v5-public-data.h"
#include <iostream>
static unsigned calls=0;
extern "C" int32_t YNXProductSessionHTTPProofSignV5(YNXProductSessionHTTPRequestV5*,uint8_t*out,size_t cap,size_t*len,uint32_t*cleanup){assert(cap==98304);calls++;out[0]=13;out[1]=17;*len=2;*cleanup=2;return 0;}
int main(int argc,char**argv){assert(argc==2);PUBLICFixture f;f.journal.open(argv[1],"v5-once");auto once=f.make();once->reserve();auto request=f.request();const auto out=invokeOriginalProductDeviceV5HTTPBorrow(*once,request);assert(out.mathCompleted&&out.terminalRecorded&&calls==1);const auto key=once->recordKeyDATA();const auto names=f.journal.list();assert(names.size()==2);assert(f.journal.read(key+".entered",131072).find("YNX-PRODUCT-DEVICE-HTTP-ENTERED/v5")==0);assert(f.journal.close());
 PUBLICFixture cold;cold.journal.open(argv[1],"v5-once");auto retained=cold.make();refused([&]{retained->reserve();});assert(retained->recoveredDATA()&&retained->resultDATA()==0&&retained->cleanupDATA()==2&&retained->reportedLengthDATA()==2);assert(retained->copyRetainedOutcomeDATA()==out.member);refused([&]{retained->selectPrimitiveEntry();});assert(calls==1);assert(cold.journal.close());std::cout<<"PUBLIC_V5_ACTUAL_DIRFD_COLD_NO_REPLAY_PASS\n";
}
