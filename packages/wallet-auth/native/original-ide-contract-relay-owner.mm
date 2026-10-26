#import "original-ide-contract-relay-owner.h"
#import "original-auth-identity-source-authority.h"
#include "original-ide-parent-kernel.h"
#include "original-ide-contract-relay-peer.h"
#include "original-ide-contract-relay-launch.h"
#include <bsm/libbsm.h>
#include <sys/un.h>
#include <poll.h>
#include <memory>
static NSMutableSet *RelayOwners(){static NSMutableSet *owners;static dispatch_once_t once;dispatch_once(&once,^{owners=[NSMutableSet set];});return owners;}
@implementation YNXOriginalIDEContractRelayOwner {
 YNXAuthIdentitySourceAuthority *_source;
 NSDictionary *_scope,*_peerBinding;
 NSDictionary *_launch,*_localContext;
 ynx_auth_private::TemporaryDescriptor _workspaceDir,_profileDir;
 struct stat _workspaceIdentity,_profileIdentity;
 NSString *_resources;
 ynx_auth_ide_private::KernelProcess _node,_ide,_wallet;
 ynx_auth_ide_private::ResourceCloseDebt _resourceDebt;
 ynx_auth_ide_relay_private::BorrowedPeer _endpoint;
 dispatch_block_t _observer;
 NSError *_first,*_closeFirst,*_retireError;
 BOOL _ready,_retired,_retireResult,_busy,_notified,_observerRunning,_closeSelected,_closed;
}
- (BOOL)fail:(NSString*)code error:(NSError**)error {
 if(!_first)_first=[NSError errorWithDomain:@"YNXOriginalContractRelay" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];
 _ready=NO;if(error)*error=_first;return NO;
}
- (BOOL)recordActualError:(NSError*)actual fallback:(NSString*)fallback error:(NSError**)error {
 if(!_first&&actual)_first=actual;return [self fail:fallback error:error];
}
+ (instancetype)captureForActualRunningEntry:(NSString*)entry error:(NSError**)error {
 return [self captureForActualRunningEntry:entry localContext:nil error:error];
}
+ (instancetype)captureForActualRunningEntry:(NSString*)entry localContext:(NSDictionary*)context error:(NSError**)error {
 if(!pthread_main_np()||getuid()!=geteuid()||getgid()!=getegid()||RelayOwners().count>=64){if(error)*error=[NSError errorWithDomain:@"YNXOriginalContractRelay" code:4 userInfo:@{NSLocalizedDescriptionKey:@"IDE_CONTRACT_RELAY_PROCESS_OR_CAPACITY_REQUIRED"}];return nil;}
 auto s=[self new];[RelayOwners()addObject:s];
 @try{try{
  s->_resources=ynx_auth_ide_private::actualNodeParentResources();
  if(!ynx_auth_ide_private::actualNodeEntry(s->_resources,entry))return [s fail:@"IDE_CONTRACT_RELAY_ACTUAL_ENTRY_REQUIRED" error:error],s;
  // Acquire actual consumer custody before examining status; never JS Source,
  // request owner, raw FD or expectedScope. Dedicated purpose checked below.
  NSError *e=nil;s->_source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEContractRelaySource:&e];
  if(e||!s->_source)return [s recordActualError:e fallback:@"IDE_CONTRACT_RELAY_SOURCE_UNAVAILABLE" error:error],s;
  s->_scope=[s->_source copyOriginalIDEContractRelayScopeLocal:&e];
  if(e||!s->_scope)return [s recordActualError:e fallback:@"IDE_CONTRACT_RELAY_PROJECT_SOURCE_REQUIRED" error:error],s;
  s->_peerBinding=[s->_source copyOriginalIDEContractRelayPeerBindingLocal:&e];
  if(e||!s->_peerBinding)return [s recordActualError:e fallback:@"IDE_CONTRACT_RELAY_PEER_REQUIRED" error:error],s;
  if(!s->_endpoint.capture(5))return [s fail:@"IDE_CONTRACT_RELAY_ORIGINAL_ENDPOINT_REQUIRED" error:error],s;
  s->_node=ynx_auth_ide_private::observeKernel(getpid());s->_ide=ynx_auth_ide_private::observeKernel(getppid());s->_wallet=ynx_auth_ide_private::observeKernel((pid_t)s->_ide.original.parent);
  if(audit_token_to_pid(s->_endpoint.audit)!=(pid_t)s->_wallet.original.pid||audit_token_to_euid(s->_endpoint.audit)!=s->_wallet.original.uid||s->_node.original.parent!=s->_ide.original.pid||s->_ide.original.parent!=s->_wallet.original.pid||s->_node.original.uid!=s->_ide.original.uid||s->_ide.original.uid!=s->_wallet.original.uid)return [s fail:@"IDE_CONTRACT_RELAY_PEER_LINEAGE_REQUIRED" error:error],s;
  for(NSString *key in @[@"walletCodeIdentity",@"ideCodeIdentity",@"nodeCodeIdentity"]){
   NSData *identity=[key isEqual:@"walletCodeIdentity"]?s->_wallet.codeIdentity:[key isEqual:@"ideCodeIdentity"]?s->_ide.codeIdentity:s->_node.codeIdentity;
   if(![[identity base64EncodedStringWithOptions:0]isEqual:s->_peerBinding[key]])return [s fail:@"IDE_CONTRACT_RELAY_CODE_BINDING_CHANGED" error:error],s;
  }
  // Caller identity is the actual authenticated incoming peer's registered
  // Node code identity, not an IDE account/owner/hash guess or expectedScope.
  if(![s->_scope[@"callerIdentity"]isEqual:s->_peerBinding[@"nodeCodeIdentity"]])return [s fail:@"IDE_CONTRACT_RELAY_CALLER_IDENTITY_MISMATCH" error:error],s;
  s->_launch=[s->_source copyOriginalIDEContractRelayLaunchLocal:&e];
  if(e||!s->_launch||!ynx_auth_ide_relay_private::actualLaunch(s->_launch,s->_scope,context,s->_node.original))return [s recordActualError:e fallback:@"IDE_CONTRACT_RELAY_LOCAL_PROJECT_LAUNCH_MISMATCH" error:error],s;
  // Caller context restricts the already signed mapping; it never chooses a
  // canonical project/identity or grants permission. Capture immutable DATA.
  NSData *contextRaw=[NSJSONSerialization dataWithJSONObject:context options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
  s->_localContext=[NSJSONSerialization JSONObjectWithData:contextRaw options:0 error:nil];
  for(NSString*k in @[@"workspace",@"profile"]){
   auto&slot=[k isEqual:@"workspace"]?s->_workspaceDir:s->_profileDir;auto&identity=[k isEqual:@"workspace"]?s->_workspaceIdentity:s->_profileIdentity;
   NSString *path=s->_localContext[k];int fd=open(path.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return [s fail:@"IDE_CONTRACT_RELAY_LOCAL_DIRECTORY_UNAVAILABLE" error:error],s;
   if(!slot.hold(fd))std::terminate(); // adopt BEFORE any fstat/status/validation
   uint64_t dev=0,ino=0;SourceProofU64(s->_launch[k][@"device"],dev);SourceProofU64(s->_launch[k][@"inode"],ino,true);
   if(fstat(fd,&identity)||!S_ISDIR(identity.st_mode)||(uint64_t)identity.st_dev!=dev||(uint64_t)identity.st_ino!=ino||!ynx_auth_ide_relay_private::namedDirectory(path,identity,fd))return [s fail:@"IDE_CONTRACT_RELAY_LOCAL_DIRECTORY_IDENTITY_MISMATCH" error:error],s;
   if([k isEqual:@"profile"]&&(identity.st_uid!=getuid()||(identity.st_mode&0077)))return [s fail:@"IDE_CONTRACT_RELAY_PRIVATE_PROFILE_REQUIRED" error:error],s;
  }
  if(![s->_source pinOriginalIDEContractRelayRuntime:&e])return [s recordActualError:e fallback:@"IDE_CONTRACT_RELAY_RUNTIME_NOT_QUALIFIED" error:error],s;
  s->_ready=YES;[s assertLocalCurrent:error];return s;
 }catch(const std::exception&e){[s fail:[NSString stringWithUTF8String:e.what()] error:error];return s;}}
 @catch(id){[s fail:@"IDE_CONTRACT_RELAY_ACQUIRE_UNKNOWN" error:error];return s;}
}
- (BOOL)assertLocalCurrent:(NSError**)error {
 if(!pthread_main_np()||!_ready||_retired||_busy||_closeSelected||_first)return [self fail:@"IDE_CONTRACT_RELAY_LOCAL_NOT_CURRENT" error:error];
 _busy=YES;
 @try{try{
  NSError *e=nil;NSDictionary *scope=[_source copyOriginalIDEContractRelayScopeLocal:&e];
  if(e||![scope isEqual:_scope])return [self recordActualError:e fallback:@"IDE_CONTRACT_RELAY_PROJECT_CURRENT_CHANGED" error:error];
  if(!_endpoint.current(5))return [self fail:@"IDE_CONTRACT_RELAY_PEER_CHANGED" error:error];
  NSDictionary *launch=[_source copyOriginalIDEContractRelayLaunchLocal:&e];
  if(e||![launch isEqual:_launch]||!ynx_auth_ide_relay_private::actualLaunch(launch,_scope,_localContext,_node.original)||!ynx_auth_ide_relay_private::namedDirectory(_localContext[@"workspace"],_workspaceIdentity,_workspaceDir.identity())||!ynx_auth_ide_relay_private::namedDirectory(_localContext[@"profile"],_profileIdentity,_profileDir.identity()))return [self recordActualError:e fallback:@"IDE_CONTRACT_RELAY_LOCAL_PROJECT_CURRENT_CHANGED" error:error];
  if(!ynx_auth_ide_private::sameKernel(_node,ynx_auth_ide_private::observeKernel(getpid()))||!ynx_auth_ide_private::sameKernel(_ide,ynx_auth_ide_private::observeKernel(getppid()))||!ynx_auth_ide_private::sameKernel(_wallet,ynx_auth_ide_private::observeKernel((pid_t)_wallet.original.pid))||!ynx_auth_ide_private::identityResourceBytes(_resources,_peerBinding,_resourceDebt))return [self fail:@"IDE_CONTRACT_RELAY_KERNEL_OR_RESOURCE_CHANGED" error:error];
  if(![_source assertOriginalIDEContractRelayRuntimeCurrent:&e])return [self recordActualError:e fallback:@"IDE_CONTRACT_RELAY_RUNTIME_CURRENT_CHANGED" error:error];
  NSDictionary *last=[_source copyOriginalIDEContractRelayScopeLocal:&e];
  if(e||![last isEqual:_scope]||_retired)return [self recordActualError:e fallback:@"IDE_CONTRACT_RELAY_POST_CURRENT_REFUSED" error:error];return YES;
 }catch(const std::exception&e){return [self fail:[NSString stringWithUTF8String:e.what()] error:error];}}
 @catch(id){return [self fail:@"IDE_CONTRACT_RELAY_LOCAL_UNKNOWN" error:error];}
 @finally{_busy=NO;}
}
- (NSDictionary*)copyScopeLocal:(NSError**)error {return [self assertLocalCurrent:error]?[_scope copy]:nil;}
- (BOOL)observeLocalRevocation:(dispatch_block_t)callback error:(NSError**)error {
 if(!callback||_observer||![self assertLocalCurrent:error])return [self fail:@"IDE_CONTRACT_RELAY_OBSERVER_REFUSED" error:error];_observer=[callback copy];return YES;
}
- (void)removeLocalRevocationObserver {_observer=nil;}
- (BOOL)pollLocalRevocation:(NSError**)error {
 if([self assertLocalCurrent:error])return YES;
 // The NAPI bridge drives this on its actual uv loop, not a GCD main queue
 // that a standalone Node/libuv process might never service.
 [self retire:nil];return NO;
}
- (BOOL)retire:(NSError**)error {
 if(!pthread_main_np())return [self fail:@"IDE_CONTRACT_RELAY_THREAD_REQUIRED" error:error];
 if(_retired){if(error)*error=_retireError;return _retireResult;}
 _retired=YES;_retireResult=YES;_ready=NO;[_source retire];
 if(!_notified){_notified=YES;dispatch_block_t callback=_observer;_observer=nil;_observerRunning=YES;@try{if(callback)callback();}@catch(id){_retireResult=NO;NSError *actual=nil;[self fail:@"IDE_CONTRACT_RELAY_OBSERVER_UNKNOWN" error:&actual];_retireError=actual;if(error)*error=_retireError;return NO;}@finally{_observerRunning=NO;}}
 return YES;
}
- (BOOL)cancelLocal:(NSError**)error {return [self retire:error];}
- (BOOL)revokeLocal:(NSError**)error {return [self retire:error];}
- (BOOL)join:(NSError**)error {
 if(!pthread_main_np()||!_retired||_busy||_observerRunning){if(error)*error=[NSError errorWithDomain:@"YNXOriginalContractRelay" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_CONTRACT_RELAY_JOIN_PENDING"}];return NO;}
 return !_source||[_source join:error];
}
- (BOOL)close:(NSError**)error {
 if(_closeSelected){if(error)*error=_closeFirst;return _closed;}
 if(![self join:error])return NO;
 _closeSelected=YES;NSError *actual=nil;
 BOOL complete=_resourceDebt.clean();
 for(auto*slot:{&_workspaceDir,&_profileDir})if(!slot->available()&&!slot->closeOnce([](int fd){return ::close(fd);}))complete=NO;
 // Independent resources drain even when another cleanup is UNKNOWN.
 if(_source&&![_source close:&actual])complete=NO;
 if(!complete){_closeFirst=actual?:[NSError errorWithDomain:@"YNXOriginalContractRelay" code:3 userInfo:@{NSLocalizedDescriptionKey:@"IDE_CONTRACT_RELAY_CLOSE_UNKNOWN"}];if(error)*error=_closeFirst;return NO;}
 _source=nil;_observer=nil;_closed=YES;[RelayOwners()removeObject:self];return YES;
}
@end
