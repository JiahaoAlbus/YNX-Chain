#ifndef YNX_NATIVE_CORE_ENGINE_BINDING_PRIVATE_H
#define YNX_NATIVE_CORE_ENGINE_BINDING_PRIVATE_H
#include "ynx_source_original_resource_owner.h"
/* Serialized original, NOT a native struct or a grant. All integers BE64.
 * Existing Message3 effect/snapshot ABI160/216 is UNCHANGED. */
enum {
 YNX_CORE_ENGINE_BINDING_BYTES=416,
 YNX_CORE_ENGINE_INTENT=16, YNX_CORE_ENGINE_GENERATION=48,
 YNX_CORE_ENGINE_DEADLINE=56, YNX_CORE_ENGINE_BASE_REVISION=64,
 YNX_CORE_ENGINE_NEXT_REVISION=72, YNX_CORE_ENGINE_BASE_HASH=80,
 YNX_CORE_ENGINE_NEXT_HASH=112, YNX_CORE_ENGINE_CIPHER_HASH=144,
 YNX_CORE_ENGINE_JOURNAL_DIGEST=176, YNX_CORE_ENGINE_SOURCE_HEAD=208,
 YNX_CORE_ENGINE_SOURCE_SEQUENCE=240, YNX_CORE_ENGINE_ROW_COUNT=248,
 YNX_CORE_ENGINE_EFFECT_DIGEST=256, YNX_CORE_ENGINE_QUEUE_SELECTOR_HASH=288,
 YNX_CORE_ENGINE_RATCHET_SET_HASH=320, YNX_CORE_ENGINE_SOURCE_FRAME_HASH=352
};
/* 1=416B typed original, 2=whole normal YNXJRN1 original,
 * 3=actual retained source-history frame. Exact independent SQL readback.
 * Caller owns copied bytes; loan/finish remain owned by original inventories.
 * Invoke before message3_enter: no getter may bypass active-operation fence
 * inside a snapshot callback. Retain these originals in SAME Native attempt,
 * then compare effect_digest/intent/generation/deadline on each snapshot.
 * UNKNOWN observation is facts-only and never clears UNKNOWN or admits keys. */
veil_store_status ynx_native_core_resource_driver_engine_original_query(
 ynx_native_core_resource_loan *,uint32_t which,unsigned char *,size_t,size_t *);
#endif
