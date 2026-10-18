#ifndef YNX_NATIVE_CORE_ENGINE_CONTEXT_PRIVATE_H
#define YNX_NATIVE_CORE_ENGINE_CONTEXT_PRIVATE_H
#include "ynx_source_original_resource_owner.h"
/* Private facts from SAME finish/loan's independently read whole YNXJRN1.
 * Output120: sourceAbi32 at0; coordinates[11] at32, each serialized BE64.
 * Original selected storage AAD defines sourceAbi offset160, coordinates72.
 * Every record AND queue must agree; no single-row selection, reconstruction
 * from tuple/body/Accepted, guessed default or permission output.
 * No change to typed416, engine_original_query selectors1/2/3 or M3 ABI160/216.
 * Copied bytes belong to caller; on UNKNOWN written can retain facts only.
 * Call outside active snapshot (normal same-attempt pre-enter acquisition).
 */
enum {YNX_CORE_ENGINE_CONTEXT_BYTES=120,YNX_CORE_ENGINE_CONTEXT_COORDINATES=32};
veil_store_status ynx_native_core_resource_driver_engine_context_query(
 ynx_native_core_resource_loan *,unsigned char *,size_t,size_t *);
#endif
