#include "CaptureJSON.hpp"
#include "RootCaptureResource.hpp"
#include <string_view>
#include <limits>
namespace ynx::auth::android_capture {
namespace {
constexpr std::size_t limit=2097152,original=393216;
constexpr std::int64_t safe=9007199254740991LL;
void utf8(std::string_view s){
 for(std::size_t i=0;i<s.size();){auto a=static_cast<unsigned char>(s[i++]);if(a<0x80)continue;
  unsigned n=0;std::uint32_t cp=0,min=0;
  if(a>=0xc2&&a<=0xdf){n=1;cp=a&31;min=0x80;}
  else if(a>=0xe0&&a<=0xef){n=2;cp=a&15;min=0x800;}
  else if(a>=0xf0&&a<=0xf4){n=3;cp=a&7;min=0x10000;}
  else throw EncodeError::utf8;
  if(n>s.size()-i)throw EncodeError::utf8;
  while(n--){auto c=static_cast<unsigned char>(s[i++]);if((c&0xc0)!=0x80)throw EncodeError::utf8;cp=(cp<<6)|(c&63);}
  if(cp<min||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff))throw EncodeError::utf8;
 }
}
struct Encoder {
 std::string out;
 void add(std::string_view s){if(s.size()>limit-out.size())throw EncodeError::capacity;out.append(s);}
 void text(const std::string&s,std::size_t cap){
  if(s.empty()||s.size()>cap)throw EncodeError::capacity;utf8(s);add("\"");
  for(unsigned char c:s){switch(c){case '"':add("\\\"");break;case '\\':add("\\\\");break;case '\b':add("\\b");break;case '\f':add("\\f");break;case '\n':add("\\n");break;case '\r':add("\\r");break;case '\t':add("\\t");break;default:if(c<32){constexpr char hex[]="0123456789abcdef";char b[]={'\\','u','0','0',hex[c>>4],hex[c&15]};add(std::string_view(b,6));}else{char b=static_cast<char>(c);add(std::string_view(&b,1));}}}
  add("\"");
 }
 void opaque(const std::string&s,std::size_t cap){if(s.empty()||s.size()>cap)throw EncodeError::capacity;utf8(s);add(s);}
 void raw4(const std::array<std::string,4>&v){add("[");for(std::size_t i=0;i<4;i++){if(i)add(",");text(v[i],original);}add("]");}
};
}
std::string encode_policy(const SelectedPolicy&p){
 auto value=[](const char*s,size_t maximum){if(!s)throw EncodeError::arguments;size_t n=0;while(n<=maximum&&s[n])++n;if(!n||n>maximum)throw EncodeError::arguments;return std::string(s,n);};
 const auto platform=value(p.platform,16);if(platform!="android")throw EncodeError::arguments;
 Encoder e;e.add("{\"applicationId\":");e.text(value(p.application_id,132),132);e.add(",\"endpoint\":");e.text(value(p.endpoint,2048),2048);
 e.add(",\"enrollmentDigest\":");e.text(value(p.enrollment_digest,64),64);e.add(",\"platform\":");e.text(platform,16);
 e.add(",\"productId\":");e.text(value(p.product_id,32),32);e.add(",\"rootDigest\":");e.text(value(p.root_digest,64),64);
 e.add(",\"signatureContract\":{\"currentFrame\":");e.text(value(p.signature_contract.current_frame,512),512);e.add(",\"enrollmentFrame\":");e.text(value(p.signature_contract.enrollment_frame,512),512);
 e.add(",\"profileFrame\":");e.text(value(p.signature_contract.profile_frame,512),512);e.add(",\"purpose\":");e.text(value(p.signature_contract.purpose,512),512);
 e.add("},\"spki\":");e.text(value(p.spki,64),64);e.add("}");return e.out;
}
std::string encode(const Batch&b){
 if(b.baseline_at_ms<0||b.current_at_ms<b.baseline_at_ms||b.after_at_ms<b.current_at_ms||b.after_at_ms>safe)throw EncodeError::clock;
 if(b.nonce.size()!=43||b.native_chain_id.empty()||b.native_chain_id.size()>20)throw EncodeError::arguments;
 Encoder e;
 e.add("{\"afterAtMs\":");e.add(std::to_string(b.after_at_ms));e.add(",\"afterRaw4\":");e.raw4(b.after_raw4);
 e.add(",\"baselineAtMs\":");e.add(std::to_string(b.baseline_at_ms));e.add(",\"beforeRaw4\":");e.raw4(b.before_raw4);
 e.add(",\"currentAtMs\":");e.add(std::to_string(b.current_at_ms));e.add(",\"currentRaw\":");e.text(b.current_raw,original);
 e.add(",\"input\":{\"enrollmentRaw\":");e.text(b.enrollment_raw,original);e.add(",\"headRaw\":");e.text(b.head_raw,original);
 e.add(",\"node\":{\"nativeChainId\":");e.text(b.native_chain_id,20);e.add(",\"origin\":");e.text(b.node_origin,2048);e.add(",\"spki\":");e.text(b.node_spki,256);
 e.add("},\"operation\":\"auth-source-v2-native-node/v1\",\"policy\":");e.opaque(b.policy_canonical,16384);
 e.add(",\"previous\":");e.opaque(b.previous_canonical,4096);e.add(",\"profileRaw\":");e.text(b.profile_raw,original);
 e.add(",\"rootRaw\":");e.text(b.root_raw,16384);e.add("},\"nonce\":");e.text(b.nonce,43);e.add("}");return e.out;
}
}
