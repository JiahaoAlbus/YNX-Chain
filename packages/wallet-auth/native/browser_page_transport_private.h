#import <Foundation/Foundation.h>
#import "browser_page_borrow_private.h"
/* PRIVATE native composition only, not public SDK/WIRE or a Source factory.
 * Transport-only owner. The future original Browser qualification owns it as a
 * child, supplies independently held original request and OS peer registration,
 * and ANDs its own Source math/current before and after each method. */
@interface YNXBrowserPageTransport : NSObject
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
- (instancetype)initWithOriginalEndpoint:(NSXPCListenerEndpoint *)endpoint
    process:(pid_t)pid user:(uid_t)uid identifier:(NSString *)identifier
    codeDirectoryHash:(NSString *)cdhash originalRequest:(NSData *)request
    monotonicDeadline:(uint64_t)deadline;
- (int32_t)current;
- (int32_t)copyOriginalRequest:(NSData **)out;
- (int32_t)readOriginal:(NSData *)request result:(NSData **)out;
- (int32_t)retire;
- (int32_t)join;
- (int32_t)close;
@end
/* Source-private composition bridge; transport-only, never exported to JS.
 * Caller retains its independently qualified parent through handle destruction.
 * Does not make capture_original succeed or confer Browser authorization. */
ynx_browser_page_borrow *YNXBrowserPageAdoptTransportChild(YNXBrowserPageTransport *child);
