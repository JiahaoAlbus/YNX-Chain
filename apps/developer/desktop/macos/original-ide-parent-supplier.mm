#import "original-ide-parent-supplier.h"
#import "original-ide-parent-observation.h"
#import "original-ide-parent-kernel.h"
#include "original-ide-parent-transport.h"
#include <memory>
using namespace ynx_auth_ide_private;
static NSError *ParentFailure(NSString *code){return [NSError errorWithDomain:@"YNXOriginalIDEParent" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];}
@interface YNXOriginalIDEParentGuard : NSObject <YNXWalletAdmissionParentGuard>
- (BOOL)capture:(NSURL *)resources parent:(pid_t)parent error:(NSError **)error;
- (BOOL)adopt:(pid_t)child error:(NSError **)error;
- (BOOL)finish:(NSError **)error;
- (void)retire;
- (id)originalFirstCause;
@end
static NSMutableSet<YNXOriginalIDEParentGuard*> *RecognizedGuards(){static NSMutableSet *set;static dispatch_once_t once;dispatch_once(&once,^{set=[NSMutableSet set];});return set;}
@implementation YNXOriginalIDEParentGuard {
 Observation _observation;SourceBinding _binding;Lifetime _lifetime;
 ResourceCloseDebt _resourceDebt;
 YNXAuthIdentitySourceAuthority *_source;std::unique_ptr<PreludeTransport> _prelude;
 BOOL _accepted,_adopted,_retired,_retireSelected,_closeSelected,_closeComplete,_peerAdmitted;
 NSError *_first,*_cleanup;id _originalCause;
}
- (BOOL)failure:(NSError **)error code:(NSString *)code {
 if(!_first)_first=(error&&*error)?*error:ParentFailure(code);_retired=YES;_lifetime.unknown(code.UTF8String);if(error)*error=_first;return NO;
}
- (BOOL)capture:(NSURL *)resources parent:(pid_t)parent error:(NSError **)error {
 @synchronized(self){@try{try{
  if(parent!=getppid()||!resources.isFileURL||!_observation.captureActualIDE(error)||![resources.path isEqual:_observation.actualResources()])return [self failure:error code:@"IDE_NORMAL_PARENT_RESOURCES_MISMATCH"];
  _source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEParentSource:error];
  if(!_source||!_binding.capture(_source,error))return [self failure:error code:@"IDE_ORIGINAL_SOURCE_NOT_ADMITTED"];
  NSDictionary *registration=_binding.registration();
  if(![[_observation.walletCodeIdentity() base64EncodedStringWithOptions:0] isEqual:registration[@"walletCodeIdentity"]]||
     ![[_observation.ideCodeIdentity() base64EncodedStringWithOptions:0] isEqual:registration[@"ideCodeIdentity"]]||!registeredResources(_observation.actualResources(),_binding,_resourceDebt))return [self failure:error code:@"IDE_REGISTERED_CODE_OR_RESOURCE_MISMATCH"];
  uint64_t now=wallMS(),expires=[_binding.request()[@"expiresAtMs"] unsignedLongLongValue];if(expires<=now)return [self failure:error code:@"IDE_ORIGINAL_INTENT_EXPIRED"];
  _prelude=std::make_unique<PreludeTransport>(_observation.ownedEndpoint(),(unsigned)std::min<uint64_t>(expires-now,15000));
  Prelude request=originalPrelude(PreludeKind::prepareIDE,_binding);request.wallet=_observation.wallet();request.ide=_observation.ide();_prelude->write(request);
  Prelude reply=_prelude->read();audit_token_t peer=_observation.walletPeerAuditToken();
  if(reply.kind!=PreludeKind::pendingIDE||!originalPreludeBinding(reply,_binding)||reply.challenge!=request.challenge||!(reply.wallet==request.wallet)||!(reply.ide==request.ide)||std::memcmp(reply.audit.data(),&peer,32)||reply.ideAudit!=request.audit)return [self failure:error code:@"IDE_ORIGINAL_JOINT_PENDING_BINDING_MISMATCH"];
  _peerAdmitted=YES;
  if(!_observation.takeInheritedEndpoint(error))return [self failure:error code:@"IDE_ORIGINAL_INHERITED_ENDPOINT_TRANSFER_FAILED"];
  if(!_binding.current(error)||!_observation.assertOriginals(error)||!_lifetime.begin([_binding.request()[@"requestNonce"] UTF8String],_observation.wallet(),_observation.ide(),wallMS(),expires,monotonicMS()))return [self failure:error code:@"IDE_ORIGINAL_PENDING_POST_FENCE_FAILED"];
  _accepted=YES;@synchronized(RecognizedGuards()){[RecognizedGuards() addObject:self];}return YES;
 }catch(const std::exception&e){return [self failure:error code:[NSString stringWithUTF8String:e.what()]];}}@catch(id exception){if(!_originalCause)_originalCause=exception;return [self failure:error code:@"IDE_ORIGINAL_PARENT_ACQUIRE_EXCEPTION"];} }
}
- (int)descriptor {@synchronized(self){return _accepted&&!_retired?_observation.ownedEndpoint():-1;}}
- (pid_t)parentPID {return (pid_t)_observation.wallet().pid;}
- (NSURL *)approvedWorkspaceURL {return nil;}
- (id)originalFirstCause {return _originalCause?:_first;}
- (BOOL)assertCurrentResources:(NSURL *)resources node:(NSURL *)node entry:(NSURL *)entry child:(pid_t)child error:(NSError **)error {
 @synchronized(self){@try{try{
  NSString *root=_observation.actualResources();
  if(!_accepted||_retired||_closeSelected||![resources.path isEqual:root]||![node.path isEqual:[root stringByAppendingPathComponent:@"runtime/node"]]||![entry.path isEqual:[root stringByAppendingPathComponent:@"server.mjs"]]||child<0||(_adopted?(child!=(pid_t)_lifetime.node().pid):(child!=0)))return [self failure:error code:@"IDE_ORIGINAL_PARENT_CURRENT_BINDING_MISMATCH"];
  if(!_binding.current(error)||!_observation.assertOriginals(error)||!_lifetime.current(_observation.wallet(),_observation.ide(),wallMS(),monotonicMS())||(_adopted&&(!_observation.assertActualSpawnedNode(error)||!_lifetime.nodeCurrent(_observation.node()))))return [self failure:error code:@"IDE_ORIGINAL_PARENT_CURRENT_FAILED"];
  if(!_binding.current(error)||!_observation.assertOriginals(error)||!_lifetime.current(_observation.wallet(),_observation.ide(),wallMS(),monotonicMS()))return [self failure:error code:@"IDE_ORIGINAL_PARENT_POST_CURRENT_FAILED"];return YES;
 }catch(const std::exception&e){return [self failure:error code:[NSString stringWithUTF8String:e.what()]];}}@catch(id exception){return [self failure:error code:@"IDE_ORIGINAL_PARENT_CURRENT_EXCEPTION"];} }
}
- (BOOL)adopt:(pid_t)child error:(NSError **)error {
 @synchronized(self){@try{try{
  NSURL *root=[NSURL fileURLWithPath:_observation.actualResources() isDirectory:YES];
  if(![self assertCurrentResources:root node:[root URLByAppendingPathComponent:@"runtime/node"] entry:[root URLByAppendingPathComponent:@"server.mjs"] child:0 error:error]||_adopted||child<=1||!_observation.captureActualSpawnedNode(child,error))return [self failure:error code:@"IDE_ORIGINAL_CHILD_ADOPT_MISMATCH"];
  auto observed=observeKernel(child);if(![[observed.codeIdentity base64EncodedStringWithOptions:0] isEqual:_binding.registration()[@"nodeCodeIdentity"]]||!_lifetime.beginAdopt(_lifetime.intent(),observed.original))return [self failure:error code:@"IDE_ORIGINAL_CHILD_REGISTRATION_MISMATCH"];
  Prelude adoption=originalPrelude(PreludeKind::adoptNode,_binding);adoption.wallet=_observation.wallet();adoption.ide=_observation.ide();adoption.node=observed.original;
  // No response read after spawn: the real Node is now the ONLY prefix reader.
  _prelude->write(adoption);_prelude->handoff();
  if(!_binding.current(error)||!_observation.assertActualSpawnedNode(error)||!_lifetime.completeAdopt(_lifetime.intent(),_observation.node(),_observation.wallet(),_observation.ide(),wallMS(),monotonicMS()))return [self failure:error code:@"IDE_ORIGINAL_ADOPT_POST_FENCE_FAILED"];
  _adopted=YES;return YES;
 }catch(const std::exception&e){return [self failure:error code:[NSString stringWithUTF8String:e.what()]];}}@catch(id exception){return [self failure:error code:@"IDE_ORIGINAL_ADOPT_EXCEPTION"];} }
}
- (void)retire {
 @synchronized(self){
  _retired=YES;_lifetime.retire();if(_retireSelected)return;_retireSelected=YES;
  @try{if(_peerAdmitted){NSError *failure=nil;if(!_observation.retireEndpoint(&failure)&&!_cleanup)_cleanup=failure;}}
  @catch(id exception){if(!_first&&!_originalCause)_originalCause=exception;if(!_cleanup)_cleanup=ParentFailure(@"IDE_ORIGINAL_RETIRE_UNKNOWN");}
  _peerAdmitted=NO; // Selected once, even when endpoint retirement is UNKNOWN.
  // Independent original custody must still be fenced if endpoint retirement
  // throws. Preserve its first error; do not retry either resource operation.
  @try{[_source retire];}
  @catch(id exception){if(!_first&&!_originalCause)_originalCause=exception;if(!_cleanup)_cleanup=ParentFailure(@"IDE_ORIGINAL_RETIRE_UNKNOWN");}
 }
}
- (BOOL)finish:(NSError **)error {
 @synchronized(self){if(_closeSelected){if(!_closeComplete&&error)*error=_cleanup;return _closeComplete;}[self retire];_closeSelected=YES;
  NSError *observationFailure=nil,*joinFailure=nil,*closeFailure=nil;BOOL observed=_observation.closeOnce(&observationFailure),sourceJoined=YES,sourceClosed=YES;
  @try{if(_source)sourceJoined=[_source join:&joinFailure];}@catch(id exception){sourceJoined=NO;if(!_first&&!_originalCause)_originalCause=exception;joinFailure=ParentFailure(@"IDE_SOURCE_JOIN_EXCEPTION");}
  @try{if(_source)sourceClosed=[_source close:&closeFailure];}@catch(id exception){sourceClosed=NO;if(!_first&&!_originalCause)_originalCause=exception;closeFailure=ParentFailure(@"IDE_SOURCE_CLOSE_EXCEPTION");}
  if(!_cleanup)_cleanup=observationFailure?:joinFailure?:closeFailure;
  _closeComplete=observed&&sourceJoined&&sourceClosed&&!_cleanup&&_resourceDebt.clean();
  if(_closeComplete){_source=nil;@synchronized(RecognizedGuards()){[RecognizedGuards() removeObject:self];}}
  else if(!_cleanup)_cleanup=ParentFailure(@"IDE_ORIGINAL_PARENT_CLEANUP_UNKNOWN");if(!_closeComplete&&error)*error=_cleanup;return _closeComplete;
 }
}
- (void)close {NSError *e=nil;if(![self finish:&e])@throw e;}
@end
@interface YNXIDEAdmissionAcquireOutcome ()
- (instancetype)initWithGuard:(YNXOriginalIDEParentGuard *)guard cause:(id)cause cleanup:(NSError *)cleanup debt:(YNXOriginalIDEParentGuard *)debt;
- (BOOL)finishCleanup:(NSError **)error;
@end
@implementation YNXIDEAdmissionAcquireOutcome {
 YNXOriginalIDEParentGuard *_originalGuard,*_debt;id _first;NSError *_cleanup;
}
- (instancetype)initWithGuard:(YNXOriginalIDEParentGuard *)guard cause:(id)cause cleanup:(NSError *)cleanup debt:(YNXOriginalIDEParentGuard *)debt {if((self=[super init])){_originalGuard=guard;_first=cause;_cleanup=cleanup;_debt=debt;}return self;}
- (YNXIDEAdmissionAcquireKind)kind {return _originalGuard?YNXIDEAdmissionQualified:(_debt?YNXIDEAdmissionCleanupIncomplete:YNXIDEAdmissionCleanRefusal);}
- (id<YNXWalletAdmissionParentGuard>)guard {return _originalGuard;}
- (id)firstCause {return _first;}
- (NSError *)cleanupError {return _cleanup;}
- (BOOL)finishCleanup:(NSError **)error {return !_debt||[_debt finish:error];}
@end
YNXIDEAdmissionAcquireOutcome *YNXOriginalAcquireIDEAdmissionParent(NSURL *resources,pid_t parent,NSError **error){
 static BOOL acquireSelected=NO;@synchronized(RecognizedGuards()){if(acquireSelected){NSError *cause=ParentFailure(@"IDE_ORIGINAL_PARENT_ACQUISITION_ALREADY_SELECTED");if(error)*error=cause;return [[YNXIDEAdmissionAcquireOutcome alloc]initWithGuard:nil cause:cause cleanup:nil debt:nil];}acquireSelected=YES;}
 YNXOriginalIDEParentGuard *owner=[YNXOriginalIDEParentGuard new];NSError *cause=nil;
 if([owner capture:resources parent:parent error:&cause])return [[YNXIDEAdmissionAcquireOutcome alloc]initWithGuard:owner cause:nil cleanup:nil debt:nil];
 NSError *cleanup=nil;BOOL finished=[owner finish:&cleanup];if(error)*error=cause?:cleanup;
 return [[YNXIDEAdmissionAcquireOutcome alloc]initWithGuard:nil cause:[owner originalFirstCause]?:cause cleanup:cleanup debt:finished?nil:owner];
}
BOOL YNXFinishIDEAdmissionAcquireCleanup(YNXIDEAdmissionAcquireOutcome *outcome,NSError **error){return !outcome||[outcome finishCleanup:error];}
BOOL YNXOriginalAdoptIDEAdmissionChild(id<YNXWalletAdmissionParentGuard> guard,pid_t actualChild,NSError **error){
 @synchronized(RecognizedGuards()){if(![RecognizedGuards() containsObject:guard]){if(error)*error=ParentFailure(@"IDE_ORIGINAL_RECOGNIZED_GUARD_REQUIRED");return NO;}}
 return [(YNXOriginalIDEParentGuard*)guard adopt:actualChild error:error];
}
void YNXOriginalRetireIDEAdmissionParent(id<YNXWalletAdmissionParentGuard> guard){BOOL recognized=NO;@synchronized(RecognizedGuards()){recognized=[RecognizedGuards() containsObject:guard];}if(recognized)[(YNXOriginalIDEParentGuard*)guard retire];}

