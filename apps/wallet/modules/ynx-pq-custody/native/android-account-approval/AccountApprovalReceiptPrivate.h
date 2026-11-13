#pragma once
#include <AndroidV4AccountApprovalPlanPrivate.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Private native-to-Wallet storage on the SAME holder and original actor.
 * This is an observation of one sign attempt, not a signing or release permit.
 * Absent Core/backup stages have zero values, not successful cleanup receipts.
 * When core_invoked=1, raw result/cleanup are exactly what the primitive
 * supplied (including cleanup UNKNOWN=0). core_result_present=0 records a
 * call with no return; its code is zero, and it cannot authorize commit.
 * backup_release_attempted=1 applies only to an acquired (possibly partial)
 * original backup loan. D32 records that release independently of Core.
 */
typedef struct {
 uint32_t version,size;
 uint32_t core_invoked,core_result_present;
 int32_t core_result;
 uint32_t core_cleanup;
 uint32_t backup_acquired,backup_release_attempted;
 ynx_auth_android_provision_drain_v1 backup_drain;
 ynx_auth_android_provision_failure_v1 first;
} ynx_wallet_v4_account_approval_native_receipt_v1;

/* Wallet retains and reads back this exact receipt on its acknowledged
 * ENTERED holder. A post-retire call may only persist original evidence.
 * A lost receipt ACK leaves the original operation UNKNOWN. This method
 * does not commit the approval, perform cleanup, call Core or return Member
 * bytes. The original retain_v1 receives the bounded Member independently.
 */
void ynx_wallet_v4_account_approval_record_native_receipt_v1(
 ynx_original_wallet_v4_account_approval_v1*,
 const ynx_wallet_v4_account_approval_native_receipt_v1*,
 ynx_auth_android_provision_failure_v1*);

#ifdef __cplusplus
}
static_assert(sizeof(ynx_wallet_v4_account_approval_native_receipt_v1)==88,"native receipt88");
static_assert(offsetof(ynx_wallet_v4_account_approval_native_receipt_v1,backup_drain)==32,"D32 offset");
static_assert(offsetof(ynx_wallet_v4_account_approval_native_receipt_v1,first)==64,"F24 offset");
#else
_Static_assert(sizeof(ynx_wallet_v4_account_approval_native_receipt_v1)==88,"native receipt88");
_Static_assert(offsetof(ynx_wallet_v4_account_approval_native_receipt_v1,backup_drain)==32,"D32 offset");
_Static_assert(offsetof(ynx_wallet_v4_account_approval_native_receipt_v1,first)==64,"F24 offset");
#endif
