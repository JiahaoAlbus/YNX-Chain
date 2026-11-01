#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_browser_page_borrow ynx_browser_page_borrow;
enum { YNX_BROWSER_OK=0, YNX_BROWSER_NOT_SUPPLIED=71, YNX_BROWSER_INVALID=72,
       YNX_BROWSER_RETIRED=73, YNX_BROWSER_BUSY=74, YNX_BROWSER_PENDING=75,
       YNX_BROWSER_TRANSPORT=76, YNX_BROWSER_LIMIT=77, YNX_BROWSER_MISMATCH=78 };
/* Normal zero-input acquisition. A transport/endpoint/PID is NOT Source.
 * No qualified Browser Source giver exists in the retained namespace yet.
 * Non-null partial must always be adopted even on failure. No caller setter. */
int32_t ynx_browser_page_borrow_capture_original_v1(ynx_browser_page_borrow **out);
int32_t ynx_browser_page_borrow_current_v1(ynx_browser_page_borrow *);
/* Original bytes/preparation/profile come from the giver, never received JSON.
 * On non-OK all output buffers and *written remain unchanged. */
int32_t ynx_browser_page_borrow_request_v1(ynx_browser_page_borrow *,
    uint8_t *out, size_t cap, size_t *written);
int32_t ynx_browser_page_borrow_read_v1(ynx_browser_page_borrow *,
    const uint8_t *exact_request, size_t bytes,
    uint8_t *out, size_t cap, size_t *written);
int32_t ynx_browser_page_borrow_retire_v1(ynx_browser_page_borrow *);
int32_t ynx_browser_page_borrow_join_v1(ynx_browser_page_borrow *);
/* Closes only after actual invalidation/drain. PENDING preserves SAME owner.
 * No automatic retry, replacement connection, request replay or timeout renewal. */
int32_t ynx_browser_page_borrow_close_v1(ynx_browser_page_borrow *);
/* Only after successful close; caller serializes destroy against every method. */
int32_t ynx_browser_page_borrow_destroy_v1(ynx_browser_page_borrow **);
#ifdef __cplusplus
}
#endif
