#include "original-ide-parent-transport.h"
#include <cassert>
#include <thread>
#include <iostream>
using namespace ynx_auth_ide_private;
template<class F>bool refused(F f){try{f();return false;}catch(const std::runtime_error&){return true;}}
int main(){
 int fds[2];assert(socketpair(AF_UNIX,SOCK_STREAM,0,fds)==0);Prelude p{};p.kind=PreludeKind::readyNode;p.intent.fill('a');auto raw=encodePrelude(p);
 std::thread peer([&]{for(unsigned i=0;i<raw.size();i++)assert(send(fds[1],raw.data()+i,1,0)==1);const char tail[]="{\"type\":\"installed\"}\n";assert(send(fds[1],tail,sizeof(tail)-1,0)==sizeof(tail)-1);});
 PreludeTransport transport(fds[0],1000);auto read=transport.read();assert(read.kind==p.kind);transport.handoff();assert(refused([&]{transport.read();}));assert(refused([&]{transport.write(p);}));
 peer.join();char tail[64]{};auto size=recv(fds[0],tail,sizeof(tail),0);assert(std::string(tail,size)=="{\"type\":\"installed\"}\n");close(fds[0]);close(fds[1]);
 assert(socketpair(AF_UNIX,SOCK_STREAM,0,fds)==0);PreludeTransport timeout(fds[0],2);assert(refused([&]{timeout.read();}));close(fds[0]);close(fds[1]);
 assert(socketpair(AF_UNIX,SOCK_STREAM,0,fds)==0);assert(send(fds[1],raw.data(),17,0)==17);close(fds[1]);PreludeTransport partial(fds[0],100);assert(refused([&]{partial.read();}));assert(refused([&]{partial.read();}));close(fds[0]);
 std::cout<<"PASS real socket production prelude transport: fragments, untouched installed tail, post-handoff IO refusal, bounded timeout, partial EOF sticky UNKNOWN\n";
}
