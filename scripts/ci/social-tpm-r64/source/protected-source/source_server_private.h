#ifndef YNX_SOURCE_SERVER_PRIVATE_H
#define YNX_SOURCE_SERVER_PRIVATE_H
#include "veil_classic_protection.h"
typedef struct ynx_source_wrapping_owner ynx_source_wrapping_owner;
/* Private native credential custody, NOT provisioning or source admission.
 * Candidate reload-only port. Caller retains original credential FD. */
int ynx_source_wrapping_open(int credential_fd, ynx_source_wrapping_owner **out);
struct ynx_tpm2_owner;
/* Primitive storage custody, not enrollment: same-thread locked secret borrow. */
int ynx_tpm2_wrapping_custody_retain(struct ynx_tpm2_owner *);
int ynx_tpm2_wrapping_custody_release(struct ynx_tpm2_owner *);
int ynx_source_wrapping_from_tpm(struct ynx_tpm2_owner *,ynx_source_wrapping_owner **out);
/* Same-thread primitive readiness only. Cancellation/cleanup/current failure
 * cannot restore wiped key state; this does not prove domain admission. */
int ynx_source_wrapping_current(ynx_source_wrapping_owner *);
int ynx_source_wrapping_close(ynx_source_wrapping_owner **owner);
int ynx_source_reload_records(ynx_source_wrapping_owner *,const veil_own_binding *,
 const uint8_t pq[2592],const veil_own_record *,const veil_classic_record *,
 uint8_t classic[256],size_t *written,veil_pq_custodian **out);
#endif
