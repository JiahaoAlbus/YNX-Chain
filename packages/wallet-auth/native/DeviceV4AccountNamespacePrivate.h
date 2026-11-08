#pragma once
#include "DeviceV4SourceBorrowPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
// Comparison only. Input tuple must come from independently current genuine
// Main pair custody. It cannot mint/replace a Device view or authorize E5.
// Primary DEVICE purpose only; SAME view, original deadline and full current
// before/after comparison. Full actor I/O, never under a Store/write lock.
typedef struct {ynx_auth_device_v4_failure_v1 failure;uint32_t matched;} ynx_auth_device_v4_namespace_match_v1;
ynx_auth_device_v4_namespace_match_v1 ynx_auth_device_v4_view_match_account_namespace_v1(
 ynx_auth_device_v4_view_v1*,ynx_auth_device_v4_bytes_v1 account_issuer,
 ynx_auth_device_v4_bytes_v1 account_subject);
#ifdef __cplusplus
}
#endif
