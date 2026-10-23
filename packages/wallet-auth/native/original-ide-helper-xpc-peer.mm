#import "original-ide-helper-xpc-peer.h"
#include "original-ide-helper-build-release.h"
#include "original-ide-parent-kernel.h"
#include "original-ide-public-originals.h"
#import <Security/Security.h>
#include <unistd.h>
using namespace ynx_auth_ide_private;
static NSError*PeerFailure(NSString*code){return [NSError errorWithDomain:@"YNXIDEHelperMessagePeer" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];}
// Actual live process validation, not a file URL or a claimed PID from IPC.
// The OS additionally enforces nodeRequirement on EVERY incoming message.
static bool PeerCode(pid_t pid,const std::string&requirement,const std::string&team){
 if(pid<=1||requirement.empty()||team.empty())return false;
 SecRequirementRef rule=nullptr;SecCodeRef code=nullptr;CFDictionaryRef info=nullptr;
 OSStatus rc=SecRequirementCreateWithString((__bridge CFStringRef)[NSString stringWithUTF8String:requirement.c_str()],kSecCSDefaultFlags,&rule);
 if(!rc)rc=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)@{(__bridge NSString*)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&code);
 if(!rc)rc=SecCodeCheckValidity(code,kSecCSStrictValidate,rule);
 if(!rc)rc=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&info);
 NSString*actual=info?((__bridge NSDictionary*)info)[(__bridge NSString*)kSecCodeInfoTeamIdentifier]:nil;
 bool ok=!rc&&[actual isEqual:[NSString stringWithUTF8String:team.c_str()]];
 if(info)CFRelease(info);if(code)CFRelease(code);if(rule)CFRelease(rule);return ok;
}
static bool PeerRelease(const IDEHelperBuildRelease&r){
 return !r.nodeRequirement.empty()&&r.nodeRequirement!=r.clientRequirement&&
  !r.helperRequirement.empty()&&!r.teamIdentifier.empty();
}
@implementation YNXIDEHelperMessagePeer{
 NSXPCConnection*_connection;const IDEHelperBuildRelease*_release;
 KernelProcess _node,_parent,_helper;uid_t _uid;gid_t _gid;au_asid_t _session;
 BOOL _retired;NSError*_first;
}
- (BOOL)fail:(NSString*)code error:(NSError**)error{if(!_first)_first=PeerFailure(code);_retired=YES;if(error)*error=_first;return NO;}
+ (BOOL)assertOriginalHelperExecutable:(NSError**)error{
 if(geteuid()!=0){if(error)*error=PeerFailure(@"IDE_HELPER_SYSTEM_ROOT_REQUIRED");return NO;}
 try{
  const IDEHelperBuildRelease*selected=nullptr;
  for(const auto&r:originalIDEHelperBuildReleases())if(PeerRelease(r)&&PeerCode(getpid(),r.helperRequirement,r.teamIdentifier)){
   if(selected){if(error)*error=PeerFailure(@"IDE_HELPER_RELEASE_AMBIGUOUS");return NO;}selected=&r;
  }
  if(!selected){if(error)*error=PeerFailure(@"IDE_HELPER_BUILD_NOT_ADMITTED");return NO;}
  auto before=observeKernel(getpid());
  if(!PeerCode(getpid(),selected->helperRequirement,selected->teamIdentifier)||!sameKernel(before,observeKernel(getpid()))){if(error)*error=PeerFailure(@"IDE_HELPER_EXECUTABLE_CHANGED");return NO;}
  return YES;
 }catch(...){if(error)*error=PeerFailure(@"IDE_HELPER_KERNEL_OBSERVATION_FAILED");return NO;}
}
+ (instancetype)acceptOriginalNodeConnection:(NSXPCConnection*)connection error:(NSError**)error{
 YNXIDEHelperMessagePeer*owner=[self new];
 // Called by the actual NSXPC listener delegate BEFORE activate/resume.
 // Never register/install/elevate a helper as part of peer acquisition.
 if(!connection||NSXPCConnection.currentConnection||geteuid()!=0){[owner fail:@"IDE_HELPER_LISTENER_ROOT_CONNECTION_REQUIRED" error:error];return nil;}
 if(@available(macOS 13.0,*)){
  try{
   owner->_connection=connection;owner->_uid=connection.effectiveUserIdentifier;owner->_gid=connection.effectiveGroupIdentifier;owner->_session=connection.auditSessionIdentifier;
   if(!owner->_uid||connection.processIdentifier<=1){[owner fail:@"IDE_HELPER_ORDINARY_USER_REQUIRED" error:error];return nil;}
   owner->_node=observeKernel(connection.processIdentifier);owner->_parent=observeKernel((pid_t)owner->_node.original.parent);owner->_helper=observeKernel(getpid());
   if(owner->_node.original.uid!=owner->_uid||owner->_node.original.gid!=owner->_gid||owner->_parent.original.uid!=owner->_uid){[owner fail:@"IDE_HELPER_OS_PEER_MISMATCH" error:error];return nil;}
   NSString*app=owner->_parent.image.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent;
   NSBundle*b=[NSBundle bundleWithPath:app];
   if(!b.resourceURL.isFileURL||![b.bundleIdentifier isEqual:@"com.ynxweb4.developer.testnetpreview"]||![b.executableURL.path isEqual:owner->_parent.image]||![owner->_node.image isEqual:[b.resourceURL.path stringByAppendingPathComponent:@"runtime/node"]]){[owner fail:@"IDE_HELPER_ACTUAL_NODE_PARENT_REQUIRED" error:error];return nil;}
   for(const auto&r:originalIDEHelperBuildReleases())if(PeerRelease(r)&&PeerCode(getpid(),r.helperRequirement,r.teamIdentifier)&&PeerCode((pid_t)owner->_node.original.pid,r.nodeRequirement,r.teamIdentifier)&&PeerCode((pid_t)owner->_parent.original.pid,r.clientRequirement,r.teamIdentifier)){
    if(owner->_release){[owner fail:@"IDE_HELPER_RELEASE_AMBIGUOUS" error:error];return nil;}owner->_release=&r;
   }
   if(!owner->_release){[owner fail:@"IDE_HELPER_NODE_RELEASE_NOT_ADMITTED" error:error];return nil;}
   // Public Foundation API: requirement is bound to the connection before
   // activation. PID/start-time checks alone cannot authorize a message.
   [connection setCodeSigningRequirement:[NSString stringWithUTF8String:owner->_release->nodeRequirement.c_str()]];
   if(!sameKernel(owner->_node,observeKernel(connection.processIdentifier))||!sameKernel(owner->_parent,observeKernel((pid_t)owner->_node.original.parent))||!sameKernel(owner->_helper,observeKernel(getpid()))){[owner fail:@"IDE_HELPER_PEER_CHANGED_DURING_ACCEPT" error:error];return nil;}
   return owner;
  }catch(...){[owner fail:@"IDE_HELPER_KERNEL_OBSERVATION_FAILED" error:error];return nil;}
 }
 [owner fail:@"IDE_HELPER_REQUIRES_MACOS13" error:error];return nil;
}
- (BOOL)assertCurrentMessage:(NSError**)error{
 @synchronized(self){
  if(_retired||_first||!_connection||!_release){if(error)*error=_first?:PeerFailure(@"IDE_HELPER_PEER_NOT_LIVE");return NO;}
  // A retained peer may not escape onto an arbitrary queue/callback and then
  // approve a registry operation outside its exact OS message dispatch.
  if(NSXPCConnection.currentConnection!=_connection||geteuid()!=0)return [self fail:@"IDE_HELPER_EXACT_CURRENT_MESSAGE_REQUIRED" error:error];
  try{
   if(_connection.processIdentifier!=(pid_t)_node.original.pid||_connection.effectiveUserIdentifier!=_uid||_connection.effectiveGroupIdentifier!=_gid||_connection.auditSessionIdentifier!=_session||
    !sameKernel(_node,observeKernel(_connection.processIdentifier))||!sameKernel(_parent,observeKernel((pid_t)_node.original.parent))||!sameKernel(_helper,observeKernel(getpid()))||
    !PeerCode((pid_t)_node.original.pid,_release->nodeRequirement,_release->teamIdentifier)||!PeerCode((pid_t)_parent.original.pid,_release->clientRequirement,_release->teamIdentifier)||!PeerCode(getpid(),_release->helperRequirement,_release->teamIdentifier))return [self fail:@"IDE_HELPER_MESSAGE_IDENTITY_CHANGED" error:error];
   return YES;
  }catch(...){return [self fail:@"IDE_HELPER_KERNEL_OBSERVATION_FAILED" error:error];}
 }
}
- (NSString*)copyOriginalUserRegistryBase:(NSError**)error{
 @synchronized(self){if(![self assertCurrentMessage:error])return nil;
  NSString*base=[NSString stringWithUTF8String:originalIDERegistryBase(_uid).c_str()];
  if(![self assertCurrentMessage:error])return nil;return base;
 }
}
- (NSNumber*)copyOriginalUserIdentifier:(NSError**)error{
 @synchronized(self){if(![self assertCurrentMessage:error])return nil;
  NSNumber*uid=@((uint64_t)_uid);if(![self assertCurrentMessage:error])return nil;return uid;
 }
}
- (void)retire{@synchronized(self){_retired=YES;_connection=nil;}}
@end
