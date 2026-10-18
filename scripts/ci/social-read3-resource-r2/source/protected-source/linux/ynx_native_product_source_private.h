#ifndef YNX_NATIVE_PRODUCT_SOURCE_PRIVATE_H
#define YNX_NATIVE_PRODUCT_SOURCE_PRIVATE_H
#include "../ynx_source_platform_private.h"
#include "ynx_source_original_resource_owner.h"
struct ynx_native_core_resource_loan;
typedef struct veil_native_product_source veil_native_product_source;
/* Only the existing C verifiedCommit inventory can recognize root. Complete
 * device originals and the binding are copied synchronously. Retained partial
 * output is published BEFORE any fallible late-current work. It is cleanup
 * custody until current succeeds; it is never an Accepted observation grant. */
veil_store_status veil_private_product_source_acquire_v1(const veil_native_verified_commit *,const ynx_device_original_input *,const ynx_native_core_device_binding_v2 *,veil_native_product_source **);
veil_store_status veil_private_product_source_current_v1(veil_native_product_source *);
veil_store_status veil_private_product_source_reference_v1(veil_native_product_source *,unsigned char out[32]);
/* Read-only original failure; never clears UNKNOWN or revalidates authority. */
veil_store_status veil_private_product_source_first_cause_v1(veil_native_product_source *);
veil_store_status veil_private_product_source_close_v1(veil_native_product_source **);
/* A24 pure inventory, not current/business authority. Recognized same-thread
 * Source only. Unknown/foreign/thread failure leaves output untouched. */
typedef struct veil_native_product_source_inventory_v1 {
 uint32_t version,size,registered,same_thread,active,unknown;
 uint64_t transaction_children;
 int32_t first_cause;
 uint32_t root_retained,context_retained,drained;
} veil_native_product_source_inventory_v1;
/* 48 bytes: children@24, first@32, root@36, context@40, drained@44.
 * Query OK means inventory read, NEVER business grant or drained. */
veil_store_status veil_private_product_source_inventory_v1(veil_native_product_source *,veil_native_product_source_inventory_v1 *);
/* Cleanup does not require business freshness. Publish actual remaining
 * inventory or drained after actual drops. NULL+UNKNOWN retains original
 * failure in the report; caller must retain it independently of the slot. */
veil_store_status veil_private_product_source_close_observe_v1(veil_native_product_source **,veil_native_product_source_inventory_v1 *);
/* Internal final-root/driver association only, not a public provider port. */
veil_store_status ynx_native_core_resource_driver_product_reference_v1(struct ynx_native_core_resource_loan *,const ynx_native_core_device_binding_v2 *,unsigned char out[32]);
#endif
