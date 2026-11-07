// Actual sole C++ fixed-sign adapter and DATA codec; PUBLIC only C-ABI backend.
// This tests Native borrowed inputs reach the fixed typed math ABI after exact
// E5 validation. Real Go/CIRCL crypto remains supplier evidence, not this seam.
#define main runNativeAgentControls
#include "ai-agent-public.cpp"
#undef main
#include "ai_task_agent_fixed_v6.h"
extern "C" int32_t YNXAITaskActionAgentFixedSignV6(YNXAITaskAgentFixedSignRequestV6*r,uint8_t*out,size_t cap,size_t*length,uint32_t*cleanup){++mathCalls;assert(r&&r->version==6&&r->struct_size==sizeof(*r)&&r->message_original.length==message.size()&&!std::memcmp(r->message_original.bytes,message.data(),message.size())&&r->pkcs8_a.length==54&&r->pkcs8_b.length==150&&cap==98304);static const char output[]="PUBLIC-NOT-CRYPTO-MEMBER";*length=sizeof(output)-1;std::memcpy(out,output,*length);*cleanup=2;return 0;}
int main(int argc,char**argv){return runNativeAgentControls(argc,argv);}
