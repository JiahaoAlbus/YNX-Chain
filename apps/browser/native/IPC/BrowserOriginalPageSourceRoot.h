#import <Foundation/Foundation.h>
#include <stdint.h>

NS_ASSUME_NONNULL_BEGIN
// Original Auth's completion and first failure are independent. A drained Root0
// is still a failed acquisition. UNKNOWN preserves this SAME owner for drain.
typedef struct {
    int32_t firstStatus;
    uint32_t completed;
    uint32_t destroyed;
} BrowserOriginalPageRootDrain;

// PRIVATE normal composition bridge, not a new Source or a public installer.
// Implementation directly includes the original frozen Auth v3 private header.
// No injected functions, mutable symbol lookup, resource path, endpoint, expected
// data, keys, serialized authority or caller-ready flag is accepted here.
@interface BrowserOriginalPageSourceRoot : NSObject
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
// Always adopt this returned holder BEFORE inspecting acquisitionStatus. It owns
// any non-null actual partial returned by the original zero-input constructor.
+ (instancetype)acquireOriginal;
@property (nonatomic, readonly) int32_t acquisitionStatus;
@property (nonatomic, readonly) int32_t firstStatus;
@property (nonatomic, readonly) BOOL ownsOriginalRoot;
- (int32_t)requireCurrent;
// Owned original Source projection, not received JSON and not authority by itself.
// On failure caller's output is unchanged. Exact request bytes still need the
// independent original giver; never reserialize this context as those bytes.
- (int32_t)copyOriginalContext:(NSDictionary * _Nullable * _Nonnull)outContext;
// Same fixed original CLOCK_MONOTONIC nanoseconds; never renew a child deadline.
- (int32_t)copyOriginalReadDeadline:(uint64_t *)outDeadline;
- (int32_t)retireOriginal;
// No re-acquire/re-read/implicit cleanup retry. completed0 or destroyed0 means
// retain this holder and explicitly continue the SAME drain. A nonzero
// firstStatus remains observable after completed1/destroyed1.
- (BrowserOriginalPageRootDrain)closeOriginal;
@end
NS_ASSUME_NONNULL_END
