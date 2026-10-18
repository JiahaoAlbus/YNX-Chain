#pragma once
#import <Foundation/Foundation.h>
#import "original-ide-wallet-identity-source.h"
#include "original-ide-identity-peer-endpoint.h"
// Private Native owner only. No JS descriptor/PID/launch-path/provider or
// Source argument is exposed by the fixed compiled NAPI factory.
@interface YNXOriginalIDEWalletPeerLaunch:NSObject
+ (instancetype)captureSource:(YNXOriginalIDEWalletIdentitySource *)source error:(NSError **)error;
- (BOOL)launch:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
// Worker methods perform byte I/O only; fixed caller keeps owner+self busy.
- (ynx_auth_ide_identity_private::Frame)receiveBytes;
- (void)sendBytes:(ynx_auth_ide_identity_private::Frame)frame;
// Main-thread capture happens before any Source callback.
- (BOOL)captureRequest:(ynx_auth_ide_identity_private::Frame)frame error:(NSError **)error;
- (BOOL)selectDecision:(NSString *)kind proof:(NSData *)proof error:(NSError **)error;
- (ynx_auth_ide_identity_private::Frame)selectedDecision;
- (NSDictionary *)copyCapturedRequest:(NSError **)error;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
- (NSDictionary *)status;
@end
