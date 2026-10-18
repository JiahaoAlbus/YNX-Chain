#ifndef VEIL_SUPPLIER_OWNER_PRIVATE_H
#define VEIL_SUPPLIER_OWNER_PRIVATE_H
#include "veil_producer_private.h"
/* PRIVATE Model A LINK contract v1, not public ABI5/JNI or admission factory.
 * These opaque input names are REQUIRED Main/Hypatia owning adapter slots,
 * NOT claims that accepted product implementations/types already exist.
 * No struct definition, callback installer, metadata/root/boolean constructor.
 * See PRIVATE-MODEL-A-OWNERSHIP.md for exact provenance and error obligations.
 */
typedef struct veil_product_accepted_origin_owner veil_product_accepted_origin_owner;
typedef struct veil_product_accepted_device_owner veil_product_accepted_device_owner;
typedef struct veil_product_prepared_history_owner veil_product_prepared_history_owner;
typedef struct veil_selected_retained_original_owner veil_selected_retained_original_owner;
typedef struct veil_private_prepared_input_owner veil_private_prepared_input_owner;
typedef struct veil_private_authenticated_once_owner veil_private_authenticated_once_owner;
typedef struct veil_private_protected_output_owner veil_private_protected_output_owner;
typedef struct veil_private_held_original_owner veil_private_held_original_owner;
/* Exclusive same-held projection, never an admission constructor. Acquisition
 * requires the actual prepared owner and existing genuine guard/pin. Retains
 * those exact owners; guard release is refused until this borrow is dropped.
 * No pointer/token/current flag can manufacture accepted inputs here. */
veil_store_status veil_private_held_original_acquire(
  veil_private_effect_guard *,veil_private_intent_pin *,
  const veil_private_prepared_input_owner *,veil_private_held_original_owner **);
veil_store_status veil_private_held_original_validate(
  const veil_private_held_original_owner *);
/* Operations use the held owner's retained internal pin, never a caller's
 * released original pin. Outputs follow existing verified-commit contracts. */
veil_store_status veil_private_held_original_recover(
  const veil_private_held_original_owner *,veil_native_verified_commit **);
veil_store_status veil_private_held_original_acknowledge(
  const veil_private_held_original_owner *,const veil_native_verified_commit *);
/* Cleanup does not require an unexpired permission, but does require original
 * thread and completed SQLite cleanup. UNKNOWN remains durable and untouched. */
veil_store_status veil_private_held_original_drop(veil_private_held_original_owner **);
/* PRE-GUARD only. Private accepted owners, not projection strings/descriptor.
 * Actual supplier retains ALL inputs on success; failure retains caller inputs.
 * No effect/permission from preparation alone. Out is owning RAM reference.
 * Default REQUIRED clears out and performs no validation/retention/effect. */
veil_store_status veil_private_prepare_accepted_inputs(
  const veil_product_accepted_origin_owner *,
  const veil_product_accepted_device_owner *,
  const veil_product_prepared_history_owner *,
  const veil_selected_retained_original_owner *,
  veil_private_prepared_input_owner **);
/* Owner-thread refs. No consume of original and no durable history deletion.
 * Borrowed capabilities live until last prepared-owner+dependent-holder drop.
 * Same original objects on every borrow; never rebuild/re-encrypt a retry. */
veil_store_status veil_private_prepared_input_retain(
  const veil_private_prepared_input_owner *,veil_private_prepared_input_owner **);
veil_store_status veil_private_prepared_input_borrow(
  const veil_private_prepared_input_owner *,
  const veil_required_native_admission **,
  const veil_verified_native_operation_lease **,
  const veil_native_intent_handle **);
/* Synchronous same held genuine guard/pin/original, no network, callbacks,
 * signing, release or reacquire. Fresh/recovered intent follows private owner
 * origin/history, never a public mode flag. Uncertain validation is UNKNOWN. */
veil_store_status veil_private_prepared_input_validate(
  veil_private_effect_guard *,veil_private_intent_pin *,
  const veil_private_prepared_input_owner *);
veil_store_status veil_private_prepared_input_drop(veil_private_prepared_input_owner **);
/* Existing veil_native_verified_commit is the final OWNING RAM root, not
 * source-hold BORROW. Genuine successful source_publish_once transfers one ref
 * to producer/caller; root independently retains original/protected output and
 * accepted origin/history refs before guard release. Errors DO NOT transfer.
 * Defaults cannot recognize/free any non-null foreign owner and retain it.
 */
veil_store_status veil_private_verified_commit_retain(
  const veil_native_verified_commit *,veil_native_verified_commit **);
/* Opaque bounded projections only; no plaintext, raw tuple or receipt bytes.
 * Views are borrowed from commit until final drop; non-null is not permission. */
veil_store_status veil_private_verified_commit_borrow(
  const veil_native_verified_commit *,
  const veil_native_intent_handle **,
  const veil_private_authenticated_once_owner **,
  const veil_private_protected_output_owner **);
/* Repeated delivery uses the SAME commit identity without another CAS/effect.
 * Acknowledgement verifies already durable once under SAME guard and owner.
 * Ambiguous acknowledgement retains commit and returns UNKNOWN, never retry
 * encryption. Each acquisition/guard follows B1, no cache invalidation. */
veil_store_status veil_private_verified_commit_acknowledge(
  veil_private_effect_guard *,veil_private_intent_pin *,
  const veil_private_prepared_input_owner *,const veil_native_verified_commit *);
/* Reopen: preprepared independently authenticated exact-original final history
 * -> same genuine RECOVERY guard+pin (and existing B witness), recover SAME
 * final result identity, not another consumption/operation. No network inside.
 * Missing/corrupt/incomplete history or output custody stays REQUIRED/UNKNOWN.
 */
veil_store_status veil_private_verified_commit_recover(
  veil_private_effect_guard *,veil_private_intent_pin *,
  const veil_private_prepared_input_owner *,veil_native_verified_commit **);
veil_store_status veil_private_verified_commit_drop(veil_native_verified_commit **);
#endif
