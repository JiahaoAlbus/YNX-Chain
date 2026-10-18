#ifndef YNX_NATIVE_CORE_INITIALIZATION_WRITE_PRIVATE_H
#define YNX_NATIVE_CORE_INITIALIZATION_WRITE_PRIVATE_H
#include "ynx_source_original_resource_owner.h"
/* Same recognized Core resource owns this intent/lease/ordered-step attempt.
 * No public intent, lease, hash, path, success flag or optional callback operand.
 * Prepare binds actual528 AAD + canonical one-record journal + registered store
 * after genuine Core/policy/participant/wrap/current; an internal prepared
 * borrow prevents parent close. Missing registered resources still refuse.
 * It creates NO catalog Actor/device/session/final/Source grant. */
enum ynx_core_initialization_write_stage {
 YNX_INIT_UNPREPARED=0,YNX_INIT_PREPARED=1,YNX_INIT_WRITE_ENTERED=2,
 YNX_INIT_LOCAL_COMMITTED=3,YNX_INIT_FINISH_OBSERVED=4,YNX_INIT_UNCERTAIN=5
};
typedef struct ynx_native_core_initialization_finish_v1 {
 uint32_t version,stage,journal_steps,queue_count;
 uint64_t generation,deadline;
 unsigned char intent[32],store_reference[32],journal_digest[32],cipher_digest[32],effect_digest[32];
 uint32_t owner_unknown,reserved;
} ynx_native_core_initialization_finish_v1;
_Static_assert(sizeof(ynx_native_core_initialization_finish_v1)==200,"initialization local finish200");
veil_store_status ynx_native_core_resource_driver_initialization_prepare_v1(ynx_native_core_resource_loan *);
/* Existing prepared original224 borrowed from this lease until explicit lease
 * release/parent close. Facts for matching producer, not a capability to use
 * elsewhere: generation16/deadline24/request32/storeRef64/journalSHA96/
 * cipherSHA128/canonical BE AAD528 SHA160/opIDs192. Prefix YNXINITINT1 at0,
 * zero reserved11..15. No postcommit derived Source context. */
veil_store_status ynx_native_core_resource_driver_initialization_intent_borrow_v1(
 ynx_native_core_resource_loan *,ynx_original_bytes *);
/* Calls existing protected-store CAS only once, from same sealed bytes. The
 * normal same-candidate EngineCommit producer must first install its actual
 * owning checked-finish binding+exactjournal; no bypass with a byte DTO. Until
 * Main/C typed engine adapter supplies that owner, returns REQUIRED BEFORE SQL
 * or setting write-entered. Generic message finish is never accepted here. */
veil_store_status ynx_native_core_resource_driver_initialization_checked_write_v1(ynx_native_core_resource_loan *);
/* Local same-intent independently read SQL effect + EngineBinding + both domain
 * originals. Exactly once observation; NOT M3 retire/Accepted/qualified final.
 * No retry of COMMIT/CAS/nonce/seal. Caller output untouched on refusal. */
veil_store_status ynx_native_core_resource_driver_initialization_finish_v1(
 ynx_native_core_resource_loan *,ynx_native_core_initialization_finish_v1 *);
/* Cleanup only releases THIS internal lease; never erases durable state or
 * resets UNKNOWN. Failure/partial keeps actual owned input until explicit
 * release/parent close. Same thread, no active key/SQL operation. */
veil_store_status ynx_native_core_resource_driver_initialization_lease_release_v1(ynx_native_core_resource_loan *);
#endif
