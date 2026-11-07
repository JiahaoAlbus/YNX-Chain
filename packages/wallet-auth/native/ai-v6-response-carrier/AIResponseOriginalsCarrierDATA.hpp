#pragma once
#include <cstdint>
#include <optional>
#include <vector>
namespace ynx::sdk::ai::v6 {
struct ResponseCarrierOriginalsDATA {
 std::vector<uint8_t> transportOriginal,bodyOriginal,outcomeMetadataOriginal;
 // nullopt and present-empty are different original states.
 std::optional<std::vector<uint8_t>> businessReceiptOriginal;
 bool dataOnly=true,receiptProvenanceVerified=false,SourceAdmission=false,RootAdmission=false,operationVerified=false;
};
// Call only as part of paired response processing. Authentication of the full
// transport, same request, Root issuer and current is the Auth owner's job.
ResponseCarrierOriginalsDATA decodeOriginalAITaskResponseCarrierV6DATA(const std::vector<uint8_t>& transportOriginal);
}
