#pragma once
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <bsm/libbsm.h>
#include <poll.h>
#include <cstring>
namespace ynx_auth_ide_relay_private {
// Borrow only. No dup, close, shutdown, send, recv, connect or grant. Production
// passes inherited fd5 internally; no public JS fd acquisition exists.
struct BorrowedPeer {
 struct stat identity{};audit_token_t audit{};bool captured=false;
 static bool same(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_mode==b.st_mode&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_nlink==b.st_nlink;}
 bool capture(int fd){
  if(captured)return false;
  struct stat before{},after{};audit_token_t original{};socklen_t n=sizeof(original);
  if(fstat(fd,&before)||!S_ISSOCK(before.st_mode)||getsockopt(fd,SOL_LOCAL,LOCAL_PEERTOKEN,&original,&n)||n!=sizeof(original)||fstat(fd,&after)||!same(before,after))return false;
  identity=before;audit=original;captured=true;return current(fd);
 }
 bool current(int fd)const{
  if(!captured)return false;
  struct stat now{};audit_token_t actual{};socklen_t n=sizeof(actual);pollfd state{fd,POLLIN,0};
  return !fstat(fd,&now)&&same(identity,now)&&!getsockopt(fd,SOL_LOCAL,LOCAL_PEERTOKEN,&actual,&n)&&n==sizeof(actual)&&!memcmp(&actual,&audit,sizeof(actual))&&poll(&state,1,0)>=0&&!(state.revents&(POLLHUP|POLLERR|POLLNVAL));
 }
};
}
