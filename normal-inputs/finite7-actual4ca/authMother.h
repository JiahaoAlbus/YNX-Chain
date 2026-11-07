#ifndef YNX_IDE_FINITE_GET_AUTH_MOTHER_V1_H
#define YNX_IDE_FINITE_GET_AUTH_MOTHER_V1_H
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
/* PRIVATE same-image Auth->LINK ABI, not a public Source/provider API.
 * No caller URL/header/approval callback or generic void* context is accepted.
 * Only the original Auth constructor can mint these recognized opaque types. */
typedef struct ynx_auth_ide_finite_get_ticket_v1 ynx_auth_ide_finite_get_ticket_v1;
typedef struct ynx_auth_ide_finite_get_loan_v1 ynx_auth_ide_finite_get_loan_v1;
typedef struct ynx_auth_ide_finite_get_credential_v1 ynx_auth_ide_finite_get_credential_v1;
typedef struct {const uint8_t*data;size_t size;} ynx_auth_ide_get_bytes_v1;
typedef struct {ynx_auth_ide_get_bytes_v1 realm,tenant,kind,id,revision;} ynx_auth_ide_get_full_ref_v1;
enum {YNX_AUTH_IDE_GET_OK=0,YNX_AUTH_IDE_GET_PENDING=1,YNX_AUTH_IDE_GET_DENIED=2,YNX_AUTH_IDE_GET_UNKNOWN=3,YNX_AUTH_IDE_GET_NOT_SUPPLIED=71};
typedef struct {
 uint32_t version,size;
 ynx_auth_ide_get_bytes_v1 service_origin,server_name,original_path,original_operation_id;
 ynx_auth_ide_get_full_ref_v1 registered_cloud;
 uint16_t port;uint16_t reserved0;uint32_t response_header_limit,response_entity_limit;
 uint8_t expected_spki_der_sha256[32];
 uint64_t expires_unix_ms,expires_monotonic_ns;
 /* Original PRIVATE V4 header value from SAME registered DEVICE/proof child.
  * No signing or header export to JS is performed by LINK. */
 ynx_auth_ide_get_bytes_v1 original_v4_proof_header;
 const ynx_auth_ide_finite_get_credential_v1*credential;
} ynx_auth_ide_finite_get_view_v1;
typedef struct {
 uint32_t version,size;
 ynx_auth_ide_get_bytes_v1 root_certificate_pem;
 uint8_t root_certificate_sha256[32];
 uint64_t registered_root_epoch,registered_root_until_unix_ms;
 /* Actual independent same-purpose PQ TLS credential. Native FD loans only,
  * never JS bytes, DEVICE signing keys or a generic TLS/provider callback.
  * Auth keeps both original FDs open through LINK physical completion. LINK
  * uses its ORIGINAL fixed OpenSSL/PQ ctx callee; it must not close these FDs.
  * No private-key read/hash occurs in Auth's projection/current fence. */
 int32_t client_certificate_fd,client_private_key_fd;
 ynx_auth_ide_get_bytes_v1 local_san,peer_san;
 uint8_t client_certificate_sha256[32];
 uint64_t registered_credential_epoch,registered_credential_until_unix_ms;
} ynx_auth_ide_finite_get_credential_view_v1;

/* Claim exactly once for the SAME original ticket/context. Nonnull partial
 * loan is adopted before status. Failed claims cannot be retried/reminted. */
int32_t ynx_auth_ide_finite_get_claim_original_v1(ynx_auth_ide_finite_get_ticket_v1*,ynx_auth_ide_finite_get_loan_v1**);
int32_t ynx_auth_ide_finite_get_loan_retain_v1(ynx_auth_ide_finite_get_loan_v1*);
/* Full original Source/current/FD/math: ORIGINAL Cocoa actor only, outside
 * LINK locks. Not callable on transport worker. */
int32_t ynx_auth_ide_finite_get_current_original_v1(ynx_auth_ide_finite_get_ticket_v1*);
/* Worker-safe: native atomics + monotonic deadline only; no NAPI/IO/ownerlock.
 * False seals SAME loan permanently. This is an observed finite write fence,
 * NOT a fresh Root check or cross-service revocation atomicity claim. */
int32_t ynx_auth_ide_finite_get_prewrite_current_v1(const ynx_auth_ide_finite_get_loan_v1*);
int32_t ynx_auth_ide_finite_get_loan_view_v1(const ynx_auth_ide_finite_get_loan_v1*,ynx_auth_ide_finite_get_view_v1*);
int32_t ynx_auth_ide_finite_get_credential_view_v1_read(const ynx_auth_ide_finite_get_credential_v1*,ynx_auth_ide_finite_get_credential_view_v1*);
/* Retire/abort never releases parent custody. Release is cleanup-only and
 * permitted after expiry/revoke. LINK calls it ONCE only after physicaljoin
 * and every packet view/release debt cleared. Separate free prevents ABA. */
int32_t ynx_auth_ide_finite_get_abort_original_v1(ynx_auth_ide_finite_get_ticket_v1*);
int32_t ynx_auth_ide_finite_get_loan_release_v1(ynx_auth_ide_finite_get_loan_v1*,uint8_t*released);
int32_t ynx_auth_ide_finite_get_loan_free_v1(ynx_auth_ide_finite_get_loan_v1*);
int32_t ynx_auth_ide_finite_get_first_error_v1(const ynx_auth_ide_finite_get_ticket_v1*);
#ifdef __cplusplus
}
#endif
#endif
