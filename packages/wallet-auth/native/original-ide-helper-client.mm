#import "original-ide-helper-client.h"
#import "original-ide-helper-service-contract.h"
#include "original-ide-helper-build-release.h"
#include "original-ide-parent-kernel.h"
#import <Security/Security.h>
#include <CommonCrypto/CommonDigest.h>
#include <pthread.h>
#include <unistd.h>
using namespace ynx_auth_ide_private;
static NSError*ClientError(NSString*code){return [NSError errorWithDomain:@"YNXIDEHelperClient" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];}
static NSString*ClientSHA(NSData*raw){unsigned char b[32];CC_SHA256(raw.bytes,(CC_LONG)raw.length,b);NSMutableString*s=[NSMutableString string];for(auto v:b)[s appendFormat:@"%02x",v];return s;}
static NSDictionary*ClientCopyData(id raw){if(![raw isKindOfClass:NSDictionary.class]||![NSJSONSerialization isValidJSONObject:raw])return nil;NSData*b=[NSJSONSerialization dataWithJSONObject:raw options:0 error:nil];if(!b||b.length>1048576)return nil;return [NSJSONSerialization JSONObjectWithData:b options:0 error:nil];}
// This is actual transport custody used below, not an approving provider.
// Completion always adopts DATA before considering status or a late timeout.
@interface YNXHelperReplyCustody:NSObject
- (void)complete:(NSDictionary*)data error:(NSError*)error;
- (BOOL)waitUntil:(dispatch_time_t)deadline;
- (NSDictionary*)actual;
- (NSError*)first;
- (BOOL)pending;
@end
@implementation YNXHelperReplyCustody{dispatch_semaphore_t _wake;BOOL _pending;NSDictionary*_actual,*_late;id _rawPartial;NSError*_first;}
- (instancetype)init{if((self=[super init])){_wake=dispatch_semaphore_create(0);_pending=YES;}return self;}
- (void)complete:(NSDictionary*)data error:(NSError*)error{@synchronized(self){
 _rawPartial=data;NSDictionary*copy=data?ClientCopyData(data):nil;
 if(_pending){if(copy)_actual=copy;_pending=NO;if(!_first&&(error||(data&&!copy)))_first=error?:ClientError(@"AUTH_IDENTITY_HELPER_REPLY_DATA_INVALID");}
 else{if(copy){if(!_actual)_actual=copy;else _late=copy;}if(!_first)_first=ClientError(@"AUTH_IDENTITY_HELPER_DUPLICATE_REPLY_UNKNOWN");}
 dispatch_semaphore_signal(_wake);
}}
- (BOOL)waitUntil:(dispatch_time_t)deadline{if(dispatch_semaphore_wait(_wake,deadline)==0)return YES;@synchronized(self){if(!_pending)return YES;if(!_first)_first=ClientError(@"AUTH_IDENTITY_HELPER_REPLY_TIMEOUT_UNKNOWN");return NO;}}
- (NSDictionary*)actual{@synchronized(self){return _actual;}}
- (NSError*)first{@synchronized(self){return _first;}}
- (BOOL)pending{@synchronized(self){return _pending;}}
@end
static BOOL ClientDecimal(id value,uint64_t*out){if(![value isKindOfClass:NSString.class]||![value length]||[value length]>20||([value length]>1&&[value characterAtIndex:0]=='0'))return NO;uint64_t n=0;for(NSUInteger i=0;i<[value length];i++){unichar c=[value characterAtIndex:i];if(c<'0'||c>'9'||n>(UINT64_MAX-(c-'0'))/10)return NO;n=n*10+c-'0';}*out=n;return YES;}
static BOOL ClientCode(pid_t pid,const std::string&requirement,const std::string&team){
 if(pid<=1||requirement.empty()||team.empty())return NO;SecRequirementRef rule=nullptr;SecCodeRef code=nullptr;CFDictionaryRef info=nullptr;
 OSStatus rc=SecRequirementCreateWithString((__bridge CFStringRef)[NSString stringWithUTF8String:requirement.c_str()],kSecCSDefaultFlags,&rule);
 if(!rc)rc=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)@{(__bridge NSString*)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&code);
 if(!rc)rc=SecCodeCheckValidity(code,kSecCSStrictValidate,rule);if(!rc)rc=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&info);
 NSString*actual=info?((__bridge NSDictionary*)info)[(__bridge NSString*)kSecCodeInfoTeamIdentifier]:nil;BOOL ok=!rc&&[actual isEqual:[NSString stringWithUTF8String:team.c_str()]];
 if(info)CFRelease(info);if(code)CFRelease(code);if(rule)CFRelease(rule);return ok;
}
static BOOL ClientPreparePacket(NSDictionary*p,NSData*request){
 if(![p isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:p.allKeys]isEqual:[NSSet setWithArray:@[@"requestSHA256",@"kernelUID",@"sourceSequence",@"dataOnly",@"nativeAdmission"]]]||![p[@"requestSHA256"]isEqual:ClientSHA(request)])return NO;
 for(NSString*k in @[@"dataOnly",@"nativeAdmission"])if(![p[k]isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)p[k])!=CFBooleanGetTypeID())return NO;
 if(![p[@"dataOnly"]boolValue]||[p[@"nativeAdmission"]boolValue])return NO;
 for(NSString*k in @[@"kernelUID",@"sourceSequence"])if(![p[k]isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)p[k])==CFBooleanGetTypeID())return NO;
 uint64_t uid=0,seq=0;return ClientDecimal([p[@"kernelUID"]stringValue],&uid)&&uid==getuid()&&ClientDecimal([p[@"sourceSequence"]stringValue],&seq);
}
@implementation YNXIDEHelperClient{
 NSXPCConnection*_connection;const IDEHelperBuildRelease*_release;KernelProcess _node,_parent,_server;NSString*_helperPath;
 pthread_t _thread;NSData*_request,*_proof;NSDictionary*_preparedData,*_actualResult;NSMutableArray<YNXHelperReplyCustody*>*_attempts;
 uint64_t _issued,_expires,_deadline,_wallFloor,_monoFloor;BOOL _ready,_prepared,_prepareSelected,_sendSelected,_retired,_serverPinned,_invalidated,_closeSelected,_closed;
 NSError*_first,*_closeFirst;
}
- (instancetype)init{if((self=[super init])){_thread=pthread_self();_attempts=[NSMutableArray array];}return self;}
- (BOOL)fail:(NSError*)error code:(NSString*)code out:(NSError**)out{@synchronized(self){if(!_first)_first=error?:ClientError(code);if(out)*out=_first;return NO;}}
- (void)connectionTerminated{@synchronized(self){BOOL pending=NO;for(YNXHelperReplyCustody*a in _attempts)if(a.pending){pending=YES;[a complete:nil error:ClientError(@"AUTH_IDENTITY_HELPER_CONNECTION_UNKNOWN")];}if(!_retired||pending)[self fail:nil code:@"AUTH_IDENTITY_HELPER_CONNECTION_UNKNOWN" out:nil];}}
- (BOOL)localCurrent:(NSError**)error{
 @synchronized(self){
 if(!pthread_equal(_thread,pthread_self())||!_ready||!_release||_retired||_first||getuid()!=geteuid()||getgid()!=getegid())return [self fail:nil code:@"AUTH_IDENTITY_HELPER_CLIENT_NOT_CURRENT" out:error];
 try{if(!sameKernel(_node,observeKernel(getpid()))||!sameKernel(_parent,observeKernel(getppid()))||!ClientCode(getpid(),_release->nodeRequirement,_release->teamIdentifier)||!ClientCode(getppid(),_release->clientRequirement,_release->teamIdentifier))return [self fail:nil code:@"AUTH_IDENTITY_HELPER_CLIENT_IDENTITY_CHANGED" out:error];return YES;}catch(...){return [self fail:nil code:@"AUTH_IDENTITY_HELPER_CLIENT_KERNEL_UNAVAILABLE" out:error];}
 }}
+ (instancetype)acquireOriginalNodeClient:(NSError**)error{
 if(self!=YNXIDEHelperClient.class){if(error)*error=ClientError(@"AUTH_IDENTITY_ORIGINAL_HELPER_CLIENT_REQUIRED");return nil;}
 auto c=[self new];
 @try{try{
  if(!pthread_main_np()||!getuid()||getuid()!=geteuid()||getgid()!=getegid()){[c fail:nil code:@"AUTH_IDENTITY_NODE_CLIENT_CONTEXT_REQUIRED" out:error];return c;}
  // Refuse before creating an IPC connection when no actual build is admitted.
  if(originalIDEHelperBuildReleases().empty()){[c fail:nil code:@"AUTH_IDENTITY_HELPER_BUILD_NOT_ADMITTED" out:error];return c;}
  NSString*resources=actualNodeParentResources();NSString*entry=[[NSURL fileURLWithPath:[resources stringByAppendingPathComponent:@"server.mjs"]]absoluteString];if(!actualNodeEntry(resources,entry)){[c fail:nil code:@"IDE_NODE_RUNNING_ENTRY_INVALID" out:error];return c;}
  c->_node=observeKernel(getpid());c->_parent=observeKernel(getppid());c->_helperPath=[resources.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"Library/HelperTools/YNXIdentityReceiver"];
  for(const auto&r:originalIDEHelperBuildReleases())if(!r.nodeRequirement.empty()&&r.nodeRequirement!=r.clientRequirement&&ClientCode(getpid(),r.nodeRequirement,r.teamIdentifier)&&ClientCode(getppid(),r.clientRequirement,r.teamIdentifier)){
   if(c->_release){[c fail:nil code:@"AUTH_IDENTITY_HELPER_RELEASE_AMBIGUOUS" out:error];return c;}c->_release=&r;
  }
  if(!c->_release){[c fail:nil code:@"AUTH_IDENTITY_HELPER_BUILD_NOT_ADMITTED" out:error];return c;}
  if(@available(macOS 13.0,*)){
   c->_connection=[[NSXPCConnection alloc]initWithMachServiceName:YNXIDEIdentityHelperService options:NSXPCConnectionPrivileged];
   c->_connection.remoteObjectInterface=[NSXPCInterface interfaceWithProtocol:@protocol(YNXIDEIdentityReceiverService)];
   [c->_connection setCodeSigningRequirement:[NSString stringWithUTF8String:c->_release->helperRequirement.c_str()]];
   __weak YNXIDEHelperClient*weak=c;void(^ended)(void)=^{YNXIDEHelperClient*owner=weak;if(owner)[owner connectionTerminated];};
   c->_connection.interruptionHandler=ended;c->_connection.invalidationHandler=ended;c->_ready=YES;[c->_connection resume];[c localCurrent:error];return c;
  }
  [c fail:nil code:@"AUTH_IDENTITY_HELPER_REQUIRES_MACOS13" out:error];return c;
 }catch(...){[c fail:nil code:@"AUTH_IDENTITY_HELPER_CLIENT_KERNEL_UNAVAILABLE" out:error];return c;}}@catch(NSException*){[c fail:nil code:@"AUTH_IDENTITY_HELPER_CLIENT_EXCEPTION_UNKNOWN" out:error];return c;}
}
- (BOOL)clock:(NSError**)error{
 uint64_t wall=wallMS(),mono=monotonicMS();if(!_request||wall<_issued||wall>=_expires||wall<_wallFloor||mono<_monoFloor||!_deadline||mono>=_deadline)return [self fail:nil code:@"AUTH_IDENTITY_ORIGINAL_WINDOW_EXPIRED" out:error];_wallFloor=wall;_monoFloor=mono;return YES;
}
- (BOOL)serverCurrent:(NSError**)error{
 @synchronized(self){
 @try{try{if(!_connection||_connection.effectiveUserIdentifier!=0||_connection.processIdentifier<=1)return [self fail:nil code:@"AUTH_IDENTITY_ROOT_HELPER_IDENTITY_REQUIRED" out:error];
  auto server=observeKernel(_connection.processIdentifier);if(![server.image isEqual:_helperPath]||!ClientCode(_connection.processIdentifier,_release->helperRequirement,_release->teamIdentifier)||(_serverPinned&&!sameKernel(_server,server)))return [self fail:nil code:@"AUTH_IDENTITY_ROOT_HELPER_CHANGED" out:error];
  if(!_serverPinned){_server=server;_serverPinned=YES;}return YES;
 }catch(...){return [self fail:nil code:@"AUTH_IDENTITY_ROOT_HELPER_KERNEL_UNAVAILABLE" out:error];}}@catch(NSException*){return [self fail:nil code:@"AUTH_IDENTITY_ROOT_HELPER_KERNEL_UNAVAILABLE" out:error];}
 }}
- (BOOL)assertTransportCurrent:(NSError**)error{if(![self localCurrent:error]||![self clock:error]||(_prepared&&![self serverCurrent:error]))return NO;return [self localCurrent:error]&&[self clock:error];}
- (BOOL)captureRequest:(NSData*)request error:(NSError**)error{
 if(_request)return [_request isEqual:request]?[self clock:error]:[self fail:nil code:@"AUTH_IDENTITY_HELPER_REQUEST_CHANGED" out:error];
 if(![request isKindOfClass:NSData.class]||!request.length||request.length>16384)return [self fail:nil code:@"AUTH_IDENTITY_ORIGINAL_REQUEST_INVALID" out:error];
 NSDictionary*b=[NSJSONSerialization JSONObjectWithData:request options:0 error:nil];NSData*canonical=[b isKindOfClass:NSDictionary.class]?[NSJSONSerialization dataWithJSONObject:b options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil]:nil;
 if(![canonical isEqual:request]||b.count!=17||![b[@"version"]isEqual:@"YNX-AUTH-IDENTITY/v2"]||![b[@"algorithmVersion"]isEqual:@"YNX-BATCH/v0.1"]||![b[@"purpose"]isEqual:@"AUTH-IDENTITY-RECEIVE"]||!ClientDecimal(b[@"issuedAtMs"],&_issued)||!ClientDecimal(b[@"expiresAtMs"],&_expires)||_expires<=_issued||_expires-_issued>30000)return [self fail:nil code:@"AUTH_IDENTITY_ORIGINAL_REQUEST_INVALID" out:error];
 uint64_t wall=wallMS(),mono=monotonicMS();if(wall<_issued||wall>=_expires||mono>UINT64_MAX-(_expires-wall))return [self fail:nil code:@"AUTH_IDENTITY_ORIGINAL_WINDOW_EXPIRED" out:error];
 _request=[request copy];_wallFloor=wall;_monoFloor=mono;_deadline=mono+(_expires-wall);return YES;
}
- (dispatch_time_t)replyDeadline{uint64_t now=monotonicMS(),remaining=_deadline>now?_deadline-now:0;remaining=MIN(remaining,7000);return dispatch_time(DISPATCH_TIME_NOW,(int64_t)remaining*NSEC_PER_MSEC);}
- (NSDictionary*)prepareOriginalReceiveRequest:(NSData*)request error:(NSError**)error{
 if(![self localCurrent:error]||![self captureRequest:request error:error])return nil;
 if(_prepared)return [self assertTransportCurrent:error]?_preparedData:nil;
 if(_prepareSelected){[self fail:nil code:@"AUTH_IDENTITY_HELPER_PREPARE_ALREADY_SELECTED" out:error];return nil;}_prepareSelected=YES;
 YNXHelperReplyCustody*a=[YNXHelperReplyCustody new];@synchronized(self){[_attempts addObject:a];}
 @try{id<YNXIDEIdentityReceiverService>proxy=[_connection remoteObjectProxyWithErrorHandler:^(NSError*e){[a complete:nil error:e];}];[proxy prepareOriginalReceiveRequest:_request reply:^(NSDictionary*d,NSError*e){[a complete:d error:e];}];}
 @catch(NSException*){[a complete:nil error:ClientError(@"AUTH_IDENTITY_HELPER_SEND_UNKNOWN")];}
 [a waitUntil:[self replyDeadline]];_preparedData=a.actual; // adopt FIRST, even on error/timeout
 if(a.first||!_preparedData){[self fail:a.first code:@"AUTH_IDENTITY_HELPER_PREPARE_UNKNOWN" out:error];return _preparedData;}
 if(![self clock:error]||![self localCurrent:error]||![self serverCurrent:error]||!ClientPreparePacket(_preparedData,_request)){[self fail:nil code:@"AUTH_IDENTITY_HELPER_PREPARE_DATA_MISMATCH" out:error];return _preparedData;}
 _prepared=YES;return _preparedData;
}
- (NSDictionary*)receiveOriginalRequest:(NSData*)request proof:(NSData*)proof error:(NSError**)error{
 if(![self assertTransportCurrent:error]||!_prepared||![_request isEqual:request]){[self fail:nil code:@"AUTH_IDENTITY_HELPER_PREPARED_REQUEST_REQUIRED" out:error];return nil;}
 if(_sendSelected){[self fail:nil code:@"AUTH_IDENTITY_HELPER_RECEIVE_ALREADY_SELECTED" out:error];return _actualResult;}_sendSelected=YES;
 if(![proof isKindOfClass:NSData.class]||!proof.length||proof.length>262144){[self fail:nil code:@"AUTH_IDENTITY_ORIGINAL_PROOF_INVALID" out:error];return nil;}_proof=[proof copy];
 YNXHelperReplyCustody*a=[YNXHelperReplyCustody new];@synchronized(self){[_attempts addObject:a];}
 @try{id<YNXIDEIdentityReceiverService>proxy=[_connection remoteObjectProxyWithErrorHandler:^(NSError*e){[a complete:nil error:e];}];[proxy receiveOriginalRequest:_request proof:_proof reply:^(NSDictionary*d,NSError*e){[a complete:d error:e];}];}
 @catch(NSException*){[a complete:nil error:ClientError(@"AUTH_IDENTITY_HELPER_SEND_UNKNOWN")];}
 [a waitUntil:[self replyDeadline]];_actualResult=a.actual; // preserve actual public partial BEFORE status
 if(a.first||!_actualResult){[self fail:a.first code:@"AUTH_IDENTITY_HELPER_RECEIVE_UNKNOWN" out:error];return _actualResult;}
 if(![self assertTransportCurrent:error])return _actualResult;return _actualResult;
}
- (void)retire{@synchronized(self){_retired=YES;if(_connection&&!_invalidated){_invalidated=YES;[_connection invalidate];}}}
- (BOOL)join:(NSError**)error{@synchronized(self){if(!_retired){if(error)*error=ClientError(@"AUTH_IDENTITY_HELPER_CLIENT_NOT_RETIRED");return NO;}for(YNXHelperReplyCustody*a in _attempts)if(a.pending){if(error)*error=ClientError(@"AUTH_IDENTITY_HELPER_REPLY_PENDING");return NO;}return YES;}}
- (BOOL)close:(NSError**)error{@synchronized(self){if(_closeSelected){if(error)*error=_closeFirst;return _closed;}[self retire];if(![self join:error])return NO;_closeSelected=YES;_connection=nil;_closed=YES;return YES;}}
@end
