#ifndef YNX_LINK_PRIVATE_CLIENT_STARTUP_V1_H
#define YNX_LINK_PRIVATE_CLIENT_STARTUP_V1_H

#include "private_client_v1.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Private SAME-process normal-startup owner. There is no constructor from a
 * config, endpoint, route, UID/PID, Source bool, callback or serialized pointer.
 * Normal carriers opt in at build time; ordinary Go builds must not acquire an
 * unresolved Auth symbol merely by importing securelink.
 */
typedef struct ynx_link_pay_native_startup_v1 ynx_link_pay_native_startup_v1;
/* Types are defined/minted only by Auth's actual private native owners. */
typedef struct ynx_wallet_pay_actual_context_v1 ynx_wallet_pay_actual_context_v1;
typedef struct ynx_wallet_pay_source_lease_v1 ynx_wallet_pay_source_lease_v1;

/* Adopt any nonnull startup/source output BEFORE interpreting status. The
 * startup keeps the actual Root/context native borrows and Go registration
 * debt through its original one-shot Source handoff. Null constructor output
 * keeps the registration borrow here; nonnull output adopts it even on error.
 * An uncertain constructor result is UNKNOWN custody, never a retry signal.
 */
int32_t ynx_link_pay_native_startup_open_v1(
    ynx_wallet_pay_actual_context_v1 *actual_auth_context,
    ynx_link_pay_native_startup_v1 **out_startup);

/* Uses ONLY the exact context/loan retained by open. There is no replacement
 * Root/Main/binding/query/loan argument and no constructor callback parameter.
 * The one actual callee is Auth's strong source_adopt_registration_v1. Adopt
 * nonnull out_source before status; the original Source now owns that borrow.
 */
int32_t ynx_link_pay_native_startup_adopt_source_v1(
    ynx_link_pay_native_startup_v1 *startup,
    ynx_wallet_pay_source_lease_v1 **out_source);

/* Retire lowers only this startup's own flags/registration. It denies a new
 * handoff/dispatch and cancels owned work without waiting for a constructor.
 * It does not retire/close the borrowed Auth context/Root/Main or endpoint.
 * The actual Native owner must retire its own context/Main before parent Close.
 */
int32_t ynx_link_pay_native_startup_retire_v1(ynx_link_pay_native_startup_v1 *startup);

/* Cleanup timeout is independent of the qualified operation deadline; it
 * cannot refresh permission. Join waits for the actual constructor, Source
 * registration borrow and all original children. Timeout/cancel retains debt.
 */
int32_t ynx_link_pay_native_startup_join_v1(
    ynx_link_pay_native_startup_v1 *startup, uint32_t timeout_ms);

/* Close requires true Join. Known early Draining did not execute Close and
 * permits the first actual Close after Join, while error-copy keeps that first
 * cause. A genuinely entered unknown/failed Close is sticky and keeps custody.
 * closed returns 1 only after physical owned cleanup, else 0; it does not erase
 * a prior error or assert Source/Root admission. Free refuses undrained debt.
 */
int32_t ynx_link_pay_native_startup_close_v1(ynx_link_pay_native_startup_v1 *startup);
int32_t ynx_link_pay_native_startup_closed_v1(ynx_link_pay_native_startup_v1 *startup);
int32_t ynx_link_pay_native_startup_free_v1(ynx_link_pay_native_startup_v1 *startup);

/* Owned diagnostics, using the existing packet DATA ABI. Adopt nonnull output
 * before status and free it with packet_free_v1. This never mints a response:
 * packet_present stays false unless an actual original response was received.
 * First cause and physical drain are independent. No SDK error.partial field.
 */
int32_t ynx_link_pay_native_startup_error_v1(
    ynx_link_pay_native_startup_v1 *startup,
    ynx_link_private_client_packet_v1 **out_packet);

#ifdef __cplusplus
}
#endif
#endif
