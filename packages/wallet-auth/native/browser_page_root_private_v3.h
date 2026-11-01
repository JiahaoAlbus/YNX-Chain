#pragma once
#include "browser_page_request_private_v2.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_browser_page_root_v3 ynx_browser_page_root_v3;
/* True zero-input independent Source-v2 constructor. Non-null partial is always
 * adopted first; actual rows empty -> error+partial, never a fake Root/Source.
 * Output slot must be null: existing owner is refused, never overwritten. */
int32_t ynx_browser_page_root_acquire_original_v3(ynx_browser_page_root_v3 **out);
int32_t ynx_browser_page_root_current_v3(ynx_browser_page_root_v3 *);
/* SAME fixed CLOCK_MONOTONIC nanosecond deadline, for r1 child construction.
 * Local DATA only, never portable WIRE/permission. Non-OK leaves out unchanged. */
int32_t ynx_browser_page_root_read_deadline_v3(ynx_browser_page_root_v3 *,uint64_t *out);
int32_t ynx_browser_page_root_borrow_parent_v3(ynx_browser_page_root_v3 *,ynx_browser_page_parent_v2 **out);
int32_t ynx_browser_page_root_retire_v3(ynx_browser_page_root_v3 *);
ynx_browser_page_drain_v2 ynx_browser_page_root_close_v3(ynx_browser_page_root_v3 *);
int32_t ynx_browser_page_root_destroy_v3(ynx_browser_page_root_v3 **);
#ifdef __cplusplus
}
#endif
#ifdef __OBJC__
#import <Foundation/Foundation.h>
/* Owned authenticated Source projection for the original protected endpoint
 * giver, not a caller setter or portable Source approval. No raw endpoint here. */
NSDictionary *YNXCopyOriginalBrowserPageRootContextV3(ynx_browser_page_root_v3 *,NSError **);
#endif
