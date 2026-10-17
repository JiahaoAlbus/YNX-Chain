#pragma once
#include "original-ide-parent-prelude.h"
#include <chrono>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#include <cerrno>
#include <algorithm>
namespace ynx_auth_ide_private {
class PreludeTransport final {
 int fd_;std::chrono::steady_clock::time_point end_;bool handed_=false,unknown_=false;
 [[noreturn]] void fail(const char *code){unknown_=true;throw std::runtime_error(code);}
 void wait(short wanted){
  if(handed_||unknown_)fail("IDE_PRELUDE_OWNER_NO_LONGER_READER");
  auto left=std::chrono::duration_cast<std::chrono::milliseconds>(end_-std::chrono::steady_clock::now()).count();if(left<=0)fail("IDE_PRELUDE_TIMEOUT_UNKNOWN");
  pollfd p{fd_,wanted,0};int rc=poll(&p,1,(int)std::min<int64_t>(left,15000));
  if(rc==0)fail("IDE_PRELUDE_TIMEOUT_UNKNOWN");if(rc<0)fail("IDE_PRELUDE_POLL_UNKNOWN");
  if(p.revents&(POLLERR|POLLNVAL))fail("IDE_PRELUDE_ENDPOINT_UNKNOWN");
  if(!(p.revents&wanted))fail("IDE_PRELUDE_EOF_UNKNOWN");
 }
public:
 PreludeTransport(int originalFD,unsigned remainingMS):fd_(originalFD),end_(std::chrono::steady_clock::now()+std::chrono::milliseconds(std::min(remainingMS,15000u))){if(fd_<0||!remainingMS)fail("IDE_PRELUDE_DEADLINE_INVALID");}
 void write(const Prelude&p){
  auto raw=encodePrelude(p);wait(POLLOUT);
#ifdef SO_NOSIGPIPE
  int one=1;if(setsockopt(fd_,SOL_SOCKET,SO_NOSIGPIPE,&one,sizeof(one)))fail("IDE_PRELUDE_NOSIGPIPE_UNAVAILABLE");
#endif
  // Never resend a partial/unknown write. One fixed frame, one send operation.
  int flags=MSG_DONTWAIT;
#ifdef MSG_NOSIGNAL
  flags|=MSG_NOSIGNAL;
#endif
  if(send(fd_,raw.data(),raw.size(),flags)!=(ssize_t)raw.size())fail("IDE_PRELUDE_WRITE_UNKNOWN");
 }
 Prelude read(){
  PreludeReader parser;
  while(parser.remaining()){
   wait(POLLIN);PreludeBytes buffer{};ssize_t n=recv(fd_,buffer.data(),parser.remaining(),MSG_DONTWAIT);
   if(n<0&&errno==EAGAIN)continue;
   if(n<=0)fail(n==0?"IDE_PRELUDE_EOF_UNKNOWN":"IDE_PRELUDE_READ_UNKNOWN");
   try{parser.append(buffer.data(),(std::size_t)n);}catch(...){unknown_=true;throw;}
  }
  try{return parser.finish();}catch(...){unknown_=true;throw;}
 }
 void handoff(){if(unknown_||handed_)fail("IDE_PRELUDE_HANDOFF_ALREADY_SELECTED_OR_UNKNOWN");handed_=true;}
 bool handedOff()const{return handed_;}
};
}
