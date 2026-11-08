#pragma once
#include "ynx_social_finite_joint_custodian_private_v1.h"
#ifdef __cplusplus
extern "C"{
#endif
typedef struct ynx_social_finite_joint_plan_hold_v1 ynx_social_finite_joint_plan_hold_v1;
typedef struct ynx_social_finite_joint_server_context_v1 ynx_social_finite_joint_server_context_v1;
typedef struct {
 uint32_t version,size,role,uid,gid,reserved_zero;
 int32_t own_directory_fd,reserved_fd;
 uint64_t storage_generation;
 unsigned char classic_public[33],pq_public[2592],registered_bundle_sha256[32];
 ynx_social_finite_joint_bytes_v1 alias,custodian,body_original,frame_original;
 void* journal_original;
} ynx_social_finite_joint_plan_view_v1;
/* Recognized normal server context only; requires actual qualified/current
 * Root+Source+binding+peer, durable SAME intent and entered key stage BEFORE
 * Rust can open own-UID files. This is not a caller-supplied approval frame.
 * hold is a real child. Public spans/journal pointer stay immutable until
 * hold close, and may never cross UID/process. No private bytes returned. */
void ynx_social_finite_joint_plan_hold_open_v1(ynx_social_finite_joint_server_context_v1*,ynx_social_finite_joint_plan_hold_v1**,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_plan_current_v1(ynx_social_finite_joint_plan_hold_v1*,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_plan_view_v1_copy(ynx_social_finite_joint_plan_hold_v1*,ynx_social_finite_joint_plan_view_v1*,ynx_social_finite_joint_status_v1*);
void ynx_social_finite_joint_plan_hold_close_v1(ynx_social_finite_joint_plan_hold_v1**,ynx_social_finite_joint_status_v1*);
/* The normal Rust KeyOwner is crate-private and called by the actual server
 * Context. There is deliberately no external key-open/raw-sign ABI. The
 * server context above is not a client custodial token or caller pointer. */
#ifdef __cplusplus
}
#endif
