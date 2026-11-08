#ifndef YNX_LINK_IDE_FINITE_GET_FINISH_PRIVATE_V1_H
#define YNX_LINK_IDE_FINITE_GET_FINISH_PRIVATE_V1_H
#include "ide_finite_get_transport_v1.h"
#ifdef __cplusplus
extern "C" {
#endif

/* PRIVATE SAME original Native request completion. This is NOT the historical
 * standard-Go-TLS ticket sender, a JS bool/close acknowledgement, business
 * success, or a new dispatch. The genuine Auth request-custody owner retains
 * the exact ticket AND process-unique LINK client returned by its normal open;
 * neither pointer is a JS argument/setter. Another path/op-equivalent request
 * cannot substitute for that original pair.
 *
 * The original claim/base loan must still hold the live ticket on entry.
 * Auth may free/reuse its ticket addresses after loan drain, so a previously
 * closed/base-released client is NEVER accepted for another finish success.
 * finished=1 is returned only on this invocation's known physical completion
 * transition. The Auth owner may cache this actual returned result on the SAME
 * request, not reconstruct it from Target.close or a different client.
 *
 * A not-ready response or retained packet is DRAINING; no retire/drop/retry is
 * performed. Consumer releases its exact observed packet explicitly first.
 * The function then retires/joins/closes the existing sender only; it never
 * calls open/claim, Auth abort, signs, or sends any new request. Timeout and
 * ordinary DRAINING do not become sticky first causes. Late/partial/UNKNOWN
 * may physically clean up but always return finished=0. All flags are observed
 * DATA, with physical cleanup separate from known read completion/authority.
 * Full Auth current is actor-only; call on the original Cocoa/NAPI actor,
 * outside Source/Store/transport locks. Native/JS child debts and business
 * Source final fences are still owned independently by Auth/SDK.
 */
typedef struct {
 uint32_t version, size;
 uint8_t finished, physical_complete, response_known, response_released;
 uint8_t worker_joined, auth_loan_held, cleanup_unknown, reserved0;
 int32_t first_code, native_code, system_errno, auth_code;
} ynx_link_ide_get_finish_status_v1;

int32_t ynx_link_ide_finite_get_finish_ticket_original_v1(
 ynx_auth_ide_finite_get_ticket_v1 *original_ticket,
 ynx_link_ide_finite_get_v4_client *original_client,
 uint32_t timeout_ms,
 ynx_link_ide_get_finish_status_v1 *observed);

#ifdef __cplusplus
}
#endif
#endif
