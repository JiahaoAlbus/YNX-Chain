#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>
#import <ReactCommon/CallInvoker.h>
#import "YNXPQCustody-Swift.h"
#include "CustodyJSI.h"
#include "PublicStatus.h"
#include <mutex>
@interface YNXPQCustody : NSObject <RCTBridgeModule,RCTTurboModuleWithJSIBindings> {
 std::mutex _runtimeMutex;
 facebook::jsi::Runtime* _runtime;
 std::shared_ptr<facebook::react::CallInvoker> _invoker;
 BOOL _invalidated;
 uint64_t _runtimeBinding;
}
@property(nonatomic,assign) BOOL installed;
@property(nonatomic,strong) YNXPQCustodyLifecycle* lifecycle;
@end
@implementation YNXPQCustody
RCT_EXPORT_MODULE(YNXPQCustody)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init { if((self=[super init]))_lifecycle=[YNXPQCustodyLifecycle new];return self; }
- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime&)runtime callInvoker:(const std::shared_ptr<facebook::react::CallInvoker>&)invoker {
 // RN may construct this module for a passive status read. Its JSI hook only
 // retains the original runtime binding; an explicit operation installs custody.
 std::lock_guard<std::mutex> lock(_runtimeMutex);
 if(!_invalidated){_runtime=&runtime;_invoker=invoker;}
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
 std::lock_guard<std::mutex> lock(_runtimeMutex);
 if(_invalidated||!_runtime||!_invoker)return @NO;
 if(!self.installed&&!_runtimeBinding)try{self.installed=ynx::mobilepq::install(*_runtime,_invoker,&_runtimeBinding);}catch(...){self.installed=NO;}
 return @(self.installed);
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(readPublicStatus) {
 const auto status=ynx::mobilepq::readPublicStatus();const auto& h=status.held;
 return @{ @"version":@1,@"runtime":[NSString stringWithUTF8String:ynx::mobilepq::publicRuntimeName(status.runtime)],
  @"heldOperations":@(h.heldOperations),@"heldCoreUncertain":@(h.heldCoreUncertain),@"heldOSUncertain":@(h.heldOSUncertain),
  @"heldOSRecorded":@(h.heldOSRecorded),@"heldCleanupFaults":@(h.heldCleanupFaults),@"workerBusy":@(h.workerBusy) };
}
- (void)invalidate {
 uint64_t binding=0;
 {std::lock_guard<std::mutex> lock(_runtimeMutex);_invalidated=YES;self.installed=NO;_runtime=nullptr;_invoker.reset();binding=_runtimeBinding;}
 if(binding){ynx::mobilepq::requestInvalidate(binding);[self.lifecycle invalidate:binding];}
}
@end
extern "C" bool ynx_mobile_pq_invalidate_runtime_v1(uint64_t binding){return ynx::mobilepq::invalidate(binding);}
