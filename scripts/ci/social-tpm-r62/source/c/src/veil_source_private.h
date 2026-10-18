#ifndef VEIL_SOURCE_PRIVATE_H
#define VEIL_SOURCE_PRIVATE_H
#include "veil_producer_private.h"
/* PRIVATE LINK, never JNI/public metadata registration. Genuine issuer owns
 * witness construction. All strings/ciphertext are borrowed until source_drop.
 * hold validates independently enrolled issuer + rollback anchor, exact native
 * lease/intent, source/device/restore incarnations and takes their common lock.
 * Source transitions take the SAME lock through SQL/commit/lookup/output.
 * Model A: ALL remote/signature/history preparation completes before final
 * effect guard. CAS/effect/readback/once are synchronous under SAME genuine
 * held guard; no source_reacquire or unlocked-pin effect permission. Local
 * PREPARED staging may precede remote preparation, but its released guard/pin
 * never resumes effects. A new final guard needs full accepted prepared owners.
 * cas_result borrows a previously independently verified exact CAS outcome,
 * not a HTTP callback. Missing authentic supplier REQUIRED.
 */
typedef struct veil_source_hold veil_source_hold;
typedef enum { VEIL_SOURCE_FRESH, VEIL_SOURCE_RECOVERY, VEIL_SOURCE_TRANSITION } veil_source_mode;
/* Exact normal Source projection semantics (existing field meanings):
 * issuer = verified catalog Record.Binding.Issuer, equal to the SAME verified
 * issuer Credential.authority; never Account.namespace.issuer or key custodian.
 * actor = that selected verified Binding.Actor, under SAME grant/operation
 * identity; never inferred from account/device/custodian/writer label.
 * source_id/store_id = verified Binding.Source/Store equal to Credential.scope.
 * restore_incarnation/source_generation = verified Scope nativeRestoreIncarnation
 * /sourceGeneration, exact checked i64 conversion; not credential epoch.
 * original.auth_gen = selected signed Binding.Generation, not source generation.
 * revoked_through = max RevokedThrough of all verified revoke rows in the
 * complete signed catalog prefix for SAME (Issuer, Account, Device), within
 * its verified scope. Replay cannot narrow to selected Actor/Key/Generation.
 * A complete authenticated prefix with no revoke has cutoff 0. -1 is only an
 * inherited C numeric sentinel; it is NOT proof of an empty revocation prefix.
 * Identity/Key/Actor and generation must match the selected actual immutable
 * grant/operation; raw JSON, Scope, first-prepared eligibility or native pointer
 * presence cannot construct this owning Source lease/intent.
 * Empty catalog/first-prepared namespace gives no Binding.Actor or grant: it
 * must not fabricate either to initialize this existing generic source API.
 * All spans/strings remain owned by SAME authentic source hold through drop;
 * transitions and current share its real enrolled source/CAS/revocation fence.
 */
typedef struct {
  const char *issuer,*actor,*source_id,*store_id;
  int64_t restore_incarnation,source_generation,revoked_through;
  veil_private_intent_view original;
} veil_source_view;
veil_store_status veil_source_acquire(veil_private_store_binding *,const veil_verified_native_operation_lease *,const veil_native_intent_handle *,veil_source_mode,veil_source_hold **,veil_source_view *);
/* fresh validation rejects expiration/revoke; cleanup validates retained source
 * ownership only and NEVER issues a new lease/effect. It remains possible after
 * lease expiry/revoke, but foreign issuer/source/restore must still refuse. */
veil_store_status veil_source_validate(veil_source_hold *,int cleanup_only);
/* UNKNOWN is not transient permission refusal. Store latches it before release
 * even when acquire returns NULL. The genuine supplier MUST retain unresolved
 * source/history across process death/reopen before any local operation row;
 * absence of a local row, SQL marker or bootstrap is NEVER resolution.
 * A live returned hold uses an infallible owner-thread RAM destructor; dropping
 * that borrow cannot erase supplier history. Uncertain SQL retains cleanup owner.
 * Recovery requires genuine exact-original-operation/source admission, not
 * automatic acceptance of a subsequent supplier OK or local database contents. */
void veil_source_drop(veil_source_hold **);
/* Release exclusion, retaining immutable intent borrow until drop. Infallible,
 * owner-thread only; prevents a pending network wait from holding the lock. */
void veil_source_release_lock(veil_source_hold *);
/* Explicit enrolled bootstrap authorization, not absent-row auto genesis. */
veil_store_status veil_source_allow_initialization(veil_source_hold *);
veil_store_status veil_source_cas_result(veil_source_hold *,veil_private_cas_match **,const unsigned char **,size_t *);
/* PRIVATE source-owned typed ciphertext borrow. Checked registry wrappers
 * validate thread/live-held-lock/guard+pin+original BEFORE calling these.
 * No constructor, raw DB getter, dynamic callback or public authority flag.
 * Missing genuine protector/mapping stays REQUIRED. Borrow cannot outlive the
 * same held source/immutable intent; provider MUST NOT mutate/release the lock.
 * Any foreign UNKNOWN latches caller store + holder, never permits a retry.
 * Error output is discarded/cleared; no output metadata can grant authority. */
veil_store_status veil_source_step_borrow(veil_source_hold *,const veil_native_intent_handle *,
  const veil_native_ordered_step *,veil_private_step_view *);
veil_store_status veil_source_queue_borrow(veil_source_hold *,const veil_native_intent_handle *,
  const veil_native_inbound_intent *,const veil_native_outbound_intent *,veil_private_step_view *);
/* B: immutable recovery BORROW owned by this same hold until final source_drop.
 * Never early-free, including error outputs. No producer destructor/factory.
 * Once revalidates original/source/CAS/restore and real durable consumption
 * under the SAME lock; fresh path supplies NULL, recovered supplies exact borrow.
 * Default REQUIRED. Output pointers/public metadata never constitute authority. */
veil_store_status veil_source_recover_committed(veil_source_hold *,const veil_native_intent_handle *,
  veil_private_cas_match *,const veil_private_recovery_admission **);
veil_store_status veil_source_publish_once(veil_source_hold *,const veil_native_intent_handle *,
  veil_private_cas_match *,const veil_private_recovery_admission *,veil_native_verified_commit **);
/* Store-side software only; call under actual source capability, not public path.
 * Initialization is separate from acquisition, collision/partial refuses.
 * These do NOT mint grant/anchor/receipt. */
veil_store_status veil_private_initialize_source(veil_checked_store *,const veil_verified_native_operation_lease *,const veil_native_intent_handle *);
veil_store_status veil_private_persist_revocation(veil_checked_store *,const veil_verified_native_operation_lease *,const veil_native_intent_handle *);
veil_store_status veil_private_source_cleanup(veil_checked_store *);
veil_store_status veil_private_source_cleanup_observe(veil_checked_store *,veil_store_status *,int *);
#endif
