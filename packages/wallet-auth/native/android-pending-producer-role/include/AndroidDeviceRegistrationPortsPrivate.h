#pragma once
#include "AndroidDeviceRegistrationPrivate.h"
#include "AndroidDevicePendingJournalPrivate.h"
#include "product_device_registration_v4.h"
#ifdef __cplusplus
extern "C" {
#endif
// These are fixed SAME-image strong original ports, not provider classes or
// callbacks. Root port is Auth-owned captured Source18; its implementation is
// the guarded kind4 extension of the original RootCapture TU, not Node/Hermes
// or provisioning/primary/read Source promoted into pending authority.
typedef struct ynx_original_android_pending_root_v1 ynx_original_android_pending_root_v1;
void ynx_original_android_pending_root_open_v1(ynx_original_android_pending_root_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_root_current_v1(ynx_original_android_pending_root_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_root_copy_v1(ynx_original_android_pending_root_v1*,uint8_t*,size_t,ynx_auth_android_pending_review_data_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_root_copy_journal_constraints_v1(ynx_original_android_pending_root_v1*,ynx_auth_android_pending_journal_constraints_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_root_retire_v1(ynx_original_android_pending_root_v1*);
void ynx_original_android_pending_root_join_v1(ynx_original_android_pending_root_v1*,ynx_auth_android_provision_drain_v1*);
void ynx_original_android_pending_root_close_v1(ynx_original_android_pending_root_v1**,ynx_auth_android_provision_drain_v1*);

// Main private user approval/currentPolicy producer. It captures its actual
// current protected review/account permission for SAME Source operation. No
// App JSON, caller-approved boolean, pair, path or peer installer is accepted.
typedef struct ynx_original_android_pending_approval_v1 ynx_original_android_pending_approval_v1;
typedef struct {
 uint32_t version,size;ynx_auth_android_provision_bytes_v1 approval_original,policy_original,request_original;
 uint8_t request_digest[32],approval_digest[32];
 int64_t not_before_ms,expires_at_ms;
} ynx_original_android_pending_approval_data_v1;
void ynx_original_android_pending_approval_capture_v1(ynx_auth_android_pending_source_v1*,ynx_original_android_pending_approval_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_approval_current_v1(ynx_original_android_pending_approval_v1*,ynx_auth_android_pending_source_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_approval_copy_v1(ynx_original_android_pending_approval_v1*,uint8_t*,size_t,ynx_original_android_pending_approval_data_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_approval_retire_v1(ynx_original_android_pending_approval_v1*);
void ynx_original_android_pending_approval_close_v1(ynx_original_android_pending_approval_v1**,ynx_auth_android_provision_drain_v1*);

// Native owns DEVICE-specific protected slot and the OS format. First pair PoP
// MUST accept the legitimate OS-sealed PENDING DEVICE slot; an already primary
// registered Binding/SessionSource is not required and would create a cycle.
// It must Root/current-gate and bind actual original registration/public2592/64
// and typed device_generation + exact application identity BEFORE private
// bytes. PENDING creation custody does NOT grant PoP: independent pending
// purpose/current and genuine userPQapproval/currentPolicy remain mandatory.
// Never wallet ACCOUNT,
// SOCIAL_SOURCE9, HTTP-PROOF, software fallback or a creation-grant borrow.
typedef struct ynx_original_android_pending_device_pair_v1 ynx_original_android_pending_device_pair_v1;
typedef struct {uint32_t version,size;YNXProductDeviceBytesV4 der_a,der_b,pk_a,pk_b;} ynx_original_android_pending_pair_borrow_v1;
void ynx_original_android_pending_pair_open_v1(ynx_auth_android_pending_source_v1*,ynx_original_android_pending_device_pair_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_pair_current_v1(ynx_original_android_pending_device_pair_v1*,ynx_auth_android_pending_source_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_pair_borrow_once_v1(ynx_original_android_pending_device_pair_v1*,ynx_auth_android_pending_source_v1*,ynx_original_android_pending_pair_borrow_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_pair_retire_v1(ynx_original_android_pending_device_pair_v1*);
void ynx_original_android_pending_pair_close_v1(ynx_original_android_pending_device_pair_v1**,ynx_auth_android_provision_drain_v1*);

// Original Native retained AbortContext, no BOOL caller setter. The caller
// adapter must recognize its actual same context, not clone a JS signal.
void ynx_original_android_pending_abort_current_v1(ynx_original_android_abort_context_v1*,ynx_auth_android_provision_failure_v1*);

// Actual App directory/Root-reviewed journal locator, private Native only.
// Auth never receives a caller path. Parent/leaf mapping is independent Root
// material; the borrowed FD remains owned by this original retained child.
typedef struct ynx_original_android_pending_directory_v1 ynx_original_android_pending_directory_v1;
void ynx_original_android_pending_directory_open_v1(ynx_auth_android_pending_source_v1*,ynx_original_android_pending_directory_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_directory_borrow_v1(ynx_original_android_pending_directory_v1*,int*originalFD,ynx_auth_android_provision_failure_v1*);
// This is original physical identity/current only, permitted for SAME selected
// local outcome flush after revoke. It cannot authorize new Core/HTTP work.
void ynx_original_android_pending_directory_current_v1(ynx_original_android_pending_directory_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_original_android_pending_directory_close_v1(ynx_original_android_pending_directory_v1**,ynx_auth_android_provision_drain_v1*);
#ifdef __cplusplus
}
#endif
