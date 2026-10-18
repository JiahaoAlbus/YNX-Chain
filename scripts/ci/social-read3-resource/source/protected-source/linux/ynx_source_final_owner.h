#ifndef YNX_SOURCE_FINAL_OWNER_H
#define YNX_SOURCE_FINAL_OWNER_H
#include "../ynx_source_platform_private.h"
/* Concrete custody of the SAME checked finish/guard/pin/CAS. Reserve before
 * terminal invocation. Local committed SQL is not independent qualification. */
veil_store_status ynx_final_hold_reserve(veil_native_finish_result *,ynx_platform_final_hold **);
veil_store_status ynx_final_hold_refuse(ynx_platform_final_hold *,veil_store_status);
veil_store_status ynx_final_hold_current(ynx_platform_final_hold *);
veil_store_status ynx_final_hold_close(ynx_platform_final_hold **);
/* Implemented inside the checked-store TU; no raw SQL, installer or callback
 * is accepted. Inventory recognizes RAM; the actual finish retains all owners. */
veil_store_status ynx_finish_original_retain(veil_native_finish_result *,veil_native_finish_result **,const veil_native_intent_handle **);
veil_store_status ynx_finish_original_current(veil_native_finish_result *);
/* Exact held core commit facts, not a signed body or device authority. The
 * receipt/cipher spans borrow the same finish guard; no plaintext/key escapes. */
typedef struct {
 char operation[37],account[513],device[513],identity[513],storage_key[513];
 char base_hash[65],next_hash[65],cipher_hash[65];
 int64_t base_revision,next_revision,authorization_generation;
 uint32_t journal_steps;unsigned char journal_digest[32];
 ynx_core_origin_original origin;
 const unsigned char *receipt,*ciphertext,*journal;
 size_t receipt_size,ciphertext_size,journal_size;
 /* Same immutable verified Source intent subtype, never inferred from journal. */
 uint32_t native_kind;
} ynx_finish_commit_original;
veil_store_status ynx_finish_original_commit_borrow(veil_native_finish_result *,ynx_finish_commit_original *);

/* Transfer cleanup custody only; current/borrow must reject the refusal. */
veil_store_status veil_private_verified_commit_adopt_partial(ynx_platform_final_hold **,const veil_native_intent_handle *,veil_store_status,veil_native_verified_commit **);
/* Only the concrete original resource driver can qualify the same checked
 * finish. Late non-OK publishes its real partial hold for cleanup. */
struct ynx_native_core_resource_loan;
veil_store_status ynx_final_hold_reserve_qualified(
 struct ynx_native_core_resource_loan *,veil_native_finish_result *,ynx_platform_final_hold **);
veil_store_status ynx_final_hold_bind_qualified(ynx_platform_final_hold *,
 struct ynx_native_core_resource_loan *);
/* Private same-owner borrow; valid only under a retained verified commit. */
veil_store_status ynx_final_hold_product_resource_borrow(ynx_platform_final_hold *,struct ynx_native_core_resource_loan **);
#endif
