#pragma once
#include "MobileRegisteredReceiptPrivate.hpp"
namespace ynx::auth::mobile::receipt {
// Separate Source metadata: never alias ledger H/revision/nonce to these.
struct OriginalSourceSelection {
 uint32_t version=1,mode=0;
 std::string reference,declaredOriginalOperationId,networkId,account;
 std::string platform,applicationId,protectedResourceRef,nativeChainID;
 std::string vaultRevision,registrationDigest,keyVersion,sourceExecutionHeight;
 std::string sourceNonce,spendingBudgetOriginalDigest;
 uint64_t issuedAtMs=0,expiresAtMs=0;
 bool reviewClaimed=false; // pre-capture receipt NEVER claims a UI operation
 std::vector<uint8_t>scopeOriginal,contextOriginal;
};
ynx::core::mobile::registered::ReadResult readOriginalSourceSelection(const std::shared_ptr<RegisteredAccountReceipt>&,OriginalSourceSelection&)noexcept;
class ReceiptDirectoryLoan;
struct DirectoryAcquisition {std::shared_ptr<ReceiptDirectoryLoan>owner;ynx::core::mobile::registered::Failure failure;bool ready=false;ynx::core::mobile::registered::Failure pendingCause{};};
struct DirectoryDATA {uint32_t version=1,role=0,uid=0,gid=0;int borrowedFD=-1;uint64_t device=0,inode=0;};
// Actual Root selected existing 0700 child, not a path/locator from Source/JS.
// role1 source-only; role2 original journal; role3 registered slot. Unprovided
// independent role2/3 mappings refuse that borrow, without creating anything.
DirectoryAcquisition borrowOriginalReceiptDirectory(const std::shared_ptr<RegisteredAccountReceipt>&,uint32_t role)noexcept;
ynx::core::mobile::registered::ReadResult currentOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&)noexcept;
ynx::core::mobile::registered::ReadResult readOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&,DirectoryDATA&)noexcept;
ynx::core::mobile::registered::Failure closeOriginalReceiptDirectory(const std::shared_ptr<ReceiptDirectoryLoan>&)noexcept;
bool originalReceiptDirectoryClosed(const std::shared_ptr<ReceiptDirectoryLoan>&)noexcept;
}
