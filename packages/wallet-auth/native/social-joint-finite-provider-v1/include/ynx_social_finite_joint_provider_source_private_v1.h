#ifndef YNX_SOCIAL_FINITE_JOINT_PROVIDER_SOURCE_PRIVATE_V1_H
#define YNX_SOCIAL_FINITE_JOINT_PROVIDER_SOURCE_PRIVATE_V1_H
#include "social_joint_profile_issuer_private.h"
#ifdef __cplusplus
extern "C" {
#endif
/* PRIVATE same role-process Go bridge. No Root installer/provider callback.
 * open receives SourceInputv2 with ref0; verifies original approved_profiles,
 * credentials/history/catalog/checkpoint and cap10, retaining SAME history.
 * This returns a retained local owner, never a cross-UID Go ref or JSON grant.
 */
void ynx_auth_social_joint_provider_source_open_v1(ynx_social_joint_source_input_v1*,uint64_t*,ynx_social_joint_status_v1*);
void ynx_auth_social_joint_provider_source_reference_v1(uint64_t,uint64_t*,ynx_social_joint_status_v1*);
void ynx_auth_social_joint_provider_source_current_v1(uint64_t,ynx_social_joint_status_v1*);
typedef struct {
 uint32_t version,size,role,reserved_zero;
 uint64_t credential_epoch;
 unsigned char classic_public[33],pq_public[2592];
 unsigned char scope_sha256[32],history_original_sha256[32],history_nonce[32];
 char custodian[513],realm[129],client[129],network[129],header_sha256[65];
 int64_t not_before_ms,expires_ms;
} ynx_social_joint_provider_facts_v1;
/* Zero-init. Filled version1/sizeof means copy retained even on late error.
 * Role1 issuer / role2 anchor, original Source credential epoch (not storage).
 * scope digest is original Go canonical scope7 SHA; history digest full exact
 * canonical signed history envelope, not head/records/reconstructed counters.
 * String arrays NUL terminated; hashes and key bytes not strings.
 */
void ynx_auth_social_joint_provider_source_facts_v1(uint64_t,uint32_t,ynx_social_joint_provider_facts_v1*,ynx_social_joint_status_v1*);
/* Same registered local source + actual recognized Native binding, not a view
 * DTO. Go borrows/releases actual binding view and independently sole-inspects
 * original body with actual scope/policies/epochs/history/window; frame exact
 * original sourceSigningInput. No caller timestamp or generic signing input.
 * Pending view debt prevents source close; repeated different body rejected.
 */
void ynx_auth_social_joint_provider_source_seal_original_v1(uint64_t,ynx_social_joint_source_v1*,ynx_social_joint_binding_v1*,uint32_t,ynx_social_joint_bytes_v1,ynx_social_joint_bytes_v1,ynx_social_joint_status_v1*);
void ynx_auth_social_joint_provider_source_close_v1(uint64_t*,ynx_social_joint_status_v1*);
#ifdef __cplusplus
}
#endif
#endif
