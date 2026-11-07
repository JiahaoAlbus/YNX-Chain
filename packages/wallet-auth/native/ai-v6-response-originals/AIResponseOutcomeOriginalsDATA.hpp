#pragma once
#include <cstdint>
#include <cstddef>
#include <optional>
#include <string>
#include <vector>
// PRIVATE pure DATA helper, not a Source/loan constructor. The metadata/receipt
// must arrive from the SAME actual fixedSource durable-business outcome loan,
// NEVER from an HTTP response state, callback, body JSON or caller DTO as grant.
namespace ynx::sdk::ai::v6 {
using Bytes=std::vector<uint8_t>;
inline constexpr size_t responseHTTPBodyCap=2097152; // LINK response carrier
inline constexpr size_t responseAuthBodyCap=1048576; // actual MobileAITaskClient
inline constexpr size_t businessReceiptCap=1048576;
inline constexpr size_t outcomeMetadataCap=16384;
struct OriginalResponseBindingDATA {
 std::string action,state,bodyDigest,bodyBytes;
 std::optional<std::string>requestRef;
};
struct ResponseOutcomeOriginalsDATA {
 Bytes metadataOriginal,businessReceiptOriginal,bodyOriginal;
 bool dataOnly=true,responseProofVerified=false,receiptProvenanceVerified=false;
 bool completionSemanticsVerified=false,RootAdmission=false,SourceAdmission=false;
};
// Copies existing canonical exact5 metadata and opaque original receipt bytes.
// Does not parse/reorder the receipt's actual Go struct serialization. Caller
// supplies independent response proof/binding DATA from the existing sole r2
// parser; this helper does NOT verify that proof or manufacture a Root loan.
ResponseOutcomeOriginalsDATA copyAIResponseOutcomeOriginalsV6DATA(
 const Bytes& privateMetadataOriginal,const Bytes& privateBusinessReceiptOriginal,
 const Bytes& responseBodyOriginal,const OriginalResponseBindingDATA& independent);
// HTTP Packet has no business receipt carrier in the actual server contract.
// No success/receipt can be extracted from status/header/state/body alone.
[[noreturn]] void requireAIResponseBusinessOutcomeSourceV6();
}
