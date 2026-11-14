#import "BrowserOriginalPageSourceRoot.h"
// This is the actual original owner header, supplied by its immutable r3
// component include path. No local declaration/copy or guessed symbol is used.
#include "browser_page_root_private_v3.h"
#include <mutex>
#include <exception>

@interface BrowserOriginalPageSourceRoot () {
    std::mutex _lock;
    ynx_browser_page_root_v3 *_root;
    int32_t _acquisition, _first;
    bool _retired, _completed, _destroyed;
}
- (instancetype)initOriginal;
@end

@implementation BrowserOriginalPageSourceRoot
+ (instancetype)acquireOriginal { return [[self alloc] initOriginal]; }
- (instancetype)initOriginal {
    self = [super init]; if (!self) return nil;
    // The actual output slot is owned BEFORE the accompanying status is read.
    // Error+nonnull remains in this holder until original close+destroy finish.
    _acquisition = ynx_browser_page_root_acquire_original_v3(&_root);
    if (_acquisition) _first = _acquisition;
    else if (!_root) _first = _acquisition = YNX_BROWSER_INVALID;
    return self;
}
- (int32_t)acquisitionStatus { std::lock_guard<std::mutex> guard(_lock); return _acquisition; }
- (int32_t)firstStatus { std::lock_guard<std::mutex> guard(_lock); return _first; }
- (BOOL)ownsOriginalRoot { std::lock_guard<std::mutex> guard(_lock); return _root != nullptr; }
- (int32_t)rememberLocked:(int32_t)status {
    if (status && !_first) _first = status;
    return _first ?: status;
}
- (int32_t)currentLocked {
    if (_first) return _first;
    if (_retired || _completed || !_root) return [self rememberLocked:YNX_BROWSER_RETIRED];
    return [self rememberLocked:ynx_browser_page_root_current_v3(_root)];
}
- (int32_t)requireCurrent {
    std::lock_guard<std::mutex> guard(_lock); return [self currentLocked];
}
- (int32_t)copyOriginalContext:(NSDictionary **)outContext {
    if (!outContext) return YNX_BROWSER_INVALID;
    std::lock_guard<std::mutex> guard(_lock);
    int32_t status = [self currentLocked]; if (status) return status;
    NSError *error = nil;
    NSDictionary *context = YNXCopyOriginalBrowserPageRootContextV3(_root, &error);
    if (error || !context) {
        status = ynx_browser_page_root_current_v3(_root);
        return [self rememberLocked:status ?: YNX_BROWSER_MISMATCH];
    }
    status = [self currentLocked]; if (status) return status;
    *outContext = context; // No asynchronous work between final current and publication.
    return YNX_BROWSER_OK;
}
- (int32_t)copyOriginalReadDeadline:(uint64_t *)outDeadline {
    if (!outDeadline) return YNX_BROWSER_INVALID;
    std::lock_guard<std::mutex> guard(_lock);
    int32_t status = [self currentLocked]; if (status) return status;
    uint64_t sameDeadline = 0;
    status = ynx_browser_page_root_read_deadline_v3(_root, &sameDeadline);
    if (status) return [self rememberLocked:status];
    status = [self currentLocked]; if (status) return status;
    *outDeadline = sameDeadline;
    return YNX_BROWSER_OK;
}
- (int32_t)retireOriginal {
    std::lock_guard<std::mutex> guard(_lock);
    if (_retired || !_root) return _first ?: YNX_BROWSER_RETIRED;
    _retired = true;
    return [self rememberLocked:ynx_browser_page_root_retire_v3(_root)];
}
- (BrowserOriginalPageRootDrain)closeOriginal {
    std::lock_guard<std::mutex> guard(_lock);
    _retired = true;
    if (!_root) {
        // No original resource existed, or actual destroy already completed.
        _completed = _destroyed = true;
        return {_first, 1, 1};
    }
    if (!_completed) {
        ynx_browser_page_drain_v2 drain = ynx_browser_page_root_close_v3(_root);
        (void)[self rememberLocked:drain.first_error];
        if (drain.completed != 1) return {_first, 0, 0};
        _completed = true;
    }
    int32_t status = ynx_browser_page_root_destroy_v3(&_root);
    (void)[self rememberLocked:status];
    if (status || _root) return {_first, 1, 0};
    _destroyed = true;
    return {_first, 1, 1};
}
- (void)dealloc {
    // Same rule as the original Root: dropping unclosed Source debt is a caller
    // lifecycle error. Do not invent automatic reacquisition, silently leak the
    // opaque owner, or claim an unobserved close. Retain on UNKNOWN and close it.
    if (_root) std::terminate();
}
@end
