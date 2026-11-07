#import "WPRMaterializationRPCPrivate.h"
#import "WPRMaterializationSourcePrivate.h"
#include <thread>
#include <mutex>
#include <condition_variable>
#include <deque>
#include <chrono>
namespace {
NSError*failure(NSString*s){return[NSError errorWithDomain:@"YNXWPRMaterializationRPC" code:1 userInfo:@{NSLocalizedDescriptionKey:s}];}
bool leaseString(NSString*s){if(![s isKindOfClass:NSString.class]||!s.length||s.length>20||[s hasPrefix:@"0"])return false;uint64_t value=0;for(NSUInteger n=0;n<s.length;n++){auto c=[s characterAtIndex:n];if(c<'0'||c>'9'||value>(UINT64_MAX-(c-'0'))/10)return false;value=value*10+(c-'0');}return value!=0;}
enum class Command{Captured,Independent,Current,Recheck,Retire,Join,Close};
struct Pending{Command command;void(^reply)(NSDictionary*,NSError*);};
struct ActorState{std::mutex lock;std::condition_variable wake;std::deque<Pending>pending;bool accepting=true;};
}
@interface YNXWPRMaterializationActorPrivate:NSObject
@property(nonatomic,strong)YNXAuthIdentitySourceAuthority*source;
@property(nonatomic,strong)YNXWPRPublicationPeer*peer;
@property(nonatomic,copy)NSString*lease;
@property(nonatomic,strong)NSError*first;
@property(nonatomic,strong)NSDictionary*captured;
@property(nonatomic,strong)NSData*currentOriginal;
@property(nonatomic,strong)NSData*registrationOriginal;
@property(nonatomic,strong)NSData*expectedInputOriginal;
@property(nonatomic,strong)NSDictionary*buildOriginals;
@property(nonatomic,strong)NSData*independentOriginal;
@property(nonatomic)BOOL retired;
@property(atomic)BOOL physicalDone;
- (void)enqueue:(Command)command reply:(void(^)(NSDictionary*,NSError*))reply;
- (void)serveOriginalOpenReply:(void(^)(NSDictionary*,NSError*))reply;
- (NSDictionary*)envelope:(BOOL)error;
@end
@implementation YNXWPRMaterializationActorPrivate{
 ActorState _actor;std::thread::id _worker;uint64_t _deadlineMono;
}
- (void)remember:(NSError*)e{if(!_first&&e)_first=e;}
- (NSDictionary*)envelope:(BOOL)error {
 return@{@"version":@"YNX-WPR-MATERIALIZATION-RPC/v1",@"lease":_lease?:NSNull.null,@"originals":_captured?:NSNull.null,@"currentOriginal":_currentOriginal?:NSNull.null,@"registrationCaptureOriginal":_registrationOriginal?:NSNull.null,@"expectedInputOriginal":_expectedInputOriginal?:NSNull.null,@"independentOriginal":_independentOriginal?:NSNull.null,@"buildOriginals":_buildOriginals?:NSNull.null,@"errorPresent":@(error),@"firstCausePresent":@(_first!=nil),@"firstCause":_first?:NSNull.null,@"retired":@(_retired),@"physicalDone":@(self.physicalDone),@"dataOnly":@YES,@"RootAdmission":@NO,@"SourceAdmission":@NO,@"NativeAdmission":@NO};
}
- (BOOL)capture {
 if(_retired||self.physicalDone||_first)return NO;NSError*cause=nil;
 if(![_peer assertCurrentMessage:&cause]){[self remember:cause?:failure(@"WPR_RPC_ORIGINAL_MESSAGE_REQUIRED")];return NO;}
 NSDictionary*snapshot=[_source copyOriginalWPRPublicationOriginals:&cause];
 if(snapshot){NSDictionary*copy=@{@"root":[[NSString alloc]initWithData:snapshot[@"rootOriginal"]encoding:NSUTF8StringEncoding]?:@"",@"enrollment":[[NSString alloc]initWithData:snapshot[@"enrollmentOriginal"]encoding:NSUTF8StringEncoding]?:@"",@"profile":[[NSString alloc]initWithData:snapshot[@"profileOriginal"]encoding:NSUTF8StringEncoding]?:@"",@"acquisitionHead":[[NSString alloc]initWithData:snapshot[@"acquisitionHeadOriginal"]encoding:NSUTF8StringEncoding]?:@""};
 if(_captured&&![_captured isEqual:copy]){[self remember:failure(@"WPR_RPC_CAPTURED_ORIGINALS_CHANGED")];return NO;}_captured=[copy copy];_currentOriginal=[snapshot[@"currentOriginal"]copy];
 if(!_deadlineMono){auto now=uint64_t(NSDate.date.timeIntervalSince1970*1000.0),expires=[snapshot[@"expiresAtMs"]unsignedLongLongValue];if(expires<=now||expires-now>30000){[self remember:failure(@"WPR_RPC_ORIGINAL_WINDOW_REQUIRED")];return NO;}_deadlineMono=uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count())+(expires-now);}}
 if(cause||!snapshot){[self remember:cause?:failure(@"WPR_RPC_SOURCE_CURRENT_REQUIRED")];return NO;}
 const auto mono=uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());if(!_deadlineMono||mono>=_deadlineMono){[self remember:failure(@"WPR_RPC_ORIGINAL_WINDOW_EXPIRED")];return NO;}
 return YES;
}
- (BOOL)drain {
 _retired=YES;[_source retire];NSError*cause=nil;if(_source&&![_source join:&cause]){[self remember:cause];return NO;}cause=nil;
 BOOL done=!_source||[_source closeOriginalWPRPublicationSource:&cause];[self remember:cause];self.physicalDone=!_source||[_source originalWPRPublicationPhysicallyClosed];return done&&self.physicalDone;
}
- (void)enqueue:(Command)command reply:(void(^)(NSDictionary*,NSError*))reply {
 bool rejected=false;{std::lock_guard<std::mutex>guard(_actor.lock);if(!_actor.accepting||_actor.pending.size()>=16)rejected=true;else{_actor.pending.push_back({command,[reply copy]});_actor.wake.notify_one();}}
 // External completion must never run while the same owner's queue is locked.
 if(rejected)reply(nil,failure(@"WPR_RPC_SAME_OWNER_NOT_ACCEPTING"));
}
- (void)serveOriginalOpenReply:(void(^)(NSDictionary*,NSError*))reply {
 _worker=std::this_thread::get_id();NSError*cause=nil;_source=[YNXAuthIdentitySourceAuthority acquireOriginalWPRPublicationForPeer:_peer error:&cause];[self remember:cause];
 if(!_source&&!_first)[self remember:failure(@"WPR_RPC_SOURCE_OWNER_REQUIRED")];BOOL okay=[self capture];reply([self envelope:!okay],_first);
 // SAME genuine original NSXPC open message stays on its original worker.
 // Later commands may enqueue ONLY after their actual message peer check.
 // No NSXPC TLS identity is copied into a boolean or migrated to another thread.
 while(!self.physicalDone){
  Pending next{};bool selected=false;{
   std::unique_lock<std::mutex>guard(_actor.lock);
   if(_actor.pending.empty())_actor.wake.wait_for(guard,std::chrono::milliseconds(100));
   if(!_actor.pending.empty()){next=std::move(_actor.pending.front());_actor.pending.pop_front();selected=true;}
  }
  const auto now=uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());
  if(_deadlineMono&&now>=_deadlineMono)[self remember:failure(@"WPR_RPC_ORIGINAL_WINDOW_EXPIRED")];
  if(_first){_retired=YES;[self drain];}
  if(!selected)continue;BOOL success=YES;NSError*error=nil;
  switch(next.command){
   case Command::Captured:case Command::Current:case Command::Recheck:success=[self capture];break;
   case Command::Independent:{success=[self capture];if(success){NSData*actual=[_source copyIndependentWPRMaterializationOriginal:&error];if(actual)_independentOriginal=[actual copy];[self remember:error];if(!actual&&!error)[self remember:failure(@"WPR_INDEPENDENT_MATERIALIZATION_ORIGINAL_NOT_SUPPLIED")];if(!_first){error=nil;NSDictionary*bundle=[_source copyOriginalWPRMaterializationCaptureBundle:&error];if(bundle[@"registrationCaptureOriginal"])_registrationOriginal=[bundle[@"registrationCaptureOriginal"]copy];if(bundle[@"expectedInputOriginal"])_expectedInputOriginal=[bundle[@"expectedInputOriginal"]copy];if(bundle[@"currentOriginal"])_currentOriginal=[bundle[@"currentOriginal"]copy];[self remember:error];if(!bundle||!_registrationOriginal||!_expectedInputOriginal||!_currentOriginal)[self remember:failure(@"WPR_NATIVE_REGISTRATION_CAPTURE_NOT_SUPPLIED")];}if(!_first){error=nil;NSDictionary*files=[_source copyOriginalWPRMaterializationBuildOriginals:&error];if(files)_buildOriginals=[files copy];[self remember:error];if(files.count!=6)[self remember:failure(@"WPR_BUILD_ORIGINALS_NOT_SUPPLIED")];}success=!_first;}break;}
   case Command::Retire:_retired=YES;[_source retire];break;
   case Command::Join:case Command::Close:success=[self drain];break;
  }
  if(!_retired&&_deadlineMono&&uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count())>=_deadlineMono){[self remember:failure(@"WPR_RPC_ORIGINAL_WINDOW_EXPIRED")];success=NO;}
  next.reply([self envelope:!success],_first);
 }
 std::deque<Pending>left;{std::lock_guard<std::mutex>guard(_actor.lock);_actor.accepting=false;left.swap(_actor.pending);}for(auto&item:left)item.reply([self envelope:YES],_first?:failure(@"WPR_RPC_ORIGINAL_OWNER_CLOSED"));
 // Ambiguous/pending cleanup never reaches this point: the actor stays held
 // and reachable on its SAME original worker, without reopening/re-signing.
}
@end
@implementation YNXWPRMaterializationServerPrivate{
 YNXWPRPublicationPeer*_peer;NSMutableDictionary<NSString*,YNXWPRMaterializationActorPrivate*>*_actors;uint64_t _serial;
}
+ (instancetype)forOriginalPeer:(YNXWPRPublicationPeer*)peer{auto owner=[YNXWPRMaterializationServerPrivate new];owner->_peer=peer;owner->_actors=[NSMutableDictionary dictionary];return owner;}
- (void)openOriginalMaterializationWithReply:(void(^)(NSDictionary*,NSError*))reply {
 NSError*cause=nil;if(![YNXWPRPublicationPeer isOriginalPeer:_peer]||![_peer assertCurrentMessage:&cause]){reply(nil,cause?:failure(@"WPR_RPC_GENUINE_CURRENT_PEER_REQUIRED"));return;}
 YNXWPRMaterializationActorPrivate*actor=[YNXWPRMaterializationActorPrivate new];actor.peer=_peer;
 @synchronized(self){if(_actors.count>=16||_serial==UINT64_MAX){reply(nil,failure(@"WPR_RPC_CUSTODY_CAPACITY"));return;}actor.lease=[NSString stringWithFormat:@"%llu",(unsigned long long)++_serial];_actors[actor.lease]=actor;}
 [actor serveOriginalOpenReply:reply];
 // Retain terminal readonly identity until SAME connection is released. A
 // lost close response must not turn actual physical completion into a new
 // acquire, foreign lease, or permanently unobservable debt.
}
- (void)route:(NSString*)lease command:(Command)command reply:(void(^)(NSDictionary*,NSError*))reply {
 const bool custody=command==Command::Retire||command==Command::Join||command==Command::Close;
 NSError*cause=nil;BOOL peerOkay=custody?[_peer assertOriginalCustodyMessage:&cause]:[_peer assertCurrentMessage:&cause];if(!leaseString(lease)||![YNXWPRPublicationPeer isOriginalPeer:_peer]||!peerOkay){reply(nil,cause?:failure(@"WPR_RPC_ORIGINAL_LEASE_REQUIRED"));return;}
 YNXWPRMaterializationActorPrivate*actor=nil;@synchronized(self){actor=_actors[lease];}if(!actor){reply(nil,failure(@"WPR_RPC_FOREIGN_OR_CLOSED_LEASE"));return;}if(actor.physicalDone){reply([actor envelope:!custody||actor.first!=nil],actor.first);return;}[actor enqueue:command reply:reply];
}
- (void)readCapturedPublicOriginals:(NSString*)s reply:(void(^)(NSDictionary*,NSError*))r{[self route:s command:Command::Captured reply:r];}
- (void)readIndependentMaterializationOriginal:(NSString*)s reply:(void(^)(NSDictionary*,NSError*))r{[self route:s command:Command::Independent reply:r];}
- (void)assertOriginalMaterializationCurrent:(NSString*)s reply:(void(^)(NSDictionary*,NSError*))r{[self route:s command:Command::Current reply:r];}
- (void)recheckOriginalMaterialization:(NSString*)s reply:(void(^)(NSDictionary*,NSError*))r{[self route:s command:Command::Recheck reply:r];}
- (void)retireOriginalMaterialization:(NSString*)s reply:(void(^)(NSDictionary*,NSError*))r{[self route:s command:Command::Retire reply:r];}
- (void)joinOriginalMaterialization:(NSString*)s reply:(void(^)(NSDictionary*,NSError*))r{[self route:s command:Command::Join reply:r];}
- (void)closeOriginalMaterialization:(NSString*)s reply:(void(^)(NSDictionary*,NSError*))r{[self route:s command:Command::Close reply:r];}
@end
NSXPCInterface*YNXWPRMaterializationRPCInterfaceV1(void){
 auto interface=[NSXPCInterface interfaceWithProtocol:@protocol(YNXWPRMaterializationRPCPrivateV1)];NSSet*classes=[NSSet setWithArray:@[NSDictionary.class,NSArray.class,NSString.class,NSData.class,NSNumber.class,NSError.class,NSNull.class]];
 for(NSString*name in @[@"openOriginalMaterializationWithReply:",@"readCapturedPublicOriginals:reply:",@"readIndependentMaterializationOriginal:reply:",@"assertOriginalMaterializationCurrent:reply:",@"recheckOriginalMaterialization:reply:",@"retireOriginalMaterialization:reply:",@"joinOriginalMaterialization:reply:",@"closeOriginalMaterialization:reply:"]){SEL selector=NSSelectorFromString(name);[interface setClasses:classes forSelector:selector argumentIndex:0 ofReply:YES];}
 return interface;
}
