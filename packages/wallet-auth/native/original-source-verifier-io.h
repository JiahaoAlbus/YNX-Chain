#pragma once
#include <algorithm>
#include <chrono>
#include <cerrno>
#include <cstdint>
#include <functional>
#include <stdexcept>
#include <vector>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
namespace ynx_auth_private {
// Borrowed endpoints only: caller retains original NSFileHandles/task and all
// close/UNKNOWN debt. This function never kills, closes output, or retries work.
inline std::vector<unsigned char> boundedVerifierIO(
 int input,int output,int errors,const unsigned char *bytes,std::size_t size,
 const std::function<bool()> &finishInput,const std::function<bool()> &running,
 unsigned budgetMS=7000){
 using Clock=std::chrono::steady_clock;
 const auto end=Clock::now()+std::chrono::milliseconds(std::min(budgetMS,7000u));
 auto fail=[](const char *code)->void{throw std::runtime_error(code);};
 if(input<0||output<0||errors<0||input==output||input==errors||output==errors||size>131072||!budgetMS)fail("AUTH_IDENTITY_VERIFIER_IO_INVALID");
 for(int fd:{input,output,errors}){int flags=fcntl(fd,F_GETFL);if(flags<0||fcntl(fd,F_SETFL,flags|O_NONBLOCK))fail("AUTH_IDENTITY_VERIFIER_NONBLOCK_UNKNOWN");}
#ifdef F_SETNOSIGPIPE
 if(fcntl(input,F_SETNOSIGPIPE,1))fail("AUTH_IDENTITY_VERIFIER_NOSIGPIPE_UNKNOWN");
#endif
 std::vector<unsigned char> result;std::size_t sent=0;bool inputClosed=false,outEOF=false,errEOF=false;
 auto deadline=[&](){if(Clock::now()>=end)fail("AUTH_IDENTITY_VERIFIER_TIMEOUT_UNKNOWN");};
 while(true){
  deadline();
  if(!inputClosed&&sent==size){if(!finishInput())fail("AUTH_IDENTITY_VERIFIER_INPUT_CLOSE_UNKNOWN");inputClosed=true;deadline();}
  if(inputClosed&&outEOF&&errEOF){bool alive=running();deadline();if(!alive)return result;}
  pollfd fds[3]={{inputClosed?-1:input,POLLOUT,0},{outEOF?-1:output,POLLIN,0},{errEOF?-1:errors,POLLIN,0}};
  auto left=std::chrono::duration_cast<std::chrono::milliseconds>(end-Clock::now()).count();
  int rc=poll(fds,3,(int)std::max<int64_t>(1,std::min<int64_t>(left,10)));deadline();
  if(rc<0){if(errno==EINTR)continue;fail("AUTH_IDENTITY_VERIFIER_POLL_UNKNOWN");}
  for(const auto &fd:fds)if(fd.revents&POLLNVAL)fail("AUTH_IDENTITY_VERIFIER_ENDPOINT_UNKNOWN");
  if(!inputClosed&&(fds[0].revents&(POLLOUT|POLLHUP|POLLERR))){
   ssize_t n=write(input,bytes+sent,std::min<std::size_t>(4096,size-sent));deadline();
   if(n>0)sent+=(std::size_t)n;else if(n<0&&(errno==EAGAIN||errno==EINTR)){}else fail("AUTH_IDENTITY_VERIFIER_INPUT_UNKNOWN");
  }
  for(unsigned index=1;index<3;index++)if(fds[index].fd>=0&&(fds[index].revents&(POLLIN|POLLHUP|POLLERR))){
   unsigned char chunk[4096];ssize_t n=read(fds[index].fd,chunk,sizeof(chunk));deadline();
   if(n==0){if(index==1)outEOF=true;else errEOF=true;}
   else if(n>0){if(index==2)fail("AUTH_IDENTITY_VERIFIER_STDERR_REJECTED");if((std::size_t)n>65536-result.size())fail("AUTH_IDENTITY_VERIFIER_OUTPUT_CAPACITY");result.insert(result.end(),chunk,chunk+n);}
   else if(errno!=EAGAIN&&errno!=EINTR)fail("AUTH_IDENTITY_VERIFIER_READ_UNKNOWN");
  }
 }
}
}
