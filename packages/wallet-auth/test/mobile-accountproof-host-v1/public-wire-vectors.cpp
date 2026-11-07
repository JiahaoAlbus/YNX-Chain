#include "../../native/mobile-accountproof-host-v1/MobileAccountProofWireDATA.hpp"
#include <iostream>
int main(int argc,char**){namespace a=ynx::sdk::mobile::accountproof;namespace w=a::wire;w::FrameDATA f;f.sequence=9007199254740993ULL;if(argc>1){f.sequence=1;f.status=w::Status::Failed;f.reader[0]=7;f.failure={true,0};}auto b=w::encodeFrameDATA(f);auto d=w::decodeFrameDATA(b);if(d.sequence!=f.sequence)return 2;std::cout.write(reinterpret_cast<const char*>(b.data()),b.size());}
