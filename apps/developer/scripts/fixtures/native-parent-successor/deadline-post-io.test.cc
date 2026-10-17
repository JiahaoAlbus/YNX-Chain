#include <chrono>
#include <thread>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#include <cassert>
#include <string>
#include <iostream>
enum class Delay {none,poll,send,recv};
static Delay delay=Delay::none;
static unsigned ioCalls=0;
static void delayed(Delay point){if(delay==point)std::this_thread::sleep_for(std::chrono::milliseconds(30));}
static int delayedPoll(pollfd *p,nfds_t n,int ms){int r=::poll(p,n,ms);delayed(Delay::poll);return r;}
static ssize_t delayedSend(int fd,const void *p,size_t n,int flags){++ioCalls;auto r=::send(fd,p,n,flags);delayed(Delay::send);return r;}
static ssize_t delayedRecv(int fd,void *p,size_t n,int flags){++ioCalls;auto r=::recv(fd,p,n,flags);delayed(Delay::recv);return r;}
// Actual production transport, real socket syscalls; only return scheduling
// is delayed, modelling a descheduled thread after a ready/completed syscall.
#define poll delayedPoll
#define send delayedSend
#define recv delayedRecv
#include "original-ide-parent-transport.h"
#undef poll
#undef send
#undef recv
using namespace ynx_auth_ide_private;
template<class F>static void timeout(F f){bool denied=false;try{f();}catch(const std::runtime_error&e){denied=std::string(e.what())=="IDE_PRELUDE_TIMEOUT_UNKNOWN";}assert(denied);}
static void run(Delay d,bool write){
 int fd[2];assert(socketpair(AF_UNIX,SOCK_STREAM,0,fd)==0);
 Prelude p{};p.kind=PreludeKind::readyNode;p.intent.fill('a');auto raw=encodePrelude(p);
 if(!write)assert(::send(fd[1],raw.data(),raw.size(),0)==(ssize_t)raw.size());
 delay=d;ioCalls=0;PreludeTransport transport(fd[0],5);
 timeout([&]{if(write)transport.write(p);else (void)transport.read();});
 unsigned selected=ioCalls;bool refused=false;try{transport.read();}catch(const std::runtime_error&){refused=true;}
 assert(refused&&ioCalls==selected);assert(!transport.handedOff());
 bool handoffRefused=false;try{transport.handoff();}catch(const std::runtime_error&){handoffRefused=true;}assert(handoffRefused);
 close(fd[0]);close(fd[1]);delay=Delay::none;
}
int main(){
 run(Delay::poll,false);run(Delay::poll,true);run(Delay::recv,false);run(Delay::send,true);
 int fd[2];assert(socketpair(AF_UNIX,SOCK_STREAM,0,fd)==0);PreludeTransport handoff(fd[0],5);
 std::this_thread::sleep_for(std::chrono::milliseconds(30));timeout([&]{handoff.handoff();});assert(!handoff.handedOff());close(fd[0]);close(fd[1]);
 std::cout<<"PASS actual socket transport post-poll/read/write and handoff deadline; sticky UNKNOWN/no IO retry\n";
}
