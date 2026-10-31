#include <stddef.h>
#include "../native/ynx_sdk_social_platform_policy_v1.h"
_Static_assert(offsetof(ynx_sdk_social_platform_binding_v1,policy_generation)==24,"u64 is not storage-only generation");
_Static_assert(offsetof(ynx_sdk_social_platform_binding_v1,key_epoch)==40,"independent original epoch");
_Static_assert(offsetof(ynx_sdk_social_platform_binding_v1,registration_revision)==48,"independent original registered revision");
_Static_assert(offsetof(ynx_sdk_social_platform_binding_v1,account)==64,"five32B tuples");
_Static_assert(offsetof(ynx_sdk_social_platform_query_binding_v1,original)==8,"old original224 follows query header");
_Static_assert(offsetof(ynx_sdk_social_platform_query_binding_v1,query_deadline_ns)==232,"query240 owns independent deadline");
_Static_assert(YNX_SDK_SOCIAL_ORDINARY_CAPABILITIES_V1==255u,"ordinary exact capabilities");
_Static_assert(YNX_SDK_SOCIAL_STRONG_CAPABILITIES_V1==65791u,"strong ABI is not ordinary V4 grant");
