#include "MobileAITaskV6HeaderDATA.hpp"
#include "MobileCanonicalDATA.hpp"
#include <stdexcept>
namespace ynx::sdk::ai::v6::data {
namespace {
namespace c=ynx::auth::mobile::qualified::data;
void need(bool x){if(!x)throw std::runtime_error("AI_V6_HEADER_DATA_INVALID");}
std::string b64(const Bytes&b){static const char*a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";std::string out;uint32_t x=0;unsigned n=0;for(auto v:b){x=(x<<8)|v;n+=8;while(n>=6){n-=6;out+=a[(x>>n)&63];}}if(n)out+=a[(x<<(6-n))&63];return out;}
Bytes un64(const std::string&s,size_t cap){auto out=c::unbase64url(s,cap);need(!out.empty()&&b64(out)==s);return out;}
std::string encode(const Bytes&u,const Bytes&member){need(!member.empty()&&member.size()<=98304);auto v=c::parseCanonical(u,16384);need(v.type==c::Value::object&&v.o.count("member")==0);c::Value m;m.type=c::Value::string;m.s=b64(member);v.o.emplace("member",m);auto raw=c::canonical(v);auto out=b64(Bytes(raw.begin(),raw.end()));need(out.size()<=196608);return out;}
HeaderDATA decode(const std::string&header,const std::string&net,const Bytes&body,bool response){need(!header.empty()&&header.size()<=196608);auto raw=un64(header,147456);auto v=c::parseCanonical(raw,147456);need(c::canonical(v)==std::string(raw.begin(),raw.end()));auto member=un64(v.at("member").text(),98304);need(v.o.erase("member")==1);auto unsignedText=c::canonical(v);Bytes u(unsignedText.begin(),unsignedText.end());auto msg=response?encodeResponseMessage(u,net):encodeRequestMessage(u,net,body);return{{u,msg},member};}
}
std::string encodeRequestHeaderDATA(const Bytes&u,const std::string&n,const Bytes&b,const Bytes&m){(void)encodeRequestMessage(u,n,b);return encode(u,m);}
std::string encodeResponseHeaderDATA(const Bytes&u,const std::string&n,const Bytes&m){(void)encodeResponseMessage(u,n);return encode(u,m);}
HeaderDATA decodeRequestHeaderDATA(const std::string&h,const std::string&n,const Bytes&b){return decode(h,n,b,false);}
HeaderDATA decodeResponseHeaderDATA(const std::string&h,const std::string&n){return decode(h,n,{},true);}
}
