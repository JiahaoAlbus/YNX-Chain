#pragma once
#include "MobileLedgerProofBackendPrivate.hpp"
#include <memory>
namespace ynx::auth::mobile::receipt {
class RegisteredAccountReceipt; // final owning Auth implementation, no public ctor
struct ReceiptAcquisition {
 std::shared_ptr<RegisteredAccountReceipt>owner;
 ynx::core::mobile::registered::Failure failure;
};
struct ReceiptDATA {
 uint32_t version=1;
 std::string platform,chainId,networkId,canonicalOwner,account;
 std::string sourceId,instanceId,registrationDigest,keyVersion;
 uint64_t height=0,originHeight=0,currentEngineHeight=0,activeRevision=0,ledgerNonce=0;
 ynx::core::mobile::registered::Bytes fullAppHash,pkA,pkB;
};
// ZERO-input pre-capture producer. It cannot call Native registered_account
// acquire (that consumer will call this producer). No journal/slot/UI claim.
ReceiptAcquisition acquireOriginalRegisteredAccountReceipt()noexcept;
ynx::core::mobile::registered::Failure readOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&,ReceiptDATA&)noexcept;
ynx::core::mobile::registered::Failure originalReceiptCurrent(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
void retireOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
ynx::core::mobile::registered::Failure joinOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
ynx::core::mobile::registered::Failure closeOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
bool originalReceiptClosed(const std::shared_ptr<RegisteredAccountReceipt>&)noexcept;
}
