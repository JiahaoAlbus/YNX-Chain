#include "Current4WireClient.hpp"
#include <algorithm>
#include <cerrno>
#include <climits>
#include <cstring>
#include <fcntl.h>
#include <limits>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace ynx::auth::current4 {
namespace {
void put(std::vector<uint8_t>&v,uint64_t n,unsigned bytes){for(unsigned i=bytes;i;--i)v.push_back(uint8_t(n>>((i-1)*8)));}
uint64_t get(const uint8_t*p,unsigned bytes){uint64_t n=0;for(unsigned i=0;i<bytes;++i)n=(n<<8)|p[i];return n;}
bool canonical(const std::array<uint8_t,42>&o){if(o[0]!='0'||o[1]!='x')return false;for(size_t i=2;i<o.size();++i)if(!((o[i]>='0'&&o[i]<='9')||(o[i]>='a'&&o[i]<='f')))return false;return true;}
}
WireClient::WireClient(int fd,Deadline deadline):fd_(fd),deadline_(deadline),io_deadline_(deadline){
 sockaddr_un local{},peer{};socklen_t ln=sizeof local,pn=sizeof peer;int type=0;socklen_t tn=sizeof type;
 if(fd_<0||getsockname(fd_,reinterpret_cast<sockaddr*>(&local),&ln)||getpeername(fd_,reinterpret_cast<sockaddr*>(&peer),&pn)||local.sun_family!=AF_UNIX||peer.sun_family!=AF_UNIX||getsockopt(fd_,SOL_SOCKET,SO_TYPE,&type,&tn)||type!=SOCK_STREAM||std::chrono::steady_clock::now()>=deadline_){unknown_=true;return;}
 int flags=fcntl(fd_,F_GETFL);if(flags<0||fcntl(fd_,F_SETFL,flags|O_NONBLOCK)<0||fcntl(fd_,F_SETFD,FD_CLOEXEC)<0)unknown_=true;
#ifdef SO_NOSIGPIPE
 int yes=1;if(setsockopt(fd_,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof yes))unknown_=true;
#endif
}
WireClient::~WireClient(){if(fd_>=0)::close(fd_);}
bool WireClient::fail(){unknown_=true;return false;}
bool WireClient::io(bool writing,uint8_t*p,size_t count){
 size_t at=0;
 while(at<count){
  auto remaining=io_deadline_-std::chrono::steady_clock::now();if(remaining<=Deadline::duration::zero())return fail();
  auto ms=std::chrono::duration_cast<std::chrono::milliseconds>(remaining).count();int timeout=int(std::min<int64_t>(INT_MAX,std::max<int64_t>(1,ms)));
  pollfd f{fd_,short(writing?POLLOUT:POLLIN),0};int rc=poll(&f,1,timeout);
  if(rc<0&&errno==EINTR)continue;if(rc<=0||f.revents&POLLNVAL)return fail();
  ssize_t n;
  if(writing){
#ifdef MSG_NOSIGNAL
   n=send(fd_,p+at,count-at,MSG_NOSIGNAL);
#else
   n=send(fd_,p+at,count-at,0);
#endif
  }else n=recv(fd_,p+at,count-at,0);
  if(n<0&&(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK))continue;
  if(n<=0)return fail();at+=size_t(n);
 }
 return true;
}
bool WireClient::exchange(uint8_t op,const std::vector<uint8_t>&body,Reply&out){
 if(unknown_||fd_<0||closed_||next_==0||next_==std::numeric_limits<uint64_t>::max())return false;
 const bool cleanup=op>=YNX_C4_RETIRE;
 // Seal producing requests BEFORE cleanup I/O. Incomplete physical drain or
 // a known cleanup error never resurrects this original captured permission.
 // Keep the same owner/debt and sequence for remaining cleanup operations.
 if(cleanup)cleanup_started_=true;
 else if(cleanup_started_)return false;
 if(cleanup){
  // Physical cleanup is allowed after permission expiry. This single fixed
  // cleanup budget can never authorize a read/current or renew that window.
  if(cleanup_deadline_==Deadline{})cleanup_deadline_=std::chrono::steady_clock::now()+std::chrono::seconds(5);
  io_deadline_=cleanup_deadline_;
 }else io_deadline_=deadline_;
 if(std::chrono::steady_clock::now()>=io_deadline_)return false; // no I/O entered
 const auto seq=next_++; // consumed BEFORE any I/O, including partial write.
 std::vector<uint8_t>request{'Y','N','C','4'};put(request,YNX_CURRENT4_PRIVATE_WIRE_VERSION,2);request.push_back(YNX_C4_REQUEST);request.push_back(op);put(request,seq,8);put(request,body.size(),4);put(request,0,4);request.insert(request.end(),body.begin(),body.end());
 if(op==YNX_C4_CAPTURE)acquisition_possible_=true;
 if(!io(true,request.data(),request.size()))return false;
 std::array<uint8_t,24>h{};if(!io(false,h.data(),h.size()))return false;
 if(memcmp(h.data(),YNX_CURRENT4_PRIVATE_WIRE_MAGIC,4)||get(h.data()+4,2)!=1||h[6]!=YNX_C4_RESPONSE||h[7]!=op||get(h.data()+8,8)!=seq||get(h.data()+20,4)!=0)return fail();
 auto n=get(h.data()+16,4);if(n<8||n>YNX_CURRENT4_PRIVATE_BODY_MAX)return fail();
 // Bound every fixed reply before allocation; READ alone can carry policy.
 if(op!=YNX_C4_READ&&n!=uint64_t((op==YNX_C4_CAPTURE||op==YNX_C4_JOIN||op==YNX_C4_CLOSE)?12:8))return fail();
 std::vector<uint8_t>b(size_t(n),0);if(!io(false,b.data(),b.size()))return false;
 Reply r;auto rawcode=uint32_t(get(b.data(),4));memcpy(&r.code,&rawcode,4);auto present=get(b.data()+4,4);if(present>1)return fail();r.error_present=present!=0;
 if(!r.error_present&&r.code!=0)return fail();
 if(r.error_present&&op<=YNX_C4_CURRENT)denied_=true;
 if(op==YNX_C4_CAPTURE){auto owns=get(b.data()+8,4);if(owns>1)return fail();r.owner_present=owns!=0;owner_=owner_||r.owner_present;captured_=r.owner_present;if(!r.error_present&&!r.owner_present)return fail();}
 else if(op==YNX_C4_JOIN||op==YNX_C4_CLOSE){auto done=get(b.data()+8,4);if(done>1)return fail();r.physical_complete=done!=0;if(op==YNX_C4_CLOSE&&r.physical_complete){owner_=false;closed_=true;acquisition_possible_=false;}}
 else if(op==YNX_C4_READ){
  if(r.error_present){if(n!=8)return fail();}
  else {
   if(n<YNX_CURRENT4_PRIVATE_READ_PREFIX_BYTES)return fail();r.height=get(b.data()+8,8);auto count=get(b.data()+16,8);
   if(!r.height||!count||count>YNX_CURRENT4_PRIVATE_POLICY_MAX||count!=n-YNX_CURRENT4_PRIVATE_READ_PREFIX_BYTES)return fail();
   std::copy_n(b.data()+24,42,r.owner.begin());if(r.owner!=selected_owner_||!canonical(r.owner))return fail();
   r.policy.assign(b.begin()+YNX_CURRENT4_PRIVATE_READ_PREFIX_BYTES,b.end());
  }
 }
 // No late-expiry success or caller-output mutation on malformed transport.
 if(std::chrono::steady_clock::now()>=io_deadline_)return false; // reply known; do not invent UNKNOWN
 out=std::move(r);return true;
}
bool WireClient::capture(const std::array<uint8_t,32>&network,const std::array<uint8_t,42>&owner,Reply&out){std::lock_guard<std::mutex>l(mu_);if(capture_entered_||!canonical(owner))return false;capture_entered_=true;selected_owner_=owner;std::vector<uint8_t>b(network.begin(),network.end());b.insert(b.end(),owner.begin(),owner.end());return exchange(YNX_C4_CAPTURE,b,out);}
bool WireClient::read(uint64_t capacity,Reply&out){std::lock_guard<std::mutex>l(mu_);if(!captured_||denied_||!capacity||capacity>YNX_CURRENT4_PRIVATE_POLICY_MAX)return false;std::vector<uint8_t>b;put(b,capacity,8);Reply r;if(!exchange(YNX_C4_READ,b,r))return false;if(r.policy.size()>capacity)return fail();out=std::move(r);return true;}
bool WireClient::current(Reply&out){std::lock_guard<std::mutex>l(mu_);return captured_&&!denied_&&exchange(YNX_C4_CURRENT,{},out);}
bool WireClient::retire(Reply&out){std::lock_guard<std::mutex>l(mu_);return captured_&&exchange(YNX_C4_RETIRE,{},out);}
bool WireClient::join(Reply&out){std::lock_guard<std::mutex>l(mu_);return captured_&&exchange(YNX_C4_JOIN,{},out);}
bool WireClient::close(Reply&out){std::lock_guard<std::mutex>l(mu_);return captured_&&exchange(YNX_C4_CLOSE,{},out);}
bool WireClient::unknown()const{std::lock_guard<std::mutex>l(mu_);return unknown_;}
bool WireClient::remoteOwnerDebt()const{std::lock_guard<std::mutex>l(mu_);return owner_||(acquisition_possible_&&unknown_);}
}
