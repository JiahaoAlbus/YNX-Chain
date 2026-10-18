#ifndef YNX_NATIVE_CORE_STORE_READONLY_PRIVATE_H
#define YNX_NATIVE_CORE_STORE_READONLY_PRIVATE_H
#include "ynx_source_original_resource_owner.h"
/* Facts only, never an acquisition/admission/capability/permission. Requires the
 * SAME recognized policy resource. No caller intent/path/account selector.
 * Store ref32 is SHA256 of registered association/key/dev/inode/generation,
 * stable across process restart for that registration, NOT account authority.
 * JNI must associate it with its existing verified account/CoreLoan; it must
 * never use this ref alone to open a DB or manufacture an accountStoreRef.
 * New restore registration/generation has a different ref. */
veil_store_status ynx_native_core_resource_driver_store_reference_v1(
 ynx_native_core_resource_loan *,unsigned char out32[32]);
/* Existing original intent only. Reads both independently owned domain DBs
 * under original registered fence; no expiry renewal, write, signing, finish,
 * nonce allocation or clearing UNKNOWN. Receipt only when BOTH state=2 rows
 * have equal exact bytes; kind1/2/3 remain commit/checkpoint/terminal.
 * Missing/partial/mismatch never means NOT_APPLIED or FINALIZED. On success
 * facts_written=1 even if return UNKNOWN because owner is already unresolved.
 * Any non-OK/no facts result leaves caller metadata/ciphertext untouched and
 * written=0. Caller owns receipt copy; no borrow survives resource close.
 * This readback is neither authenticated receipt acceptance nor FINALIZED nor
 * qualified_current; verifier/current/revoke remain independently mandatory.
 */
typedef struct ynx_native_core_terminal_observation_v1 {
 uint32_t version,kind;uint64_t generation,deadline;
 unsigned char intent[32],store_reference[32],receipt_digest[32];
 uint32_t facts_written,owner_unknown;
} ynx_native_core_terminal_observation_v1;
_Static_assert(sizeof(ynx_native_core_terminal_observation_v1)==128,"read-only observation128");
veil_store_status ynx_native_core_resource_driver_terminal_observe_v1(
 ynx_native_core_resource_loan *,uint32_t kind,
 ynx_native_core_terminal_observation_v1 *,unsigned char *receipt,
 size_t capacity,size_t *written);
/* Same held original effect only, kind=0. Observes local status=5 original
 * AFTER SQLite commit. This is NOT cross-domain commit/finalization, and an
 * absent row is UNKNOWN, never permission to retry or a NOT_APPLIED verdict.
 * Same output/UNKNOWN preservation contract as terminal_observe. */
veil_store_status ynx_native_core_resource_driver_effect_observe_v1(
 ynx_native_core_resource_loan *,ynx_native_core_terminal_observation_v1 *,
 unsigned char *effect,size_t capacity,size_t *written);
#endif
