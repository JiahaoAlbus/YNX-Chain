#ifndef YNX_SOURCE_PLATFORM_PRIVATE_H
#define YNX_SOURCE_PLATFORM_PRIVATE_H
#include "../c/src/veil_source_private.h"
#include "../c/src/veil_supplier_owner_private.h"
/* Private static LINK boundary. No callback registration or public constructor.
 * Only an independently qualified provider defines this type. The normal
 * unbound TU cannot create it. All borrowed projections remain platform-owned.
 * Provider validates original enrolled identities, independent rollback floor,
 * exact retained input and fixed lifetime BEFORE acquisition. It retains the
 * real joint fence through enter/CAS/effect/readback/terminal. No network waits
 * in that synchronous section. Every mutation/cancel/revoke takes that fence.
 * Partial/error outputs retain original custody; UNKNOWN survives drop/reopen.
 */
typedef struct ynx_platform_original_hold ynx_platform_original_hold;
typedef struct ynx_platform_final_hold ynx_platform_final_hold;
typedef struct ynx_platform_prepared_hold ynx_platform_prepared_hold;
/* Borrowed UNADMITTED exact bytes. This struct is not enrollment/admission.
 * The qualified static provider independently verifies every original binding
 * and acquires its protected issuer/independent-anchor joint fence. */
typedef struct ynx_original_bytes {const unsigned char *data;size_t size;} ynx_original_bytes;
typedef struct ynx_original_input {
 ynx_original_bytes root,registration,status,source,namespace_prefix,request;
 const unsigned char *nonce;size_t nonce_size;
 const ynx_original_bytes *status_history;size_t status_history_count;
} ynx_original_input;
/* NativeCore-only normal input. Do not append fields to the common server
 * original transport: its first-device account/prepared offsets stay fixed. */
typedef struct ynx_core_original_input {
 ynx_original_bytes root,registration,status,source,namespace_prefix,request;
 const unsigned char *nonce;size_t nonce_size;
 const ynx_original_bytes *status_history;size_t status_history_count;
 /* Same RecoveryLoan live DEVICE identity; provenance only, not grant. */
 unsigned char native_classic[33],native_pq[2592],source_nonce[32];
 uint64_t monotonic_deadline_ns; /* SAME original operation, not a grant */
} ynx_core_original_input;
/* PRIVATE v2 intake; public v1 OriginalInput remains unchanged. */
typedef struct ynx_native_core_borrow_request_v2 {
 uint32_t version,size,purpose,operation,selected_key_uses,required_operations;
 uint64_t context_id,context_generation,monotonic_deadline_ns;
 unsigned char intent_digest[32];
} ynx_native_core_borrow_request_v2;
typedef struct ynx_native_core_rights_ref_v2 {
 uint32_t version,size,purpose,operation;uint64_t borrow_id,parent_generation;
} ynx_native_core_rights_ref_v2;
/* Same-candidate private C/Rust carrier. The Android pointer is a synchronous
 * borrow of the existing native own-key custodian, never a Java handle/grant.
 * Policy authorization still consumes only the original authenticated input.
 */
typedef struct ynx_core_original_input_v2 {ynx_native_core_borrow_request_v2 rights;ynx_core_original_input original;void *android_own_key_platform;} ynx_core_original_input_v2;
_Static_assert(sizeof(ynx_native_core_borrow_request_v2)==80,"private request80");
_Static_assert(offsetof(ynx_native_core_borrow_request_v2,required_operations)==20,"private low-set20");
_Static_assert(sizeof(ynx_native_core_rights_ref_v2)==32,"private ref32");
_Static_assert(offsetof(ynx_core_original_input_v2,android_own_key_platform)==2880,"private context offset2880");
_Static_assert(sizeof(ynx_core_original_input_v2)==2888,"private original2888");
veil_store_status ynx_platform_acquire_original_v2(const ynx_core_original_input_v2 *,ynx_platform_original_hold **);
veil_store_status ynx_source_client_original_acquire_v2(const ynx_core_original_input_v2 *,veil_source_hold **);
/* Borrowed provenance of the already acquired SAME original root. These
 * facts do not construct permission. Consumer keeps the source guard alive. */
typedef struct ynx_core_origin_original {
 unsigned char root_digest[32],registration_digest[32];
 unsigned char native_classic[33],native_pq[2592],source_nonce[32],account_nonce[32];
} ynx_core_origin_original;
veil_store_status ynx_source_client_core_origin_borrow(veil_source_hold *,ynx_core_origin_original *);
veil_store_status veil_private_core_origin_borrow(veil_private_effect_guard *,veil_private_intent_pin *,ynx_core_origin_original *);
int32_t ynx_source_monotonic_now_v1(uint64_t *);
veil_store_status ynx_platform_acquire_original(const ynx_core_original_input *,ynx_platform_original_hold **);
/* The four outputs are exclusive borrows of this SAME root, never owning DTOs. */
veil_store_status ynx_platform_original_projection(ynx_platform_original_hold *,const veil_product_accepted_origin_owner **,const veil_product_accepted_device_owner **,const veil_product_prepared_history_owner **,const veil_selected_retained_original_owner **);
veil_store_status ynx_source_client_original_acquire(const ynx_core_original_input *,veil_source_hold **);
veil_store_status ynx_source_client_original_projection(veil_source_hold *,const veil_product_accepted_origin_owner **,const veil_product_accepted_device_owner **,const veil_product_prepared_history_owner **,const veil_selected_retained_original_owner **);
veil_store_status ynx_platform_acquire(veil_private_store_binding *,const veil_verified_native_operation_lease *,const veil_native_intent_handle *,veil_source_mode,ynx_platform_original_hold **,veil_source_view *);
veil_store_status ynx_platform_acquire_prepared(const veil_private_prepared_input_owner *,ynx_platform_original_hold **);
veil_store_status ynx_platform_current(ynx_platform_original_hold *,int cleanup_only);
veil_store_status ynx_platform_original_first_cause(ynx_platform_original_hold *);
/* Enter persists exact-original unresolved custody before a possible effect.
 * Any failure after the invocation is conservatively UNKNOWN. No renewal. */
veil_store_status ynx_platform_enter(ynx_platform_original_hold *);
veil_store_status ynx_platform_initialize(ynx_platform_original_hold *);
veil_store_status ynx_platform_cas(ynx_platform_original_hold *,veil_private_cas_match **,const unsigned char **,size_t *);
veil_store_status ynx_platform_step(ynx_platform_original_hold *,const veil_native_intent_handle *,const veil_native_ordered_step *,veil_private_step_view *);
veil_store_status ynx_platform_queue(ynx_platform_original_hold *,const veil_native_intent_handle *,const veil_native_inbound_intent *,const veil_native_outbound_intent *,veil_private_step_view *);
veil_store_status ynx_platform_recover(ynx_platform_original_hold *,const veil_native_intent_handle *,veil_private_cas_match *,const veil_private_recovery_admission **);
/* Full frozen ciphertext readback, synchronously borrowed under the SAME
 * original guard. No provider may retain row pointers. This is precommit
 * validation against independently held checkpoint/next-state expectations;
 * no terminal or capability is returned by successful comparison. */
typedef struct ynx_precommit_readback {
 const veil_native_intent_handle *intent;
 const veil_private_step_view *rows;size_t row_count;
} ynx_precommit_readback;
veil_store_status ynx_platform_precommit_checkpoint(ynx_platform_original_hold *,const ynx_precommit_readback *);
veil_store_status ynx_source_client_precommit_checkpoint(veil_source_hold *,const ynx_precommit_readback *);
veil_store_status ynx_platform_terminal(ynx_platform_original_hold *,const veil_native_intent_handle *,veil_private_cas_match *,const veil_private_recovery_admission *,ynx_platform_final_hold **);
/* A terminal refusal may return SAME original partial hold for cleanup only.
 * The normal reserved final RAM slot retains it as sticky UNKNOWN, preserving
 * first cause. Transfer is not verified commit; current/borrow must refuse.
 * Without a partial hold the original refusal propagates with NULL output. */
/* Final hold exists only after the static qualified provider verifies original
 * through-effect history, independent terminal/checkpoint and durable floor.
 * It independently retains origin, device and protected output after guard
 * release. No public bytes/token/pointer constructor, no callback installer. */
typedef struct ynx_independent_commit_originals {
 uint32_t version;
 ynx_original_bytes engine_issuer,engine_anchor,checkpoint_anchor,terminal_issuer,terminal_anchor;
 const ynx_original_bytes *checkpoint_predecessors;size_t checkpoint_count;
 const ynx_original_bytes *terminal_issuer_predecessors;size_t terminal_issuer_count;
 const ynx_original_bytes *terminal_anchor_predecessors;size_t terminal_anchor_count;
} ynx_independent_commit_originals;
/* Original signed envelopes borrowed only from this genuine final root. The
 * RAM caller cannot provide or replace companions, floor or terminal facts. */
/* Original public facts selected by the verifier; NOT a device capability.
 * Provider independently binds native device keys/account/root to this genuine
 * final root and protected latest revocation head/floor. Historical final does
 * not renew its first Attempt; live observation is provider-held independently.
 */
typedef struct ynx_device_original_input {
 uint32_t version;ynx_original_bytes final,current,terminal,checkpoint;
 const ynx_original_bytes *predecessors;size_t predecessor_count;
} ynx_device_original_input;
/* Original PUBLIC signed records from SAME actually retired server owner.
 * Provider checks current revocation/latest independent floor internally;
 * borrowed originals live until this owner closes. No signing from DTO/status. */

/* Independently restore original committed device custody using THIS static
 * provider's selected admitted Root, native authenticated public device keys,
 * complete originals, protected latest head/floor and revocation. Public bytes
 * are not a lookup authority. No first-init Attempt is renewed. NonOK => noout;
 * any unresolved restoration remains durable in provider history. */
veil_store_status ynx_platform_device_restore(const ynx_device_original_input *,const unsigned char *,size_t,const unsigned char *,size_t,ynx_platform_final_hold **);
veil_store_status veil_private_verified_commit_restore_device(const ynx_device_original_input *,const unsigned char *,size_t,const unsigned char *,size_t,veil_native_verified_commit **);
veil_store_status ynx_platform_final_device_current(ynx_platform_final_hold *,const ynx_device_original_input *);
veil_store_status veil_private_verified_commit_device_current(const veil_native_verified_commit *,const ynx_device_original_input *);
veil_store_status ynx_platform_final_originals(ynx_platform_final_hold *,ynx_independent_commit_originals *);
veil_store_status veil_private_verified_commit_originals(const veil_native_verified_commit *,ynx_independent_commit_originals *);
veil_store_status ynx_platform_final_current(ynx_platform_final_hold *);
veil_store_status ynx_platform_final_borrow(ynx_platform_final_hold *,const veil_native_intent_handle **,const veil_private_authenticated_once_owner **,const veil_private_protected_output_owner **);
veil_store_status ynx_platform_final_acknowledge(ynx_platform_final_hold *,ynx_platform_prepared_hold *,veil_private_effect_guard *,veil_private_intent_pin *);
veil_store_status ynx_platform_final_recover(ynx_platform_prepared_hold *,veil_private_effect_guard *,veil_private_intent_pin *,ynx_platform_final_hold **);
veil_store_status ynx_platform_final_close(ynx_platform_final_hold **);
/* Actual normal publish caller reserves C RAM before terminal invocation;
 * successful transfer retains even a late UNKNOWN until explicit close. */
veil_store_status veil_private_verified_commit_publish(ynx_platform_original_hold *,const veil_native_intent_handle *,veil_private_cas_match *,const veil_private_recovery_admission *,veil_native_verified_commit **);
/* Checks the SAME retained original proposal/realm/principals/frame/slot. This
 * does not approve arbitrary wire bytes; no signer is called by this client. */
veil_store_status ynx_platform_type4(ynx_platform_original_hold *,const unsigned char *,size_t);
/* Infallible owner-thread RAM disposal/exclusion release, not durable erase.
 * No implicit rollback, replay, cancel, success or UNKNOWN settlement. */
void ynx_platform_release_lock(ynx_platform_original_hold *);
/* Fallible cleanup-only: non-OK retains the exact original parent, including
 * when a child was released with UNKNOWN. Explicit retry drains remaining RAM
 * only; it does not retry an effect or settle the original operation. */
veil_store_status ynx_platform_drop(ynx_platform_original_hold **);

/* C owning client; handles are recognized by its private live inventory before
 * dereference. Prepared acquisition accepts an actual verifier-owned Prepared,
 * not a DTO, raw public token, grant flag or signing constructor. */
veil_store_status ynx_source_client_prepared_acquire(const veil_private_prepared_input_owner *,veil_source_hold **);
veil_store_status ynx_source_client_current(veil_source_hold *,int cleanup_only);
veil_store_status ynx_source_client_enter(veil_source_hold *);
veil_store_status ynx_source_client_type4(veil_source_hold *,const unsigned char *,size_t);
veil_store_status ynx_source_client_close(veil_source_hold **);

/* Qualified provider's retained prepared custody, produced only from its own
 * four same-root accepted borrows. Failure retains original input custody and
 * transfers no prepared handle; this is not a metadata-to-owner constructor. */
veil_store_status ynx_platform_prepare_original(const veil_product_accepted_origin_owner *,const veil_product_accepted_device_owner *,const veil_product_prepared_history_owner *,const veil_selected_retained_original_owner *,ynx_platform_prepared_hold **);
veil_store_status ynx_platform_prepared_current(ynx_platform_prepared_hold *);
veil_store_status ynx_platform_prepared_capabilities(ynx_platform_prepared_hold *,const veil_required_native_admission **,const veil_verified_native_operation_lease **,const veil_native_intent_handle **);
veil_store_status ynx_platform_prepared_validate(ynx_platform_prepared_hold *,veil_private_effect_guard *,veil_private_intent_pin *);
veil_store_status ynx_platform_prepared_close(ynx_platform_prepared_hold **);
/* Immutable original native sealed journal and exactly one original queue.
 * Pointers are borrowed only while this same qualified root is retained. */
typedef struct ynx_original_native_plan {
 const veil_native_intent_handle *intent;
 const veil_native_ordered_step *journal[32];size_t journal_count;
 const veil_native_inbound_intent *inbox;const veil_native_outbound_intent *outbox;
} ynx_original_native_plan;
veil_store_status ynx_platform_original_native_plan(ynx_platform_original_hold *,ynx_original_native_plan *);
veil_store_status ynx_source_client_original_native_plan(veil_source_hold *,ynx_original_native_plan *);
/* Actual admission-to-binding ownership lives in the qualified platform. It
 * retains exact path/schema/inode/restore under the same original fence. */
veil_store_status ynx_platform_store_admit(const veil_required_native_admission *,veil_private_store_binding **,const char **);
void ynx_platform_store_release(veil_private_store_binding **);
/* Private same-original native snapshot transfer, not a trust wire format.
 * Only the statically qualified provider produces authenticated rows, the
 * enrolled actor and the protected reservation under the original joint fence.
 * Row bytes and descriptor pointers remain borrowed until explicit close.
 * kind: 1 identity, 2 peer, 3 EC, 4 signed, 5 Kyber, 6 session. Existing codec
 * and policy checks still apply; integer fields are associations, not grants. */
typedef struct ynx_platform_snapshot_hold ynx_platform_snapshot_hold;
typedef struct ynx_storage_attempt ynx_storage_attempt;
typedef struct ynx_source_snapshot_hold ynx_source_snapshot_hold;
typedef struct ynx_native_used_key {uint32_t signed_id;ynx_original_bytes public_key;} ynx_native_used_key;
typedef struct ynx_native_cohort_row {
 uint32_t kind,id,device,policy,registration;uint64_t version;
 ynx_original_bytes name,body;const ynx_native_used_key *used;size_t used_count;
} ynx_native_cohort_row;
typedef struct ynx_native_snapshot_projection {
 uint64_t binding[11],actor;unsigned char source_abi[32];size_t reserved_bytes;
 uint32_t queue;ynx_original_bytes inbound_wire;
 const ynx_native_cohort_row *rows;size_t row_count;
 const veil_verified_native_operation_lease *lease;const veil_native_intent_handle *intent;
} ynx_native_snapshot_projection;
/* Acquisition authenticates same root + genuine retained Prepared, obtains
 * complete coherent records and a native reservation once, without new lease. */
veil_store_status ynx_platform_snapshot_acquire(ynx_platform_original_hold *,const veil_private_prepared_input_owner *,ynx_platform_snapshot_hold **);
veil_store_status ynx_platform_snapshot_current(ynx_platform_snapshot_hold *);
veil_store_status ynx_platform_snapshot_projection(ynx_platform_snapshot_hold *,ynx_native_snapshot_projection *);
veil_store_status ynx_platform_snapshot_close(ynx_platform_snapshot_hold **);
/* Same retained snapshot's authenticated message-purpose route. Request logical
 * and direction select an ALREADY accepted relation; neither creates one. The
 * provider must bind enrolled local device/peer/session and exact lease before
 * returning borrowed names. Existing YNXM/YNXO signed/wire formats unchanged. */
typedef struct ynx_native_message_route {
 uint64_t binding[11];unsigned char logical[16];uint32_t direction;
 ynx_original_bytes local_name,remote_name;uint32_t local_device,remote_device;
} ynx_native_message_route;
veil_store_status ynx_platform_snapshot_message_route(ynx_platform_snapshot_hold *,const unsigned char logical[16],uint32_t direction,ynx_native_message_route *);
veil_store_status ynx_source_client_snapshot_message_route(ynx_source_snapshot_hold *,const unsigned char logical[16],uint32_t direction,ynx_native_message_route *);
veil_store_status ynx_source_client_snapshot_acquire(veil_source_hold *,const veil_private_prepared_input_owner *,ynx_source_snapshot_hold **);
veil_store_status ynx_source_client_snapshot_current(ynx_source_snapshot_hold *);
veil_store_status ynx_source_client_snapshot_projection(ynx_source_snapshot_hold *,ynx_native_snapshot_projection *);
veil_store_status ynx_source_client_snapshot_close(ynx_source_snapshot_hold **);


/* Server-only private ABI: these are bounded UNADMITTED original bytes, not
 * a trust wire/schema or admission DTO. Platform retains the exact server
 * original account+prepared/directory history and exclusive issuer/independent
 * anchor joint fence, independently validating them against original inputs.
 * No Go callback is installed and no Android pointer crosses this boundary. */
typedef struct ynx_server_original_input {
 ynx_original_input original;
 ynx_original_bytes account_original,prepared_original;
} ynx_server_original_input;
typedef struct ynx_server_terminal_input {
 ynx_original_bytes checkpoint,namespace_prefix,account_result;
} ynx_server_terminal_input;
typedef struct ynx_platform_server_hold ynx_platform_server_hold;
typedef struct ynx_source_server_hold ynx_source_server_hold;
veil_store_status ynx_platform_server_device_originals(ynx_platform_server_hold *,ynx_device_original_input *);
veil_store_status ynx_source_client_server_device_originals(ynx_source_server_hold *,ynx_device_original_input *);
/* Provider acquire copies/retains all original bytes before returning. Any
 * partial error transfers SAME hold for cleanup; NULL means no held owner.
 * Genuine verification/enrollment/current/independent fence REQUIRED. */
veil_store_status ynx_platform_server_acquire(const ynx_server_original_input *,ynx_platform_server_hold **);
veil_store_status ynx_platform_server_current(ynx_platform_server_hold *);
/* Enter persists unresolved custody before possible Go account append. */
veil_store_status ynx_platform_server_enter(ynx_platform_server_hold *);
/* Independently verify SAME actual signed checkpoint/full-prefix/account
 * readback against original input and retained floor before irreversible
 * retirement. A caller's bytes or return0 are never a verified terminal. */
veil_store_status ynx_platform_server_retire(ynx_platform_server_hold *,const ynx_server_terminal_input *);
/* Same-thread RAM close may run on expiry/cancel/UNKNOWN. Refusal keeps EXACT
 * pointer; OK clears it. Durable UNKNOWN remains in protected provider. */
veil_store_status ynx_platform_server_close(ynx_platform_server_hold **);
veil_store_status ynx_source_client_server_acquire(const ynx_server_original_input *,ynx_source_server_hold **);
veil_store_status ynx_source_client_server_current(ynx_source_server_hold *);
veil_store_status ynx_source_client_server_enter(ynx_source_server_hold *);
veil_store_status ynx_source_client_server_retire(ynx_source_server_hold *,const ynx_server_terminal_input *);
veil_store_status ynx_source_client_server_close(ynx_source_server_hold **);

/* Locator only; actual retained owner is checked on every call. */
typedef struct ynx_server_participant_token{uint64_t kind,serial;}ynx_server_participant_token;
veil_store_status ynx_source_client_server_unknown(ynx_source_server_hold *);
/* PUBLIC original records, only after true same-owner independent retirement;
 * status0 is a RAM copy, not device admission. short2 writes nothing; required
 * size returned, same thread, explicit close remains mandatory. */
int32_t ynx_source_first_device_server_copy_device_records_v1(ynx_server_participant_token,unsigned char *,size_t,size_t *);
int32_t ynx_source_first_device_server_acquire_v1(const ynx_server_original_input *,ynx_server_participant_token *);
int32_t ynx_source_first_device_server_current_v1(ynx_server_participant_token);
int32_t ynx_source_first_device_server_enter_v1(ynx_server_participant_token);
int32_t ynx_source_first_device_server_unknown_v1(ynx_server_participant_token);
int32_t ynx_source_first_device_server_retire_v1(ynx_server_participant_token,const ynx_server_terminal_input *);
int32_t ynx_source_first_device_server_close_v1(ynx_server_participant_token *);

/* Pre-source role acquisition: raw originals remain UNADMITTED. Unlike the
 * post-source server ABI, this requires neither Source nor Pending signatures.
 * The static platform must independently authenticate enrolled role policy,
 * original full history and exclusive issuer/independent-anchor ownership. */
/* purpose1 directory: prepared_original MUST be empty (prevents a pre-source
 * dependency cycle); purpose2 firstPrepared: original prepared bytes required.
 * Directory checkpoint means the existing unsigned signing material, not a
 * claimed/approved receipt. All canonical raw and fixed expiry are preserved. */
typedef struct ynx_role_original_input {
 ynx_original_bytes root,registration,status,credential,account_original,request,prepared_original,directory_checkpoint,namespace_prefix;
 const ynx_original_bytes *status_history;size_t status_history_count;
 const unsigned char *nonce;size_t nonce_size;uint32_t purpose,role;
} ynx_role_original_input;
typedef struct ynx_role_binding {
 ynx_original_bytes operation,custodian,frame;
 unsigned char nonce[32],head[32],classic_public[33],pq_public[2592];uint64_t sequence;uint32_t purpose,role;
} ynx_role_binding;
typedef struct ynx_platform_role_hold ynx_platform_role_hold;
typedef struct ynx_source_role_hold ynx_source_role_hold;
veil_store_status ynx_platform_role_acquire(const ynx_role_original_input *,ynx_platform_role_hold **);
veil_store_status ynx_platform_role_current(ynx_platform_role_hold *);
veil_store_status ynx_platform_role_projection(ynx_platform_role_hold *,ynx_role_binding *);
veil_store_status ynx_platform_role_enter(ynx_platform_role_hold *);
veil_store_status ynx_platform_role_close(ynx_platform_role_hold **);
veil_store_status ynx_source_client_role_acquire(const ynx_role_original_input *,ynx_source_role_hold **);
veil_store_status ynx_source_client_role_current(ynx_source_role_hold *);
veil_store_status ynx_source_client_role_projection(ynx_source_role_hold *,ynx_role_binding *);
veil_store_status ynx_source_client_role_enter(ynx_source_role_hold *);
veil_store_status ynx_source_client_role_close(ynx_source_role_hold **);


/* Fixed synchronous collector proof-of-claim call. This is NOT a callback table
 * and return0 alone does not grant signing: retained qualified role current +
 * enter are independently mandatory. Go must implement actual active context,
 * pinned binding/dispatch and durable exact SIGNING row checks under its lock. */
typedef struct ynx_source_claimed_intent{
 const unsigned char *operation;size_t operation_size;const unsigned char *nonce;
 uint64_t sequence;const unsigned char *head,*role;size_t role_size;
 const unsigned char *custodian;size_t custodian_size;
 const unsigned char *classic,*pq,*frame;size_t frame_size;
}ynx_source_claimed_intent;
int32_t ynx_source_collector_claimed_intent_v1(uint64_t owner,uint64_t collector,const ynx_source_claimed_intent *);
int32_t ynx_source_native_run_claimed_v1(uint64_t owner);
/* Actual holder custody identity, distinct from returned owning collector. */
typedef struct ynx_source_holder_token{uint64_t kind,serial;}ynx_source_holder_token;
int32_t ynx_source_directory_holder_open_v1(int32_t,uint32_t,const unsigned char *,size_t,const unsigned char *,size_t,const unsigned char *,size_t,ynx_source_holder_token *);
int32_t ynx_source_first_prepared_holder_open_v1(int32_t,uint32_t,const unsigned char *,size_t,const unsigned char *,size_t,const unsigned char *,size_t,ynx_source_holder_token *);
int32_t ynx_source_role_ready_collector_v1(ynx_source_holder_token,const ynx_role_original_input *,uint64_t *);
int32_t ynx_source_first_prepared_holder_close_v1(ynx_source_holder_token);


/* Persistent message session is acquired ONLY from a genuine committed device
 * root. Original envelopes are constraints, not a Root or capability. Initial
 * association authenticates the selected protected row; its short observation
 * window is not renewed nor required as a new official signature for each op.
 * Static provider must independently select admitted Root/enrollment, actual
 * protected row/version/ProtocolAddresses, bilateral relation and latest floor.
 * Each subsequent operation obtains its own fixed immutable request window. */
typedef struct ynx_message_session_input {
 uint32_t version;ynx_original_bytes issuer_credential,anchor_credential,purpose,association_issuer,association_anchor;
 ynx_original_bytes issuer_enrollment,anchor_enrollment;
 const ynx_original_bytes *issuer_history;size_t issuer_history_count;
 const ynx_original_bytes *anchor_history;size_t anchor_history_count;
} ynx_message_session_input;
typedef struct ynx_platform_message_session_hold ynx_platform_message_session_hold;
typedef struct veil_private_message_session_hold veil_private_message_session_hold;
/* Native matching facts obtained only under actual accepted-device current. */
typedef struct ynx_native_core_device_binding_v2 {unsigned char root[32],registration[32],classic[33],pq[2592];} ynx_native_core_device_binding_v2;
veil_store_status veil_private_message_session_acquire_v2(const veil_native_verified_commit *,const ynx_device_original_input *,const ynx_native_core_device_binding_v2 *,const ynx_message_session_input *,veil_private_message_session_hold **);
int32_t ynx_sdk_native_message_context_open_v2(const ynx_native_core_device_binding_v2 *,void **);
int32_t ynx_sdk_native_message_context_current_v2(void *);
int32_t ynx_sdk_native_message_context_close_v2(void **);
int32_t ynx_sdk_native_message_rights_borrow_v2(void *,ynx_original_bytes,uint32_t,uint32_t,uint64_t,void **);
int32_t ynx_sdk_native_core_rights_current_v2(void *);
int32_t ynx_sdk_native_core_rights_close_v2(void **);
int32_t ynx_sdk_native_core_gate_v2(void *,uint32_t);
int32_t ynx_sdk_native_message_budget_v2(void *,uint64_t *);
/* PUBLIC observation from actual owning session, not Native ratchet records. */
typedef struct ynx_message_session_projection {
 uint32_t version;ynx_original_bytes local_name,remote_name;uint32_t local_device,remote_device;
 unsigned char purpose_digest[32],selected_session_digest[32],relation_digest[32],checkpoint_digest[32];
 uint64_t relation_revision;int64_t purpose_expires_ms;
} ynx_message_session_projection;
/* NonOK may return SAME partially acquired owning session for cleanup. Never
 * retry from the error; provider keeps durable uncertainty/once state. */
veil_store_status ynx_platform_message_session_acquire(ynx_platform_final_hold *,const ynx_message_session_input *,ynx_platform_message_session_hold **);
veil_store_status ynx_platform_message_session_current(ynx_platform_message_session_hold *);
veil_store_status ynx_platform_message_session_projection(ynx_platform_message_session_hold *,ynx_message_session_projection *);
veil_store_status ynx_platform_message_session_close(ynx_platform_message_session_hold **);
veil_store_status veil_private_message_session_acquire(const veil_native_verified_commit *,const ynx_message_session_input *,veil_private_message_session_hold **);
veil_store_status veil_private_message_session_current(veil_private_message_session_hold *);
veil_store_status veil_private_message_session_projection(veil_private_message_session_hold *,ynx_message_session_projection *);
veil_store_status veil_private_message_session_close(veil_private_message_session_hold **);


/* Native-only per-operation facts, never an authorization carrier. The static
 * provider derives a fresh purpose-compatible lease/intent/journal under THIS
 * retained session and independently current device/floor. No official re-sign
 * per message; original request digest/nonce/window are fixed once by Native. */
typedef struct ynx_message_operation_input {uint32_t version,direction;unsigned char logical[16],request_digest[32],nonce[32];int64_t issued_ms,expires_ms;} ynx_message_operation_input;
veil_store_status ynx_platform_message_prepare(ynx_platform_message_session_hold *,const ynx_message_operation_input *,ynx_platform_prepared_hold **);
veil_store_status veil_private_message_operation_prepare(veil_private_message_session_hold *,const ynx_message_operation_input *,veil_private_prepared_input_owner **);
veil_store_status veil_private_message_operation_current(veil_private_prepared_input_owner *);
veil_store_status veil_private_message_operation_plan(veil_private_prepared_input_owner *,ynx_original_native_plan *);
veil_store_status veil_private_message_operation_enter(veil_private_prepared_input_owner *);
veil_store_status veil_private_message_operation_snapshot(veil_private_prepared_input_owner *,ynx_source_snapshot_hold **);

/* Synchronous Native-only computed journal. These original bytes are borrowed
 * from the actual held CryptoEngine computation, never JNI input authority.
 * Static provider validates same session/row versions/lease, protects records,
 * performs one fenced atomic queue+ratchet commit with pre-checkpoint, and
 * verifies independent terminal/current/floor before returning final custody. */
typedef struct ynx_native_computed_step {uint32_t kind,id,extra_id,device;ynx_original_bytes name,body;} ynx_native_computed_step;
veil_store_status ynx_platform_snapshot_protected_commit(ynx_platform_snapshot_hold *,const ynx_native_computed_step *,size_t,uint32_t,ynx_original_bytes,ynx_platform_final_hold **);
veil_store_status veil_private_verified_commit_snapshot_publish(ynx_platform_snapshot_hold *,ynx_storage_attempt **,const veil_native_intent_handle *,const ynx_native_computed_step *,size_t,uint32_t,ynx_original_bytes,veil_native_verified_commit **);
veil_store_status ynx_source_client_snapshot_protected_lookup(ynx_source_snapshot_hold *,veil_native_verified_commit **);
veil_store_status ynx_source_client_snapshot_protected_commit(ynx_source_snapshot_hold *,const ynx_native_computed_step *,size_t,uint32_t,ynx_original_bytes,veil_native_verified_commit **);

/* PRIVATE NativeCore normal startup composition. Fixed PUBLIC originals are
 * verified by the existing Source/account authenticators. No field is a Root
 * selector or an enforcing resource grant; the native supplier owns all spans. */
struct ynx_sdk_fixed_startup_originals;
typedef struct ynx_native_core_startup_input_v2 {
 uint32_t version,size;
 const struct ynx_sdk_fixed_startup_originals *fixed;
 ynx_original_bytes manifest,selected_bootstrap;
 ynx_original_bytes approval,issuer_current,anchor_current,association,account;
 uint64_t storage_generation;
 ynx_original_bytes origin[6];
 const ynx_original_bytes *origin_history;size_t origin_history_count;
 ynx_original_bytes accepted_relation; /* optional for FirstDevice, exact for Message */
} ynx_native_core_startup_input_v2;
typedef struct ynx_native_core_startup_hold ynx_native_core_startup_hold;
veil_store_status ynx_source_client_native_core_startup_v2(const ynx_native_core_startup_input_v2 *,ynx_native_core_startup_hold **);
veil_store_status ynx_source_client_native_core_startup_current_v2(ynx_native_core_startup_hold *);
veil_store_status ynx_source_client_native_core_startup_close_v2(ynx_native_core_startup_hold **);
_Static_assert(sizeof(ynx_native_core_startup_input_v2)==264,"private complete startup264 on selected64");
_Static_assert(offsetof(ynx_native_core_startup_input_v2,origin)==136,"private startup origin136");
#endif
