#import "WPRPublicationPeerPrivate.h"
#include "original-ide-parent-kernel.h"
#import <Security/Security.h>
#include <unistd.h>
#include <thread>
using namespace ynx::wallet::product::publication;
using ynx_auth_ide_private::KernelProcess;
using ynx_auth_ide_private::observeKernel;
using ynx_auth_ide_private::sameKernel;
namespace {
NSMapTable*peerInventory(){static NSMapTable*table;static dispatch_once_t once;dispatch_once(&once,^{table=[NSMapTable strongToStrongObjectsMapTable];});return table;}
bool code(pid_t pid,const std::string&requirement,const std::string&team){
 if(pid<=1||requirement.empty()||team.empty())return false;
 SecRequirementRef rule=nullptr;SecCodeRef guest=nullptr;CFDictionaryRef info=nullptr;
 OSStatus rc=SecRequirementCreateWithString((__bridge CFStringRef)[NSString stringWithUTF8String:requirement.c_str()],kSecCSDefaultFlags,&rule);
 if(!rc)rc=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)@{(__bridge NSString*)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&guest);
 if(!rc)rc=SecCodeCheckValidity(guest,kSecCSStrictValidate,rule);
 if(!rc)rc=SecCodeCopySigningInformation(guest,kSecCSSigningInformation,&info);
 NSString*actual=info?((__bridge NSDictionary*)info)[(__bridge NSString*)kSecCodeInfoTeamIdentifier]:nil;
 bool okay=!rc&&[actual isEqual:[NSString stringWithUTF8String:team.c_str()]];
 if(info)CFRelease(info);if(guest)CFRelease(guest);if(rule)CFRelease(rule);return okay;
}
uint64_t wall(){return uint64_t(NSDate.date.timeIntervalSince1970*1000.0);}
}
@implementation YNXWPRPublicationPeer{
 NSXPCConnection*_connection;const InstallationRelease*_row;InstallationRelease _sameRow;KernelProcess _node,_app,_helper;
 uid_t _uid;gid_t _gid;au_asid_t _session;std::thread::id _worker;BOOL _retired;NSError*_first;
}
+ (BOOL)isOriginalPeer:(id)p{@synchronized(peerInventory()){return p&&[p class]==YNXWPRPublicationPeer.class&&[peerInventory() objectForKey:p]==p;}}
- (BOOL)fail:(NSString*)cause error:(NSError**)error{if(!_first)_first=[NSError errorWithDomain:@"YNXWPRPublicationPeer" code:1 userInfo:@{NSLocalizedDescriptionKey:cause}];_retired=YES;if(error)*error=_first;return NO;}
+ (instancetype)acceptOriginalConnection:(NSXPCConnection*)connection error:(NSError**)error{
 YNXWPRPublicationPeer*owner=[YNXWPRPublicationPeer new];owner->_worker=std::this_thread::get_id();@synchronized(peerInventory()){if(peerInventory().count>=64){[owner fail:@"WPR_PEER_CUSTODY_CAPACITY" error:error];return owner;}[peerInventory()setObject:owner forKey:owner];}
 // No WPR registration means no process/connection/file observation at all.
 if(original_installation_releases().empty()){[owner fail:@"WPR_INSTALL_RELEASE_NOT_SUPPLIED" error:error];return owner;}
 if(!connection||NSXPCConnection.currentConnection||geteuid()!=0){[owner fail:@"WPR_ORIGINAL_PRIVILEGED_LISTENER_REQUIRED" error:error];return owner;}
 @try{try{owner->_connection=connection;owner->_uid=connection.effectiveUserIdentifier;owner->_gid=connection.effectiveGroupIdentifier;owner->_session=connection.auditSessionIdentifier;
 if(!owner->_uid||connection.processIdentifier<=1){[owner fail:@"WPR_ORDINARY_KERNEL_PEER_REQUIRED" error:error];return owner;}
 owner->_node=observeKernel(connection.processIdentifier);owner->_app=observeKernel((pid_t)owner->_node.original.parent);owner->_helper=observeKernel(getpid());
 if(owner->_node.original.uid!=owner->_uid||owner->_node.original.gid!=owner->_gid||owner->_app.original.uid!=owner->_uid){[owner fail:@"WPR_KERNEL_PEER_MISMATCH" error:error];return owner;}
 NSString*appPath=owner->_app.image.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent;NSBundle*bundle=[NSBundle bundleWithPath:appPath];
 for(const auto&r:original_installation_releases())if(valid_installation_release(r)&&r.product.uid==owner->_uid&&wall()>=r.issued_ms&&wall()<r.expires_ms&&[bundle.bundleIdentifier isEqual:[NSString stringWithUTF8String:r.product.application_id.c_str()]]&&[bundle.executableURL.path isEqual:owner->_app.image]&&[owner->_node.image isEqual:[bundle.resourceURL.path stringByAppendingPathComponent:@"runtime/node"]]&&code(getpid(),r.helper_requirement,r.team_identifier)&&code((pid_t)owner->_node.original.pid,r.node_requirement,r.team_identifier)&&code((pid_t)owner->_app.original.pid,r.client_requirement,r.team_identifier)){
 if(owner->_row){[owner fail:@"WPR_INSTALL_RELEASE_AMBIGUOUS" error:error];return owner;}owner->_row=&r;}
 if(!owner->_row){[owner fail:@"WPR_KERNEL_RELEASE_REQUIRED" error:error];return owner;}owner->_sameRow=*owner->_row;
 if(@available(macOS 13.0,*)){[connection setCodeSigningRequirement:[NSString stringWithUTF8String:owner->_row->node_requirement.c_str()]];}else{[owner fail:@"WPR_MACOS13_REQUIRED" error:error];return owner;}
 if(!sameKernel(owner->_node,observeKernel(connection.processIdentifier))||!sameKernel(owner->_app,observeKernel((pid_t)owner->_node.original.parent))||!sameKernel(owner->_helper,observeKernel(getpid()))){[owner fail:@"WPR_KERNEL_ACCEPT_CHANGED" error:error];return owner;}return owner;
 }catch(...){[owner fail:@"WPR_KERNEL_ACCEPT_UNKNOWN" error:error];return owner;}}@catch(NSException*){[owner fail:@"WPR_ACCEPT_EXCEPTION_UNKNOWN" error:error];return owner;}
}
- (BOOL)assertCurrentMessage:(NSError**)error{@synchronized(self){
 if(![YNXWPRPublicationPeer isOriginalPeer:self]||_retired||_first||!_connection||!registered(_row)){if(error)*error=_first;return NO;}
 if(NSXPCConnection.currentConnection!=_connection||geteuid()!=0||!same_installation_release(*_row,_sameRow))return[self fail:@"WPR_EXACT_CURRENT_MESSAGE_REQUIRED" error:error];
 @try{try{if(!valid_installation_release(*_row)||wall()<_row->issued_ms||wall()>=_row->expires_ms||_connection.processIdentifier!=(pid_t)_node.original.pid||_connection.effectiveUserIdentifier!=_uid||_connection.effectiveGroupIdentifier!=_gid||_connection.auditSessionIdentifier!=_session||_row->product.uid!=_uid||!sameKernel(_node,observeKernel(_connection.processIdentifier))||!sameKernel(_app,observeKernel((pid_t)_node.original.parent))||!sameKernel(_helper,observeKernel(getpid()))||!code((pid_t)_node.original.pid,_row->node_requirement,_row->team_identifier)||!code((pid_t)_app.original.pid,_row->client_requirement,_row->team_identifier)||!code(getpid(),_row->helper_requirement,_row->team_identifier))return[self fail:@"WPR_CURRENT_MESSAGE_CHANGED" error:error];return YES;
 }catch(...){return[self fail:@"WPR_CURRENT_MESSAGE_UNKNOWN" error:error];}}@catch(NSException*){return[self fail:@"WPR_MESSAGE_EXCEPTION_UNKNOWN" error:error];}
}}
- (const InstallationRelease*)originalRegisteredRelease:(NSError**)error{if(![self assertCurrentMessage:error])return nullptr;return _row;}
- (BOOL)assertOriginalCustodyMessage:(NSError**)error{@synchronized(self){
 // SAME original connection/process only for retire/join/close observation.
 // Does not grant live Source use, renew a window or erase the first cause.
 if(![YNXWPRPublicationPeer isOriginalPeer:self]||!_connection||!registered(_row)||NSXPCConnection.currentConnection!=_connection||geteuid()!=0||!same_installation_release(*_row,_sameRow)){if(error)*error=_first;return NO;}
 @try{try{if(!valid_installation_release(*_row)||_connection.processIdentifier!=(pid_t)_node.original.pid||_connection.effectiveUserIdentifier!=_uid||_connection.effectiveGroupIdentifier!=_gid||_connection.auditSessionIdentifier!=_session||!sameKernel(_node,observeKernel(_connection.processIdentifier))||!sameKernel(_app,observeKernel((pid_t)_node.original.parent))||!sameKernel(_helper,observeKernel(getpid()))||!code((pid_t)_node.original.pid,_row->node_requirement,_row->team_identifier)||!code((pid_t)_app.original.pid,_row->client_requirement,_row->team_identifier)||!code(getpid(),_row->helper_requirement,_row->team_identifier)){if(error)*error=_first;return NO;}return YES;}catch(...){if(error)*error=_first;return NO;}}@catch(NSException*){if(error)*error=_first;return NO;}
}}
- (void)retire{@synchronized(self){_retired=YES;_connection=nil;}}
- (void)close{@synchronized(self){[self retire];@synchronized(peerInventory()){[peerInventory()removeObjectForKey:self];}}}
@end
