#ifndef YNX_NATIVE_CORE_INITIALIZATION_JOURNAL_PRIVATE_H
#define YNX_NATIVE_CORE_INITIALIZATION_JOURNAL_PRIVATE_H
#include "ynx_source_original_resource_owner.h"
/* Same original resource owns immutable canonical YNXJRN1 bytes immediately
 * after its one protected seal; no second encryption or caller row operand.
 * This is the source of the single typed ordered record, not a capability,
 * checked-write finish, engine binding or a claim that journal was committed.
 * Out pointers borrowed only until same resource close. NonOK output untouched.
 * Missing Source/intent/lease capability may not be substituted by these bytes.
 * No actor/session/outbox is synthesized for first-device bootstrap.
 */
typedef struct ynx_native_core_initialization_journal_v1 {
 uint32_t version,native_kind,journal_steps,queue_count;
 ynx_original_bytes journal;
 unsigned char journal_digest[32],cipher_digest[32];
} ynx_native_core_initialization_journal_v1;
_Static_assert(sizeof(ynx_native_core_initialization_journal_v1)==96,"typed journal96");
veil_store_status ynx_native_core_resource_driver_initialization_journal_borrow_v1(
 ynx_native_core_resource_loan *,ynx_native_core_initialization_journal_v1 *);
#endif
