#ifndef VEIL_CHECKED_STORE_H
#define VEIL_CHECKED_STORE_H
#include <stddef.h>
#include <stdint.h>

/* PRIVATE native ABI v5, no JNI/Java/JS entry point. Unsafe C pointers must be
 * owned/borrowed by R7's private NativeBackend, never issued as public handles.
 * These objects are not NativeLease or NativeVerifiedFinalCommit. */
#define VEIL_CHECKED_STORE_ABI 5u
#define VEIL_STORE_RUNTIME_COMPLETE 0
#define VEIL_STORE_CELL_MAX (8u * 1024u * 1024u + 28u)
#define VEIL_STORE_RECORDS_MAX 4096u
#define VEIL_STORE_TOTAL_MAX (64u * 1024u * 1024u)
typedef struct veil_checked_store veil_checked_store;
typedef struct veil_authenticated_record veil_authenticated_record;
typedef struct veil_authenticated_intent veil_authenticated_intent;
typedef struct veil_authenticated_step veil_authenticated_step;
typedef struct veil_required_native_admission veil_required_native_admission;
typedef struct veil_ciphertext_snapshot veil_ciphertext_snapshot;
typedef struct veil_native_snapshot veil_native_snapshot;
typedef struct veil_native_verified_commit veil_native_verified_commit;
typedef struct veil_verified_native_operation_lease veil_verified_native_operation_lease;
typedef struct veil_snapshot_read_handle veil_snapshot_read_handle;
typedef struct veil_owned_native_snapshot veil_owned_native_snapshot;
typedef struct veil_native_record_key veil_native_record_key;
typedef struct veil_native_read_result veil_native_read_result;
typedef struct veil_checked_write_handle veil_checked_write_handle;
typedef struct veil_native_intent_handle veil_native_intent_handle;
typedef struct veil_native_ordered_step veil_native_ordered_step;
typedef struct veil_native_inbound_intent veil_native_inbound_intent;
typedef struct veil_native_outbound_intent veil_native_outbound_intent;
typedef struct veil_native_finish_result veil_native_finish_result;
typedef struct veil_native_lookup_result veil_native_lookup_result;
typedef struct veil_native_pending_handle veil_native_pending_handle;
typedef struct veil_native_cleanup_handle veil_native_cleanup_handle;
typedef enum {
  VEIL_STORE_OK = 0, VEIL_STORE_REQUIRED = 1, VEIL_STORE_BOUND = 2,
  VEIL_STORE_SQL = 3, VEIL_STORE_THREAD = 4, VEIL_STORE_LIFETIME = 5,
  VEIL_STORE_FROZEN = 6, VEIL_STORE_MISMATCH = 7,
  VEIL_STORE_UNKNOWN = 8, VEIL_STORE_DUPLICATE = 9
} veil_store_status;

/* Intentionally returns REQUIRED. Admission and authenticated opaque objects
 * have NO production constructor. No UI bool/receipt/callback enables them.
 * Future Main adapter supplies the SAME original NativeStore DB path from
 * required native binding/lease, not a new PQ database or a raw Java sqlite ptr. */
veil_store_status veil_store_open_required(const veil_required_native_admission *, veil_checked_store **);
/* Actual native SQLite read transaction, fully owned bounded ciphertext rows.
 * SQL coherence is NOT authorization generation/source/device/restore trust.
 * Snapshot is !Send owner-thread/lifetime-bound; no row bytes/cursor getter.
 * Engine cannot close/destroy until snapshot released. */
veil_store_status veil_store_read_ciphertext_snapshot(veil_checked_store *, veil_ciphertext_snapshot **);
veil_store_status veil_store_snapshot_compare_current(veil_checked_store *, const veil_ciphertext_snapshot *);
veil_store_status veil_store_snapshot_release(veil_ciphertext_snapshot **);
/* Required real cohort decoder: Identity/EC/Kyber/Session AND signed prekey,
 * source/generation/version/device/revoke/restore lease. No production factory.
 * These functions return REQUIRED/null, never promote SQL revision to grant. */
veil_store_status veil_store_acquire_snapshot_required(const veil_required_native_admission *, const veil_ciphertext_snapshot *, veil_native_snapshot **);
veil_store_status veil_store_lookup_exact_required(const veil_required_native_admission *, veil_checked_store *, const veil_authenticated_intent *, veil_native_verified_commit **);
/* Hypatia's EIGHT R7 groups. Decoder/source factories remain REQUIRED; write
 * mechanisms below are implemented but default private providers unavailable.
 * No host row/public tag can create a real lease, decoded record or receipt.
 * REQUIRED issuance clears output, retains caller ownership, not NotApplied. */
veil_store_status veil_native_acquire_snapshot(veil_checked_store *, const veil_verified_native_operation_lease *, veil_snapshot_read_handle **);
veil_store_status veil_native_read_identity(veil_snapshot_read_handle *, const veil_native_record_key *, veil_native_read_result **);
veil_store_status veil_native_read_ec(veil_snapshot_read_handle *, const veil_native_record_key *, veil_native_read_result **);
veil_store_status veil_native_read_kyber(veil_snapshot_read_handle *, const veil_native_record_key *, veil_native_read_result **);
veil_store_status veil_native_read_session(veil_snapshot_read_handle *, const veil_native_record_key *, veil_native_read_result **);
veil_store_status veil_native_read_signed(veil_snapshot_read_handle *, const veil_native_record_key *, veil_native_read_result **);
veil_store_status veil_native_finish_snapshot(veil_snapshot_read_handle **, veil_owned_native_snapshot **);
/* Durable PREPARED only, no business mutation/output. Online CAS waits outside
 * SQLite and authority guard. Missing private factories remain REQUIRED.
 * UNKNOWN returns a retained handle; do not recreate/encrypt/reapply. */
/* Failed begin/lookup may return their ORIGINAL primary and NULL business
 * output while store retains an opaque cleanup owner. Always take_cleanup
 * after failure; no reapply. Ownership is thread-bound, not an authority.
 * Observation is diagnostic only. Drop refuses active txn or missing durable
 * UNKNOWN fence and retains the SAME handle. Store close refuses live borrow.
 */
typedef struct {
  veil_store_status primary, rollback, unknown_fence;
  int actual_autocommit;
} veil_native_cleanup_observation;
veil_store_status veil_native_take_cleanup(veil_checked_store *,veil_native_cleanup_handle **);
veil_store_status veil_native_cleanup_observe(veil_native_cleanup_handle *,veil_native_cleanup_observation *);
veil_store_status veil_native_cleanup_drop(veil_native_cleanup_handle **);
veil_store_status veil_native_prepare_intent(veil_checked_store *, const veil_verified_native_operation_lease *, const veil_native_intent_handle *, veil_native_pending_handle **);
veil_store_status veil_native_pending_drop(veil_native_pending_handle **);
veil_store_status veil_native_begin_checked_write(veil_checked_store *, const veil_verified_native_operation_lease *, const veil_native_intent_handle *, veil_checked_write_handle **);
veil_store_status veil_native_apply_ordered_step(veil_checked_write_handle *, const veil_native_ordered_step *);
veil_store_status veil_native_append_inbox(veil_checked_write_handle *, const veil_native_inbound_intent *);
veil_store_status veil_native_append_outbox(veil_checked_write_handle *, const veil_native_outbound_intent *);
veil_store_status veil_native_finish_commit(veil_checked_write_handle **, veil_native_finish_result **);
veil_store_status veil_native_lookup_operation(veil_checked_store *, const veil_verified_native_operation_lease *, const veil_native_intent_handle *, veil_native_lookup_result **);
veil_store_status veil_native_cancel_operation(veil_checked_write_handle *, const veil_native_intent_handle *);
/* Decoder drops retain unavailable non-null owners. Issued producer drops are
 * real thread-bound cleanup; pending/UNKNOWN/output retention is never deleted. */
veil_store_status veil_native_snapshot_read_drop(veil_snapshot_read_handle **);
veil_store_status veil_native_owned_snapshot_drop(veil_owned_native_snapshot **);
veil_store_status veil_native_read_result_drop(veil_native_read_result **);
veil_store_status veil_native_checked_write_drop(veil_checked_write_handle **);
veil_store_status veil_native_finish_result_drop(veil_native_finish_result **);
veil_store_status veil_native_lookup_result_drop(veil_native_lookup_result **);
/* Only the real private CAS/authority/once-retention provider can issue output.
 * Local COMMIT success alone is NOT Applied/NativeVerifiedFinalCommit. */
veil_store_status veil_native_finish_publish_once(veil_native_finish_result *, veil_native_verified_commit **);
veil_store_status veil_native_lookup_publish_once(veil_native_lookup_result *, veil_native_verified_commit **);
veil_store_status veil_store_begin(veil_checked_store *);
veil_store_status veil_store_apply_record(veil_checked_store *, const veil_authenticated_record *);
/* Inserts exact protected intent and splits original ciphertext into bounded
 * existing aux chunks; one transaction also contains record changes. */
veil_store_status veil_store_stage_intent(veil_checked_store *, const veil_authenticated_intent *);
/* R7 typed seam: preserves every original mutation in order, never sorts or
 * coalesces actual SQL. No production step constructor. RequiredNoether wraps
 * Identity/EcSave/KyberSave/KyberUsed/Session inside native; EcRemove uses a
 * protected tombstone; Inbox/Outbox carry the SAME retained original ciphertext.
 * Key/kind/direction binding remains REQUIRED, not inferred from public tags. */
veil_store_status veil_store_apply_native_step(veil_checked_store *, const veil_authenticated_step *);
veil_store_status veil_store_freeze(veil_checked_store *);
/* Privileged native readback while frozen, compares actual typed cells/exact
 * ciphertext bytes. NOT canonical authenticated business checkpoint/anchor. */
veil_store_status veil_store_verify_record(veil_checked_store *, const veil_authenticated_record *);
veil_store_status veil_store_verify_intent(veil_checked_store *, const veil_authenticated_intent *);
veil_store_status veil_store_verify_applied(veil_checked_store *);
veil_store_status veil_store_rollback(veil_checked_store *);
/* Protected production final commitment stays unavailable. It never COMMITs. */
veil_store_status veil_store_commit_required(veil_checked_store *);
/* Native close is owner-thread only; rollback cleanup works after freeze.
 * close leaves a tombstone for explicit scoped lifetime refusal; destroy is
 * R7-owner-only after ALL borrows cease (standard unsafe FFI obligation). */
veil_store_status veil_store_close(veil_checked_store *);
veil_store_status veil_store_destroy(veil_checked_store **);

#ifdef VEIL_STORE_FIXTURE
typedef enum {
  VEIL_FIXTURE_IDENTITY, VEIL_FIXTURE_EC_SAVE, VEIL_FIXTURE_EC_REMOVE,
  VEIL_FIXTURE_KYBER_SAVE, VEIL_FIXTURE_KYBER_USED, VEIL_FIXTURE_SESSION,
  VEIL_FIXTURE_INBOX, VEIL_FIXTURE_OUTBOX
} veil_fixture_step_tag;
veil_store_status veil_fixture_step_create(veil_fixture_step_tag, uint32_t sequence,
    const veil_authenticated_record *, const veil_authenticated_intent *, veil_authenticated_step **);
void veil_fixture_step_free(veil_authenticated_step **);
/* Synthetic-only build surface, absent from normal object/library. It cannot
 * create production admission, protector output or a verified commit. */
typedef struct {
  const char *op, *owner, *device, *identity_fp, *key_alias;
  int64_t base_rev, next_rev, auth_gen;
  const char *base_hash, *next_hash, *cipher_hash;
  const unsigned char *ciphertext; size_t ciphertext_size;
} veil_fixture_intent;
veil_store_status veil_fixture_open(const char *owned_test_path, veil_checked_store **);
veil_store_status veil_fixture_record(const char *kind, const char *id, const unsigned char *, size_t, veil_authenticated_record **);
veil_store_status veil_fixture_intent_create(const veil_fixture_intent *, veil_authenticated_intent **);
void veil_fixture_record_free(veil_authenticated_record **);
void veil_fixture_intent_free(veil_authenticated_intent **);
/* SQLite mechanics ONLY; deliberately cannot return native verified receipt. */
veil_store_status veil_fixture_commit_mechanics(veil_checked_store *, const char *op, const char *commitment_hash);
veil_store_status veil_fixture_delete_session(veil_checked_store *, const char *id);
veil_store_status veil_fixture_revision(veil_checked_store *, int64_t *);
veil_store_status veil_fixture_reopen_exact_readback(veil_checked_store *, const veil_authenticated_record *, const veil_authenticated_intent *, const char *commitment_hash);
veil_store_status veil_fixture_snapshot_expect(const veil_ciphertext_snapshot *, const char *kind, const char *id, const veil_authenticated_record *expected_or_null);
#endif
#endif
