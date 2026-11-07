#include "AIResponseOriginalsCarrierDATA.hpp"
#include "MobileCanonicalDATA.hpp"
#include <stdexcept>
namespace ynx::sdk::ai::v6 {
namespace c=ynx::auth::mobile::qualified::data;
namespace {
void need(bool v){if(!v)throw std::runtime_error("AI_V6_RESPONSE_ORIGINALS_CARRIER_INVALID");}
std::vector<uint8_t> un64(const c::Value&v,size_t cap){const auto&s=v.text();return s.empty()?std::vector<uint8_t>{}:c::unbase64url(s,cap);}
}
ResponseCarrierOriginalsDATA decodeOriginalAITaskResponseCarrierV6DATA(const std::vector<uint8_t>&raw){
 auto v=c::parseCanonical(raw,1048576);
 v.keys({"version","bodyOriginalBase64url","outcomeMetadataOriginalBase64url","businessReceiptOriginalBase64url"});
 need(v.at("version").text()=="YNX-AI-TASK-V6-RESPONSE-ORIGINALS/v1");
 ResponseCarrierOriginalsDATA out;out.transportOriginal=raw;
 out.bodyOriginal=un64(v.at("bodyOriginalBase64url"),1048576);
 out.outcomeMetadataOriginal=un64(v.at("outcomeMetadataOriginalBase64url"),16384);
 auto m=c::parseCanonical(out.outcomeMetadataOriginal,16384);
 m.keys({"state","action","businessAction","completionScope","requestRef"});
 const auto&state=m.at("state").text();
 need(state=="COMMITTED"||state=="ACCEPTED"||state=="OBSERVED"||state=="DENIED"||state=="UNKNOWN");
 need(!m.at("action").text().empty());
 for(auto key:{"businessAction","completionScope","requestRef"})need(m.at(key).type==c::Value::nullValue||m.at(key).type==c::Value::string);
 const auto&r=v.at("businessReceiptOriginalBase64url");
 if(r.type!=c::Value::nullValue)out.businessReceiptOriginal=un64(r,1048576);
 return out;
}
}
