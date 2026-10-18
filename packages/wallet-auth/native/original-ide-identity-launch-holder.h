#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
#include <sys/types.h>
// Private original IDE App launcher only. Not a renderer/JS provider, public
// FD adoption API, Source installer, old four-operation parent or new daemon.
@interface YNXOriginalIdentityPeerLaunchHolder : NSObject
// Call once at original main entry inside its first autoreleasepool, before
// App-owned files/pipes/tasks. Ordinary FD presence is NOT an identity launch.
// The original Wallet Native launcher must write the exact eight transport
// bytes YNXIDP01 BEFORE spawning App. This marker is DATA, never admission.
// Missing/unrelated fd5 => nil/no error and untouched FD, preserving local use.
// Marked fd5 => SAME partial returned even on qualification error; no fallback
// to an ordinary task and no second capture/retry of that original launch.
+ (instancetype)captureInheritedOriginal:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
// Returns one owned duplicate for the existing posix_spawn file actions only.
// Holder retains it; caller must NOT close or hand the number to JS/Theia.
// Duplicate starts CLOEXEC. Map it to backend fd5 in original App spawn.
- (int)duplicateForBackendSpawn:(NSError **)error;
// Must be called after actual posix_spawn return, on success or failure.
// PID must be the actual returned child, not a JS/body-provided PID. Failed
// spawn consumes this launch, retires it and closes the temporary duplicate.
- (BOOL)finishBackendSpawn:(pid_t)actualPID spawnStatus:(int)status error:(NSError **)error;
- (void)retire;
// Original launcher still owns child wait/reaping. This join checks original
// process lifetime; it never reaps another owner's task or marks it gone by DTO.
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@property(nonatomic,readonly) NSError *firstCause;
@property(nonatomic,readonly) BOOL ready;
@end
#endif
