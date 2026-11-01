#import "original-ide-identity-launch-holder.h"
#import "original-auth-identity-source-authority.h"
#import "original-ide-parent-kernel.h"
#import <bsm/libbsm.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <unistd.h>
#include <signal.h>
#include <cerrno>
#include <cstring>
#include <algorithm>
#include <exception>
using namespace ynx_auth_ide_private;
namespace {
bool IdentitySameFile(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_mode==b.st_mode&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_nlink==b.st_nlink;}
bool IdentityHex(id value){return [value isKindOfClass:NSString.class]&&[value length]==64&&[value rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]invertedSet]].location==NSNotFound;}
bool IdentityCode(id value){if(![value isKindOfClass:NSString.class])return false;NSData*d=[[NSData alloc]initWithBase64EncodedString:value options:0];return d.length>=20&&d.length<=64&&[[d base64EncodedStringWithOptions:0]isEqual:value];}
NSDictionary*IdentityBody(NSData*wire){
 if(![wire isKindOfClass:NSData.class]||!wire.length||wire.length>393216)return nil;
 id envelope=[NSJSONSerialization JSONObjectWithData:wire options:0 error:nil];
 if(![envelope isKindOfClass:NSDictionary.class]||![envelope[@"version"]isEqual:@2]||![envelope[@"algorithmVersion"]isEqual:@"YNX-BATCH/v0.1"])return nil;
 id text=envelope[@"body"];if(![text isKindOfClass:NSString.class]||[text length]>87384)return nil;
 NSString*s=[[text stringByReplacingOccurrencesOfString:@"-" withString:@"+"]stringByReplacingOccurrencesOfString:@"_" withString:@"/"];
 if(s.length%4==1)return nil;while(s.length%4)s=[s stringByAppendingString:@"="];
 NSData*bytes=[[NSData alloc]initWithBase64EncodedString:s options:0];if(!bytes.length||bytes.length>65536)return nil;
 NSString*back=[[[[bytes base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"]stringByReplacingOccurrencesOfString:@"=" withString:@""];
 if(![back isEqual:text])return nil;
 id body=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];return [body isKindOfClass:NSDictionary.class]?body:nil;
}
}
@implementation YNXOriginalIdentityPeerLaunchHolder {
 YNXAuthIdentitySourceAuthority *_source;NSDictionary *_selection,*_registration;
 KernelProcess _wallet,_ide,_node;ResourceCloseDebt _resourcesDebt;
 NSString *_resources,*_purpose;NSData *_rootOriginal,*_profileOriginal;
 audit_token_t _peer;struct stat _identity,_duplicateIdentity;
 int _endpoint,_duplicate;pid_t _spawnPID;pthread_t _thread;uint64_t _wallFloor,_monoFloor,_deadline,_expires;
 BOOL _ready,_retired,_spawnSelected,_spawnFinished,_adopted,_endpointCloseSelected,_duplicateCloseSelected,_closeSelected,_complete;
 NSError *_first,*_cleanup;
}
- (instancetype)init {if((self=[super init])){_endpoint=-1;_duplicate=-1;_thread=pthread_self();}return self;}
- (BOOL)fail:(NSError**)error code:(NSString*)code {
 if(!_first)_first=(error&&*error)?*error:[NSError errorWithDomain:@"YNXOriginalIdentityPeerLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];
 _ready=NO;if(error)*error=_first;return NO;
}
- (BOOL)endpointCurrent {
 struct stat held{};audit_token_t peer{};socklen_t size=sizeof(peer);
 return _endpoint>=0&&!_endpointCloseSelected&&fstat(_endpoint,&held)==0&&IdentitySameFile(held,_identity)&&
  getsockopt(_endpoint,SOL_LOCAL,LOCAL_PEERTOKEN,&peer,&size)==0&&size==sizeof(peer)&&!memcmp(&_peer,&peer,sizeof(peer));
}
- (BOOL)clockCurrent {
 uint64_t wall=wallMS(),mono=monotonicMS();if(wall<_wallFloor||mono<_monoFloor||wall>=_expires||mono>=_deadline)return NO;
 _wallFloor=wall;_monoFloor=mono;return YES;
}
+ (instancetype)captureInheritedOriginal:(NSError**)error {
 // Classify the original transport marker BEFORE adopting a numbered FD.
 // Finder/Foundation may already have unrelated pipes/files at fd5. Merely
 // finding that number must never turn ordinary local IDE startup into Auth.
 errno=0;int flags=fcntl(5,F_GETFD);if(flags<0&&errno==EBADF)return nil;
 static const unsigned char marker[8]={'Y','N','X','I','D','P','0','1'};
 unsigned char observed[8]={0};ssize_t seen=flags<0?-1:recv(5,observed,sizeof(observed),MSG_PEEK|MSG_DONTWAIT);
 if(seen<=0)return nil;
 if(memcmp(observed,marker,(size_t)seen))return nil; // unrelated FD is not ours
 YNXOriginalIdentityPeerLaunchHolder*h=[self new];h->_endpoint=5;
 @try{try{
  if(flags<0||getuid()!=geteuid()||getgid()!=getegid()||!pthread_main_np())return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_CONTEXT_REQUIRED"],h;
  if(fstat(5,&h->_identity)||!S_ISSOCK(h->_identity.st_mode)||fcntl(5,F_SETFD,flags|FD_CLOEXEC))return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_ENDPOINT_REQUIRED"],h;
  if(seen!=sizeof(marker)||recv(5,observed,sizeof(observed),MSG_DONTWAIT)!=sizeof(marker)||memcmp(observed,marker,sizeof(marker)))return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_MARKER_TRUNCATED"],h;
  int type=0;socklen_t size=sizeof(type);if(getsockopt(5,SOL_SOCKET,SO_TYPE,&type,&size)||type!=SOCK_STREAM)return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_ENDPOINT_REQUIRED"],h;
  size=sizeof(h->_peer);if(getsockopt(5,SOL_LOCAL,LOCAL_PEERTOKEN,&h->_peer,&size)||size!=sizeof(h->_peer))return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_PEER_REQUIRED"],h;
  h->_ide=observeKernel(getpid());h->_wallet=observeKernel(getppid());
  if(h->_ide.original.parent!=h->_wallet.original.pid||h->_ide.original.uid!=h->_wallet.original.uid||audit_token_to_pid(h->_peer)!=(pid_t)h->_wallet.original.pid||audit_token_to_euid(h->_peer)!=h->_wallet.original.uid)return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_KERNEL_PEER_MISMATCH"],h;
  if(![NSBundle.mainBundle.bundleIdentifier isEqual:@"com.ynxweb4.developer.testnetpreview"])return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_ORIGINAL_APP_REQUIRED"],h;
  h->_resources=NSBundle.mainBundle.resourcePath;
  h->_source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEParentSource:error]; // capture partial BEFORE status
  if(!h->_source||(error&&*error)||![h->_source assertAuthenticatedNativePurpose:error])return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_SOURCE_REQUIRED"],h;
  h->_selection=[h->_source copyOriginalSelection:error];NSDictionary*r=h->_selection[@"identityPeerBinding"];
  NSArray*keys=@[@"walletCodeIdentity",@"ideCodeIdentity",@"nodeCodeIdentity",@"nodeSHA256",@"entrySHA256",@"provenanceSHA256"];
  if(![r isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:r.allKeys]isEqual:[NSSet setWithArray:keys]]||!IdentityCode(r[@"walletCodeIdentity"])||!IdentityCode(r[@"ideCodeIdentity"])||!IdentityCode(r[@"nodeCodeIdentity"])||!IdentityHex(r[@"nodeSHA256"])||!IdentityHex(r[@"entrySHA256"])||!IdentityHex(r[@"provenanceSHA256"]))return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_REGISTRATION_REQUIRED"],h;
  h->_registration=[r copy];
  NSDictionary*raw=[h->_source copyOriginalProvisioningPublicOriginals:error];
  id root=[NSJSONSerialization JSONObjectWithData:raw[@"rootOriginal"] options:0 error:nil];NSDictionary*profile=IdentityBody(raw[@"profileOriginal"]),*current=IdentityBody(raw[@"currentOriginal"]);
  NSArray*purposes=@[@"AUTH-IDENTITY-RECEIVE",@"AUTH-IDENTITY-RECOVER",@"AUTH-PROTECTED-KEY-CALL"];
  if(![root isKindOfClass:NSDictionary.class]||![root[@"version"]isEqual:@2]||![root[@"algorithmVersion"]isEqual:@"YNX-BATCH/v0.1"]||![purposes containsObject:root[@"purpose"]]||![profile[@"purpose"]isEqual:root[@"purpose"]]||![current[@"purpose"]isEqual:root[@"purpose"]])return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_IDENTITY_PURPOSE_REQUIRED"],h;
  h->_purpose=[root[@"purpose"]copy];h->_rootOriginal=[raw[@"rootOriginal"]copy];h->_profileOriginal=[raw[@"profileOriginal"]copy];
  id end=current[@"expiresAtMs"];uint64_t wall=wallMS(),mono=monotonicMS();
  if(![end isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)end)==CFBooleanGetTypeID()||[end unsignedLongLongValue]<=wall||[end unsignedLongLongValue]>9007199254740991ULL||wall>UINT64_MAX-30000)return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_WINDOW_REQUIRED"],h;
  h->_expires=std::min<uint64_t>([end unsignedLongLongValue],wall+30000);
  if(mono>UINT64_MAX-(h->_expires-wall))return [h fail:error code:@"AUTH_IDENTITY_LAUNCH_WINDOW_REQUIRED"],h;
  h->_wallFloor=wall;h->_monoFloor=mono;h->_deadline=mono+(h->_expires-wall);h->_ready=YES;
  if(![h assertCurrent:error])return h;return h;
 }catch(const std::exception&){[h fail:error code:@"AUTH_IDENTITY_LAUNCH_NATIVE_EXCEPTION"];return h;}}@catch(id){[h fail:error code:@"AUTH_IDENTITY_LAUNCH_NATIVE_EXCEPTION"];return h;}
}
- (BOOL)assertCurrent:(NSError**)error {
 @synchronized(self){@try{try{
  if(!pthread_equal(_thread,pthread_self())||!pthread_main_np())return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_THREAD_REQUIRED"];
  if(!_ready||_retired||_closeSelected||_first||![self clockCurrent]||![self endpointCurrent])return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_NOT_CURRENT"];
  if(!sameKernel(_ide,observeKernel(getpid()))||!sameKernel(_wallet,observeKernel((pid_t)_wallet.original.pid)))return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_KERNEL_CHANGED"];
  if(![[_ide.codeIdentity base64EncodedStringWithOptions:0]isEqual:_registration[@"ideCodeIdentity"]]||![[_wallet.codeIdentity base64EncodedStringWithOptions:0]isEqual:_registration[@"walletCodeIdentity"]]||![_source assertAuthenticatedNativePurpose:error]||![[_source copyOriginalSelection:error]isEqual:_selection]||!identityResourceBytes(_resources,_registration,_resourcesDebt))return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_REGISTRATION_CHANGED"];
  if(_adopted){auto child=observeKernel((pid_t)_node.original.pid);if(!sameKernel(_node,child)||child.original.parent!=_ide.original.pid)return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_CHILD_CHANGED"];}
  if(![_source assertAuthenticatedNativePurpose:error]||![self endpointCurrent]||![self clockCurrent])return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_POST_CURRENT_REFUSED"];return YES;
 }catch(const std::exception&){return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_NATIVE_EXCEPTION"];}}@catch(id){return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_NATIVE_EXCEPTION"];}}
}
- (int)duplicateForBackendSpawn:(NSError**)error {
 @synchronized(self){if(!pthread_equal(_thread,pthread_self())||!pthread_main_np())return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_THREAD_REQUIRED"],-1;
  if(_spawnSelected)return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_SPAWN_ONCE"],-1;_spawnSelected=YES;
  if(![self assertCurrent:error])return -1;
  _duplicate=fcntl(_endpoint,F_DUPFD_CLOEXEC,10); // SAME holder owns partial before post-check
  if(_duplicate<0||fstat(_duplicate,&_duplicateIdentity)||!IdentitySameFile(_identity,_duplicateIdentity)||![self assertCurrent:error])return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_DUPLICATE_UNKNOWN"],-1;
  return _duplicate;
 }
}
- (BOOL)closeDuplicate:(NSError**)error {
 if(_duplicate<0)return YES;if(_duplicateCloseSelected)return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_DUPLICATE_CLOSE_UNKNOWN"];
 _duplicateCloseSelected=YES;struct stat now{};
 if(fstat(_duplicate,&now)||!IdentitySameFile(now,_duplicateIdentity)||::close(_duplicate))return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_DUPLICATE_CLOSE_UNKNOWN"];
 _duplicate=-1;return YES;
}
- (BOOL)finishBackendSpawn:(pid_t)pid spawnStatus:(int)status error:(NSError**)error {
 @synchronized(self){@try{try{
  if(!pthread_equal(_thread,pthread_self())||!pthread_main_np())return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_THREAD_REQUIRED"];
  if(!_spawnSelected||_spawnFinished)return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_SPAWN_RESULT_ONCE"];
  _spawnFinished=YES;
  // Preserve actual child custody BEFORE duplicate disposal or post-current.
  if(status==0&&pid>0){_spawnPID=pid;_node=observeKernel(pid);_adopted=YES;}
  BOOL disposed=[self closeDuplicate:error];
  if(status||pid<=0||!_adopted||!disposed){[self retire];return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_SPAWN_FAILED"];}
  if(_node.original.parent!=_ide.original.pid||_node.original.uid!=_ide.original.uid||![[_node.codeIdentity base64EncodedStringWithOptions:0]isEqual:_registration[@"nodeCodeIdentity"]]){[self retire];return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_NODE_MISMATCH"];}
  return [self assertCurrent:error];
 }catch(const std::exception&){[self retire];return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_ADOPT_UNKNOWN"];}}@catch(id){[self retire];return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_ADOPT_UNKNOWN"];}}
}
- (void)retire {
 @synchronized(self){if(_retired)return;_retired=YES;_ready=NO;
  struct stat now{};if(_endpoint>=0&&!_endpointCloseSelected&&fstat(_endpoint,&now)==0&&IdentitySameFile(now,_identity))shutdown(_endpoint,SHUT_RDWR);
  @try{[_source retire];}@catch(id){[self fail:nil code:@"AUTH_IDENTITY_LAUNCH_RETIRE_UNKNOWN"];}
 }
}
- (BOOL)join:(NSError**)error {
 @synchronized(self){if(!pthread_equal(_thread,pthread_self())||!pthread_main_np())return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_THREAD_REQUIRED"];
  if(!_retired)return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_RETIRE_REQUIRED"];
  if(_spawnPID>0){errno=0;if(kill(_spawnPID,0)==0||errno!=ESRCH)return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_CHILD_JOIN_PENDING"];}
  if(_source&&![_source join:error])return NO;return YES;
 }
}
- (BOOL)close:(NSError**)error {
 @synchronized(self){if(!pthread_equal(_thread,pthread_self())||!pthread_main_np())return [self fail:error code:@"AUTH_IDENTITY_LAUNCH_THREAD_REQUIRED"];
  if(_closeSelected){if(!_complete&&error)*error=_cleanup;return _complete;}
  [self retire];if(![self join:error])return NO;_closeSelected=YES;BOOL okay=YES;NSError*first=nil,*next=nil;
  if(![self closeDuplicate:&next]){okay=NO;first=next;}
  if(_endpoint>=0&&!_endpointCloseSelected){_endpointCloseSelected=YES;struct stat now{};
   if(fstat(_endpoint,&now)||!IdentitySameFile(now,_identity)||::close(_endpoint)){okay=NO;if(!first)first=[NSError errorWithDomain:@"YNXOriginalIdentityPeerLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_LAUNCH_ENDPOINT_CLOSE_UNKNOWN"}];}
   else _endpoint=-1;
  }
  next=nil;@try{if(_source&&![_source close:&next]){okay=NO;if(!first)first=next;}}@catch(id){okay=NO;}
  _complete=okay&&_resourcesDebt.clean();if(_complete)_source=nil;
  else{_cleanup=first?:[NSError errorWithDomain:@"YNXOriginalIdentityPeerLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_LAUNCH_CLOSE_UNKNOWN"}];if(error)*error=_cleanup;}return _complete;
 }
}
- (NSError*)firstCause {return _first;}
- (BOOL)ready {return _ready&&!_retired&&!_first&&!_closeSelected;}
@end
