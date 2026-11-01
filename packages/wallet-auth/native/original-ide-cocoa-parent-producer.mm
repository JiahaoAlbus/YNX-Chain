#import "original-ide-cocoa-parent-producer.h"
#import "original-auth-identity-source-authority.h"
#include "original-auth-identity-native-release.h"
#include "original-ide-parent-observation.h"
#include "original-ide-parent-kernel.h"
#include "original-ide-parent-transport.h"
#include <memory>
#include <cstring>
using namespace ynx_auth_ide_private;
static NSError*ParentError(NSString*c){return [NSError errorWithDomain:@"YNXOriginalIDECocoaParent" code:1 userInfo:@{NSLocalizedDescriptionKey:c}];}
@interface YNXAuthIdentitySourceAuthority(IDECocoaChildFirstPrivate)
- (BOOL)closeOriginalIDECocoaParentChildFirst:(NSError**)error;
@end
@implementation YNXOriginalIDECocoaParentProducer {
 YNXAuthIdentitySourceAuthority*_source;SourceBinding _binding;Observation _observation;Lifetime _life;
 ResourceCloseDebt _resourceDebt;std::unique_ptr<PreludeTransport>_transport;
 NSURL*_resources;id _firstCause;NSError*_cleanupError;
 BOOL _selected,_ready,_retired,_busy,_adoptSelected,_handoff,_cleanupRequested,_cleanupSelected,_cleanupComplete,_endpointRetireSelected;
}
+ (BOOL)accessInstanceVariablesDirectly {return NO;}
- (void)dealloc {if(!_cleanupComplete)std::terminate();}
- (BOOL)fail:(NSError**)e code:(NSString*)code {
 _ready=NO;_retired=YES;_life.unknown(code.UTF8String);if(!_firstCause)_firstCause=(e&&*e)?*e:ParentError(code);if(e)*e=[_firstCause isKindOfClass:NSError.class]?_firstCause:ParentError(code);return NO;
}
+ (instancetype)acquireOriginalResources:(NSURL*)resources parent:(pid_t)parent error:(NSError**)error {
 YNXOriginalIDECocoaParentProducer*o=[self new];NSError*e=nil;
 @try{try{
  o->_selected=YES;
  if(!resources.isFileURL||parent<=1||parent!=getppid()) {[o fail:&e code:@"IDE_PARENT_ORIGINAL_CALLER_REQUIRED"];if(error)*error=e;return o;}
  char canonical[PATH_MAX];NSURL*actual=NSBundle.mainBundle.resourceURL;
  if(!actual.isFileURL||!realpath(actual.path.fileSystemRepresentation,canonical)||![actual.path isEqual:[NSString stringWithUTF8String:canonical]]||![resources.path isEqual:actual.path]){[o fail:&e code:@"IDE_PARENT_ACTUAL_BUNDLE_REQUIRED"];if(error)*error=e;return o;}o->_resources=[actual copy];
  // Normal Root0 refusal before OS/socket work. Table presence is NOT approval:
  // actual Source math and exact registered four-op binding are mandatory next.
  if(ynx_auth_private::originalNativeSourceReleases().empty()){[o fail:&e code:@"IDE_PARENT_SOURCE_RELEASE_NOT_SUPPLIED"];if(error)*error=e;return o;}
  o->_source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEParentSource:&e];
  if(e||!o->_source||!o->_binding.capture(o->_source,&e)){[o fail:&e code:@"IDE_PARENT_ORIGINAL_SOURCE_NOT_ADMITTED"];if(error)*error=e;return o;}
  if(!o->_observation.captureActualIDE(&e)||![o->_resources.path isEqual:o->_observation.actualResources()]){[o fail:&e code:@"IDE_PARENT_ORIGINAL_OS_CAPTURE_FAILED"];if(error)*error=e;return o;}
  NSDictionary*r=o->_binding.registration();
  if(![[o->_observation.walletCodeIdentity()base64EncodedStringWithOptions:0]isEqual:r[@"walletCodeIdentity"]]||![[o->_observation.ideCodeIdentity()base64EncodedStringWithOptions:0]isEqual:r[@"ideCodeIdentity"]]||!registeredResources(o->_observation.actualResources(),o->_binding,o->_resourceDebt)||!o->_binding.current(&e)){[o fail:&e code:@"IDE_PARENT_REGISTERED_RESOURCES_MISMATCH"];if(error)*error=e;return o;}
  uint64_t now=wallMS(),expires=[o->_binding.request()[@"expiresAtMs"]unsignedLongLongValue];
  if(expires<=now||!o->_life.begin([o->_binding.request()[@"requestNonce"]UTF8String],o->_observation.wallet(),o->_observation.ide(),now,expires,monotonicMS())){[o fail:&e code:@"IDE_PARENT_ORIGINAL_WINDOW_INVALID"];if(error)*error=e;return o;}
  o->_transport=std::make_unique<PreludeTransport>(o->_observation.ownedEndpoint(),(unsigned)std::min<uint64_t>(expires-now,15000));
  Prelude request=originalPrelude(PreludeKind::prepareIDE,o->_binding);request.wallet=o->_observation.wallet();request.ide=o->_observation.ide();
  o->_transport->write(request); // once; partial/timeout remains UNKNOWN
  Prelude pending=o->_transport->read();
  std::array<unsigned char,32>peer{},ide{};memcpy(peer.data(),&o->_observation.walletPeerAuditToken(),32);memcpy(ide.data(),&o->_observation.ideAuditToken(),32);
  if(pending.kind!=PreludeKind::pendingIDE||!originalPreludeBinding(pending,o->_binding)||pending.challenge!=request.challenge||!(pending.wallet==request.wallet)||!(pending.ide==request.ide)||pending.audit!=peer||pending.ideAudit!=ide||!verifyKernelAudit(pending.audit,request.wallet)||!o->_observation.assertOriginals(&e)||!o->_binding.current(&e)||!o->_life.current(o->_observation.wallet(),o->_observation.ide(),wallMS(),monotonicMS())){[o fail:&e code:@"IDE_PARENT_AUTHENTICATED_PENDING_MISMATCH"];if(error)*error=e;return o;}
  if(!o->_observation.takeInheritedEndpoint(&e)){[o fail:&e code:@"IDE_PARENT_ENDPOINT_CUSTODY_FAILED"];if(error)*error=e;return o;}
  o->_ready=YES;
  if(![o assertCurrentResources:resources node:[resources URLByAppendingPathComponent:@"runtime/node"] entry:[resources URLByAppendingPathComponent:@"server.mjs"] child:0 error:&e]){if(error)*error=e;return o;}
  return o;
 }catch(const std::exception&x){[o fail:&e code:[NSString stringWithUTF8String:x.what()]];}}@catch(id x){if(!o->_firstCause)o->_firstCause=x;[o fail:&e code:@"IDE_PARENT_ACQUIRE_EXCEPTION"];}
 if(error)*error=e;return o;
}
- (BOOL)assertCurrentResources:(NSURL*)resources node:(NSURL*)node entry:(NSURL*)entry child:(pid_t)child error:(NSError**)error {
 @synchronized(self){BOOL entered=NO;@try{try{
  if(_busy||!_ready||_retired||_cleanupSelected||child<0||!_transport||![resources isEqual:_resources]||![node isEqual:[_resources URLByAppendingPathComponent:@"runtime/node"]]||![entry isEqual:[_resources URLByAppendingPathComponent:@"server.mjs"]]||_observation.wallet().pid!=(uint64_t)getppid())return [self fail:error code:@"IDE_PARENT_CURRENT_CONSTRAINT_MISMATCH"];
  _busy=YES;entered=YES;
  if(!_binding.current(error)||!_observation.assertOriginals(error)||!_life.current(_observation.wallet(),_observation.ide(),wallMS(),monotonicMS())||!registeredResources(_observation.actualResources(),_binding,_resourceDebt))return [self fail:error code:@"IDE_PARENT_CURRENT_ORIGINALS_FAILED"];
  if(child>0){
   if(!_adoptSelected){_adoptSelected=YES;
    if(!_observation.captureActualSpawnedNode(child,error)||!_life.beginAdopt(_life.intent(),_observation.node()))return [self fail:error code:@"IDE_PARENT_ACTUAL_CHILD_MISMATCH"];
    auto actual=observeKernel(child);if(![[actual.codeIdentity base64EncodedStringWithOptions:0]isEqual:_binding.registration()[@"nodeCodeIdentity"]])return [self fail:error code:@"IDE_PARENT_REGISTERED_CHILD_CODE_MISMATCH"];
    Prelude adopt=originalPrelude(PreludeKind::adoptNode,_binding);adopt.wallet=_observation.wallet();adopt.ide=_observation.ide();adopt.node=_observation.node();
    _transport->write(adopt);_transport->handoff();_handoff=YES;
    if(!_life.completeAdopt(_life.intent(),_observation.node(),_observation.wallet(),_observation.ide(),wallMS(),monotonicMS()))return [self fail:error code:@"IDE_PARENT_ADOPT_LATE_CURRENT"];
   }else if(_observation.node().pid!=(uint64_t)child||!_handoff)return [self fail:error code:@"IDE_PARENT_CHILD_SUBSTITUTION"];
   if(!_observation.assertActualSpawnedNode(error)||!_life.nodeCurrent(_observation.node()))return [self fail:error code:@"IDE_PARENT_CHILD_CURRENT_FAILED"];
  }else if(_adoptSelected)return [self fail:error code:@"IDE_PARENT_ADOPTED_CHILD_REQUIRED"];
  if(!_binding.current(error)||!_observation.assertOriginals(error)||!_life.current(_observation.wallet(),_observation.ide(),wallMS(),monotonicMS()))return [self fail:error code:@"IDE_PARENT_POST_CURRENT_FAILED"];
  if(!_ready||_retired||_cleanupRequested)return [self fail:error code:@"IDE_PARENT_LATE_RETIREMENT"];
  return YES;
 }catch(const std::exception&x){return [self fail:error code:[NSString stringWithUTF8String:x.what()]];}}@catch(id x){if(!_firstCause)_firstCause=x;return [self fail:error code:@"IDE_PARENT_CURRENT_EXCEPTION"];}@finally{if(entered)_busy=NO;}}
}
- (BOOL)qualified {@synchronized(self){return _ready&&!_retired&&!_cleanupSelected;}}
- (int)descriptor {@synchronized(self){if(![self assertCurrentResources:_resources node:[_resources URLByAppendingPathComponent:@"runtime/node"] entry:[_resources URLByAppendingPathComponent:@"server.mjs"] child:_adoptSelected?(pid_t)_observation.node().pid:0 error:nil])return -1;return _observation.ownedEndpoint();}}
- (pid_t)parentPID {@synchronized(self){return (pid_t)_observation.wallet().pid;}}
- (NSURL*)approvedWorkspaceURL {return nil;/* Four login operations NEVER grant project/workspace. */}
- (id)firstCause {@synchronized(self){return _firstCause?:_cleanupError;}}
- (NSError*)cleanupError {@synchronized(self){return _cleanupError;}}
- (BOOL)cleanupSelected {@synchronized(self){return _cleanupRequested;}}
- (BOOL)cleanupComplete {@synchronized(self){return _cleanupComplete;}}
- (BOOL)finishCleanup:(NSError**)error {
 @synchronized(self){@try{try{_retired=YES;_ready=NO;_cleanupRequested=YES;_life.retire();if(_busy){if(!_cleanupError)_cleanupError=ParentError(@"IDE_PARENT_CURRENT_READ_PENDING");if(error)*error=_cleanupError;return NO;}if(_cleanupSelected){if(!_cleanupComplete&&error)*error=_cleanupError;return _cleanupComplete;}_cleanupSelected=YES;
  // Same-channel only. Do not kill the owned backend or an unrelated process.
  NSError*e=nil;if(_transport&&!_endpointRetireSelected){_endpointRetireSelected=YES;if(!_observation.retireEndpoint(&e)){_cleanupError=e?:ParentError(@"IDE_PARENT_ENDPOINT_RETIRE_UNKNOWN");if(error)*error=_cleanupError;return NO;}}
  if(!_resourceDebt.clean()){_cleanupError=ParentError(@"IDE_PARENT_REGISTERED_RESOURCE_CLOSE_DEBT");if(error)*error=_cleanupError;return NO;}
  if(!_observation.closeOnce(&e)){_cleanupError=e?:ParentError(@"IDE_PARENT_OBSERVATION_CLOSE_UNKNOWN");if(error)*error=_cleanupError;return NO;}
  @try{[_source retire];if(_source&&(![_source join:&e]||e||![_source closeOriginalIDECocoaParentChildFirst:&e]||e)){_cleanupError=e?:ParentError(@"IDE_PARENT_SOURCE_CLOSE_UNKNOWN");if(error)*error=_cleanupError;return NO;}}@catch(id x){if(!_firstCause)_firstCause=x;_cleanupError=ParentError(@"IDE_PARENT_SOURCE_CLEANUP_EXCEPTION");if(error)*error=_cleanupError;return NO;}
  _source=nil;_cleanupComplete=YES;return YES;
 }catch(...){if(!_cleanupError)_cleanupError=ParentError(@"IDE_PARENT_CLEANUP_CPP_EXCEPTION");if(error)*error=_cleanupError;return NO;}}@catch(id x){if(!_firstCause)_firstCause=x;if(!_cleanupError)_cleanupError=ParentError(@"IDE_PARENT_CLEANUP_EXCEPTION");if(error)*error=_cleanupError;return NO;}}
}
- (void)close {NSError*e=nil;if(![self finishCleanup:&e])@throw e?:ParentError(@"IDE_PARENT_CLEANUP_INCOMPLETE");}
@end
