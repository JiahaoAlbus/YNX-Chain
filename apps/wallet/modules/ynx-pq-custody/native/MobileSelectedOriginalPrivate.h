#pragma once
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Native platform owner implements these strong calls from its SAME actual
 * selected registered account + Native review inventory. No JS reference,
 * public JSON, provider/config setter, ordinary decrypt or OS success grants
 * Auth Source. Auth independently verifies Root4/Source18/registration/current
 * and compares ALL twelve context values before claiming the original review.
 */
typedef struct YNXMobilePQSelectedOriginal YNXMobilePQSelectedOriginal;
typedef struct YNXMobilePQSelectedDirectoryLoan YNXMobilePQSelectedDirectoryLoan;
typedef struct {const uint8_t*bytes;size_t length;} YNXMobileSelectedPublicSpan;
typedef struct {
 uint32_t version,size,mode;
 YNXMobileSelectedPublicSpan reference,original_operation_id;
 YNXMobileSelectedPublicSpan network_id,account,platform,application_id,protected_resource_ref;
 YNXMobileSelectedPublicSpan native_chain_id,vault_revision,registration_digest,key_version,execution_height,nonce,spending_budget_original_digest;
 uint64_t issued_at_ms,expires_at_ms;
} YNXMobilePQSelectedOriginalDATA;
/* Nonnull partial is adopted before rc; every span stays owned until release.
 * mode3 selects SAME original operation, never creates a review/op or nonce. */
int32_t ynx_mobile_pq_selected_original_acquire_v1(uint32_t mode,YNXMobilePQSelectedOriginal**);
int32_t ynx_mobile_pq_selected_original_read_v1(YNXMobilePQSelectedOriginal*,YNXMobilePQSelectedOriginalDATA*);
int32_t ynx_mobile_pq_selected_original_current_v1(YNXMobilePQSelectedOriginal*,uint32_t phase);
/* Source builds the exact original review/body/op digest from its held bytes.
 * Claim checks actual original Native review approval and consumes only this
 * child once. It must NOT enter/sign/submit or close the mother approval. Query
 * mode must not claim approval. No caller approved boolean is accepted. */
int32_t ynx_mobile_pq_selected_original_claim_review_v1(YNXMobilePQSelectedOriginal*,YNXMobileSelectedPublicSpan scope_original,YNXMobileSelectedPublicSpan review_original);
void ynx_mobile_pq_selected_original_retire_v1(YNXMobilePQSelectedOriginal*);
int32_t ynx_mobile_pq_selected_original_close_v1(YNXMobilePQSelectedOriginal*);
int32_t ynx_mobile_pq_selected_original_release_closed_v1(YNXMobilePQSelectedOriginal*);
enum {YNX_MOBILE_SOURCE_PUBLIC_ORIGINALS=1,YNX_MOBILE_SOURCE_ORIGINAL_JOURNAL=2,YNX_MOBILE_SOURCE_REGISTERED_SLOT=3};
typedef struct {uint32_t version,size;int32_t directory_fd;uint64_t device,inode;uint32_t uid,gid;} YNXMobilePQSelectedDirectoryDATA;
/* Actual app/account Native directory inventory, no create/mkdir/OS43/UI.
 * Auth passes independently COMPILED Root locator, not scope resourceRef or
 * a caller path. Native retains exact protected container/named identity;
 * current rejects substitution, app/account/epoch drift and retired parent.
 * Auth dup owns its FD and closes it BEFORE dropping this Native borrow.
 * Nonnull output loan is adopted before rc; no loan may close the mother.
 * Native original_close must retain pending child debt, not pretend joined.
 */
int32_t ynx_mobile_pq_selected_original_borrow_directory_v1(YNXMobilePQSelectedOriginal*,uint32_t kind,YNXMobileSelectedPublicSpan root_locator,YNXMobilePQSelectedDirectoryLoan**,YNXMobilePQSelectedDirectoryDATA*);
int32_t ynx_mobile_pq_selected_directory_current_v1(YNXMobilePQSelectedDirectoryLoan*);
int32_t ynx_mobile_pq_selected_directory_close_v1(YNXMobilePQSelectedDirectoryLoan*);
int32_t ynx_mobile_pq_selected_directory_release_closed_v1(YNXMobilePQSelectedDirectoryLoan*);
#ifdef __cplusplus
}
#endif
