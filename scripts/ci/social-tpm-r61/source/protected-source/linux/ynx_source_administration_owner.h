#ifndef YNX_SOURCE_ADMINISTRATION_OWNER_H
#define YNX_SOURCE_ADMINISTRATION_OWNER_H
#include "../ynx_source_platform_private.h"
typedef struct ynx_administration_owner ynx_administration_owner;
/* Same exclusive startup loan, retained by its parent backend until close.
 * Policy coordinates are expectations ONLY; never a floor/head capability. */
typedef struct ynx_administration_head_expectation{uint64_t generation;unsigned char head[32];} ynx_administration_head_expectation;
veil_store_status ynx_administration_acquire(void *same_startup,uint32_t role,ynx_original_bytes exact_row,ynx_administration_owner **);
veil_store_status ynx_administration_current(ynx_administration_owner *);
veil_store_status ynx_administration_original(ynx_administration_owner *,ynx_original_bytes *);
/* Exact operation bytes remain held across uncertainty. This entry cannot
 * publish an admitted row without the genuine protected head transaction. */
veil_store_status ynx_administration_registration_commit(ynx_administration_owner *,ynx_original_bytes exact_operation);
/* Normal factory derives the immutable private intent from its held row and
 * selected policy. No Auth/public caller supplies Expected or replacement raw. */
veil_store_status ynx_administration_register_original(ynx_administration_owner *);
veil_store_status ynx_administration_close(ynx_administration_owner **);
/* Concrete same-administration domain execution loan; all outputs are custody
 * under the original current/revoke policy and registered resource binding. */
typedef struct ynx_administration_execution_loan ynx_administration_execution_loan;
veil_store_status ynx_administration_execution_acquire(ynx_administration_owner *,ynx_original_bytes,uint64_t,ynx_administration_execution_loan **);
veil_store_status ynx_administration_execution_current(ynx_administration_execution_loan *);
veil_store_status ynx_administration_execution_advance(ynx_administration_execution_loan *,uint32_t,ynx_original_bytes);
veil_store_status ynx_administration_execution_observe(ynx_administration_execution_loan *,uint32_t *);
veil_store_status ynx_administration_execution_close(ynx_administration_execution_loan **);
/* Shared private journal I/O mechanics, not an administration or Core grant.
 * The owning caller keeps its own purpose/current/floor guard and begins the
 * transaction before apply. No key, SQLite handle or success leaves as a cap. */
struct sqlite3;
veil_store_status ynx_private_domain_journal_read(struct sqlite3 *,const unsigned char key_identity[32],unsigned char original[352]);
veil_store_status ynx_private_domain_journal_apply(struct sqlite3 *,const unsigned char key_identity[32],const unsigned char previous[352],const unsigned char next[352]);
#endif
