#ifndef VEIL_PRODUCER_PRIVATE_H
#define VEIL_PRODUCER_PRIVATE_H
#include "veil_checked_store.h"
/* Implementation-only LINK contract proposed to Main. Not a registration API.
 * Only real verifier/source modules may define production implementations.
 * No exported constructor, callback table, bool grant, public receipt factory.
 * Defaults in veil_producer_unavailable.c fail closed.
 * Ciphertext pointers are borrowed under the pin until release; NO plaintext.
 * Metadata is NOT authority. Every projection checks issuer/source/device/
 * generation/restore/actor under the SAME guard (including source-CAS lock).
 */
typedef struct veil_private_store_binding veil_private_store_binding;
/* Actual issuer binds existing original NativeStore path/schema/inode/restore
 * under native admission. No public pathname factory. No CREATE allowed.
 * Binding pins lease/authority registry while connection exists. */
veil_store_status veil_private_store_admit(const veil_required_native_admission *,veil_private_store_binding **,const char **);
void veil_private_store_release(veil_private_store_binding **);
typedef struct veil_private_effect_guard veil_private_effect_guard;
typedef struct veil_private_intent_pin veil_private_intent_pin;
typedef struct veil_private_cas_match veil_private_cas_match;
typedef struct veil_private_recovery_admission veil_private_recovery_admission;
/* Immutable operation subtype issued only by the SAME verified Source intent.
 * This is not a public grant/callback. MESSAGE retains exactly one queue;
 * INITIALIZE_STORAGE is the private local first-device bootstrap record. */
enum veil_private_native_intent_kind { VEIL_PRIVATE_NATIVE_MESSAGE=0, VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE=1 };
typedef struct {
  const char *op,*owner,*device,*identity_fp,*key_alias;
  const char *base_hash,*next_hash,*cipher_hash;
  int64_t base_rev,next_rev,auth_gen;
  const unsigned char *sealed_candidate; size_t candidate_size;
  uint32_t journal_steps;
  uint32_t native_kind;
} veil_private_intent_view;
typedef struct {
  uint32_t sequence;
  const char *kind,*id;
  const unsigned char *sealed; size_t sealed_size;
} veil_private_step_view;
/* acquire locks authority -> source-CAS -> store, same order for transitions.
 * It NEVER waits for network. Missing/revoked/expired/changed inputs fail.
 * validate never releases/reacquires guard. All transitions take same lock.
 * release is thread-bound, infallible, zeroizes only provider-owned secrets.
 * retain pins exact admitted immutable intent and journal; release only drops
 * RAM borrow, NEVER clears durable pending/UNKNOWN/output-retention.
 */
/* Recovery admission is a separate actual source/UNKNOWN registry operation,
 * not a local phase reset or receipt flag. Default REQUIRED. */
/* Immutable BORROW owned by SAME genuine source_hold through final guard/pin
 * release. No producer free/destructor. Pointer presence is not authority. */
veil_store_status veil_private_recover_committed(veil_private_effect_guard *,veil_private_intent_pin *,veil_private_cas_match *,const veil_private_recovery_admission **);
veil_store_status veil_private_guard_acquire(veil_checked_store *,const veil_verified_native_operation_lease *,const veil_native_intent_handle *,veil_private_effect_guard **);
/* Recovery is separately issued for EXACT same retained operation. It cannot
 * begin a normal write or authorize reencrypt/metadata-abort. Default REQUIRED.
 */
veil_store_status veil_private_guard_acquire_recovery(veil_checked_store *,const veil_verified_native_operation_lease *,const veil_native_intent_handle *,veil_private_effect_guard **);
/* Durable DENIAL ONLY, issued under SAME held authority/source-CAS lock.
 * Success means original op/actor/issuer/generation/source/restore UNKNOWN
 * persists across connection/process reopen and prevents ALL normal effects
 * until independent authenticated exact resolution. No public metadata grants.
 * Must also work for expired/revoked holder cleanup, not grant validation.
 * Missing or failed fence retains guard/pin, never locally opens the scope.
 * cas_exact itself must persist in-flight/exact-operation admission BEFORE
 * returning match: closes crash gap before core can call this denial port.
 */
veil_store_status veil_private_unknown_fence(veil_private_effect_guard *,veil_private_intent_pin *);
veil_store_status veil_private_guard_validate(veil_private_effect_guard *);
void veil_private_guard_release(veil_private_effect_guard **);
veil_store_status veil_private_intent_retain(veil_private_effect_guard *,const veil_native_intent_handle *,veil_private_intent_pin **,veil_private_intent_view *);
void veil_private_intent_release(veil_private_intent_pin **);
/* step is issued by SAME immutable intent. EC removal MUST be a protected
 * tombstone whose real selected decoder returns missing; no physical DELETE.
 * The issuer verifies kind/id/version/used-policy/original journal position.
 */
veil_store_status veil_private_step_borrow(veil_private_effect_guard *,veil_private_intent_pin *,const veil_native_ordered_step *,veil_private_step_view *);
veil_store_status veil_private_queue_borrow(veil_private_effect_guard *,veil_private_intent_pin *,const veil_native_inbound_intent *,const veil_native_outbound_intent *,veil_private_step_view *);
/* CAS/anchor verifier proves exact binding/op/base/next/cipherdigest/authgen/
 * source/device/restore and original candidate match. Independent server
 * authentication, NOT same-DB marker. Receipt max32KiB, guard-borrowed.
 */
veil_store_status veil_private_cas_exact(veil_private_effect_guard *,veil_private_intent_pin *,veil_private_cas_match **,const unsigned char **,size_t *);
/* Full bounded frozen native ciphertext inventory, NOT raw DB/cursor.
 * Provider verifies selected canonical business hash/base/next plus protected
 * record/source mapping. Snapshot is synchronous !Send borrowed; cannot escape.
 * It is NOT a decoder factory; provider/Noether own interpretation.
 */
veil_store_status veil_private_readback_count(veil_private_effect_guard *,const veil_ciphertext_snapshot *,size_t *);
veil_store_status veil_private_readback_at(veil_private_effect_guard *,const veil_ciphertext_snapshot *,size_t,veil_private_step_view *);
veil_store_status veil_private_final_checkpoint(veil_private_effect_guard *,veil_private_intent_pin *,const veil_ciphertext_snapshot *);
/* Consumes/publishes once under SAME held guard and actual independent receipt.
 * Missing retention/consumer/source fencing returns REQUIRED, never public OK.
 * Returned NativeVerifiedFinalCommit must come from actual private issuer.
 * Caller must not turn local committed/UNKNOWN observations into authority.
 */
veil_store_status veil_private_publish_once(veil_private_effect_guard *,veil_private_intent_pin *,veil_private_cas_match *,const veil_private_recovery_admission *,veil_native_verified_commit **);
#endif
