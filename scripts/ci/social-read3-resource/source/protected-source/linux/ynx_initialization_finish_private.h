#ifndef YNX_INITIALIZATION_FINISH_PRIVATE_H
#define YNX_INITIALIZATION_FINISH_PRIVATE_H
#include "ynx_source_original_resource_owner.h"
#include "ynx_storage_initialization_aad_private.h"
/* Concrete normal finish subtype. Preparation owns SAME recognized Core
 * resource/lease; it is NOT a locally committed finish or a Source grant.
 * Zero actor/session/route/device-authorization fields are NOT synthesized.
 * All spans remain borrowed only while actual finish keeps its resource pin.
 */
typedef struct ynx_initialization_finish_original_v1 {
 uint32_t version,size;uint64_t generation,deadline;
 ynx_storage_initialization_aad_v1 aad;
 ynx_original_bytes intent_original,journal,ciphertext;
 unsigned char store_reference[32];
} ynx_initialization_finish_original_v1;
_Static_assert(sizeof(ynx_initialization_finish_original_v1)==632,"initialization source632");
veil_store_status veil_native_initialization_finish_create(ynx_native_core_resource_loan *,veil_native_finish_result **);
veil_store_status ynx_finish_initialization_identity_matches(veil_native_finish_result *,ynx_native_core_resource_loan *);
veil_store_status ynx_finish_initialization_prepared_current(veil_native_finish_result *,ynx_native_core_resource_loan *);
veil_store_status ynx_finish_initialization_prepared_retain(veil_native_finish_result *,ynx_native_core_resource_loan *,veil_native_finish_result **);
veil_store_status ynx_finish_initialization_original_borrow(veil_native_finish_result *,ynx_native_core_resource_loan *,ynx_initialization_finish_original_v1 *);
veil_store_status ynx_finish_initialization_commit_observed(veil_native_finish_result *,ynx_native_core_resource_loan *);
/* Fixed C/C resource SPI, never public caller-supplied callbacks/flags.
 * retained/released are actual ownership OUTPUTS, not admission inputs. */
veil_store_status ynx_native_core_resource_initialization_finish_attach(ynx_native_core_resource_loan *,veil_native_finish_result *,int *retained);
veil_store_status ynx_native_core_resource_initialization_finish_originals(ynx_native_core_resource_loan *,veil_native_finish_result *,ynx_initialization_finish_original_v1 *);
veil_store_status ynx_native_core_resource_initialization_finish_release(ynx_native_core_resource_loan *,veil_native_finish_result *,int *released);
veil_store_status ynx_native_core_resource_initialization_finished_current(ynx_native_core_resource_loan *,veil_native_finish_result *);
/* Bind actual inventory-owned initialization finish, no data operand. */
veil_store_status ynx_native_core_resource_driver_initialization_bind_finish_v1(ynx_native_core_resource_loan *,veil_native_finish_result *);
/* Exact Main typed initialization context720, independent readback only. */
veil_store_status ynx_native_core_resource_driver_initialization_engine_context_query(ynx_native_core_resource_loan *,unsigned char *,size_t,size_t *);
#endif
