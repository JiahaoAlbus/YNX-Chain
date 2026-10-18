#import "original-private-service-channel.h"
#import "original-auth-identity-source-authority.h"
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <Security/Security.h>
#include <chrono>

static NSDictionary *ChannelTuple(struct stat s) {
 return @{@"device":@(s.st_dev),@"inode":@(s.st_ino),@"uid":@(s.st_uid),@"gid":@(s.st_gid),@"mode":@(s.st_mode&07777),@"nlink":@(s.st_nlink)};
}
static BOOL ChannelSame(struct stat a,struct stat b) {return [ChannelTuple(a) isEqual:ChannelTuple(b)];}
static uint64_t ChannelNow() {return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
static BOOL ChannelCode(pid_t pid,NSDictionary *approved) {
 struct proc_bsdinfo p{};
 if(pid<=1||proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&p,sizeof(p))!=(int)sizeof(p)||p.pbi_uid!=getuid()||p.pbi_start_tvsec!=[approved[@"startSeconds"] unsignedLongLongValue]||p.pbi_start_tvusec!=[approved[@"startMicroseconds"] unsignedLongLongValue])return NO;
 SecCodeRef code=nullptr;CFDictionaryRef metadata=nullptr;
 OSStatus status=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)@{(__bridge NSString *)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&code);
 if(status==errSecSuccess)status=SecCodeCheckValidity(code,kSecCSStrictValidate,nullptr);
 if(status==errSecSuccess)status=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&metadata);
 NSData *actual=metadata?((__bridge NSDictionary *)metadata)[(__bridge NSString *)kSecCodeInfoUnique]:nil;
 BOOL same=status==errSecSuccess&&[actual isKindOfClass:NSData.class]&&[[actual base64EncodedStringWithOptions:0] isEqual:approved[@"codeHashBase64"]];
 if(metadata)CFRelease(metadata);if(code)CFRelease(code);return same;
}
@implementation YNXOriginalPrivateServiceChannel {
 YNXAuthIdentitySourceAuthority *_source;NSDictionary *_selection,*_registration;
 NSString *_path,*_parentPath,*_name;int _parent,_listener,_peer;
 struct stat _parentIdentity,_socketIdentity,_peerIdentity;
 BOOL _selected,_ready,_closed,_closeSelected,_socketCaptured,_readSelected,_writeSelected,_retired;
 BOOL _parentCloseSelected,_listenerCloseSelected,_peerCloseSelected;
 NSError *_first,*_cleanup;NSData *_input;NSMutableData *_incoming,*_outgoing;NSUInteger _sent;
 uint64_t _deadline;unsigned _accepted;
}
- (instancetype)init {if((self=[super init])){_parent=-1;_listener=-1;_peer=-1;}return self;}
- (BOOL)fail:(NSError **)error code:(NSString *)code {
 if(!_first)_first=(error&&*error)?*error:[NSError errorWithDomain:@"YNXOriginalPrivateChannel" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];
 _retired=YES;if(error)*error=_first;return NO;
}
- (NSError *)firstCause {return _first;}
- (NSError *)cleanupCause {return _cleanup;}
- (BOOL)parentCurrent {
 struct stat held{},named{},expected=_parentIdentity;
 // This supplier is Darwin/APFS: a named socket increments directory nlink.
 // Bind the exact prewrite tuple and the one owned-child transition, not a
 // stale creation-time nlink. No unrelated child or sibling is authorized.
 if(_socketCaptured)expected.st_nlink++;
 return _parent>=0&&!fstat(_parent,&held)&&!lstat(_parentPath.fileSystemRepresentation,&named)&&S_ISDIR(named.st_mode)&&ChannelSame(held,expected)&&ChannelSame(named,expected);
}
- (BOOL)sourceCurrent:(NSError **)error {
 if(!_source||![_source assertCurrent:error]||![_source assertAuthenticatedNativePurpose:error])return NO;
 NSDictionary *actual=[_source copyOriginalSelection:error];return actual&&[actual isEqual:_selection];
}
- (BOOL)assertCurrent:(NSError **)error {
 @synchronized(self){
  struct stat socket{};
  if(!_ready||_retired||_closeSelected||![self sourceCurrent:error]||![self parentCurrent]||!_socketCaptured||fstatat(_parent,_name.fileSystemRepresentation,&socket,AT_SYMLINK_NOFOLLOW)||!S_ISSOCK(socket.st_mode)||!ChannelSame(socket,_socketIdentity)||getpid()!=[_selection[@"originalServicePID"] intValue])return [self fail:error code:@"ORIGINAL_SERVICE_CHANNEL_CURRENT_FAILED"];
  if(_peer>=0){pid_t pid=0;socklen_t size=sizeof(pid);uid_t uid=0;gid_t gid=0;struct stat held{};
   if(getsockopt(_peer,SOL_LOCAL,LOCAL_PEERPID,&pid,&size)||size!=sizeof(pid)||getpeereid(_peer,&uid,&gid)||uid!=getuid()||pid!=[_registration[@"peer"][@"pid"] intValue]||!ChannelCode(pid,_registration[@"peer"])||fstat(_peer,&held)||!ChannelSame(held,_peerIdentity))return [self fail:error code:@"ORIGINAL_SERVICE_CHANNEL_PEER_CHANGED"];
  }
  return YES;
 }
}
- (BOOL)acquireOriginalSource:(YNXAuthIdentitySourceAuthority *)source error:(NSError **)error {
 @synchronized(self){
  if(_selected)return [self fail:error code:@"ORIGINAL_SERVICE_CHANNEL_ALREADY_SELECTED"];_selected=YES;
  if(![source isMemberOfClass:YNXAuthIdentitySourceAuthority.class])return [self fail:error code:@"ORIGINAL_SERVICE_SOURCE_OWNER_REQUIRED"];
  _source=source;if(![_source assertCurrent:error]||![_source assertAuthenticatedNativePurpose:error])return [self fail:error code:@"ORIGINAL_SERVICE_SOURCE_NOT_ADMITTED"];
  _selection=[_source copyOriginalSelection:error];_registration=_selection[@"originalServiceChannel"];
  NSSet *keys=[NSSet setWithArray:@[@"version",@"parentIdentity",@"peer",@"consumerManifestDigest",@"gatewayManifestDigest",@"registryDigest",@"currentReference"]];
  if(![_registration isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:_registration.allKeys] isEqual:keys]||![_registration[@"version"] isEqual:@"YNX-REGISTERED-PRIVATE-CHANNEL/v1"]||![_selection[@"originalServicePID"] isKindOfClass:NSNumber.class]||[_selection[@"originalServicePID"] intValue]!=getpid())return [self fail:error code:@"ORIGINAL_SERVICE_CHANNEL_REGISTRATION_REQUIRED"];
  for(NSString *k in @[@"consumerManifestDigest",@"gatewayManifestDigest",@"registryDigest",@"currentReference"]){id v=_selection[@"expectedRequest"][k];if(![v isKindOfClass:NSString.class]||![v length]||![_registration[k] isEqual:v])return [self fail:error code:@"ORIGINAL_SERVICE_CHANNEL_REGISTRATION_MISMATCH"];}
  NSDictionary *peer=_registration[@"peer"];
  if(![peer isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:peer.allKeys] isEqual:[NSSet setWithArray:@[@"pid",@"startSeconds",@"startMicroseconds",@"codeHashBase64"]]]||[peer[@"pid"] intValue]<=1||!ChannelCode([peer[@"pid"] intValue],peer))return [self fail:error code:@"ORIGINAL_SERVICE_PEER_REGISTRATION_REQUIRED"];
  _path=_selection[@"originalServiceSocket"];
  if(![_path isKindOfClass:NSString.class]||![_path hasPrefix:@"/"]||![_path isEqual:_path.stringByStandardizingPath]||[_path lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>=sizeof(sockaddr_un::sun_path))return [self fail:error code:@"ORIGINAL_SERVICE_SOCKET_PATH_INVALID"];
  _parentPath=_path.stringByDeletingLastPathComponent;_name=_path.lastPathComponent;
  // Walk every component no-follow, never mkdir or select a substitute path.
  _parent=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  for(NSString *part in _parentPath.pathComponents){if([part isEqual:@"/"])continue;int next=openat(_parent,part.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);int old=_parent;_parent=next;if(old>=0&&close(old)){if(!_cleanup)_cleanup=[NSError errorWithDomain:@"YNXOriginalPrivateChannel" code:2 userInfo:@{NSLocalizedDescriptionKey:@"ORIGINAL_SERVICE_PARENT_CLOSE_UNKNOWN"}];return [self fail:error code:@"ORIGINAL_SERVICE_PARENT_CLOSE_UNKNOWN"];}if(next<0)return [self fail:error code:@"ORIGINAL_SERVICE_PARENT_UNAVAILABLE"];}
  if(_parent<0||fstat(_parent,&_parentIdentity)||!S_ISDIR(_parentIdentity.st_mode)||_parentIdentity.st_uid!=getuid()||(_parentIdentity.st_mode&0777)!=0700||![ChannelTuple(_parentIdentity) isEqual:_registration[@"parentIdentity"]]||![self parentCurrent]||![self sourceCurrent:error])return [self fail:error code:@"ORIGINAL_SERVICE_PARENT_CHANGED"];
  struct stat existing{};if(!fstatat(_parent,_name.fileSystemRepresentation,&existing,AT_SYMLINK_NOFOLLOW)||errno!=ENOENT)return [self fail:error code:@"ORIGINAL_SERVICE_SOCKET_ALREADY_EXISTS"];
  _listener=socket(AF_UNIX,SOCK_STREAM,0);if(_listener<0||fcntl(_listener,F_SETFD,FD_CLOEXEC)||fcntl(_listener,F_SETFL,O_NONBLOCK))return [self fail:error code:@"ORIGINAL_SERVICE_LISTENER_UNAVAILABLE"];
  int yes=1;if(setsockopt(_listener,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes)))return [self fail:error code:@"ORIGINAL_SERVICE_LISTENER_FLAGS_FAILED"];
  sockaddr_un address{};address.sun_family=AF_UNIX;strcpy(address.sun_path,_path.fileSystemRepresentation);
  if(bind(_listener,(sockaddr*)&address,sizeof(address)))return [self fail:error code:@"ORIGINAL_SERVICE_BIND_FAILED"];
  if(fstatat(_parent,_name.fileSystemRepresentation,&_socketIdentity,AT_SYMLINK_NOFOLLOW)||!S_ISSOCK(_socketIdentity.st_mode)||_socketIdentity.st_uid!=getuid()||_socketIdentity.st_nlink!=1)return [self fail:error code:@"ORIGINAL_SERVICE_BOUND_IDENTITY_UNKNOWN"];
  _socketCaptured=YES;
  struct stat protectedSocket{};
  if(fchmodat(_parent,_name.fileSystemRepresentation,0600,AT_SYMLINK_NOFOLLOW)||fstatat(_parent,_name.fileSystemRepresentation,&protectedSocket,AT_SYMLINK_NOFOLLOW)||!S_ISSOCK(protectedSocket.st_mode)||protectedSocket.st_dev!=_socketIdentity.st_dev||protectedSocket.st_ino!=_socketIdentity.st_ino||protectedSocket.st_uid!=_socketIdentity.st_uid||protectedSocket.st_gid!=_socketIdentity.st_gid||protectedSocket.st_nlink!=1||(protectedSocket.st_mode&0777)!=0600)return [self fail:error code:@"ORIGINAL_SERVICE_LISTEN_FAILED"];
  _socketIdentity=protectedSocket;if(listen(_listener,1))return [self fail:error code:@"ORIGINAL_SERVICE_LISTEN_FAILED"];
  _ready=YES;return [self assertCurrent:error];
 }
}
- (NSData *)readOriginalRequest:(NSError **)error {
 @synchronized(self){
  if(error)*error=nil;if(![self assertCurrent:error])return nil;
  if(_input){[self fail:error code:@"ORIGINAL_SERVICE_UNRESOLVED_REQUEST"];return nil;}
  if(_peer<0){
   if(_accepted>=64){[self fail:error code:@"ORIGINAL_SERVICE_CHANNEL_CAPACITY"];return nil;}
   pollfd p{_listener,POLLIN,0};int observed=poll(&p,1,0);
   if(observed==0)return nil; // PRE-ENTRY IDLE: no cause, deadline or selected attempt.
   if(observed<0||(p.revents&(POLLERR|POLLHUP|POLLNVAL))||!(p.revents&POLLIN)){[self fail:error code:@"ORIGINAL_SERVICE_LISTENER_UNKNOWN"];return nil;}
   _peer=accept(_listener,nullptr,nullptr);
   if(_peer<0||fcntl(_peer,F_SETFD,FD_CLOEXEC)||fcntl(_peer,F_SETFL,O_NONBLOCK)||fstat(_peer,&_peerIdentity)){[self fail:error code:@"ORIGINAL_SERVICE_ACCEPT_UNKNOWN"];return nil;}
   _accepted++;_readSelected=YES;_incoming=[NSMutableData data];_deadline=ChannelNow()+15000;
   int yes=1;if(setsockopt(_peer,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes))||![self assertCurrent:error])return nil;
  }
  if(ChannelNow()>=_deadline){[self fail:error code:@"ORIGINAL_SERVICE_CHANNEL_TIMEOUT"];return nil;}
  // One bounded slice on the same accepted peer. Partial bytes and the first
  // accept deadline survive null. No re-accept/replay/replacement on timeout.
  for(unsigned slice=0;slice<16384;slice++){
   char ch;ssize_t n=read(_peer,&ch,1);
   if(n<0&&(errno==EAGAIN||errno==EWOULDBLOCK)){if(![self assertCurrent:error])return nil;return nil;}
   if(n!=1){[self fail:error code:@"ORIGINAL_SERVICE_REQUEST_TRUNCATED"];return nil;}
   if(!ch){[self fail:error code:@"ORIGINAL_SERVICE_REQUEST_NUL"];return nil;}
   if(ch=='\n'){
    char extra;ssize_t peek=recv(_peer,&extra,1,MSG_PEEK|MSG_DONTWAIT);if(peek>0||(peek<0&&errno!=EAGAIN&&errno!=EWOULDBLOCK)){[self fail:error code:@"ORIGINAL_SERVICE_EXTRA_FRAME"];return nil;}
    if(!_incoming.length||![[NSString alloc]initWithData:_incoming encoding:NSUTF8StringEncoding]||![self assertCurrent:error]||ChannelNow()>=_deadline){[self fail:error code:@"ORIGINAL_SERVICE_REQUEST_ENCODING_OR_FENCE"];return nil;}
    _input=[_incoming copy];_incoming=nil;return _input; // Sole SDK decoder, not grant.
   }
   if(_incoming.length>=262144){[self fail:error code:@"ORIGINAL_SERVICE_REQUEST_CAPACITY"];return nil;}[_incoming appendBytes:&ch length:1];
  }
  if(![self assertCurrent:error])return nil;return nil;
 }
}
- (BOOL)writeOriginalResponse:(NSData *)response error:(NSError **)error {
 @synchronized(self){
  if(error)*error=nil;if(!_input||![self assertCurrent:error])return [self fail:error code:@"ORIGINAL_SERVICE_RESPONSE_NOT_SELECTED"];
  if(![response isKindOfClass:NSData.class]||!response.length||response.length>65536||memchr(response.bytes,'\n',response.length)||![[NSString alloc]initWithData:response encoding:NSUTF8StringEncoding])return [self fail:error code:@"ORIGINAL_SERVICE_RESPONSE_INVALID"];
  if(!_writeSelected){_writeSelected=YES;_outgoing=[response mutableCopy];const char lf='\n';[_outgoing appendBytes:&lf length:1];_sent=0;_deadline=ChannelNow()+15000;}
  else if(_outgoing.length!=response.length+1||memcmp(_outgoing.bytes,response.bytes,response.length))return [self fail:error code:@"ORIGINAL_SERVICE_RESPONSE_SUBSTITUTED"];
  if(ChannelNow()>=_deadline)return [self fail:error code:@"ORIGINAL_SERVICE_CHANNEL_TIMEOUT"];
  pollfd p{_peer,POLLOUT,0};int observed=poll(&p,1,0);if(observed==0)return NO; // pending, no cause
  if(observed<0||(p.revents&(POLLERR|POLLHUP|POLLNVAL))||!(p.revents&POLLOUT))return [self fail:error code:@"ORIGINAL_SERVICE_RESPONSE_WRITE_UNKNOWN"];
  ssize_t n=write(_peer,(const char*)_outgoing.bytes+_sent,_outgoing.length-_sent);
  if(n<0&&(errno==EAGAIN||errno==EWOULDBLOCK))return NO;
  if(n<=0)return [self fail:error code:@"ORIGINAL_SERVICE_RESPONSE_WRITE_UNKNOWN"];_sent+=(size_t)n;
  if(![self assertCurrent:error])return NO;if(_sent<_outgoing.length)return NO;
  if(![self assertCurrent:error])return NO; // transport write != peer receive != business ACK.
  _peerCloseSelected=YES;if(close(_peer)){if(!_cleanup)_cleanup=[NSError errorWithDomain:@"YNXOriginalPrivateChannel" code:2 userInfo:@{NSLocalizedDescriptionKey:@"ORIGINAL_SERVICE_PEER_CLOSE_UNKNOWN"}];return [self fail:error code:@"ORIGINAL_SERVICE_PEER_CLOSE_UNKNOWN"];}
  _peer=-1;_peerCloseSelected=NO;_input=nil;_incoming=nil;_outgoing=nil;_sent=0;_deadline=0;_readSelected=NO;_writeSelected=NO;return YES;
 }
}
- (BOOL)closeOriginal:(NSError **)error {
 @synchronized(self){
  if(_closeSelected){if(!_closed&&error)*error=_cleanup;return _closed;}_closeSelected=YES;_retired=YES;BOOL ok=YES;
  if(_peer>=0&&!_peerCloseSelected){_peerCloseSelected=YES;if(close(_peer))ok=NO;else _peer=-1;}
  if(_listener>=0&&!_listenerCloseSelected){_listenerCloseSelected=YES;if(close(_listener))ok=NO;else _listener=-1;}
  if(_socketCaptured){struct stat named{};if(![self parentCurrent]||fstatat(_parent,_name.fileSystemRepresentation,&named,AT_SYMLINK_NOFOLLOW)||!ChannelSame(named,_socketIdentity)||!S_ISSOCK(named.st_mode))ok=NO;else if(unlinkat(_parent,_name.fileSystemRepresentation,0))ok=NO;else _socketCaptured=NO;}
  if(_parent>=0&&!_socketCaptured&&![self parentCurrent])ok=NO;
  if(_parent>=0&&!_parentCloseSelected){_parentCloseSelected=YES;if(close(_parent))ok=NO;else _parent=-1;}
  _closed=ok;if(!ok&&!_cleanup)_cleanup=[NSError errorWithDomain:@"YNXOriginalPrivateChannel" code:2 userInfo:@{NSLocalizedDescriptionKey:@"ORIGINAL_SERVICE_CHANNEL_CLOSE_UNKNOWN"}];if(!ok&&error)*error=_cleanup;return ok;
 }
}
@end
