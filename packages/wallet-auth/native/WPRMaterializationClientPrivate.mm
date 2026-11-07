#import "WPRMaterializationClientPrivate.h"
#include "original-ide-parent-kernel.h"
#import <Security/Security.h>
#include <thread>
#include <chrono>
using namespace ynx::wallet::product::publication;
using ynx_auth_ide_private::KernelProcess;using ynx_auth_ide_private::observeKernel;using ynx_auth_ide_private::sameKernel;
namespace {
NSError*clientError(NSString*s){return[NSError errorWithDomain:@"WPRNativeMaterializationClient" code:1 userInfo:@{NSLocalizedDescriptionKey:s}];}
uint64_t monotonicMS(){return uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());}
NSMapTable*clients(){static NSMapTable*t;static dispatch_once_t once;dispatch_once(&once,^{t=[NSMapTable strongToStrongObjectsMapTable];});return t;}
bool code(pid_t pid,const std::string&req,const std::string&team){SecRequirementRef rule=nullptr;SecCodeRef guest=nullptr;CFDictionaryRef info=nullptr;OSStatus rc=SecRequirementCreateWithString((__bridge CFStringRef)[NSString stringWithUTF8String:req.c_str()],kSecCSDefaultFlags,&rule);if(!rc)rc=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)@{(__bridge NSString*)kSecGuestAttributePid:@(pid)},0,&guest);if(!rc)rc=SecCodeCheckValidity(guest,kSecCSStrictValidate,rule);if(!rc)rc=SecCodeCopySigningInformation(guest,kSecCSSigningInformation,&info);NSString*actual=info?((__bridge NSDictionary*)info)[(__bridge NSString*)kSecCodeInfoTeamIdentifier]:nil;bool yes=!rc&&[actual isEqual:[NSString stringWithUTF8String:team.c_str()]];if(info)CFRelease(info);if(guest)CFRelease(guest);if(rule)CFRelease(rule);return yes;}
}
// Callback storage remains owned after timeout. Only the original Native
// worker adopts it; a late callback cannot mutate the custody inventory.
@interface YNXWPRPendingReplyPrivate:NSObject
@property(nonatomic,strong)NSDictionary*body;
@property(nonatomic,strong)NSError*cause;
@property(nonatomic)BOOL completed;
@property(nonatomic,strong)dispatch_semaphore_t signal;
- (void)complete:(NSDictionary*)body cause:(NSError*)cause;
@end
@implementation YNXWPRPendingReplyPrivate
- (instancetype)init{if((self=[super init]))_signal=dispatch_semaphore_create(0);return self;}
- (void)complete:(NSDictionary*)body cause:(NSError*)cause{@synchronized(self){if(_completed)return;_body=[body copy];_cause=cause;_completed=YES;}dispatch_semaphore_signal(_signal);}
@end
@implementation YNXWPRMaterializationClientPrivate{
 const InstallationRelease*_row;InstallationRelease _same;KernelProcess _node,_app,_helper;
 std::thread::id _worker;NSXPCConnection*_connection;NSString*_lease;NSDictionary*_captured,*_independent;
 NSError*_first;BOOL _retired,_closed,_remoteDone,_pending,_openSelected;uint64_t _expiresMono;
 YNXWPRPendingReplyPrivate*_pendingReply;
}
- (BOOL)fail:(NSError*)e{if(!_first)_first=e?:clientError(@"WPR_NATIVE_MATERIALIZATION_UNAVAILABLE");return NO;}
- (BOOL)helperCurrent:(NSError**)error {
 try{pid_t pid=_connection.processIdentifier;if(pid<=1)throw std::runtime_error("WPR_HELPER_PID_REQUIRED");auto actual=observeKernel(pid);
 if(actual.original.uid!=0||!code(pid,_row->helper_requirement,_row->team_identifier)||(_helper.original.pid&&!sameKernel(_helper,actual)))throw std::runtime_error("WPR_HELPER_CHANGED");_helper=actual;return YES;
 }catch(...){[self fail:clientError(@"WPR_NATIVE_HELPER_CURRENT_REQUIRED")];if(error)*error=_first;return NO;}
}
- (BOOL)localCurrent:(NSError**)error {
 if(_worker!=std::this_thread::get_id()||_retired||_closed||_remoteDone||_first||!registered(_row)||!same_installation_release(*_row,_same)){if(error)*error=_first?:clientError(@"WPR_ORIGINAL_NATIVE_CLIENT_REQUIRED");return NO;}
 if(!_expiresMono||monotonicMS()>=_expiresMono){[self fail:clientError(@"WPR_NATIVE_CLIENT_WINDOW_EXPIRED")];if(error)*error=_first;return NO;}
 try{if(!sameKernel(_node,observeKernel(getpid()))||!sameKernel(_app,observeKernel((pid_t)_node.original.parent))||_node.original.uid!=getuid()||getuid()!=_row->product.uid||!code(getpid(),_row->node_requirement,_row->team_identifier)||!code((pid_t)_app.original.pid,_row->client_requirement,_row->team_identifier)){[self fail:clientError(@"WPR_NATIVE_NODEHOST_CHANGED")];if(error)*error=_first;return NO;}return YES;}catch(...){[self fail:clientError(@"WPR_NATIVE_NODEHOST_OBSERVATION_UNKNOWN")];if(error)*error=_first;return NO;}
}
- (NSDictionary*)invoke:(SEL)selector allowRetired:(BOOL)cleanup error:(NSError**)error {
 if(_worker!=std::this_thread::get_id()||_pending||(!_connection)||(!cleanup&&![self localCurrent:error]))return nil;
 _pending=YES;YNXWPRPendingReplyPrivate*pending=[YNXWPRPendingReplyPrivate new];_pendingReply=pending;
 id<YNXWPRMaterializationRPCPrivateV1>proxy=[_connection remoteObjectProxyWithErrorHandler:^(NSError*e){[pending complete:nil cause:e];}];
 void(^reply)(NSDictionary*,NSError*)=^(NSDictionary*body,NSError*e){[pending complete:body cause:e];};
 if(selector==@selector(openOriginalMaterializationWithReply:))[proxy openOriginalMaterializationWithReply:reply];
 else if(selector==@selector(readCapturedPublicOriginals:reply:))[proxy readCapturedPublicOriginals:_lease reply:reply];
 else if(selector==@selector(readIndependentMaterializationOriginal:reply:))[proxy readIndependentMaterializationOriginal:_lease reply:reply];
 else if(selector==@selector(assertOriginalMaterializationCurrent:reply:))[proxy assertOriginalMaterializationCurrent:_lease reply:reply];
 else if(selector==@selector(recheckOriginalMaterialization:reply:))[proxy recheckOriginalMaterialization:_lease reply:reply];
 else if(selector==@selector(retireOriginalMaterialization:reply:))[proxy retireOriginalMaterialization:_lease reply:reply];
 else if(selector==@selector(joinOriginalMaterialization:reply:))[proxy joinOriginalMaterialization:_lease reply:reply];
 else if(selector==@selector(closeOriginalMaterialization:reply:))[proxy closeOriginalMaterialization:_lease reply:reply];
 else{_pending=NO;_pendingReply=nil;[self fail:clientError(@"WPR_FINITE_RPC_METHOD_REQUIRED")];if(error)*error=_first;return nil;}
 if(dispatch_semaphore_wait(pending.signal,dispatch_time(DISPATCH_TIME_NOW,7*NSEC_PER_SEC))){[self fail:clientError(@"WPR_ORIGINAL_RPC_UNKNOWN")];if(error)*error=_first;return nil;} // retain SAME pending reply for explicit drain
 NSDictionary*actual=[self adoptPending:error];
 if(!cleanup&&![self helperCurrent:error])return actual;
 if(!cleanup&&![self localCurrent:error])return actual;if(error)*error=_first;return actual;
}
- (NSDictionary*)adoptPending:(NSError**)error {
 if(!_pendingReply)return nil;NSDictionary*actual=nil;NSError*cause=nil;
 @synchronized(_pendingReply){if(!_pendingReply.completed){if(error)*error=_first;return nil;}actual=_pendingReply.body;cause=_pendingReply.cause;}
 _pendingReply=nil;_pending=NO;
 // Adopt actual partials first. These are DATA, never a copied Native brand.
 if([actual[@"lease"]isKindOfClass:NSString.class]){if(_lease&&![_lease isEqual:actual[@"lease"]])[self fail:clientError(@"WPR_FOREIGN_RPC_LEASE")];else _lease=[actual[@"lease"]copy];}
 if([actual[@"originals"]isKindOfClass:NSDictionary.class]){if(_captured&&![_captured isEqual:actual[@"originals"]])[self fail:clientError(@"WPR_CAPTURED_PUBLIC_ORIGINALS_CHANGED")];else _captured=[actual[@"originals"]copy];}
 BOOL typed=[actual[@"version"]isEqual:@"YNX-WPR-MATERIALIZATION-RPC/v1"]&&[actual[@"dataOnly"]isEqual:@YES]&&[actual[@"RootAdmission"]isEqual:@NO]&&[actual[@"SourceAdmission"]isEqual:@NO]&&[actual[@"NativeAdmission"]isEqual:@NO];
 if(typed&&[actual[@"physicalDone"]isEqual:@YES])_remoteDone=YES;
 // An error-handler callback without a typed envelope cannot prove that the
 // remote open did not happen. Such a debt remains UNKNOWN and is not reopened.
 if(typed&&!_lease)_openSelected=NO;
 if(cause)[self fail:cause];else if(!typed)[self fail:clientError(@"WPR_TYPED_RPC_REPLY_REQUIRED")];
 else if([actual[@"firstCausePresent"]isEqual:@YES]||[actual[@"errorPresent"]isEqual:@YES])[self fail:[actual[@"firstCause"]isKindOfClass:NSError.class]?actual[@"firstCause"]:clientError(@"WPR_ORIGINAL_RPC_REJECTED")];
 if(error)*error=_first;return actual;
}
+ (instancetype)acquireOriginal:(NSError**)error {
 auto owner=[YNXWPRMaterializationClientPrivate new];owner->_worker=std::this_thread::get_id();@synchronized(clients()){if(clients().count>=32){[owner fail:clientError(@"WPR_NATIVE_CLIENT_CUSTODY_CAPACITY")];if(error)*error=owner->_first;return owner;}[clients()setObject:owner forKey:owner];}
 if(original_installation_releases().empty()){[owner fail:clientError(@"WPR_REVIEWED_PUBLIC_ORIGINAL_LOAN_NOT_SUPPLIED")];if(error)*error=owner->_first;return owner;}
 try{owner->_node=observeKernel(getpid());owner->_app=observeKernel((pid_t)owner->_node.original.parent);
 for(const auto&r:original_installation_releases())if(valid_installation_release(r)&&r.product.uid==getuid()&&!r.materialization_service_name.empty()&&digest(r.independent_materialization_sha256)&&r.independent_materialization_bytes>0&&r.independent_materialization_bytes<=2097152&&code(getpid(),r.node_requirement,r.team_identifier)&&code((pid_t)owner->_app.original.pid,r.client_requirement,r.team_identifier)){if(owner->_row){[owner fail:clientError(@"WPR_NATIVE_CLIENT_RELEASE_AMBIGUOUS")];if(error)*error=owner->_first;return owner;}owner->_row=&r;}
 if(!owner->_row){[owner fail:clientError(@"WPR_NATIVE_NODEHOST_NOT_REGISTERED")];if(error)*error=owner->_first;return owner;}owner->_same=*owner->_row;
 owner->_connection=[[NSXPCConnection alloc]initWithMachServiceName:[NSString stringWithUTF8String:owner->_row->materialization_service_name.c_str()]options:NSXPCConnectionPrivileged];owner->_connection.remoteObjectInterface=YNXWPRMaterializationRPCInterfaceV1();
 if(@available(macOS 13.0,*)){[owner->_connection setCodeSigningRequirement:[NSString stringWithUTF8String:owner->_row->helper_requirement.c_str()]];}else{[owner fail:clientError(@"WPR_MACOS13_REQUIRED")];if(error)*error=owner->_first;return owner;}
 owner->_expiresMono=monotonicMS()+30000;[owner->_connection activate];owner->_openSelected=YES;[owner invoke:@selector(openOriginalMaterializationWithReply:)allowRetired:NO error:error];return owner;
 }catch(...){[owner fail:clientError(@"WPR_NATIVE_CLIENT_CAPTURE_UNKNOWN")];if(error)*error=owner->_first;return owner;}
}
- (NSDictionary*)readCapturedPublicOriginals:(NSError**)error{if(![self assertCurrent:error])return nil;return[_captured copy];}
- (NSDictionary*)readIndependentMaterializationOriginals:(NSError**)error {
 if(![self assertCurrent:error])return nil;NSDictionary*actual=[self invoke:@selector(readIndependentMaterializationOriginal:reply:)allowRetired:NO error:error];if(actual)_independent=[actual copy];return actual;
}
- (BOOL)assertCurrent:(NSError**)error{NSDictionary*reply=[self invoke:@selector(assertOriginalMaterializationCurrent:reply:)allowRetired:NO error:error];return reply&&!_first&&!_closed;}
- (BOOL)recheck:(NSError**)error{NSDictionary*reply=[self invoke:@selector(recheckOriginalMaterialization:reply:)allowRetired:NO error:error];return reply&&!_first&&!_closed;}
- (void)retire{if(_worker!=std::this_thread::get_id())return;_retired=YES;if(_connection&&_lease&&!_pending)[self invoke:@selector(retireOriginalMaterialization:reply:)allowRetired:YES error:nil];}
- (BOOL)join:(NSError**)error{if(_worker!=std::this_thread::get_id())return NO;if(_pending)[self adoptPending:error];if(_pending){if(error)*error=_first?:clientError(@"WPR_NATIVE_RPC_PENDING");return NO;}if(_remoteDone||!_connection||!_lease)return !_openSelected||_remoteDone;NSDictionary*reply=[self invoke:@selector(joinOriginalMaterialization:reply:)allowRetired:YES error:error];return reply&&_remoteDone;}
- (BOOL)close:(NSError**)error {
 if(_worker!=std::this_thread::get_id())return NO;if(_closed){if(error)*error=_first;return YES;}if(_pending)[self adoptPending:error];[self retire];if(_pending){if(error)*error=_first;return NO;}
 if(!_remoteDone&&_connection&&_lease)[self invoke:@selector(closeOriginalMaterialization:reply:)allowRetired:YES error:error];
 if(_pending||(!_remoteDone&&_openSelected)){if(error)*error=_first;return NO;}[_connection invalidate];_connection=nil;_closed=YES;@synchronized(clients()){[clients()removeObjectForKey:self];}if(error)*error=_first;return YES;
}
- (BOOL)isClosed{return _closed&&!_pending;}
- (BOOL)errorPresent{return _first!=nil;}
- (NSError*)firstCause{return _first;}
@end
