#ifndef YNX_SOURCE_SEALED_ROLE_LAUNCHER_H
#define YNX_SOURCE_SEALED_ROLE_LAUNCHER_H
#include "ynx_tpm2_esys_owner.h"
#include "../source_server_private.h"
#include "../ynx_message_platform_owner.h"
int ynx_source_dedicated_protection_enter(void);
typedef struct ynx_source_sealed_role_owner ynx_source_sealed_role_owner;
/* Dedicated-process primitive custody only, never enrollment or Source admission.
 * Normal caller must verify credential and resolve independently enrolled resources
 * BEFORE this explicit composition entry. Never invoke on an arbitrary Go worker. */
int ynx_source_sealed_role_dedicated_open(const ynx_tpm2_resource_selection *,ynx_source_sealed_role_owner **);
int ynx_source_sealed_role_current(ynx_source_sealed_role_owner *);
int ynx_source_sealed_role_wrapping_open(ynx_source_sealed_role_owner *,ynx_source_wrapping_owner **);
int ynx_source_sealed_role_close(ynx_source_sealed_role_owner **);
/* Existing schema has no authenticated TPM enrollment association. Exact signed
 * credential bytes are retained by Rust; resolver MUST refuse until genuine
 * original enrollment mapping is supplied. No keyAlias/config/pointer fallback. */
typedef struct {const uint8_t *raw;size_t n;uint32_t role,purpose;uint64_t monotonic_deadline_ns;int64_t not_before_ms,expires_ms;} ynx_source_verified_credential_input;
/* Synchronous private borrowed facts only, NEVER enrollment. Must not retain raw.
 * Remaining budget is inherited from original verification, never recomputed. */
int ynx_source_sealed_role_monotonic_ns(uint64_t *);
int ynx_source_sealed_role_resolve_open(const ynx_source_verified_credential_input *,ynx_source_sealed_role_owner **);
/* Separate private Message3 primitive custody path. Original enrollment is
 * already verified by the retained Native startup borrower; the MU areas and
 * exact named selection are independently checked again here. Neither this
 * result nor an attestation mathematical OK is domain/floor admission. */
typedef struct {
 const ynx_message_enrollment_public_input *enrollment;
 int64_t not_before_ms,expires_ms;
} ynx_message_sealed_custody_input;
int ynx_source_message_sealed_open(const ynx_message_sealed_custody_input *,ynx_source_sealed_role_owner **);
/* Scoped decoded original fields from the Rust-verified enrollment borrow.
 * fields[0..8]: object/salt/AK/NV public, object/counter policy, PCR selection,
 * PCR digest; fields[8..13]: object/salt/AK/qualified-AK/counter Name (34 bytes).
 * Device 0=/dev/tpmrm0, 1=/dev/tpm0. No URI, alias or public pointer grants. */
typedef struct ynx_message_sealed_raw_input {
 uint32_t device,handles[4];ynx_message_bytes fields[13];
 uint64_t counter_floor,monotonic_deadline_ns;int64_t not_before_ms,expires_ms;
} ynx_message_sealed_raw_input;
int ynx_source_message_sealed_open_raw(const ynx_message_sealed_raw_input *,ynx_source_sealed_role_owner **);
/* Fresh Native nonce, actual Quote/NV_Certify and selected-original verification.
 * Observation only; never clears uncertainty, renews budget or grants custody. */
int ynx_source_message_sealed_observe_raw(ynx_source_sealed_role_owner *,const ynx_message_sealed_raw_input *);
/* Independent transport-client primitive. The caller supplies a DISTINCT
 * named client sealed owner; never reuse issuer/anchor wrapping custody.
 * Imports only into the dedicated locked native TLS context, no key export. */
struct ssl_ctx_st;
int ynx_source_sealed_client_context_key(ynx_source_sealed_role_owner *,struct ssl_ctx_st *);
#endif
