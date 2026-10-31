#ifndef YNX_SDK_SOCIAL_PLATFORM_POLICY_V1_H
#define YNX_SDK_SOCIAL_PLATFORM_POLICY_V1_H
#include <stdint.h>
/* SDK shared DATA layout. No owner constructor, Root/capability installer,
 * signing function or storage fallback. Actual selection getters remain Main.
 * The old strong NativeCore binding240/v2 is a different type, never aliased.
 */
enum { YNX_SDK_SOCIAL_PLATFORM_PROTECTED_V1=1, YNX_SDK_SOCIAL_STRONG_JOINT_V1=2 };
enum { YNX_SDK_SOCIAL_CAP_PROTECTED_STORAGE=1u,YNX_SDK_SOCIAL_CAP_ACCOUNT_NAMESPACE=2u,
 YNX_SDK_SOCIAL_CAP_PURPOSE_KEY_EPOCH=4u,YNX_SDK_SOCIAL_CAP_NATIVE_RESTRICTED_OWNER=8u,
 YNX_SDK_SOCIAL_CAP_REGISTERED_CURRENT_REVOKE=16u,YNX_SDK_SOCIAL_CAP_ORIGINAL_TRANSACTION=32u,
 YNX_SDK_SOCIAL_CAP_DURABLE_UNKNOWN_QUERY=64u,YNX_SDK_SOCIAL_CAP_ORIGINAL_PROTOCOL=128u,
 YNX_SDK_SOCIAL_CAP_STRONG_JOINT=65536u };
#define YNX_SDK_SOCIAL_ORDINARY_CAPABILITIES_V1 255u
#define YNX_SDK_SOCIAL_STRONG_CAPABILITIES_V1 65791u
#define YNX_SDK_SOCIAL_POLICY_ORIGINAL_VERSION 3u
#define YNX_SDK_SOCIAL_CURRENT_ORIGINAL_VERSION 3u
#define YNX_SDK_SOCIAL_ROOT_RELEASE_VERSION 4u
#define YNX_SDK_SOCIAL_CREDENTIAL_DELEGATION_VERSION 4u
#define YNX_SDK_SOCIAL_RUNTIME_APPROVAL_VERSION 4u
#define YNX_SDK_SOCIAL_READ_OPERATION_V1 3u
/* All generations/epoch/revision/deadline and five actual32-byte tuples must
 * come from the original authenticated policy/current and issued held slot.
 * Key epoch/registration revision are never inferred from storage generation.
 */
typedef struct ynx_sdk_social_platform_binding_v1 {
 uint32_t version,size,profile,purpose,operation,capabilities;
 uint64_t policy_generation,storage_generation,key_epoch,registration_revision,deadline_ns;
 unsigned char account[32],namespace_id[32],registration[32],device[32],intent[32];
} ynx_sdk_social_platform_binding_v1;
/* original retains its old effect deadline/epoch/gen. Fresh current READ224/op3
 * is separately held; its independent query deadline cannot renew old effects.
 */
typedef struct ynx_sdk_social_platform_query_binding_v1 {
 uint32_t version,size;
 ynx_sdk_social_platform_binding_v1 original;
 uint64_t query_deadline_ns;
} ynx_sdk_social_platform_query_binding_v1;
typedef struct ynx_sdk_social_platform_diagnostic_v1 {
 uint32_t version,size,code_capabilities,material_capabilities;
} ynx_sdk_social_platform_diagnostic_v1;
#if defined(__cplusplus)
static_assert(sizeof(ynx_sdk_social_platform_binding_v1)==224,"Social DATA ordinary224 distinct from strong240");
static_assert(sizeof(ynx_sdk_social_platform_query_binding_v1)==240,"Social DATA query240 contains original224");
#else
_Static_assert(sizeof(ynx_sdk_social_platform_binding_v1)==224,"Social DATA ordinary224 distinct from strong240");
_Static_assert(sizeof(ynx_sdk_social_platform_query_binding_v1)==240,"Social DATA query240 contains original224");
#endif
/* This release/delegation V4 grant is ONLY PolicyV3 ordinary/profile1/caps255.
 * ABI profile2 metadata is not a strong V3 grant; future strong requires a new
 * explicit Root authorization. Original V2 policies/strong240 remain exact.
 */
#endif
