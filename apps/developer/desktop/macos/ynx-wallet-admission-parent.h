#import <Foundation/Foundation.h>

@protocol YNXWalletAdmissionParentGuard <NSObject>
@property(nonatomic,readonly) int descriptor;
@property(nonatomic,readonly) pid_t parentPID;
@property(nonatomic,readonly) NSURL *approvedWorkspaceURL;
- (BOOL)assertCurrentResources:(NSURL *)resources node:(NSURL *)node entry:(NSURL *)entry child:(pid_t)child error:(NSError **)error;
- (void)close;
@end

// A normal, strongly linked entry point. Structural OS evidence is necessary
// but cannot supply the original registered executor/parent authorization.
typedef NS_ENUM(NSUInteger, YNXIDEAdmissionAcquireKind) {
    YNXIDEAdmissionCleanRefusal,
    YNXIDEAdmissionQualified,
    YNXIDEAdmissionCleanupIncomplete
};

// Immutable acquire result; cleanup custody is private and is never a guard.
// No public constructor can manufacture a qualified resource or a debt owner.
@interface YNXIDEAdmissionAcquireOutcome : NSObject
@property(nonatomic,readonly) YNXIDEAdmissionAcquireKind kind;
@property(nonatomic,readonly) id<YNXWalletAdmissionParentGuard> guard;
@property(nonatomic,readonly) id firstCause;
@property(nonatomic,readonly) NSError *cleanupError;
@end
FOUNDATION_EXPORT YNXIDEAdmissionAcquireOutcome *YNXOriginalAcquireIDEAdmissionParent(NSURL *resources, pid_t parent, NSError **error);
// Same original cleanup selection/status. An uncertain close is not retried.
FOUNDATION_EXPORT BOOL YNXFinishIDEAdmissionAcquireCleanup(YNXIDEAdmissionAcquireOutcome *outcome, NSError **error);
