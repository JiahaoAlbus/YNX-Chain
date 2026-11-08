#ifndef YNX_LINK_IDE_FINITE_GET_TRANSPORT_V1_H
#define YNX_LINK_IDE_FINITE_GET_TRANSPORT_V1_H
#include "ide_finite_get_auth_mother_v1.h"
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/* PRIVATE same-image Auth -> LINK callee. The Auth owner supplies its real
 * strong mother header and implementation. There is no URL, credential, PIN,
 * proof header, Source callback, provider or signer installation operation. */
typedef struct ynx_link_ide_finite_get_v4_client ynx_link_ide_finite_get_v4_client;
typedef struct ynx_link_ide_finite_get_v4_packet ynx_link_ide_finite_get_v4_packet;
typedef struct { const uint8_t *data; size_t size; } ynx_link_ide_get_bytes_v1;
enum {
 YNX_LINK_IDE_GET_OK=0, YNX_LINK_IDE_GET_DENIED=1, YNX_LINK_IDE_GET_BOUNDS=2,
 YNX_LINK_IDE_GET_UNAVAILABLE=3, YNX_LINK_IDE_GET_CANCELLED=4,
 YNX_LINK_IDE_GET_DRAINING=5, YNX_LINK_IDE_GET_SOURCE_CURRENT=6,
 YNX_LINK_IDE_GET_CLOSED=7, YNX_LINK_IDE_GET_PROTOCOL=8,
 YNX_LINK_IDE_GET_TIMEOUT=9, YNX_LINK_IDE_GET_TLS=10,
 YNX_LINK_IDE_GET_SPKI=11, YNX_LINK_IDE_GET_REDIRECT=12,
 YNX_LINK_IDE_GET_CLEANUP_UNKNOWN=13
};
typedef struct {
 uint32_t version, size;
 int32_t code, native_code, system_errno, auth_code;
 /* Observed bounded error DATA. It contains no original request header or key.
  * View is invalidated by the next operation on this original client. */
 ynx_link_ide_get_bytes_v1 message;
} ynx_link_ide_get_failure_v1;
typedef struct {
 uint32_t version, size;
 int32_t status_code;
 uint8_t body_complete, dispatch_possible, unknown, reserved0;
 /* Native-only owned original response and any late prefix, including on
  * failure. These bytes never establish proof, finish, Root or Source grants.
  * Packet view is borrowed until this exact packet is released. */
 ynx_link_ide_get_bytes_v1 headers_original, trailers_original, entity_original;
 ynx_link_ide_get_failure_v1 failure;
 ynx_link_ide_get_bytes_v1 peer_spki_sha256, peer_certificate_sha256,
     root_certificate_sha256;
 uint64_t policy_epoch;
} ynx_link_ide_get_packet_view_v1;
typedef struct {
 uint32_t version, size;
 uint8_t started, retired, response_ready, worker_joined;
 uint8_t response_released, closing, physical_complete, source_borrow_held;
 uint8_t cleanup_unknown, auth_loan_held, closed, reserved0;
} ynx_link_ide_get_lifetime_v1;

/* SAME original ticket/context; actor-only claim and original Source check.
 * Adopt a nonnull partial client before interpreting any return code. One
 * attempt only: failed or UNKNOWN claims cannot be retried or reminted. */
int32_t ynx_link_ide_finite_get_open_original_v1(
 ynx_auth_ide_finite_get_ticket_v1 *, ynx_link_ide_finite_get_v4_client **);
/* Full original Auth Source/FD/math check on its original actor only. Worker
 * TLS write checks the actual loan's bounded native prewrite fence separately. */
int32_t ynx_link_ide_finite_get_current_original_v1(ynx_link_ide_finite_get_v4_client *);
/* Wait/probe for the same one attempt. Adopt nonnull packet before status.
 * Repeated probes return that same ownership, not extra packet references. */
int32_t ynx_link_ide_finite_get_wait_original_v1(
 ynx_link_ide_finite_get_v4_client *, uint32_t, ynx_link_ide_finite_get_v4_packet **);
int32_t ynx_link_ide_finite_get_packet_view_v1_read(
 ynx_link_ide_finite_get_v4_client *, const ynx_link_ide_finite_get_v4_packet *,
 ynx_link_ide_get_packet_view_v1 *);
int32_t ynx_link_ide_finite_get_packet_release_v1(
 ynx_link_ide_finite_get_v4_client *, ynx_link_ide_finite_get_v4_packet *);
/* Seal SAME Auth loan and original transport. No retry, redirect or resend. */
int32_t ynx_link_ide_finite_get_abort_original_v1(ynx_link_ide_finite_get_v4_client *);
/* Bounded real worker/SSL/socket join. DRAINING is progress, not a first
 * cause. A timeout retains the exact client, packet and Auth/Source debts. */
int32_t ynx_link_ide_finite_get_join_original_v1(
 ynx_link_ide_finite_get_v4_client *, uint32_t, uint8_t *completed);
/* Cleanup-only after expiry/revoke. Release original Auth loan once only
 * after physical join and all packet debt. completed may accompany an error;
 * caller must inspect both without discarding the original first cause. */
int32_t ynx_link_ide_finite_get_close_original_v1(
 ynx_link_ide_finite_get_v4_client *, uint8_t *completed);
int32_t ynx_link_ide_finite_get_free_original_v1(ynx_link_ide_finite_get_v4_client *);
int32_t ynx_link_ide_finite_get_lifetime_v1_read(
 const ynx_link_ide_finite_get_v4_client *, ynx_link_ide_get_lifetime_v1 *);
int32_t ynx_link_ide_finite_get_first_error_v1(
 ynx_link_ide_finite_get_v4_client *, ynx_link_ide_get_failure_v1 *);

#ifdef __cplusplus
}
#endif
#endif
