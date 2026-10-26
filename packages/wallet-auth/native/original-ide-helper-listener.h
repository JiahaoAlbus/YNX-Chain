#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import "original-ide-helper-service-contract.h"
#import "original-ide-helper-xpc-peer.h"
// Private exported object retains all exact partials/first-close debt. A new
// connection is NOT a retry of a failed/unknown operation.
@interface YNXIDEHelperReceiver:NSObject<YNXIDEIdentityReceiverService>
- (instancetype)initWithOriginalPeer:(YNXIDEHelperMessagePeer*)peer;
- (void)retireConnection;
- (BOOL)custodyDisposed;
@end
@interface YNXIDEHelperListenerDelegate:NSObject<NSXPCListenerDelegate>
@end
// Normal helper executable only. Refuses BEFORE creating/activating any Mach
// listener when helper build/root identity is unadmitted. Never installs itself.
FOUNDATION_EXPORT BOOL YNXRunOriginalIDEHelper(NSError**error);
#endif
