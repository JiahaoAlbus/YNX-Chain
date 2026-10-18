#ifndef YNX_INITIALIZATION_FINAL_PRIVATE_H
#define YNX_INITIALIZATION_FINAL_PRIVATE_H
#include "ynx_initialization_finish_private.h"
#include "ynx_source_final_owner.h"
/* Reserve cleanup custody after actual init COMMIT, before M3. This is NOT a
 * qualified Accepted result. Bind requires original driver's independent
 * Engine+Checkpoint+Terminal retire/floor/current; ordinary message untouched. */
veil_store_status ynx_final_hold_reserve_initialization(ynx_native_core_resource_loan *,veil_native_finish_result *,ynx_platform_final_hold **);
/* Cleanup ownership output, never permission. remaining0 means no init
 * lease remains even when status preserves UNKNOWN; do not release twice. */
veil_store_status ynx_native_core_resource_initialization_lease_close_v2(ynx_native_core_resource_loan *,int *remaining);
#endif
