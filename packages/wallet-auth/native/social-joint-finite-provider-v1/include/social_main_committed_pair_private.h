#ifndef YNX_SOCIAL_MAIN_COMMITTED_PAIR_PRIVATE_V1_H
#define YNX_SOCIAL_MAIN_COMMITTED_PAIR_PRIVATE_V1_H
#include "social_joint_profile_issuer_private.h"
#ifdef __cplusplus
extern "C" {
#endif
/* PRIVATE SAME-process/OS-actor service borrow, not registration or a DTO
 * installer. Only normal FirstDeviceAuthenticatedConsumer construction binds
 * an already admitted directory. Resource32 is the existing F06 row digest,
 * NEVER DEVICEV4 registrationDigest. The source loan MUST be obtained through
 * Native's recognized borrowCapturedSourceLoan; no JNI pointer crosses IPC.
 * out is adopted before status, including late failures. Cleanup does not
 * require freshness. Status v1/24 separates error presence from first==0 and
 * physical_done. All outputs must be disjoint caller-owned memory. */
#define YNX_SOCIAL_MAIN_PAIR_STORAGE_V1 8192u
typedef struct {
 uint32_t version,size;
 uint64_t view;
 ynx_social_joint_bytes_v1 application[6];
 ynx_social_joint_bytes_v1 classic_public,pq_public;
 /* Private SAME-owner account namespace for independent Device qualification.
  * Not part of SocialData, not public telemetry or an admission operand. */
 ynx_social_joint_bytes_v1 account_issuer,account_subject;
 int64_t not_before_ms,expires_ms;
} ynx_social_main_pair_view_v1;
void ynx_social_main_committed_pair_open_v1(uint64_t,unsigned char*,size_t,uint64_t*,ynx_social_joint_status_v1*);
void ynx_social_main_committed_pair_current_v1(uint64_t,ynx_social_joint_status_v1*);
/* Caller supplies >=8192 bytes; all output spans point into this storage,
 * never Go memory. Nonzero view is a real child even with a late error.
 * Keep storage until release. No private key, plaintext or ratchet output. */
void ynx_social_main_committed_pair_view_open_v1(uint64_t,unsigned char*,size_t,ynx_social_main_pair_view_v1*,ynx_social_joint_status_v1*);
void ynx_social_main_committed_pair_view_release_v1(uint64_t,uint64_t*,ynx_social_joint_status_v1*);
void ynx_social_main_committed_pair_close_v1(uint64_t*,ynx_social_joint_status_v1*);
#ifdef __cplusplus
}
static_assert(sizeof(ynx_social_main_pair_view_v1)==192,"Main pair view64 ABI");
#endif
#endif
