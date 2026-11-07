#include "AIMobileIntentDATA.h"
#include <MobileCanonicalDATA.hpp>
#include <stdexcept>
namespace ynx::mobileai {
namespace data=ynx::auth::mobile::qualified::data;
namespace {
const std::string&string(const data::Value&v,size_t cap){auto&s=v.text();if(s.empty()||s.size()>cap||s.find('\0')!=std::string::npos)throw std::runtime_error("AI_V6_MOBILE_INTENT_STRING");return s;}
std::optional<std::string>optional(const data::Value&v,size_t cap){if(v.type==data::Value::nullValue)return {};return string(v,cap);}
}
NativeIntentDATA parseIntentSnapshot(const std::string&snapshot){
 if(snapshot.size()>2097152)throw std::runtime_error("AI_V6_MOBILE_INTENT_CARRIER_BOUND");
 auto value=data::parseCanonical(Bytes(snapshot.begin(),snapshot.end()),2097152);
 value.keys({"operationId","action","method","path","taskId","taskRevision","generation","stepId","runId","creationBinding","bodyOriginalBase64url"});
 NativeIntentDATA result;
 result.operationId=string(value.at("operationId"),128);result.action=string(value.at("action"),64);
 result.method=string(value.at("method"),8);result.path=string(value.at("path"),2048);
 result.taskId=optional(value.at("taskId"),128);result.taskRevision=optional(value.at("taskRevision"),20);
 result.generation=optional(value.at("generation"),20);result.stepId=optional(value.at("stepId"),128);result.runId=optional(value.at("runId"),128);
 auto&creation=value.at("creationBinding");if(creation.type!=data::Value::nullValue){creation.keys({"conversationId"});result.creationConversationId=string(creation.at("conversationId"),128);}
 auto encoded=value.at("bodyOriginalBase64url").text();
 if(encoded.size()>1398102)throw std::runtime_error("AI_V6_MOBILE_INTENT_BODY_BOUND");
 result.bodyOriginal=encoded.empty()?Bytes{}:data::unbase64url(encoded,1048576);
 value.o.erase("bodyOriginalBase64url");if(data::canonical(value).size()>16384)throw std::runtime_error("AI_V6_MOBILE_INTENT_METADATA_BOUND");
 // Auth + the sole fixed35 codec independently enforce action/route/body semantics.
 return result;
}
}
