#ifndef YNX_SOURCE_ORIGINAL_RESOURCE_OWNER_H
#define YNX_SOURCE_ORIGINAL_RESOURCE_OWNER_H
#include "ynx_source_administration_owner.h"
/* Private selected Native executor. Input administration is recognized by its
 * own inventory and actual policy/resource current; no pointer grants entry. */
typedef struct ynx_original_executor ynx_original_executor;
typedef enum {YNX_EXEC_RESERVED=1,YNX_EXEC_ENTERED=2,YNX_EXEC_BURNED=3,YNX_EXEC_ALLOCATED=4,YNX_EXEC_CAS=5,YNX_EXEC_TERMINAL=6} ynx_executor_phase;
veil_store_status ynx_original_executor_acquire(ynx_administration_owner *,ynx_original_bytes,uint64_t,ynx_original_executor **);
veil_store_status ynx_original_executor_current(ynx_original_executor *);
veil_store_status ynx_original_executor_advance(ynx_original_executor *,ynx_executor_phase,ynx_original_bytes);
veil_store_status ynx_original_executor_original(ynx_original_executor *,ynx_original_bytes *,ynx_executor_phase *);
/* UNKNOWN recovery observes the same durable intent; never starts new work. */
veil_store_status ynx_original_executor_observe(ynx_original_executor *,ynx_executor_phase *);
veil_store_status ynx_original_executor_close(ynx_original_executor **);
/* Private NativeCore registered-resource PARTIAL custody. Unlike the
 * administration executor, this type never borrows an administration grant.
 * A current observation does not admit a store, allocator/floor or projection. */
typedef struct ynx_native_core_resource_loan ynx_native_core_resource_loan;
veil_store_status ynx_native_core_resource_acquire_v2(void *,ynx_native_core_resource_loan **);
veil_store_status ynx_native_core_resource_acquire(void *same_core_policy,ynx_native_core_resource_loan **);
veil_store_status ynx_native_core_resource_observe_current(ynx_native_core_resource_loan *);
veil_store_status ynx_native_core_resource_close(ynx_native_core_resource_loan **);
/* Cleanup-only original cause, no business current or Ready projection. */
veil_store_status ynx_native_core_resource_first_cause(ynx_native_core_resource_loan *);
/* Same NativeCore operation's authenticated original participant custody.
 * Not an enforcing owner: qualification needs the separately registered,
 * actual key-use/current/revoke/head/floor owning execution primitive. */
typedef struct ynx_native_core_participant ynx_native_core_participant;
typedef struct ynx_native_core_participant_originals_v2 {
 uint32_t version,purpose;uint64_t storage_generation,deadline;
 unsigned char intent_digest[32];
 ynx_original_bytes approval,issuer_current,anchor_current,association,account,operation;
 ynx_original_bytes origin[6],accepted_relation;
} ynx_native_core_participant_originals_v2;
_Static_assert(sizeof(ynx_native_core_participant_originals_v2)==264,"participant originals264");
veil_store_status ynx_native_core_participant_acquire_v2(void *,ynx_native_core_participant **);
veil_store_status ynx_native_core_participant_current(ynx_native_core_participant *);
veil_store_status ynx_native_core_participant_retain_for_policy(ynx_native_core_participant *,void *);
veil_store_status ynx_native_core_participant_release_borrow(ynx_native_core_participant *);
veil_store_status ynx_native_core_participant_close(ynx_native_core_participant **);
/* Private actual file persistence, never resource admission. Controlled
 * directory fd and integrity key come from the original resource holder.
 * Create is O_EXCL; restore never creates; ENTERED survives close/restart.
 * Caller still holds independent current/revoke/floor fence. */
typedef struct ynx_native_core_pending ynx_native_core_pending;
veil_store_status ynx_native_core_pending_create(int,const unsigned char[32],ynx_original_bytes,ynx_native_core_pending **);
veil_store_status ynx_native_core_pending_restore(int,const unsigned char[32],ynx_native_core_pending **);
veil_store_status ynx_native_core_pending_validate_enter(ynx_native_core_pending *,const unsigned char[32],ynx_original_bytes);
veil_store_status ynx_native_core_pending_enter(ynx_native_core_pending *,const unsigned char[32],ynx_original_bytes);
veil_store_status ynx_native_core_pending_observe(ynx_native_core_pending *,uint32_t *);
veil_store_status ynx_native_core_pending_close(ynx_native_core_pending **);

struct ynx_native_core_enforcing_binding_v2;
veil_store_status ynx_native_core_pending_matches(ynx_native_core_pending *,const struct ynx_native_core_enforcing_binding_v2 *);
/* Same original opaque resource owner; NOT a new accepted/Core wrapper.
 * Factory verifies same policy/participant/wrap and real release-selected
 * domain stores/integrity/floor resources. Empty registration remains REQUIRED.
 * This first domain-driver increment does not produce final/admission output.
 * Non-OK + non-NULL must be retained and closed by existing resource_close.
 * Driver CURRENT observes actual protected domain originals; not ProductReady.
 */
struct ynx_android_core_wrap;
veil_store_status ynx_native_core_resource_driver_factory_v2(void *,
 ynx_native_core_participant *,struct ynx_android_core_wrap *,int restore,
 ynx_native_core_resource_loan **);
veil_store_status ynx_native_core_resource_driver_current(ynx_native_core_resource_loan *);
veil_store_status ynx_native_core_resource_driver_reserve(ynx_native_core_resource_loan *);
/* Facts-only query. UNKNOWN remains sticky. No phase change or replay. */
veil_store_status ynx_native_core_resource_driver_query_exact(ynx_native_core_resource_loan *,
 unsigned char originals[2][352]);

/* Factory v3 has NO caller restore bit. Both initialization and restore callers
 * pass the SAME retained policy/participant/wrap. Exact registered durable
 * phase determines runnable versus read-only UNKNOWN recovery, never purpose
 * or operation integers. There is no create/migrate fallback. */
veil_store_status ynx_native_core_resource_driver_factory_v3(void *,
 ynx_native_core_participant *,struct ynx_android_core_wrap *,
 ynx_native_core_resource_loan **);
/* PRIVATE storage transaction facts only, NOT permission/capability. Ciphertext
 * is produced by the existing controlled storage seal, not JS plaintext/key.
 * All rows include ratchet records and the queue in the SAME SQL transaction.
 * Record selectors are binary exact Native names, never SQL/path fragments. */
typedef struct ynx_native_core_cipher_cas {
 ynx_original_bytes name,previous_ciphertext,next_ciphertext;
 uint64_t previous_version,next_version;
 unsigned char storage_nonce[12];
} ynx_native_core_cipher_cas;
/* Persist an exact nonce INTENT before sealing. OK here is durable reservation
 * only, NOT a nonce allocation proof; this API deliberately outputs no nonce.
 * Protected counter adjudication is separately required before effect. */
veil_store_status ynx_native_core_resource_driver_nonce_intent(ynx_native_core_resource_loan *);
/* Whole transaction current/nonce/effect identity and full byte CAS, no replay.
 * This private entry cannot manufacture independent floor/final/projection. */

/* Exact readback after any uncertainty, no mutations or permission outputs. */
veil_store_status ynx_native_core_resource_driver_effect_query(
 ynx_native_core_resource_loan *,unsigned char *,size_t,size_t *);
/* Uses the same registered coordinator as reservation/effect; no key use after
 * selected cancel. Cannot undo an already entered irreversible commit. */
veil_store_status ynx_native_core_resource_driver_cancel(ynx_native_core_resource_loan *);

struct ynx_storage_expected;
typedef struct ynx_native_core_plain_cas {
 const struct ynx_storage_expected *expected;
 ynx_original_bytes previous_ciphertext,plaintext;
} ynx_native_core_plain_cas;
/* Same source-controlled key use plus all record/ratchet/queue CAS. Exact
 * expected metadata are ordinary private facts, never rights or key material.
 * Driver replaces the nonce with its independently verified reserved value.
 * Plaintext copies are held only in mlocked mappings and wiped on close. */
veil_store_status ynx_native_core_resource_driver_protected_ratchet(
 ynx_native_core_resource_loan *,const ynx_native_core_plain_cas *,size_t);

/* Existing resource's typed FirstDevice initialization only. AAD is constructed
 * from its actual same-owner originals, never a caller DTO/guess. Exact
 * plaintext/id/request/generation are reborrowed inside from SAME SDK policy.
 * Seal once under named protected nonce reservation; no CAS/queue/finish here.
 * Ciphertext is immutable borrowed until same resource cleanup, including
 * late refusal. Failed query leaves output untouched. No grant output. */
#include "ynx_storage_initialization_aad_private.h"
/* v2 has NO caller expected/AAD/row operand. SAME actual participant264 and
 * initialization96 originals construct typed AAD; registered SQL row absence
 * and protected nonce are checked under the existing joint fence. */
veil_store_status ynx_native_core_resource_driver_seal_initialization_v2(ynx_native_core_resource_loan *);
veil_store_status ynx_native_core_resource_driver_initialization_aad_query(ynx_native_core_resource_loan *,ynx_storage_initialization_aad_v1 *);
veil_store_status ynx_native_core_resource_driver_initialization_ciphertext_borrow(
 ynx_native_core_resource_loan *,ynx_original_bytes *);

/* Protected independent counter/floor checkpoint, not a Source final or M3
 * terminal. It cannot return qualified projection/accepted capability. */
veil_store_status ynx_native_core_resource_driver_checkpoint(ynx_native_core_resource_loan *);
/* SAME real normal checked-store finish + retained source history observation.
 * No row index, hash DTO, restore flag or signing permission is accepted.
 * Imports the complete already sealed ordered journal, never reseals it.
 * All RECORD rows are the ratchet set; the authenticated final QUEUE is unique.
 * Global state revisions/hashes belong to finish's original operation, NOT an
 * arbitrary row. Source role is used only for original head/sequence facts;
 * its legacy signing rights never authorize any Message3 key operation.
 * core_engine_binding is inserted with core_effect and all CAS in one COMMIT.
 * Non-OK may retain finish/SQL observations; close original loan, no replay. */
struct ynx_source_role_hold;
veil_store_status ynx_native_core_resource_driver_commit_engine_original(
 ynx_native_core_resource_loan *,veil_native_finish_result *,struct ynx_source_role_hold *);
/* Exact typed readback only. No permission output. Output fixed416B documented
 * in ENGINE_BINDING_LAYOUT.md; journal/source frame are independently queried.
 * Never synthesize a binding for an old untyped core_effect. */
veil_store_status ynx_native_core_resource_driver_engine_binding_query(
 ynx_native_core_resource_loan *,unsigned char *,size_t,size_t *);
/* Borrowed checked-store finish of THIS durably committed engine only. No
 * permission/Accepted result. Caller already owns the resource for this call. */
veil_store_status ynx_native_core_resource_driver_committed_finish_borrow(
 ynx_native_core_resource_loan *,veil_native_finish_result **);
/* Same finish + actual independent three-retire qualification. These borrow
 * counts protect lifetime only; they never grant any authority. */
veil_store_status ynx_native_core_resource_driver_final_retain(
 ynx_native_core_resource_loan *,veil_native_finish_result *);
veil_store_status ynx_native_core_resource_driver_final_current(
 ynx_native_core_resource_loan *,veil_native_finish_result *);
veil_store_status ynx_native_core_resource_driver_final_release(ynx_native_core_resource_loan *);
/* PRE-GUARD original-resource lifetime only: no signature/final prerequisite,
 * no admission/lease/intent constructor. The same real policy is mandatory.
 * Borrowed originals/path remain valid only until this borrow is released. */
veil_store_status ynx_native_core_resource_driver_prepared_retain(
 ynx_native_core_resource_loan *,void *same_policy);
veil_store_status ynx_native_core_resource_driver_prepared_current(
 ynx_native_core_resource_loan *,void *same_policy);
veil_store_status ynx_native_core_resource_driver_prepared_originals_borrow(
 ynx_native_core_resource_loan *,void *same_policy,
 const ynx_native_core_participant_originals_v2 **);
veil_store_status ynx_native_core_resource_driver_prepared_store_borrow(
 ynx_native_core_resource_loan *,void *same_policy,const char **,
 uint64_t *device,uint64_t *inode);
veil_store_status ynx_native_core_resource_driver_prepared_release(
 ynx_native_core_resource_loan *);
#include "ynx_native_core_store_readonly_private.h"
#include "ynx_native_core_initialization_journal_private.h"
#include "ynx_native_core_initialization_write_private.h"
#include "ynx_initialization_finish_private.h"
#endif
