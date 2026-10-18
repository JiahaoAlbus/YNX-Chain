#ifndef YNX_NATIVE_CORE_MESSAGE3_PRIVATE_H
#define YNX_NATIVE_CORE_MESSAGE3_PRIVATE_H
#include "ynx_source_original_resource_owner.h"
#include "../android/ynx_native_core_binding.h"
/* PRIVATE same-artifact C/Rust bridge. Not a Node/Java wire, installer,
 * grant, Root, public caller result or new Message3 method/signing domain.
 * C original resource and Rust original custody inventories recognize their
 * OWN opaque pointers independently. No Rust Accepted value constructs C.
 *
 * A's C callee bodies exist in ynx_native_core_message3_driver.inc.
 * Main owns the three actual Rust SDK exports below; not yet linked here.
 * Never substitute a status stub for that recognized SDK implementation.
 */
enum ynx_native_core_message3_kind {
 YNX_CORE_M3_ENGINE_COMMIT=1,YNX_CORE_M3_CHECKPOINT=2,YNX_CORE_M3_TERMINAL=3
};
/* C -> Rust: read-only observations of this SAME actual protected transaction.
 * Binding is still independently borrowed from same_policy by SDK. C fields
 * cannot supply Root/account/device/role authorization or replace originals.
 * Rust matches the actual body using its typed normal source/operation context,
 * actual retained role enrollment/current and original frame grammar.
 */
typedef struct ynx_native_core_message3_effect_v1 {
 uint32_t version,kind;
 uint64_t storage_generation,policy_generation,deadline;
 unsigned char intent[32],effect_digest[32];
 ynx_original_bytes effect_original,checkpoint_original,domain_originals[2];
} ynx_native_core_message3_effect_v1;
/* Rust -> C: snapshots borrowed from a RECOGNIZED actual SDK custody holder.
 * Frames/signature parts/receipt come from that holder's own retained attempt,
 * never from Node caller arguments, flags, DTOs or ordinary void input checks.
 * id/body/frames stay exact from enter through retire. Non-OK may retain public
 * partial bytes; owner remains recognized and is not released/reacquired.
 * On recognized in-flight key_leave, SDK MUST fill retained public parts
 * even when returning its original current/signer error. Cleanup observation
 * is NOT authorization. Foreign/unrecognized holders leave zero. Missing
 * validated observation retains the original borrow and UNKNOWN in C.
 */
typedef struct ynx_native_core_message3_snapshot_v1 {
 uint32_t version,kind,phase,role_count;
 uint64_t storage_generation,policy_generation,deadline;
 unsigned char intent[32];
 ynx_original_bytes id,body,frames[2],classic[2],pq[2],receipt;
} ynx_native_core_message3_snapshot_v1;
_Static_assert(sizeof(ynx_native_core_message3_effect_v1)==160,"M3 effect facts160");
_Static_assert(sizeof(ynx_native_core_message3_snapshot_v1)==216,"M3 Native snapshot216");
/* Main Rust owner implements: before returning OK, independently recognizes
 * holder and same_policy in SDK inventories, matches SAME startup and exact
 * operation identity, original purpose/current/expiry/role enrollment, then
 * matches body/frame against actual normal context AND these C transaction
 * observations. It must not treat C facts, verify-signature success or an
 * unqualified held key pair as signing admission. No accepted-result
 * prerequisite is introduced before the first engineCommit signature.
 * Caller owns NO returned span; Native holder keeps them through C finish.
 */
int32_t ynx_sdk_native_message3_snapshot_v1(void *same_holder,void *same_policy,
 const ynx_native_core_message3_effect_v1 *,ynx_native_core_message3_snapshot_v1 *);
/* Parent native lifetime pin only; does not grant effect/key permission.
 * Main must refuse disposal while C's original attempt retains it. No new
 * opaque loan/root type is installed. Failure retains original borrow.
 */
int32_t ynx_sdk_native_message3_retain_v1(void *same_holder,void *same_policy);
int32_t ynx_sdk_native_message3_release_v1(void *same_holder,void *same_policy);

/* A Linux owner implements in original resource owner, not a new wrapper:
 * effect_facts: output original local effect/checkpoint facts, not projection.
 * enter: take snapshot from actual holder; durable reserve BEFORE signatures.
 * key_enter/leave: same coordinator, exact frame/role/classic-vs-PQ once bit,
 * current/revoke/cancel/time gates before and after actual key use. Failed
 * entry/leave is sticky UNKNOWN; no retry with a fresh wrapper/role handle.
 * No network while key guard held. Leave must run even after sign failure,
 * preserving partial signature bytes in original Native holder.
 * retire: exact original Native snapshot must contain required REAL parts,
 * compare to enter facts, COMMIT receipt in both actual domain stores, then
 * independent SELECT original readback <=65536; out is copied ONLY from that
 * readback. Late refusal retains written/out bytes and original receipt.
 * Auth public holder.retire(id,receipt) signature and legacy9 void stay intact.
 */
veil_store_status ynx_native_core_resource_driver_message3_effect_facts(
 ynx_native_core_resource_loan *,uint32_t,ynx_native_core_message3_effect_v1 *);
veil_store_status ynx_native_core_resource_driver_message3_enter(
 ynx_native_core_resource_loan *,void *same_holder,uint32_t kind);
veil_store_status ynx_native_core_resource_driver_message3_key_enter(
 ynx_native_core_resource_loan *,void *same_holder,uint32_t kind,uint32_t role_index,uint32_t pq);
veil_store_status ynx_native_core_resource_driver_message3_key_leave(
 ynx_native_core_resource_loan *,void *same_holder,uint32_t kind,veil_store_status actual_key_status);
veil_store_status ynx_native_core_resource_driver_message3_retire(
 ynx_native_core_resource_loan *,void *same_holder,uint32_t kind,
 unsigned char *out,size_t capacity,size_t *written);
/* Per-domain MAC-authenticated public partial readback. Same intent only;
 * no signing, new bit, counter/phase mutation, receipt fabrication or replay.
 * domain=0/1, kind=1..3; output YNXCOREM3PART1 (80B header + actual parts).
 * On UNKNOWN, *written can still preserve authenticated observed bytes. */
veil_store_status ynx_native_core_resource_driver_message3_parts_query(
 ynx_native_core_resource_loan *,uint32_t kind,uint32_t domain,
 unsigned char *,size_t,size_t *);
/* Same ORIGINAL resource loan qualified by actual counter/domain state plus
 * the recognized Native five-role chain. Original SDK policy binding remains
 * byte-for-byte unchanged; observed committed floor/head are separate facts.
 * Borrowed receipt spans valid only while original resource loan lives.
 * NOT an AcceptedSource/Device constructor or a new opaque Root. */
typedef struct ynx_native_core_qualified_projection_v1 {
 uint32_t version,size;ynx_native_core_enforcing_binding_v2 original_binding;
 uint64_t committed_floor[2];unsigned char committed_head[2][32];
 ynx_original_bytes receipts[3];
} ynx_native_core_qualified_projection_v1;
_Static_assert(sizeof(ynx_native_core_qualified_projection_v1)==376,"M3 projection376");
veil_store_status ynx_native_core_resource_driver_qualified_current(ynx_native_core_resource_loan *);
veil_store_status ynx_native_core_resource_driver_qualified_projection(
 ynx_native_core_resource_loan *,ynx_native_core_qualified_projection_v1 *);
#endif

