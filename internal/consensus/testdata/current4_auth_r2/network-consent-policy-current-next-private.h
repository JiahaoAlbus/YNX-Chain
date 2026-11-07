#pragma once
#include "network_pending_principal_private.h"
#ifdef __cplusplus
extern "C" {
#endif
/* NEXT-CODE private authority-reader contract, UNIMPLEMENTED here.
 * Original authority, NOT caller JSON/SourceCurrent9/Wallet transaction grant,
 * mints this SAME-account/network original policy/current read child.
 * No transport URL, path, policy, height, approved bool or setter arguments.
 * It owns protected/authenticated originals/current/revoke through cleanup.
 */
typedef struct ynx_network_original_policy_current_v1 ynx_network_original_policy_current_v1;
typedef struct {uint64_t execution_height;int64_t now_millis;size_t policy_bytes;uint8_t subject_owner[42];}ynx_network_original_policy_current_metadata_v1;
ynx_network_error_v1 ynx_network_original_policy_current_capture_v1(
 ynx_network_pending_principal_v1*,ynx_network_original_policy_current_v1**);
/* Bounded owned copy of actual original WalletPolicyProjection, <=8388608.
 * Independent height from SAME authority read; actual now sampled by producer.
 * Metadata+bytes must be one coherent original capture, current on BOTH sides.
 * No truncated success, NONOK leaves output unchanged, alias/overflow denied.
 * A new read cannot extend the original permission/window or resurrect revoke.
 */
ynx_network_error_v1 ynx_network_original_policy_current_read_v1(
 ynx_network_original_policy_current_v1*,uint8_t*policy,size_t capacity,
 ynx_network_original_policy_current_metadata_v1*);
ynx_network_error_v1 ynx_network_original_policy_current_current_v1(ynx_network_original_policy_current_v1*);
ynx_network_error_v1 ynx_network_original_policy_current_retire_v1(ynx_network_original_policy_current_v1*);
ynx_network_drain_v1 ynx_network_original_policy_current_join_v1(ynx_network_original_policy_current_v1*);
ynx_network_drain_v1 ynx_network_original_policy_current_close_v1(ynx_network_original_policy_current_v1*);
#ifdef __cplusplus
}
#endif
