#ifndef YNX_LINK_PRIVATE_CLIENT_V1_H
#define YNX_LINK_PRIVATE_CLIENT_V1_H

/* Private in-process transport ABI. This is not an SDK, Root registration,
 * Source factory, network permission, or a JS provider. The normal Go owner
 * alone hands off an original registration for its actual LocalCallerClient,
 * original parent context, and five immutable indexed route slots. An all-zero
 * Go binding is disabled; at least one slot must be enabled. Missing intent or
 * invoice targets must never be invented to populate another slot.
 * There are deliberately no destination/path/UID/service/config setters here.
 */
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ynx_link_private_client_registration_v1 ynx_link_private_client_registration_v1;
typedef struct ynx_link_private_client_registration_borrow_v1 ynx_link_private_client_registration_borrow_v1;
typedef struct ynx_link_private_client_holder_v1 ynx_link_private_client_holder_v1;

/* Long-lived native Source handoff MUST own an actual registration borrow,
 * minted only by the normal Go owner's BorrowNativeRegistrationPointer(). A
 * raw NativeRegistrationPointer() is only a temporary Go-owner-controlled use;
 * copying its address does not retain its original client/context or prevent
 * parent free/address reuse. There is no C constructor or config setter.
 *
 * SourceLease stores the opaque borrow privately, checks it, and extracts the
 * original registration only while that borrow remains held. current is pure
 * native observed state, not Source approval or a Go/OS-peer/network read. Release
 * drops this original borrow once, after all borrowing native children drain.
 * Parent Retire/Join/Close must retain outstanding borrow/holder debt.
 */
int32_t ynx_link_private_client_registration_from_borrow_v1(
    ynx_link_private_client_registration_borrow_v1 *borrow,
    ynx_link_private_client_registration_v1 **out_registration);
int32_t ynx_link_private_client_registration_borrow_current_v1(
    ynx_link_private_client_registration_borrow_v1 *borrow);
int32_t ynx_link_private_client_registration_borrow_release_v1(
    ynx_link_private_client_registration_borrow_v1 *borrow);

enum ynx_link_private_client_error_code_v1 {
    YNX_LINK_PRIVATE_OK_V1 = 0,
    YNX_LINK_PRIVATE_DENIED_V1 = 1,
    YNX_LINK_PRIVATE_BOUNDS_V1 = 2,
    YNX_LINK_PRIVATE_UNAVAILABLE_V1 = 3,
    YNX_LINK_PRIVATE_CANCELLED_V1 = 4,
    YNX_LINK_PRIVATE_DRAINING_V1 = 5,
    YNX_LINK_PRIVATE_NATIVE_CURRENT_V1 = 6,
    YNX_LINK_PRIVATE_CLOSED_V1 = 7
};

/* Indices are fixed by the private normal registration; disabled slots deny.
 * No index can select
 * an unregistered path or turn a query-only borrow into a write. */
enum ynx_link_private_client_operation_v1 {
    YNX_LINK_PRIVATE_POST_TERMS_V1 = 0,
    YNX_LINK_PRIVATE_POST_SETTLEMENT_V1 = 1,
    YNX_LINK_PRIVATE_POST_REFUND_V1 = 2,
    YNX_LINK_PRIVATE_GET_INTENT_V1 = 3,
    YNX_LINK_PRIVATE_GET_INVOICE_V1 = 4
};

/* The actual Auth/P01 native Source owner supplies this original fence.
 * Context identity/qualification is NOT obtained from a Binding selector,
 * callback returning "approved", TLS identity, JSON, or a transport response.
 * All callbacks must be native, thread-safe, bounded, and never throw across
 * this C ABI, call JS, do network/FD I/O, or reenter the Go transport holder.
 *
 * current: 0 iff this original native borrow is currently valid; otherwise
 * return its original nonzero native error code (not a new authorization).
 * retain: 0 acquires exactly one native borrow; a nonzero return acquires none.
 * release: drops that acquired borrow once, only after the real child drains.
 * retain/release must not substitute/reopen a Source or re-sign an operation.
 */
typedef struct ynx_link_private_client_source_fence_v1 {
    void *ctx;
    int32_t (*current)(void *ctx);
    int32_t (*retain)(void *ctx);
    void (*release)(void *ctx);
} ynx_link_private_client_source_fence_v1;

/* Owned response/error DATA. Adopt a nonnull out-packet BEFORE checking the
 * return code. Body is the exact original received byte prefix/full body;
 * header_json is an owned JSON encoding of the original parsed Go http.Header
 * (name -> string array), not a claim to raw HTTP header wire bytes. Neither
 * field is authorization or a receipt. Sizes exclude any optional NUL byte.
 *
 * error_code/native_current_code/error_message preserve the first cause.
 * dispatch_possible becomes true immediately before an original request write
 * is attempted; no error after that proves non-execution. Preserve UNKNOWN
 * under the original operation. Never retry/re-POST or invent query fallback.
 * partial_response_bytes is diagnostics only, never SDK error.partial custody.
 * All pointers belong to the packet and are freed only by packet_free_v1.
 */
typedef struct ynx_link_private_client_packet_v1 {
    uint8_t packet_present;
    uint8_t *method;
    size_t method_size;
    uint8_t *request_path;
    size_t request_path_size;
    int32_t status_code;
    int32_t error_code;
    int32_t native_current_code;
    uint8_t dispatch_possible;
    uint64_t partial_response_bytes;
    uint8_t *header_json;
    size_t header_json_size;
    uint8_t *content_type;
    size_t content_type_size;
    uint8_t *cache_control;
    size_t cache_control_size;
    uint8_t *body;
    size_t body_size;
    char *error_message;
    size_t error_message_size;
} ynx_link_private_client_packet_v1;

/* Capture always sets *out_holder (possibly a nonnull owned error partial)
 * before returning an error. Caller must adopt it first and perform the same
 * retire/join/close/free cleanup. A successful fence retain is held through
 * actual Join and Close. registration is a private startup handoff, never a
 * caller-created request selector or a serialized/public pointer constructor.
 */
int32_t ynx_link_private_client_capture_v1(
    ynx_link_private_client_registration_v1 *registration,
    const ynx_link_private_client_source_fence_v1 *source_fence,
    uint8_t query_only,
    ynx_link_private_client_holder_v1 **out_holder);

/* Pure native local flags/PID only; no Go/OS-peer/FD/network/JS or qualification. */
int32_t ynx_link_private_client_current_local_v1(ynx_link_private_client_holder_v1 *holder);
/* Local check AND the original native Source fence.current. Error-only; no
 * response/material is minted. These are not fresh OS peer checks. The Call
 * implementation independently checks the same native fence at req.Write. */
int32_t ynx_link_private_client_current_source_v1(ynx_link_private_client_holder_v1 *holder);
int32_t ynx_link_private_client_recheck_v1(ynx_link_private_client_holder_v1 *holder);

/* One bounded attempt on an immutable registered operation. 0..2 are POST;
 * query_only refuses them. 3..4 are GET and require body_size==0 (body may be
 * NULL). POST bounds/MIME/peer/destination come solely from registration.
 * Input bytes are copied before async/native work can outlive this call.
 * Nonnull *out_packet is owned even when this function returns an error.
 */
int32_t ynx_link_private_client_call_v1(
    ynx_link_private_client_holder_v1 *holder,
    uint8_t operation_index,
    const uint8_t *body,
    size_t body_size,
    ynx_link_private_client_packet_v1 **out_packet);

/* Copy the holder's sticky first error into a new owned packet, without
 * Source/transport I/O or losing response DATA. Packet free does not free its
 * holder. No pointer from a freed holder may be reused as a fresh capability.
 */
int32_t ynx_link_private_client_error_v1(
    ynx_link_private_client_holder_v1 *holder,
    ynx_link_private_client_packet_v1 **out_packet);
void ynx_link_private_client_packet_free_v1(ynx_link_private_client_packet_v1 *packet);

/* Retire denies new calls and cancels the holder's actual in-flight context.
 * Join really waits for owned work; a timeout retains the holder/native borrow.
 * Close never reports a live child as drained. A cleanup failure is retained
 * independently of the original exchange's first cause. free_v1 only succeeds
 * after the real Join and Close; on error it retains the original owner.
 * Nothing here unregisters/unlinks a socket or closes a borrowed Go parent.
 */
int32_t ynx_link_private_client_retire_v1(ynx_link_private_client_holder_v1 *holder);
int32_t ynx_link_private_client_join_v1(ynx_link_private_client_holder_v1 *holder, uint32_t timeout_ms);
int32_t ynx_link_private_client_close_v1(ynx_link_private_client_holder_v1 *holder);
int32_t ynx_link_private_client_free_v1(ynx_link_private_client_holder_v1 *holder);

#ifdef __cplusplus
}
#endif
#endif
