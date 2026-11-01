#pragma once
#import <Foundation/Foundation.h>
#include <sys/types.h>
// Native owning producer. Caller resources/parent only constrain the actual
// running App/OS lineage; neither parameter supplies authority or workspace.
@interface YNXOriginalIDECocoaParentProducer : NSObject
+ (instancetype)acquireOriginalResources:(NSURL*)resources parent:(pid_t)parent error:(NSError**)error;
@property(nonatomic,readonly) int descriptor;
@property(nonatomic,readonly) pid_t parentPID;
@property(nonatomic,readonly) NSURL*approvedWorkspaceURL;
@property(nonatomic,readonly) BOOL qualified;
@property(nonatomic,readonly) BOOL cleanupSelected;
@property(nonatomic,readonly) BOOL cleanupComplete;
@property(nonatomic,readonly) id firstCause;
@property(nonatomic,readonly) NSError*cleanupError;
- (BOOL)assertCurrentResources:(NSURL*)resources node:(NSURL*)node entry:(NSURL*)entry child:(pid_t)child error:(NSError**)error;
- (BOOL)finishCleanup:(NSError**)error;
// P03's void protocol must observe incomplete close as a thrown original
// cleanup cause, preserving the same parent object instead of nil-success.
- (void)close;
@end
