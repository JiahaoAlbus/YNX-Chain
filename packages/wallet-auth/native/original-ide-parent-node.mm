#import "original-ide-parent-node.h"
#import "original-ide-parent-kernel.h"
#include "original-ide-parent-transport.h"
#import <bsm/libbsm.h>
#import <sys/stat.h>
#import <sys/un.h>
#import <fcntl.h>
#include <memory>
using namespace ynx_auth_ide_private;
static bool NodeSameFile(struct stat a,struct stat b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_mode==b.st_mode&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_nlink==b.st_nlink;}
@implementation YNXOriginalIDENodeDelivery {
 YNXAuthIdentitySourceAuthority *_source;SourceBinding _binding;Lifetime _life;
 ResourceCloseDebt _resourceDebt;
 KernelProcess _wallet,_ide,_node;NSString *_resources;
 audit_token_t _peerToken,_selfToken;struct stat _endpointIdentity;
 std::array<unsigned char,32> _ideAudit;
 int _ownedEndpoint;std::unique_ptr<PreludeTransport> _prelude;
 BOOL _selected,_ready,_retired,_closeSelected,_complete,_endpointSelected;
 NSError *_first,*_cleanup;id _originalCause;
}
- (instancetype)init {if((self=[super init]))_ownedEndpoint=-1;return self;}
- (BOOL)fail:(NSError **)error code:(NSString *)code {
 if(!_first)_first=(error&&*error)?*error:[NSError errorWithDomain:@"YNXOriginalIDENode" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];_retired=YES;_life.unknown(code.UTF8String);if(error)*error=_first;return NO;
}
- (BOOL)endpointCurrent {
 if(_ownedEndpoint<0||_endpointSelected)return NO;struct stat owned{},named{};audit_token_t peer{};socklen_t n=sizeof(peer);sockaddr_un address{};socklen_t addressSize=sizeof(address);int type=0;socklen_t typeSize=sizeof(type);pollfd p{_ownedEndpoint,POLLIN,0};
 return poll(&p,1,0)>=0&&!(p.revents&(POLLHUP|POLLERR|POLLNVAL))&&fstat(_ownedEndpoint,&owned)==0&&fstat(4,&named)==0&&NodeSameFile(owned,_endpointIdentity)&&NodeSameFile(named,_endpointIdentity)&&
  getsockopt(_ownedEndpoint,SOL_SOCKET,SO_TYPE,&type,&typeSize)==0&&type==SOCK_STREAM&&getpeername(_ownedEndpoint,(sockaddr*)&address,&addressSize)==0&&address.sun_family==AF_UNIX&&
  getsockopt(_ownedEndpoint,SOL_LOCAL,LOCAL_PEERTOKEN,&peer,&n)==0&&n==sizeof(peer)&&std::memcmp(&peer,&_peerToken,sizeof(peer))==0;
}
- (BOOL)acquireActualEntry:(NSString *)entryFileURL error:(NSError **)error {
 @synchronized(self){@try{try{
  if(_selected)return [self fail:error code:@"IDE_NODE_ACQUIRE_ALREADY_SELECTED"];_selected=YES;
  _resources=actualNodeParentResources();if(!actualNodeEntry(_resources,entryFileURL))return [self fail:error code:@"IDE_NODE_ACTUAL_RUNNING_ENTRY_MISMATCH"];
  _source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEConsumerSource:error];
  if(!_source||!_binding.capture(_source,error))return [self fail:error code:@"IDE_NODE_ORIGINAL_SOURCE_NOT_ADMITTED"];
  _node=observeKernel(getpid());_ide=observeKernel(getppid());_wallet=observeKernel((pid_t)_ide.original.parent);_selfToken=originalSelfAudit();
  NSDictionary *r=_binding.registration();
  if(_node.original.parent!=_ide.original.pid||_ide.original.parent!=_wallet.original.pid||_node.original.uid!=_ide.original.uid||_ide.original.uid!=_wallet.original.uid||
     ![[_node.codeIdentity base64EncodedStringWithOptions:0] isEqual:r[@"nodeCodeIdentity"]]||![[_ide.codeIdentity base64EncodedStringWithOptions:0] isEqual:r[@"ideCodeIdentity"]]||![[_wallet.codeIdentity base64EncodedStringWithOptions:0] isEqual:r[@"walletCodeIdentity"]]||!registeredResources(_resources,_binding,_resourceDebt))return [self fail:error code:@"IDE_NODE_REGISTERED_LINEAGE_OR_RESOURCES_MISMATCH"];
  socklen_t n=sizeof(_peerToken);if(getsockopt(4,SOL_LOCAL,LOCAL_PEERTOKEN,&_peerToken,&n)||n!=sizeof(_peerToken)||audit_token_to_pid(_peerToken)!=(pid_t)_wallet.original.pid||audit_token_to_euid(_peerToken)!=_wallet.original.uid)return [self fail:error code:@"IDE_NODE_ORIGINAL_WALLET_PEER_MISMATCH"];
  _ownedEndpoint=fcntl(4,F_DUPFD_CLOEXEC,10);if(_ownedEndpoint<0||fstat(_ownedEndpoint,&_endpointIdentity)||![self endpointCurrent])return [self fail:error code:@"IDE_NODE_ORIGINAL_ENDPOINT_UNAVAILABLE"];
  uint64_t now=wallMS(),expires=[_binding.request()[@"expiresAtMs"] unsignedLongLongValue];if(expires<=now)return [self fail:error code:@"IDE_NODE_ORIGINAL_INTENT_EXPIRED"];
  _prelude=std::make_unique<PreludeTransport>(_ownedEndpoint,(unsigned)std::min<uint64_t>(expires-now,15000));
  Prelude request=originalPrelude(PreludeKind::acquireNode,_binding);request.wallet=_wallet.original;request.ide=_ide.original;request.node=_node.original;_prelude->write(request);
  Prelude reply=_prelude->read();
  if(reply.kind!=PreludeKind::readyNode||!originalPreludeBinding(reply,_binding)||reply.challenge!=request.challenge||!(reply.wallet==request.wallet)||!(reply.ide==request.ide)||!(reply.node==request.node)||std::memcmp(reply.audit.data(),&_peerToken,32)||std::memcmp(reply.nodeAudit.data(),&_selfToken,32)||!verifyKernelAudit(reply.ideAudit,_ide.original))return [self fail:error code:@"IDE_NODE_ORIGINAL_JOINT_ADOPTION_MISMATCH"];
  _ideAudit=reply.ideAudit;
  if(!_binding.current(error)||![self endpointCurrent]||!sameKernel(_node,observeKernel(getpid()))||!sameKernel(_ide,observeKernel(getppid()))||!sameKernel(_wallet,observeKernel((pid_t)_wallet.original.pid))||
     !_life.begin([_binding.request()[@"requestNonce"] UTF8String],_wallet.original,_ide.original,wallMS(),expires,monotonicMS())||!_life.beginAdopt(_life.intent(),_node.original)||!_life.completeAdopt(_life.intent(),_node.original,_wallet.original,_ide.original,wallMS(),monotonicMS()))return [self fail:error code:@"IDE_NODE_ACQUIRE_POST_FENCE_FAILED"];
  _prelude->handoff(); // NO Native payload IO after this precise point.
  _ready=YES;return YES;
 }catch(const std::exception&e){return [self fail:error code:[NSString stringWithUTF8String:e.what()]];}}@catch(id exception){if(!_originalCause)_originalCause=exception;return [self fail:error code:@"IDE_NODE_ACQUIRE_EXCEPTION"];} }
}
- (YNXAuthIdentitySourceAuthority *)borrowOriginalPrivateClientSource:(NSError **)error {
 @synchronized(self){if(![self assertCurrentExpected:nil error:error]||![_source assertAuthenticatedNativePurpose:error])return nil;return _source;}
}
- (NSDictionary *)copyOriginalPrivateClientSelection:(NSError **)error {
 @synchronized(self){if(![self assertCurrentExpected:nil error:error]||![_source assertAuthenticatedNativePurpose:error])return nil;NSDictionary *original=[_source copyOriginalSelection:error];if(![self assertCurrentExpected:nil error:error])return nil;return original;}
}
- (int)descriptor {@synchronized(self){return _ready&&!_retired?4:-1;}}
- (id)firstCause {return _originalCause?:_first;}
- (BOOL)assertCurrentExpected:(NSDictionary *)expected error:(NSError **)error {
 @synchronized(self){@try{try{
  if(!_ready||_retired||_closeSelected||!_prelude->handedOff()||(expected&&![expected isEqual:_binding.request()]))return [self fail:error code:@"IDE_NODE_CURRENT_BINDING_MISMATCH"];
  auto observedSelf=observeKernel(getpid()),ide=observeKernel(getppid()),wallet=observeKernel((pid_t)_wallet.original.pid);auto token=originalSelfAudit();
  std::array<unsigned char,32> walletAudit{};std::memcpy(walletAudit.data(),&_peerToken,32);
  if(std::memcmp(&token,&_selfToken,32)||!verifyKernelAudit(_ideAudit,_ide.original)||!verifyKernelAudit(walletAudit,_wallet.original)||!sameKernel(observedSelf,_node)||!sameKernel(ide,_ide)||!sameKernel(wallet,_wallet)||![self endpointCurrent]||!_binding.current(error)||!_life.current(wallet.original,ide.original,wallMS(),monotonicMS())||!_life.nodeCurrent(observedSelf.original))return [self fail:error code:@"IDE_NODE_CURRENT_FAILED"];
  if(!registeredResources(_resources,_binding,_resourceDebt)||!_binding.current(error)||![self endpointCurrent]||!_life.current(wallet.original,ide.original,wallMS(),monotonicMS()))return [self fail:error code:@"IDE_NODE_POST_CURRENT_FAILED"];return YES;
 }catch(const std::exception&e){return [self fail:error code:[NSString stringWithUTF8String:e.what()]];}}@catch(id exception){if(!_originalCause)_originalCause=exception;return [self fail:error code:@"IDE_NODE_CURRENT_EXCEPTION"];} }
}
- (BOOL)closeOriginal:(NSError **)error {
 @synchronized(self){if(_closeSelected){if(!_complete&&error)*error=_cleanup;return _complete;}_retired=YES;_ready=NO;_life.retire();_closeSelected=YES;BOOL endpointDone=YES;
  if(_ownedEndpoint>=0&&!_endpointSelected){_endpointSelected=YES;struct stat now{};
   if(fstat(_ownedEndpoint,&now)||!NodeSameFile(now,_endpointIdentity)){endpointDone=NO;}
   else {if(shutdown(_ownedEndpoint,SHUT_RDWR)&&errno!=ENOTCONN)endpointDone=NO;if(::close(_ownedEndpoint))endpointDone=NO;else _ownedEndpoint=-1;}
  }
  NSError *retireFailure=nil,*joinFailure=nil,*closeFailure=nil;BOOL sourceJoined=YES,sourceClosed=YES;
  @try{[_source retire];}@catch(id exception){if(!_first&&!_originalCause)_originalCause=exception;retireFailure=[NSError errorWithDomain:@"YNXOriginalIDENode" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_SOURCE_RETIRE_EXCEPTION"}];}
  @try{if(_source)sourceJoined=[_source join:&joinFailure];}@catch(id exception){sourceJoined=NO;if(!_first&&!_originalCause)_originalCause=exception;joinFailure=[NSError errorWithDomain:@"YNXOriginalIDENode" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_SOURCE_JOIN_EXCEPTION"}];}
  @try{if(_source)sourceClosed=[_source close:&closeFailure];}@catch(id exception){sourceClosed=NO;if(!_first&&!_originalCause)_originalCause=exception;closeFailure=[NSError errorWithDomain:@"YNXOriginalIDENode" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_SOURCE_CLOSE_EXCEPTION"}];}
  _complete=endpointDone&&sourceJoined&&sourceClosed&&!retireFailure&&_resourceDebt.clean();
  if(!_complete)_cleanup=retireFailure?:joinFailure?:closeFailure?:[NSError errorWithDomain:@"YNXOriginalIDENode" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_NODE_CLOSE_UNKNOWN"}];else _source=nil;
  if(!_complete&&error)*error=_cleanup;return _complete;
 }
}
@end
