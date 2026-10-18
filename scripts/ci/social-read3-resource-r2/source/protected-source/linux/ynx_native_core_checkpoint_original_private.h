#ifndef YNX_NATIVE_CORE_CHECKPOINT_ORIGINAL_PRIVATE_V1_H
#define YNX_NATIVE_CORE_CHECKPOINT_ORIGINAL_PRIVATE_V1_H
#include <stdint.h>
#include <stddef.h>
#include "ynx_source_original_resource_owner.h"
/* Copied read-only actual observations, never signing admission. Only the SAME
 * recognized resource can select its registered anchor floor Name. CP raw
 * bytes remain available through existing message3_effect_facts(kind2/3).
 * Each intent has one CP/terminal slot; domain state sequence is NOT a signing
 * history sequence. No predecessor is manufactured by this query. */
typedef struct ynx_native_core_checkpoint_original_v1 {
 uint32_t version,size;uint64_t anchor_floor;
 unsigned char anchor_counter_name[34],reserved[6];
 unsigned char checkpoint_digest[32],output_cipher_hash[32];
} ynx_native_core_checkpoint_original_v1;
_Static_assert(sizeof(ynx_native_core_checkpoint_original_v1)==120,"checkpoint original120");
_Static_assert(offsetof(ynx_native_core_checkpoint_original_v1,anchor_counter_name)==16,"CP Name16");
_Static_assert(offsetof(ynx_native_core_checkpoint_original_v1,checkpoint_digest)==56,"CP digest56");
_Static_assert(offsetof(ynx_native_core_checkpoint_original_v1,output_cipher_hash)==88,"CP actual cipher88");
/* No returned pointers or new owner. Non-OK leaves output unchanged. This query
 * executes no increment, reserve, seal, sign, CAS or terminal action. Source
 * policy/current/revoke/joint fence remain necessary before and after. */
veil_store_status ynx_native_core_resource_driver_checkpoint_original_query(
 ynx_native_core_resource_loan *,ynx_native_core_checkpoint_original_v1 *);
#endif
