#pragma once
#include "original-ide-identity-peer-wire.h"
#include <atomic>
#include <chrono>
#include <mutex>
#include <string>
#include <cerrno>
#include <climits>
#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
namespace ynx_auth_ide_identity_private {
// Private byte transport, NOT a Source/Root/peer qualification or SDK factory.
// The original Native holder supplies its already-owned dedicated descriptor.
// No caller-supplied PID, wire claim or successful socket I/O grants authority.
class Endpoint final {
 int fd_=-1;dev_t device_=0;ino_t inode_=0;bool identified_=false;std::chrono::steady_clock::time_point deadline_;
 std::atomic<bool> retired_{false};std::atomic<unsigned> entered_{0};
 std::mutex writeMutex_,readMutex_,stateMutex_;Sequence sequence_;Reader reader_;
 std::string first_,closeFirst_;bool closeSelected_=false;
 bool sameDescriptor()const noexcept{struct stat st{};return identified_&&fd_>=0&&fstat(fd_,&st)==0&&S_ISSOCK(st.st_mode)&&st.st_dev==device_&&st.st_ino==inode_;}
 struct Entered{Endpoint&e;explicit Entered(Endpoint&v):e(v){
  std::lock_guard<std::mutex> lock(e.stateMutex_);
  if(e.closeSelected_||e.retired_.load())throw std::runtime_error("AUTH_IDENTITY_PEER_RETIRED");
  e.entered_.fetch_add(1);
 }~Entered(){e.entered_.fetch_sub(1);}};
 [[noreturn]] void fail(const char*code){
  std::lock_guard<std::mutex> lock(stateMutex_);sequence_.fail();if(first_.empty())first_=code;throw std::runtime_error(first_);
 }
 void wait(short events){
  for(;;){
   current();auto left=std::chrono::duration_cast<std::chrono::milliseconds>(deadline_-std::chrono::steady_clock::now()).count();
   if(left<=0)fail("AUTH_IDENTITY_PEER_DEADLINE");
   pollfd p{fd_,events,0};int result=::poll(&p,1,(int)std::min<long long>(left,INT_MAX));
   if(result<0&&errno==EINTR)continue;
   if(result<=0)fail(result==0?"AUTH_IDENTITY_PEER_DEADLINE":"AUTH_IDENTITY_PEER_POLL_UNKNOWN");
   current();if(p.revents&events)return;
   fail("AUTH_IDENTITY_PEER_DISCONNECTED");
  }
 }
public:
 // Capture before validation: even an invalid/non-ready partial retains its
 // descriptor and must be retired/joined/closed by its original custodian.
 Endpoint(int owned,std::chrono::steady_clock::time_point deadline):fd_(owned),deadline_(deadline){
  struct stat st{};sockaddr_storage address{};socklen_t n=sizeof(address),t=sizeof(int);int type=0;
  bool valid=fd_>=0&&fstat(fd_,&st)==0&&S_ISSOCK(st.st_mode)&&getsockname(fd_,(sockaddr*)&address,&n)==0&&address.ss_family==AF_UNIX&&getsockopt(fd_,SOL_SOCKET,SO_TYPE,&type,&t)==0&&type==SOCK_STREAM;
  if(valid){int flags=fcntl(fd_,F_GETFD);valid=flags>=0&&fcntl(fd_,F_SETFD,flags|FD_CLOEXEC)==0;}
#ifdef SO_NOSIGPIPE
  if(valid){int yes=1;valid=setsockopt(fd_,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes))==0;}
#endif
  if(!valid){first_="AUTH_IDENTITY_PEER_DESCRIPTOR_REQUIRED";sequence_.fail();}
  else{device_=st.st_dev;inode_=st.st_ino;identified_=true;}
 }
 Endpoint(const Endpoint&)=delete;Endpoint&operator=(const Endpoint&)=delete;
 ~Endpoint(){if(entered_.load())std::terminate();if(!closeSelected_){retire();try{close();}catch(...){}}}
 void current(){
  std::lock_guard<std::mutex> lock(stateMutex_);
  if(!first_.empty())throw std::runtime_error(first_);
  const char*error=retired_.load()||closeSelected_?"AUTH_IDENTITY_PEER_RETIRED":!sameDescriptor()?"AUTH_IDENTITY_PEER_DESCRIPTOR_CHANGED":std::chrono::steady_clock::now()>=deadline_?"AUTH_IDENTITY_PEER_DEADLINE":nullptr;
  if(error){first_=error;sequence_.fail();throw std::runtime_error(first_);}
 }
 void send(Message kind,const std::vector<unsigned char>&payload){
  Entered entered(*this);std::unique_lock<std::mutex> direction(writeMutex_,std::try_to_lock);
  if(!direction.owns_lock())fail("AUTH_IDENTITY_PEER_WRITE_PENDING");current();std::uint64_t number;
  {std::lock_guard<std::mutex> lock(stateMutex_);number=sequence_.selectSend();}
  try{
   auto bytes=encode({kind,number,payload});std::size_t offset=0;
   while(offset<bytes.size()){
    wait(POLLOUT);int flags=MSG_DONTWAIT;
#ifdef MSG_NOSIGNAL
    flags|=MSG_NOSIGNAL;
#endif
    auto n=::send(fd_,bytes.data()+offset,bytes.size()-offset,flags);
    if(n<0&&(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK))continue;
    if(n<=0)fail("AUTH_IDENTITY_PEER_WRITE_UNKNOWN");offset+=(std::size_t)n;
   }
   current();
  }catch(...){std::lock_guard<std::mutex> lock(stateMutex_);sequence_.fail();if(first_.empty())first_="AUTH_IDENTITY_PEER_WRITE_UNKNOWN";throw;}
 }
 Frame receive(){
  Entered entered(*this);std::unique_lock<std::mutex> direction(readMutex_,std::try_to_lock);
  if(!direction.owns_lock())fail("AUTH_IDENTITY_PEER_READ_PENDING");current();
  try{
   while(reader_.remaining()){
    wait(POLLIN);unsigned char bytes[8192];auto n=::recv(fd_,bytes,std::min(sizeof(bytes),reader_.remaining()),MSG_DONTWAIT);
    if(n<0&&(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK))continue;
    if(n<=0)fail("AUTH_IDENTITY_PEER_TRUNCATED");reader_.append(bytes,(std::size_t)n);
   }
   Frame result=reader_.finish();{std::lock_guard<std::mutex> lock(stateMutex_);sequence_.accept(result.sequence);}current();reader_=Reader{};return result;
  }catch(...){std::lock_guard<std::mutex> lock(stateMutex_);sequence_.fail();if(first_.empty())first_="AUTH_IDENTITY_PEER_READ_UNKNOWN";throw;}
 }
 void retire()noexcept{std::lock_guard<std::mutex> lock(stateMutex_);if(!retired_.exchange(true)&&sameDescriptor())::shutdown(fd_,SHUT_RDWR);}
 unsigned activeCalls()const noexcept{return entered_.load();}
 bool joined()const noexcept{return retired_.load()&&entered_.load()==0;}
 void close(){
  if(!joined())throw std::runtime_error("AUTH_IDENTITY_PEER_JOIN_REQUIRED");
  std::lock_guard<std::mutex> lock(stateMutex_);
  if(!joined())throw std::runtime_error("AUTH_IDENTITY_PEER_JOIN_REQUIRED");
  if(closeSelected_){if(!closeFirst_.empty())throw std::runtime_error(closeFirst_);return;}
  closeSelected_=true;
  if(identified_&&!sameDescriptor()){closeFirst_="AUTH_IDENTITY_PEER_DESCRIPTOR_CHANGED";throw std::runtime_error(closeFirst_);}
  int original=fd_;fd_=-1;
  // Never retry close after EINTR/uncertain release; that FD number may already
  // belong to another resource. Preserve the first close result separately.
  if(original>=0&&::close(original)!=0){closeFirst_="AUTH_IDENTITY_PEER_CLOSE_UNKNOWN";throw std::runtime_error(closeFirst_);}
 }
};
}
