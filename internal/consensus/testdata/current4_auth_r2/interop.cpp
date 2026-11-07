// Test-only PUBLIC cross-process caller of original Auth r2 BODY. FD3/4 are
// this harness's constants, NOT a P09 slot or a Root-qualified launcher ABI.
#include "Current4WireClient.hpp"
#include <algorithm>
#include <array>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#include <unistd.h>

using ynx::auth::current4::Reply;
using ynx::auth::current4::WireClient;
using Bytes=std::vector<uint8_t>;
static void require(bool ok,const char* reason){if(!ok)throw std::runtime_error(reason);}
static Bytes original(const std::string&dir,const char*name,size_t limit,size_t exact=0){
 std::ifstream f(dir+"/"+name,std::ios::binary|std::ios::ate);
 require(bool(f),"PUBLIC original open failed");auto size=f.tellg();
 require(size>0&&uint64_t(size)<=limit&&(!exact||uint64_t(size)==exact),"PUBLIC original bound differs");
 Bytes b(static_cast<size_t>(size));f.seekg(0);f.read(reinterpret_cast<char*>(b.data()),static_cast<std::streamsize>(b.size()));
 require(bool(f)&&f.peek()==std::char_traits<char>::eof(),"PUBLIC original short/trailing");return b;
}
static void common(const Reply&r,bool denied){require(r.code==0&&r.error_present==denied,"code0 independent denial bit differs");}
int main(int argc,char**argv){
 try{
  require(argc==2,"only one PUBLIC expected-directory test argument permitted");
  const std::string dir=argv[1];
  auto net=original(dir,"network.bin",32,32),own=original(dir,"owner.bin",42,42),h=original(dir,"height.bin",8,8),policy=original(dir,"policy.bin",YNX_CURRENT4_PRIVATE_POLICY_MAX);
  std::array<uint8_t,32>network{};std::copy(net.begin(),net.end(),network.begin());
  std::array<uint8_t,42>owner{};std::copy(own.begin(),own.end(),owner.begin());
  uint64_t height=0;for(auto byte:h)height=(height<<8)|byte;require(height>0,"PUBLIC expected height absent");
  // No fake peer, read provider or source object: both inherited endpoints go
  // directly to separate original Go Node/Application-paired DATA children.
  {
   WireClient client(3,std::chrono::steady_clock::now()+std::chrono::seconds(10));Reply r;
   require(client.capture(network,owner,r),"original Core CAPTURE transport failed");common(r,false);
   require(r.owner_present&&client.remoteOwnerDebt(),"CAPTURE owner debt absent");
   require(client.read(policy.size(),r),"original Core READ transport failed");common(r,false);
   require(r.height==height&&r.owner==owner&&r.policy==policy,"full original policy bytes/height/owner differ");
   require(client.current(r),"original Core CURRENT transport failed");common(r,false);
   require(client.retire(r),"original Core RETIRE transport failed");common(r,false);
   require(client.join(r),"original Core JOIN transport failed");common(r,false);require(r.physical_complete,"DATA read/context debt remained");
   require(client.close(r),"original Core CLOSE transport failed");common(r,false);
   require(r.physical_complete&&!client.remoteOwnerDebt()&&!client.unknown(),"original close acknowledgement/debt differs");
  }
  std::cout<<"PASS original-auth-r2-to-real-core-policy-and-cleanup\n";
  {
   WireClient client(4,std::chrono::steady_clock::now()+std::chrono::seconds(10));Reply r;network[0]^=1;
   require(client.capture(network,owner,r),"denied Core CAPTURE transport failed");common(r,true);
   require(r.owner_present&&client.remoteOwnerDebt(),"failed CAPTURE partial was not adopted");
   // Production Auth r2 must latch present=true even with numerical code zero.
   // These refused calls produce no second READ/CURRENT frame on this channel.
   r.code=123;r.policy={0x5a};
   require(!client.read(policy.size(),r)&&r.code==123&&r.policy==Bytes{0x5a},"denied capture permitted read/output mutation");
   require(!client.current(r)&&r.code==123&&!client.unknown(),"denied capture permitted current or invented UNKNOWN");
   require(client.retire(r),"partial RETIRE transport failed");common(r,true);
   require(client.join(r),"partial JOIN transport failed");common(r,true);require(r.physical_complete,"partial DATA debt did not drain");
   require(client.close(r),"partial CLOSE transport failed");common(r,true);
   require(r.physical_complete&&!client.remoteOwnerDebt()&&!client.unknown(),"partial original physical cleanup/first cause differs");
  }
  std::cout<<"PASS original-auth-r2-code0-partial-denial-and-cleanup\n";
  return 0;
 }catch(const std::exception&e){std::cerr<<"Current4 PUBLIC interop failure: "<<e.what()<<"\n";return 1;}
}
