#pragma once
#include <stddef.h>
#include <stdint.h>
#include "browser_page_borrow_private.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_browser_page_request_v2 ynx_browser_page_request_v2;
typedef struct ynx_browser_page_parent_v2 ynx_browser_page_parent_v2;
typedef struct { int32_t first_error; uint32_t completed; } ynx_browser_page_drain_v2;
/* Three nonoverlapping output spans and three independent lengths. No NUL is
 * appended: preparation/profile are exact UTF8 bytes, each <=1024; raw <=32768.
 * On failure ALL caller bytes/lengths remain unchanged. No request reencoding. */
typedef struct {
    uint8_t *raw; size_t raw_cap; size_t *raw_written;
    uint8_t *preparation; size_t preparation_cap; size_t *preparation_written;
    uint8_t *profile; size_t profile_cap; size_t *profile_written;
} ynx_browser_page_request_output_v2;
int32_t ynx_browser_page_capture_original_v2(ynx_browser_page_request_v2 **,
                                           ynx_browser_page_parent_v2 **);
int32_t ynx_browser_page_request_current_v2(ynx_browser_page_request_v2 *);
int32_t ynx_browser_page_original_request_data_v2(ynx_browser_page_request_v2 *,
    const ynx_browser_page_request_output_v2 *);
int32_t ynx_browser_page_request_read_v2(ynx_browser_page_request_v2 *,
    const uint8_t *raw,size_t bytes,uint8_t *out,size_t cap,size_t *written);
int32_t ynx_browser_page_request_retire_v2(ynx_browser_page_request_v2 *);
ynx_browser_page_drain_v2 ynx_browser_page_request_join_v2(ynx_browser_page_request_v2 *);
ynx_browser_page_drain_v2 ynx_browser_page_request_close_v2(ynx_browser_page_request_v2 *);
int32_t ynx_browser_page_request_destroy_v2(ynx_browser_page_request_v2 **);
/* SAME original parent/epoch reference, independent of child retirement/close.
 * This can be checked after child destroy; no new acquisition/window/refresh.
 * destroy refuses while any same-parent child or Current is active. */
int32_t ynx_browser_page_parent_current_v2(ynx_browser_page_parent_v2 *);
int32_t ynx_browser_page_parent_destroy_v2(ynx_browser_page_parent_v2 **);
#ifdef __cplusplus
}
#endif
