#ifndef YNX_SOCIAL_FINITE_JOINT_CUSTODIAN_PRIVATE_V1_H
#define YNX_SOCIAL_FINITE_JOINT_CUSTODIAN_PRIVATE_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_social_finite_joint_custodian_v1 ynx_social_finite_joint_custodian_v1;
typedef struct {const unsigned char*data;size_t size;} ynx_social_finite_joint_bytes_v1;
typedef struct {uint32_t version,size,error_present;int32_t original_first;uint32_t physical_done,unknown;} ynx_social_finite_joint_status_v1;
/* PRIVATE normal finite operation, never a raw signer/QA approval/family1..4.
 * Originals are registration, issuer credential body, anchor credential body,
 * signed history envelope copied from recognized current Source. They remain
 * constraints; remote service independently verifies original Root/current.
 * No Go reference/pointer/token, caller path/UID/nonce/key/clock may cross UID.
 * role1=record-issuer,2=record-anchor. Exact original body16<=32768/frame<=49152.
 * Registered rows select peer/socket/source/binding/custody; default empty.
 * Metadata open MUST NOT open wrapping/private key or write journal intent.
 * Output owner/status are zero-initialized; adopt nonnull partial before error.
 * status v1/size24, error_present1 with original_first0 is still failure.
 */
typedef struct {
 uint32_t version,size;
 unsigned char source_resource[32],binding_resource[32],role_resource[32];
 uint32_t role,reserved_zero;
 ynx_social_finite_joint_bytes_v1 originals[4];
 ynx_social_finite_joint_bytes_v1 body_original,source_frame_original;
} ynx_social_finite_joint_request_v1;
void ynx_social_finite_joint_custodian_open_v1(const ynx_social_finite_joint_request_v1*,ynx_social_finite_joint_custodian_v1**,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_custodian_current_v1(ynx_social_finite_joint_custodian_v1*,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_custodian_enter_original_once_v1(ynx_social_finite_joint_custodian_v1*,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_custodian_durable_original_intent_current_v1(ynx_social_finite_joint_custodian_v1*,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_custodian_sign_once_v1(ynx_social_finite_joint_custodian_v1*,ynx_social_finite_joint_status_v1*);
/* Copy/query no new input, output max65536; written initially0. Adopt copied
 * PUBLIC partial bytes before paired error. Query never writes/loads/signs. */
void ynx_social_finite_joint_custodian_copy_original_v1(ynx_social_finite_joint_custodian_v1*,unsigned char*,size_t,size_t*,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_custodian_query_original_v1(ynx_social_finite_joint_custodian_v1*,unsigned char*,size_t,size_t*,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_custodian_retire_v1(ynx_social_finite_joint_custodian_v1*,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_custodian_join_v1(ynx_social_finite_joint_custodian_v1*,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_custodian_close_v1(ynx_social_finite_joint_custodian_v1**,ynx_social_finite_joint_status_v1*);
/* Existing registered launcher supplies inherited PUBLIC endpoint FD only.
 * RoleUID owns its private directories and performs listen; no service starts
 * on import/open. Resource selection, actual SO_PEERCRED/current/image required. */
int32_t ynx_social_finite_joint_custodian_serve_registered_v1(const unsigned char*,size_t,int32_t);
#ifdef __cplusplus
}
static_assert(sizeof(ynx_social_finite_joint_request_v1)==208);
static_assert(sizeof(ynx_social_finite_joint_status_v1)==24);
#endif
#endif
