#pragma once
#include "AndroidDeviceProvisioningPrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
// Private DATA from the SAME current kind4 Source's reviewed Root row.
// Not an observed FD, caller path, journal creation grant, or Source installer.
typedef struct {
 uint64_t device,inode;
 uint32_t uid,gid,mode,reserved;
} ynx_auth_android_pending_directory_identity_v1;
typedef struct {
 uint32_t version,size;
 ynx_auth_android_pending_directory_identity_v1 parent,directory;
 char leaf[32];
} ynx_auth_android_pending_journal_constraints_v1;
typedef struct ynx_auth_android_pending_source_v1 ynx_auth_android_pending_source_v1;
void ynx_auth_android_pending_source_copy_journal_constraints_v1(
 ynx_auth_android_pending_source_v1*,ynx_auth_android_pending_journal_constraints_v1*,
 ynx_auth_android_provision_failure_v1*);
#ifdef __cplusplus
}
#endif
