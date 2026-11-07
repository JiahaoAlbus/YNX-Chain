#pragma once
#include "MobileAITaskV6CodecDATA.hpp"
namespace ynx::sdk::ai::v6::data {
inline constexpr const char*requestHeaderName="x-ynx-product-session-proof-v6";
inline constexpr const char*responseHeaderName="x-ynx-product-session-response-proof-v6";
struct HeaderDATA:PreparedDATA {Bytes memberOriginal;};
// Strict original carrier only, not N1 math/registration/admission. Request DATA
// additionally binds supplied original body; expected network/body are independent.
std::string encodeRequestHeaderDATA(const Bytes&canonical35,const std::string&networkHex,const Bytes&bodyOriginal,const Bytes&memberOriginal);
std::string encodeResponseHeaderDATA(const Bytes&canonical16,const std::string&networkHex,const Bytes&memberOriginal);
HeaderDATA decodeRequestHeaderDATA(const std::string&header,const std::string&networkHex,const Bytes&bodyOriginal);
HeaderDATA decodeResponseHeaderDATA(const std::string&header,const std::string&networkHex);
}
