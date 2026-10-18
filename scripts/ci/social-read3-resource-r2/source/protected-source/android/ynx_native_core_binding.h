#ifndef YNX_NATIVE_CORE_BINDING_H
#define YNX_NATIVE_CORE_BINDING_H
#include <stdint.h>
typedef struct ynx_native_core_enforcing_binding_v2 {
 uint32_t version,purpose,operations,relation_present;
 uint64_t storage_generation,policy_generation,floor,deadline;
 unsigned char head[32],intent[32],association[32],device[32],registration[32],relation[32];
} ynx_native_core_enforcing_binding_v2;
_Static_assert(sizeof(ynx_native_core_enforcing_binding_v2)==240,"Core matching binding v2 size");
int32_t ynx_sdk_native_core_enforcing_binding_v2(void *,ynx_native_core_enforcing_binding_v2 *);
#endif
