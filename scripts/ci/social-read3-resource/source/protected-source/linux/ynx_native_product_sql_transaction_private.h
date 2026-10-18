#ifndef YNX_NATIVE_PRODUCT_SQL_TRANSACTION_PRIVATE_H
#define YNX_NATIVE_PRODUCT_SQL_TRANSACTION_PRIVATE_H
#include "ynx_native_product_record_limits.h"
#include "ynx_source_original_resource_owner.h"
typedef struct ynx_product_sql_transaction ynx_product_sql_transaction;
typedef struct {uint32_t version,state,ended,owner_unknown;int32_t first_cause;uint32_t cleanup_only;} ynx_product_sql_outcome_v1;
/* Registered-store SQL staging custody only. The genuine C product source owns
 * parent/root/current. No raw DB, keys, path or callback can construct this.
 * Begin is not a protected commit or JNI records-provider completion. */
veil_store_status ynx_product_sql_begin_v1(ynx_native_core_resource_loan *,const ynx_native_core_device_binding_v2 *,const unsigned char same_store_ref[32],ynx_product_sql_transaction **);
veil_store_status ynx_product_sql_current_v1(ynx_product_sql_transaction *);
veil_store_status ynx_product_sql_namespace_current_v1(ynx_product_sql_transaction *,uint32_t);
veil_store_status ynx_product_sql_write_current_v1(ynx_product_sql_transaction *);
/* Namespace-keyed opaque index through actual retained storage key owner.
 * UTF8/product-ID canonical validation is owned by the staging caller. */
veil_store_status ynx_product_sql_selector_v1(ynx_product_sql_transaction *,uint32_t,const unsigned char *,size_t,unsigned char out[32]);
/* Exact encrypted predecessor for CAS. Private storage primitive only: it
 * returns no plaintext/key/authority and does not imply a committed outcome.
 * Caller receives outputs only after both current fences succeed. */
veil_store_status ynx_product_sql_cipher_original_v1(ynx_product_sql_transaction *,const unsigned char selector[32],unsigned char *,size_t,size_t *,uint64_t *,uint32_t *);
/* End only the staging SQL snapshot, then execute the ORIGINAL reserve,
 * durable nonce and independently observed counter burn, and open the actual
 * effect transaction. Once-only even on failure; no COMMIT/end claim here. */
veil_store_status ynx_product_sql_prepare_write_once_v1(ynx_product_sql_transaction *);
/* Compare the captured exact CAS predecessor AGAIN after nonce preparation.
 * Mismatch keeps UNKNOWN; it never substitutes a newer local version. */
veil_store_status ynx_product_sql_recheck_original_v1(ynx_product_sql_transaction *,const unsigned char selector[32],const unsigned char *,size_t,uint64_t,uint32_t);
/* Native-only input from captured staging originals. No caller-provided AAD,
 * key, nonce or authority. A ciphertext output is BORROWED from the same q and
 * remains there on every late error until original resource cleanup. */
typedef struct {uint32_t namespace_id,tombstone,previous_found;ynx_original_bytes id,json,previous_cipher;uint64_t previous_version;unsigned char selector[32];} ynx_product_seal_input_v1;
veil_store_status ynx_product_sql_seal_once_v1(ynx_product_sql_transaction *,uint32_t index,const ynx_product_seal_input_v1 *,ynx_original_bytes *out_borrowed_cipher);
/* Internal actual ciphertext CAS + full map + two authenticated heads.
 * Local storage phase ONLY. Return0 is NOT ended/FINALIZED/JNI finish(true).
 * No retry or rollback after entry; later independent floor/end proof required. */
veil_store_status ynx_product_sql_commit_local_once_v1(ynx_product_sql_transaction *,const ynx_native_core_cipher_cas *,size_t);
/* Only this complete phase may construct committed+ended, after actual
 * original floor certificates and paired independent durable terminal readback. */
veil_store_status ynx_product_sql_end_once_v1(ynx_product_sql_transaction *);
/* Cleanup-only, at most one invocation. Never commits staged plaintext and
 * never retries/finishes a previous uncertain transaction. */
veil_store_status ynx_product_sql_rollback_once_v1(ynx_product_sql_transaction *);
/* Facts, not authority: 0 open / 1 paired end+CP+effect readback /
 * 2 actual rollback+ended / 3 unknown. Sticky owner uncertainty is separate. */
veil_store_status ynx_product_sql_outcome_v1_query(ynx_product_sql_transaction *,ynx_product_sql_outcome_v1 *);
/* Inventory-only diagnostic; never current/authority or outcome promotion. */
veil_store_status ynx_product_sql_first_cause_v1(ynx_product_sql_transaction *);
veil_store_status ynx_product_sql_drop_v1(ynx_product_sql_transaction **);
/* Private normal account-record read: decrypt only inside retained original
 * key owner; plaintext sink is cleared on any late error. No raw key export. */
veil_store_status ynx_product_sql_read_json_v1(ynx_product_sql_transaction *,uint32_t,const unsigned char *,size_t,unsigned char *,size_t,size_t *,uint32_t *);
/* Private enumerated IDs, BE32 length + UTF8; at most4096/current class.
 * Every row AEAD-opened and its key-owned selector rechecked, no plaintext DB IDs. */
veil_store_status ynx_product_sql_ids_v1(ynx_product_sql_transaction *,uint32_t,unsigned char *,size_t,size_t *,uint32_t *);
/* Actual COMMIT of a pure-read SQL snapshot, no protected write terminal,
 * nonce/seal/CAS/checkpoint effect. No replay after any ambiguous result. */
veil_store_status ynx_product_sql_read_end_once_v1(ynx_product_sql_transaction *);
/* For cipher_original/read_json only: NULL sink + capacity0 requests exact
 * size under the same current snapshot (JSON probe still AEAD-opens privately).
 * Full read rechecks exact size/version; no caller plaintext is published by a probe. */
#endif
