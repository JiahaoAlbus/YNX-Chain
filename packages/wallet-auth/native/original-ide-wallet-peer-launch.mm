#import "original-ide-wallet-peer-launch.h"
#import "original-ide-parent-kernel.h"
#import <AppKit/AppKit.h>
#import <Security/Security.h>
#include <CommonCrypto/CommonDigest.h>
#include <spawn.h>
#include <sys/wait.h>
#include <limits.h>
#include <memory>
using namespace ynx_auth_ide_identity_private;
using namespace ynx_auth_ide_private;
static bool WalletPeerSocketSame(const struct stat&a,const struct stat&b){return S_ISSOCK(a.st_mode)&&S_ISSOCK(b.st_mode)&&a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_nlink==b.st_nlink;}
static NSData *WalletPeerStaticIdentity(NSURL *url){SecStaticCodeRef code=nullptr;CFDictionaryRef info=nullptr;OSStatus rc=SecStaticCodeCreateWithPath((__bridge CFURLRef)url,kSecCSDefaultFlags,&code);if(rc==errSecSuccess)rc=SecStaticCodeCheckValidity(code,kSecCSStrictValidate,nullptr);if(rc==errSecSuccess)rc=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&info);id raw=info?((__bridge NSDictionary*)info)[(__bridge NSString*)kSecCodeInfoUnique]:nil;NSData *result=rc==errSecSuccess&&[raw isKindOfClass:NSData.class]?[raw copy]:nil;if(info)CFRelease(info);if(code)CFRelease(code);return result;}
@implementation YNXOriginalIDEWalletPeerLaunch {
 YNXOriginalIDEWalletIdentitySource *_source;NSDictionary *_registration,*_requestPacket;
 NSString *_image,*_resources;KernelProcess _wallet,_ide;ResourceCloseDebt _resourceDebt;
 int _server,_child,_spawn;struct stat _serverIdentity,_childIdentity,_spawnIdentity;
 BOOL _serverCloseSelected,_childCloseSelected,_spawnCloseSelected,_endpointCloseSelected,_shutdownSelected,_launchSelected,_launched,_requestSelected,_decisionSelected,_retired,_closeSelected,_closed,_reaped;
 pid_t _pid;int _childExitStatus;pthread_t _thread;NSError *_first,*_closeFirst;
 std::unique_ptr<Endpoint> _endpoint;
 Frame _captured,_decision;
 uint64_t _sourceEnd,_wallFloor,_monoFloor,_deadline;
}
- (instancetype)init{if((self=[super init])){_server=_child=_spawn=-1;_thread=pthread_self();_captured={Message::failure,0,{}};_decision={Message::failure,0,{}};}return self;}
- (BOOL)fail:(NSString *)code error:(NSError **)error{if(!_first)_first=(error&&*error)?*error:[NSError errorWithDomain:@"YNXOriginalIDEWalletPeerLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=_first;return NO;}
- (BOOL)clock:(NSError **)error{uint64_t wall=wallMS(),mono=monotonicMS();if(wall<_wallFloor||mono<_monoFloor||wall>=_sourceEnd||mono>=_deadline)return [self fail:@"AUTH_IDENTITY_WALLET_PEER_EXPIRED" error:error];_wallFloor=wall;_monoFloor=mono;return YES;}
- (BOOL)thread:(NSError **)error{if(!pthread_main_np()||!pthread_equal(_thread,pthread_self())){if(error)*error=[NSError errorWithDomain:@"YNXOriginalIDEWalletPeerLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_WALLET_THREAD_REQUIRED"}];return NO;}return YES;}
+ (instancetype)captureSource:(YNXOriginalIDEWalletIdentitySource *)source error:(NSError **)error{
 YNXOriginalIDEWalletPeerLaunch *h=[self new];h->_source=source;
 @try{try{
  if(![h thread:error]||[source class]!=YNXOriginalIDEWalletIdentitySource.class||![source assertCurrent:error])return [h fail:@"AUTH_IDENTITY_WALLET_SOURCE_REQUIRED" error:error],h;
  h->_registration=[source copyRegistration:error];NSNumber *end=[source copySourceExpiresAtMs:error];
  uint64_t wall=wallMS(),mono=monotonicMS();if(!h->_registration||!end||end.unsignedLongLongValue<=wall||mono>UINT64_MAX-(end.unsignedLongLongValue-wall))return [h fail:@"AUTH_IDENTITY_WALLET_SOURCE_WINDOW_REQUIRED" error:error],h;
  h->_sourceEnd=end.unsignedLongLongValue;h->_wallFloor=wall;h->_monoFloor=mono;h->_deadline=mono+(h->_sourceEnd-wall);h->_wallet=observeKernel(getpid());
  // Resolve the original fixed registered product through the normal OS App
  // registry. No renderer/caller path, PID, environment or executable selector.
  NSURL *url=[NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:@"com.ynxweb4.developer.testnetpreview"];
  NSBundle *bundle=url?[NSBundle bundleWithURL:url]:nil;NSString *image=bundle.executableURL.path;
  char canonical[PATH_MAX]{},resources[PATH_MAX]{};
  // Foundation may normalize /private/var to /var. Resolve the OS-selected
  // original once, then bind static code, actual kernel image and all resource
  // pins to that canonical target. This accepts no caller path or trust claim.
  if(![bundle.bundleIdentifier isEqual:@"com.ynxweb4.developer.testnetpreview"]||!image.length||!realpath(image.fileSystemRepresentation,canonical)||!realpath(bundle.resourceURL.path.fileSystemRepresentation,resources)||![[WalletPeerStaticIdentity([NSURL fileURLWithPath:[NSString stringWithUTF8String:canonical]])base64EncodedStringWithOptions:0]isEqual:h->_registration[@"ideCodeIdentity"]])return [h fail:@"AUTH_IDENTITY_WALLET_IDE_INSTALLATION_REQUIRED" error:error],h;
  h->_image=[NSString stringWithUTF8String:canonical];h->_resources=[NSString stringWithUTF8String:resources];
  if(!identityResourceBytes(h->_resources,h->_registration,h->_resourceDebt)||![source assertCurrent:error]||![h clock:error])return [h fail:@"AUTH_IDENTITY_WALLET_IDE_RESOURCES_CHANGED" error:error],h;
  int pair[2]={-1,-1};if(socketpair(AF_UNIX,SOCK_STREAM,0,pair))return [h fail:@"AUTH_IDENTITY_WALLET_SOCKETPAIR_UNAVAILABLE" error:error],h;
  h->_server=pair[0];h->_child=pair[1]; // capture BOTH before any later syscall
  if(fstat(h->_server,&h->_serverIdentity)||fstat(h->_child,&h->_childIdentity))return [h fail:@"AUTH_IDENTITY_WALLET_SOCKETPAIR_IDENTITY_UNKNOWN" error:error],h;
  for(int fd:pair){int flags=fcntl(fd,F_GETFD),yes=1;if(flags<0||fcntl(fd,F_SETFD,flags|FD_CLOEXEC)||setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes)))return [h fail:@"AUTH_IDENTITY_WALLET_SOCKETPAIR_CONFIGURATION_UNKNOWN" error:error],h;}
  if(![source assertCurrent:error]||![h clock:error])return [h fail:@"AUTH_IDENTITY_WALLET_SOCKETPAIR_POST_CURRENT_REFUSED" error:error],h;
  return h;
 }catch(...){[h fail:@"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION" error:error];return h;}}@catch(NSException*){[h fail:@"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION" error:error];return h;}
}
- (BOOL)assertCurrent:(NSError **)error{
 if(![self thread:error])return NO;if(_first||_retired||_closeSelected)return [self fail:@"AUTH_IDENTITY_WALLET_PEER_NOT_CURRENT" error:error];
 @try{try{if(![self clock:error]||![_source assertCurrent:error]||!sameKernel(_wallet,observeKernel(getpid()))||![[_source copyRegistration:error]isEqual:_registration]||!identityResourceBytes(_resources,_registration,_resourceDebt))return [self fail:@"AUTH_IDENTITY_WALLET_PEER_CURRENT_REFUSED" error:error];
  if(_launched&&(!sameKernel(_ide,observeKernel(_pid))||_ide.original.parent!=_wallet.original.pid))return [self fail:@"AUTH_IDENTITY_WALLET_IDE_CHILD_CHANGED" error:error];
  if(_endpoint)_endpoint->current();else{struct stat s{};if(_server<0||fstat(_server,&s)||!WalletPeerSocketSame(s,_serverIdentity))return [self fail:@"AUTH_IDENTITY_WALLET_SOCKET_CHANGED" error:error];}
  if(![_source assertCurrent:error]||![self clock:error]||_first||_retired||_closeSelected)return [self fail:@"AUTH_IDENTITY_WALLET_PEER_POST_CURRENT_REFUSED" error:error];return YES;
 }catch(...){return [self fail:@"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION" error:error];}}@catch(NSException*){return [self fail:@"AUTH_IDENTITY_WALLET_NATIVE_EXCEPTION" error:error];}
}
- (BOOL)closeDescriptor:(int *)fd identity:(const struct stat&)identity selected:(BOOL *)selected error:(NSError **)error{
 if(*fd<0)return YES;if(*selected){if(error)*error=_closeFirst;return NO;}*selected=YES;struct stat now{};
 if(fstat(*fd,&now)||!WalletPeerSocketSame(now,identity)||::close(*fd)){if(!_closeFirst)_closeFirst=[NSError errorWithDomain:@"YNXOriginalIDEWalletPeerLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_WALLET_SOCKET_CLOSE_UNKNOWN"}];if(error)*error=_closeFirst;return NO;}
 *fd=-1;return YES;
}
- (BOOL)launch:(NSError **)error{
 if(![self thread:error])return NO;if(_launchSelected)return [self fail:@"AUTH_IDENTITY_WALLET_LAUNCH_ONCE" error:error];_launchSelected=YES;
 if(![self assertCurrent:error])return NO;
 // Raw marker is queued exactly once BEFORE fork/exec. It is not a framed
 // sequence item, proof, user approval, or fallback to old admission channels.
 if(send(_server,Magic.data(),Magic.size(),MSG_DONTWAIT)!=(ssize_t)Magic.size())return [self fail:@"AUTH_IDENTITY_WALLET_MARKER_WRITE_UNKNOWN" error:error];
 _spawn=fcntl(_child,F_DUPFD_CLOEXEC,10);if(_spawn<0||fstat(_spawn,&_spawnIdentity)||!WalletPeerSocketSame(_spawnIdentity,_childIdentity)||![self assertCurrent:error])return [self fail:@"AUTH_IDENTITY_WALLET_SPAWN_DUPLICATE_UNKNOWN" error:error];
 posix_spawn_file_actions_t actions;posix_spawnattr_t attributes;int rc=posix_spawn_file_actions_init(&actions);if(rc)return [self fail:@"AUTH_IDENTITY_WALLET_SPAWN_ACTIONS_UNKNOWN" error:error];
 rc=posix_spawnattr_init(&attributes);if(rc){posix_spawn_file_actions_destroy(&actions);return [self fail:@"AUTH_IDENTITY_WALLET_SPAWN_ATTRIBUTES_UNKNOWN" error:error];}
 if(!rc)rc=posix_spawn_file_actions_adddup2(&actions,_spawn,5);if(!rc)rc=posix_spawn_file_actions_addclose(&actions,_spawn);if(!rc)rc=posix_spawnattr_setflags(&attributes,POSIX_SPAWN_CLOEXEC_DEFAULT);
 char *argv[]={const_cast<char*>(_image.fileSystemRepresentation),nullptr};char *environment[]={nullptr};
 if(!rc)rc=posix_spawn(&_pid,argv[0],&actions,&attributes,argv,environment); // actual PID captured before any callback
 int a=posix_spawn_file_actions_destroy(&actions),b=posix_spawnattr_destroy(&attributes);
 if(rc||a||b)return [self fail:@"AUTH_IDENTITY_WALLET_LAUNCH_UNKNOWN" error:error];
 @try{try{_ide=observeKernel(_pid);_launched=YES;if(_ide.original.parent!=_wallet.original.pid||_ide.original.uid!=_wallet.original.uid||![_ide.image isEqual:_image]||![[_ide.codeIdentity base64EncodedStringWithOptions:0]isEqual:_registration[@"ideCodeIdentity"]])return [self fail:@"AUTH_IDENTITY_WALLET_IDE_CHILD_MISMATCH" error:error];}catch(...){return [self fail:@"AUTH_IDENTITY_WALLET_IDE_CHILD_UNKNOWN" error:error];}}@catch(NSException*){return [self fail:@"AUTH_IDENTITY_WALLET_IDE_CHILD_UNKNOWN" error:error];}
 if(![self closeDescriptor:&_spawn identity:_spawnIdentity selected:&_spawnCloseSelected error:error]||![self closeDescriptor:&_child identity:_childIdentity selected:&_childCloseSelected error:error]||![self assertCurrent:error])return NO;
 // Adopt the owned server endpoint only AFTER the actual registered child
 // qualifies. Same original Source expiry captured once; never lease renewal.
 _endpoint=std::make_unique<Endpoint>(_server,std::chrono::steady_clock::time_point(std::chrono::milliseconds(_deadline)));_server=-1;
 return [self assertCurrent:error];
}
- (Frame)receiveBytes{if(!_endpoint)throw std::runtime_error("AUTH_IDENTITY_WALLET_LAUNCH_REQUIRED");return _endpoint->receive();}
- (void)sendBytes:(Frame)frame{if(!_endpoint)throw std::runtime_error("AUTH_IDENTITY_WALLET_LAUNCH_REQUIRED");_endpoint->send(frame.kind,frame.payload);}
- (BOOL)captureRequest:(Frame)frame error:(NSError **)error{
 if(![self thread:error])return NO;
 if(_requestSelected)return [self fail:@"AUTH_IDENTITY_WALLET_REQUEST_ONCE" error:error];_requestSelected=YES;
 _captured=std::move(frame); // keep FIRST actual bytes BEFORE current/refusal
 if(![self assertCurrent:error]||_captured.kind!=Message::request||_captured.payload.empty()||_captured.payload.size()>65536)return [self fail:@"AUTH_IDENTITY_WALLET_REQUEST_FRAME_INVALID" error:error];
 NSData *raw=[NSData dataWithBytes:_captured.payload.data() length:_captured.payload.size()];id packet=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
 if(![packet isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:[packet allKeys]]isEqual:[NSSet setWithArray:@[@"requestRaw",@"invocationRaw"]]]||![[NSJSONSerialization dataWithJSONObject:packet options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil]isEqual:raw])return [self fail:@"AUTH_IDENTITY_WALLET_REQUEST_PACKET_INVALID" error:error];
 id request=packet[@"requestRaw"],invocation=packet[@"invocationRaw"];if(![request isKindOfClass:NSString.class]||!(invocation==NSNull.null||[invocation isKindOfClass:NSString.class]))return [self fail:@"AUTH_IDENTITY_WALLET_REQUEST_PACKET_INVALID" error:error];
 _requestPacket=[packet copy];NSData *invocationRaw=invocation==NSNull.null?[NSData data]:[invocation dataUsingEncoding:NSUTF8StringEncoding];
 if(![_source bindRequest:[request dataUsingEncoding:NSUTF8StringEncoding] invocation:invocationRaw error:error])return [self fail:@"AUTH_IDENTITY_WALLET_REQUEST_UNQUALIFIED" error:error];return [self assertCurrent:error];
}
- (BOOL)selectDecision:(NSString *)kind proof:(NSData *)proof error:(NSError **)error{
 if(![self thread:error])return NO;if(_decisionSelected)return [self fail:@"AUTH_IDENTITY_WALLET_DECISION_ONCE" error:error];_decisionSelected=YES;
 // Capture actual returned signed bytes before ANY foreign current callback.
 if([kind isEqual:@"approve"]){if(![proof isKindOfClass:NSData.class]||!proof.length||proof.length>ProofMax)return [self fail:@"AUTH_IDENTITY_WALLET_PROOF_INVALID" error:error];_decision={Message::proof,0,{(const unsigned char*)proof.bytes,(const unsigned char*)proof.bytes+proof.length}};}
 if(!_requestSelected||!_requestPacket||![self assertCurrent:error])return NO;
 if([kind isEqual:@"approve"]){if(![_source verifyProof:proof error:error])return [self fail:@"AUTH_IDENTITY_WALLET_PROOF_REFUSED" error:error];}
 else if([kind isEqual:@"reject"]||[kind isEqual:@"cancel"]){if(proof)return [self fail:@"AUTH_IDENTITY_WALLET_UNEXPECTED_PROOF" error:error];NSData *request=[_requestPacket[@"requestRaw"]dataUsingEncoding:NSUTF8StringEncoding];unsigned char digest[32];CC_SHA256(request.bytes,(CC_LONG)request.length,digest);_decision={[kind isEqual:@"reject"]?Message::reject:Message::cancel,0,{digest,digest+32}};}
 else return [self fail:@"AUTH_IDENTITY_WALLET_DECISION_INVALID" error:error];
 return [self assertCurrent:error];
}
- (Frame)selectedDecision{return _decision;}
- (NSDictionary *)copyCapturedRequest:(NSError **)error{if(![self assertCurrent:error]||!_requestPacket)return nil;NSDictionary *result=[_requestPacket copy];return [self assertCurrent:error]?result:nil;}
- (void)retire{
 if(!pthread_equal(_thread,pthread_self()))return;_retired=YES;
 if(_endpoint)_endpoint->retire();else{
  if(!_shutdownSelected&&_server>=0){_shutdownSelected=YES;struct stat now{};if(fstat(_server,&now)||!WalletPeerSocketSame(now,_serverIdentity)||shutdown(_server,SHUT_RDWR)){if(!_closeFirst)_closeFirst=[NSError errorWithDomain:@"YNXOriginalIDEWalletPeerLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_WALLET_SOCKET_SHUTDOWN_UNKNOWN"}];}}
  // Partial launch has no worker/Endpoint owner. Release our three exact
  // captured copies BEFORE waiting for the child: keeping the child's copies
  // open can prevent its read loop from terminating after pre-adoption failure.
  [self closeDescriptor:&_server identity:_serverIdentity selected:&_serverCloseSelected error:nil];
  [self closeDescriptor:&_child identity:_childIdentity selected:&_childCloseSelected error:nil];
  [self closeDescriptor:&_spawn identity:_spawnIdentity selected:&_spawnCloseSelected error:nil];
 }
 [_source retire];
}
- (BOOL)join:(NSError **)error{
 if(![self thread:error]||!_retired)return NO;if(_endpoint&&!_endpoint->joined())return NO;
 // EOF may require the final owned socket close, not only shutdown. Once byte
 // calls have drained, dispose this exact endpoint before waiting for process
 // exit; never keep an inherited peer alive by our own cleanup ordering.
 if(_endpoint&&!_endpointCloseSelected){_endpointCloseSelected=YES;try{_endpoint->close();}catch(...){if(!_closeFirst)_closeFirst=[NSError errorWithDomain:@"YNXOriginalIDEWalletPeerLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_WALLET_ENDPOINT_CLOSE_UNKNOWN"}];}}
 if(_pid>1&&!_reaped){int status=0;pid_t rc=waitpid(_pid,&status,WNOHANG);if(!rc)return NO;if(rc!=_pid)return [self fail:@"AUTH_IDENTITY_WALLET_CHILD_REAP_UNKNOWN" error:error];_childExitStatus=WIFEXITED(status)?WEXITSTATUS(status):WIFSIGNALED(status)?128+WTERMSIG(status):-1;_reaped=YES;}
 if(_closeFirst){if(error)*error=_closeFirst;return NO;}return YES;
}
- (BOOL)close:(NSError **)error{
 if(![self thread:error])return NO;if(_closeSelected){if(error)*error=_closeFirst;return _closed;}[self retire];if(![self join:error])return NO;_closeSelected=YES;
 BOOL ok=YES;if(_endpoint){try{_endpoint->close();}catch(...){ok=NO;}}if(![self closeDescriptor:&_server identity:_serverIdentity selected:&_serverCloseSelected error:error])ok=NO;if(![self closeDescriptor:&_child identity:_childIdentity selected:&_childCloseSelected error:error])ok=NO;if(![self closeDescriptor:&_spawn identity:_spawnIdentity selected:&_spawnCloseSelected error:error])ok=NO;
 if(!_resourceDebt.clean()||_closeFirst)ok=NO;if(!ok){if(!_closeFirst)_closeFirst=[NSError errorWithDomain:@"YNXOriginalIDEWalletPeerLaunch" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_WALLET_PEER_CLOSE_UNKNOWN"}];if(error)*error=_closeFirst;return NO;}_closed=YES;return YES;
}
- (NSDictionary *)status{return @{@"launched":@(_launched),@"requestCaptured":@(_requestSelected),@"decisionSelected":@(_decisionSelected),@"capturedProofBytes":@(_decision.kind==Message::proof?_decision.payload.size():0),@"childReaped":@(_reaped||_pid<=1),@"childExitStatus":_reaped?(id)@(_childExitStatus):NSNull.null,@"retired":@(_retired),@"closed":@(_closed),@"shutdownSelected":@(_shutdownSelected),@"firstCause":_first.localizedDescription?:NSNull.null,@"closeCause":_closeFirst.localizedDescription?:NSNull.null,@"dataOnly":@YES,@"userApproved":@NO};}
@end
