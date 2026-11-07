#include "AIResponseOutcomeOriginalsDATA.hpp"
#include "MobileCanonicalDATA.hpp"
#include "MobileSourceMath.hpp"
#include <stdexcept>
namespace ynx::sdk::ai::v6 {
namespace data=ynx::auth::mobile::qualified::data;
namespace {
[[noreturn]]void fail(const char*s){throw std::runtime_error(s);}
void need(bool b,const char*s){if(!b)fail(s);}
bool nullableText(const data::Value&v){return v.type==data::Value::nullValue||v.type==data::Value::string;}
}
ResponseOutcomeOriginalsDATA copyAIResponseOutcomeOriginalsV6DATA(const Bytes&metadata,const Bytes&receipt,const Bytes&body,const OriginalResponseBindingDATA&e){
 // Preserve LINK's 2MiB carrier limit separately; actual Auth consumer only
 // supports1MiB. Never truncate/drop bytes or silently claim2MiB support.
 need(body.size()<=responseHTTPBodyCap,"AI_V6_LINK_RESPONSE_BODY_LIMIT");
 need(body.size()<=responseAuthBodyCap,"AI_V6_AUTH_RESPONSE_BODY_LIMIT_NOT_SUPPORTED");
 need(receipt.size()<=businessReceiptCap,"AI_V6_BUSINESS_RECEIPT_LIMIT");
 auto m=data::parseCanonical(metadata,outcomeMetadataCap);
 m.keys({"state","action","businessAction","completionScope","requestRef"});
 need(nullableText(m.at("businessAction"))&&nullableText(m.at("completionScope"))&&nullableText(m.at("requestRef")),"AI_V6_OUTCOME_METADATA_TYPES");
 const auto&state=m.at("state").text();
 need(state=="COMMITTED"||state=="ACCEPTED"||state=="OBSERVED"||state=="DENIED"||state=="UNKNOWN","AI_V6_OUTCOME_STATE");
 need(m.at("action").text()==e.action&&state==e.state,"AI_V6_OUTCOME_RESPONSE_BINDING");
 if(m.at("requestRef").type==data::Value::nullValue)need(!e.requestRef.has_value(),"AI_V6_OUTCOME_RESPONSE_BINDING");else need(e.requestRef.has_value()&&m.at("requestRef").text()==*e.requestRef,"AI_V6_OUTCOME_RESPONSE_BINDING");
 need(e.bodyBytes==std::to_string(body.size())&&e.bodyDigest==ynx::auth::mobile::qualified::originalSHA256(body),"AI_V6_OUTCOME_BODY_BINDING");
 if(state=="COMMITTED"||state=="ACCEPTED"||state=="OBSERVED")need(!receipt.empty()&&e.requestRef.has_value()&&!e.requestRef->empty(),"AI_V6_BUSINESS_OUTCOME_SOURCE_NOT_SUPPLIED");
 // The original Auth acquireOutcome performs exact action/businessScope and
 // Root/current/registered response proof checks AFTER adopting these copies.
 // A nonempty opaque receipt here is DATA, not evidence of its provenance.
 ResponseOutcomeOriginalsDATA out;out.metadataOriginal=metadata;out.businessReceiptOriginal=receipt;out.bodyOriginal=body;return out;
}
[[noreturn]]void requireAIResponseBusinessOutcomeSourceV6(){fail("AI_V6_BUSINESS_OUTCOME_SOURCE_NOT_SUPPLIED");}
}
