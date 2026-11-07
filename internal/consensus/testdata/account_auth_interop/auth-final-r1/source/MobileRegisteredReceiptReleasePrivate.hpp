#pragma once
#include "MobileSourceMath.hpp"
namespace ynx::auth::mobile::receipt {
struct ReviewedReceiptRelease {
 ynx::auth::mobile::qualified::SourcePolicy sourcePolicy;
 std::string accountLeaf,sourceLeaf,engineReference,chainId,nativeChainID;
 uint32_t uid=0,gid=0;
 uint64_t accountDevice=0,accountInode=0,sourceDevice=0,sourceInode=0;
 uint64_t minimumCommittedHeight=0;
 std::string journalLeaf,registeredSlotLeaf;
 uint64_t journalDevice=0,journalInode=0,slotDevice=0,slotInode=0;
};
/* Private compiled Root selection ONLY. No public create/config/JS provider.
 * Empty rows refuse before OS/engine/account selector access. This row is not
 * the engine's authenticated ledger proof; Core independently supplies that. */
const std::vector<ReviewedReceiptRelease>&reviewedReceiptReleases();
}
