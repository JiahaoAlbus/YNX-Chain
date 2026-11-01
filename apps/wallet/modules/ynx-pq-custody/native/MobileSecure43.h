#pragma once
#include "ProtectedMobilePQ.h"
/* PRIVATE native OS port. Never a Hermes/JNI-to-JS method or Source factory.
 * Original Auth must qualify this exact descriptor against its held capture.
 * No credential/private values appear in descriptors, records or logs. */
#ifdef __cplusplus
extern "C" {
#endif
typedef struct YNXMobileOS43Loan YNXMobileOS43Loan;
typedef struct YNXMobileOS43Permit YNXMobileOS43Permit;
enum { YNX_PQ_OS43_AUTHENTICATED=1,YNX_PQ_OS43_REQUIRE_HARDWARE=2,YNX_PQ_OS43_REQUIRE_STRONGBOX=3 };
enum { YNX_PQ_OS43_BORROW=1,YNX_PQ_OS43_IMPORT_ABSENT=2,YNX_PQ_OS43_REMOVE_EXACT=3 };
typedef struct {
 uint32_t version,size;
 uint8_t item_id[32],binding_digest[32];
 YNXMobilePQSpan original_binding;
 uint64_t vault_revision;
 uint32_t minimum_protection,ui_timeout_ms;
 /* Android only: actual Auth-held app-private 0700 directory, not a JS path.
  * iOS requires directory_fd=-1. All identity values are public metadata. */
 int32_t directory_fd;
 uint64_t directory_device,directory_inode;
 uint32_t directory_uid,directory_gid;
} YNXMobileOS43Descriptor;
typedef struct {
 uint32_t version,size,platform,protection,user_presence;
 uint8_t item_identity[32];
 /* platform1 Keychain generic data claims OS protection, NOT SecureEnclave.
  * platform2 reports actual KeyInfo: protection1 software/2TEE/3StrongBox. */
} YNXMobileOS43Protection;
/* REQUIRED Auth-owned gates (new native CODE). Descriptor/capture/item/epoch,
 * lifecycle intent, original review and actual current must all match.
 * Import must independently authenticate the original encrypted backup and
 * registered binding with this Native-only credential BEFORE any item write.
 * Successful OS authentication is never Source or semantic approval. */
int32_t ynx_auth_mobile_pq_os_acquire_permit_v1(YNXMobilePQCapture*,const YNXMobileOS43Descriptor*,uint32_t,YNXMobileOS43Permit**);
int32_t ynx_auth_mobile_pq_os_permit_current_v1(YNXMobileOS43Permit*);
int32_t ynx_auth_mobile_pq_os_validate_original43_v1(YNXMobileOS43Permit*,const uint8_t*,size_t);
/* Lifecycle effect receipt stays with original Auth journal; a late failure
 * after publication must remain UNKNOWN, never auto-delete/import again. */
int32_t ynx_auth_mobile_pq_os_finish_v1(YNXMobileOS43Permit*,int32_t,uint32_t);
int32_t ynx_auth_mobile_pq_os_close_permit_v1(YNXMobileOS43Permit*);
int32_t ynx_auth_mobile_pq_os_release_closed_permit_v1(YNXMobileOS43Permit*);
int32_t ynx_mobile_pq_os_borrow43_v1(YNXMobilePQCapture*,const YNXMobileOS43Descriptor*,YNXMobileOS43Loan**);
/* Native caller only. Current rechecks Source + OS descriptor/item identity;
 * bytes may be borrowed only while loan is current and never leave Native. */
int32_t ynx_mobile_pq_os_loan_current_v1(YNXMobileOS43Loan*);
int32_t ynx_mobile_pq_os_loan_bytes_v1(YNXMobileOS43Loan*,const uint8_t**,size_t*);
int32_t ynx_mobile_pq_os_loan_protection_v1(YNXMobileOS43Loan*,YNXMobileOS43Protection*);
int32_t ynx_mobile_pq_os_loan_close_v1(YNXMobileOS43Loan*);
int32_t ynx_mobile_pq_os_loan_release_closed_v1(YNXMobileOS43Loan*);
/* Native secure dialog, no credential argument/callback from JS. Import is
 * create-if-ABSENT only; stale/nonempty item refuses, never overwrites. */
int32_t ynx_mobile_pq_os_import_original43_v1(YNXMobilePQCapture*,const YNXMobileOS43Descriptor*,YNXMobileOS43Loan**);
int32_t ynx_mobile_pq_os_remove_exact43_v1(YNXMobilePQCapture*,const YNXMobileOS43Descriptor*,YNXMobileOS43Loan**);
#ifdef __cplusplus
}
#endif
