#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>
#import <ReactCommon/CallInvoker.h>
#import "YNXPQCustody-Swift.h"
#include "CustodyJSI.h"
@interface YNXPQCustody : NSObject <RCTBridgeModule,RCTTurboModuleWithJSIBindings>
@property(nonatomic,assign) BOOL installed;
@property(nonatomic,strong) YNXPQCustodyLifecycle* lifecycle;
@end
@implementation YNXPQCustody
RCT_EXPORT_MODULE(YNXPQCustody)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init { if((self=[super init]))_lifecycle=[YNXPQCustodyLifecycle new];return self; }
- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime&)runtime callInvoker:(const std::shared_ptr<facebook::react::CallInvoker>&)invoker {
 try{self.installed=ynx::mobilepq::install(runtime,invoker);}catch(...){self.installed=NO;}
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) { return @(self.installed); }
- (void)invalidate { [self.lifecycle invalidate]; }
@end
extern "C" bool ynx_mobile_pq_invalidate_runtime_v1(){return ynx::mobilepq::invalidate();}
