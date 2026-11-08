#ifndef YNX_AUTH_REGISTERED_MAIN_PAIR_READ_PRIVATE_V1_H
#define YNX_AUTH_REGISTERED_MAIN_PAIR_READ_PRIVATE_V1_H
#include "social_main_committed_pair_private.h"
#ifdef __cplusplus
extern "C" {
#endif
/* PRIVATE closed read namespace. These are transport selectors, not a signing
 * family, Root, Source domain or permission. Independent approved Root rows
 * select endpoint/listener/peer/image/resource and exact allowed purpose.
 * Empty rows fail before connect or Source acquisition. No public registration.
 */
#define YNX_AUTH_MAIN_PAIR_READ_PURPOSE_V1 0x4d505231u
#define YNX_AUTH_MAIN_PAIR_READ_PURPOSE_TEXT_V1 "original-main-committed-pair-holder-read-v1"
#define YNX_AUTH_MAIN_PAIR_READ_OPEN_V1 31u
#define YNX_AUTH_MAIN_PAIR_READ_CURRENT_V1 32u
#define YNX_AUTH_MAIN_PAIR_READ_VIEW_OPEN_V1 33u
#define YNX_AUTH_MAIN_PAIR_READ_VIEW_RELEASE_V1 34u
#define YNX_AUTH_MAIN_PAIR_READ_CLOSE_V1 35u
typedef struct ynx_auth_registered_main_pair_channel_v1 ynx_auth_registered_main_pair_channel_v1;
typedef struct ynx_auth_registered_main_pair_view_v1 ynx_auth_registered_main_pair_view_v1;
typedef struct ynx_auth_registered_main_pair_server_v1 ynx_auth_registered_main_pair_server_v1;
typedef struct ynx_auth_registered_main_pair_peer_v1 ynx_auth_registered_main_pair_peer_v1;
/* raw4/F06/source resource are constraints, never constructors of the remote
 * Main directory or a permission. ref MUST be zero: no Go id crosses UID.
 * Adopt every nonnull partial before interpreting paired status, including
 * error_present=1/original_first=0 and late public output. */
void ynx_auth_registered_main_pair_open_v1(const ynx_social_joint_source_input_v1*,const unsigned char*,size_t,ynx_auth_registered_main_pair_channel_v1**,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_current_v1(ynx_auth_registered_main_pair_channel_v1*,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_view_open_v1(ynx_auth_registered_main_pair_channel_v1*,ynx_auth_registered_main_pair_view_v1**,ynx_social_joint_status_v1*);
/* Reuses Main's exact view192/8192 storage projection. Spans point only into
 * caller storage; the uint64 view field is a LOCAL view id, not a remote Go id.
 * Keep the actual opaque view until release. Account spans are private matching
 * DATA, not SocialData, DEVICE approval or public telemetry. */
void ynx_auth_registered_main_pair_view_copy_v1(ynx_auth_registered_main_pair_channel_v1*,ynx_auth_registered_main_pair_view_v1*,unsigned char*,size_t,ynx_social_main_pair_view_v1*,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_view_current_v1(ynx_auth_registered_main_pair_channel_v1*,ynx_auth_registered_main_pair_view_v1*,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_view_release_v1(ynx_auth_registered_main_pair_channel_v1*,ynx_auth_registered_main_pair_view_v1**,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_close_v1(ynx_auth_registered_main_pair_channel_v1**,ynx_social_joint_status_v1*);
/* Existing inherited prebound socket substrate; no bind or socket-path creation.
 * After independent read-row/path/tuple checks, the Main server process may dup
 * the original prebound-not-listened fd and listen on its OWN duplicate with
 * backlog16. This preserves real Linux SO_PEERCRED; a Root-listened surrogate
 * is not equivalent. Never close the original borrowed fd. Empty rows reject
 * before dup/listen. No reconnect or repeated ambiguous physical operation.
 * A separate explicit read-purpose row is required; old witness/signing rows
 * cannot authenticate this server or peer. P02 alone integrates canonical Go
 * dispatcher. These opaque values stay in the server process/OS actor. */
void ynx_auth_registered_main_pair_server_open_v1(const unsigned char*,size_t,int32_t,ynx_auth_registered_main_pair_server_v1**,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_server_current_v1(ynx_auth_registered_main_pair_server_v1*,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_peer_open_v1(ynx_auth_registered_main_pair_server_v1*,int32_t,ynx_auth_registered_main_pair_peer_v1**,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_peer_current_v1(ynx_auth_registered_main_pair_peer_v1*,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_peer_close_v1(ynx_auth_registered_main_pair_peer_v1**,ynx_social_joint_status_v1*);
void ynx_auth_registered_main_pair_server_close_v1(ynx_auth_registered_main_pair_server_v1**,ynx_social_joint_status_v1*);
#ifdef __cplusplus
}
#endif
#endif
