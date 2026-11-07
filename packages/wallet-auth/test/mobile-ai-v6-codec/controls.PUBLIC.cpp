#include "MobileAITaskV6CodecDATA.hpp"
#include "MobileCanonicalDATA.hpp"
#include "OS43Private.h"
#include <openssl/sha.h>
#include <fstream>
#include <iostream>
#include <functional>
#include <cstdlib>
using namespace ynx::sdk::ai::v6::data;
namespace c=ynx::auth::mobile::qualified::data;
static bool primitiveUnavailable=false;
namespace ynx::mobilepq::os43 {int32_t platformSHA256(const uint8_t*p,size_t n,uint8_t*out){if(primitiveUnavailable)return 9102;return SHA256(p,n,out)?0:9102;}}
Bytes read(const std::string&p){std::ifstream f(p,std::ios::binary);if(!f)throw std::runtime_error("FIXTURE_MISSING:"+p);return Bytes(std::istreambuf_iterator<char>(f),{});}
std::string str(const Bytes&b){return {b.begin(),b.end()};}Bytes raw(const c::Value&v){auto s=c::canonical(v);return{s.begin(),s.end()};}c::Value value(std::string s){c::Value v;v.type=c::Value::string;v.s=std::move(s);return v;}
YNXAIMobileSpanV6 span(const Bytes&b){return{b.data(),b.size()};}
void need(bool b){if(!b)throw std::runtime_error("CONTROL_FAILED");}
std::string sha(const Bytes&b){uint8_t d[32];need(!ynx::mobilepq::os43::platformSHA256(b.data(),b.size(),d));const char h[]="0123456789abcdef";std::string s;for(auto x:d){s+=h[x>>4];s+=h[x&15];}return s;}
int main(int argc,char**argv){try{need(argc==2);std::string root=argv[1],network;unsigned positives=0,negatives=0;auto rejects=[&](const std::function<void()>&f){bool failed=false;try{f();}catch(...){failed=true;}need(failed);negatives++;};
 for(unsigned i=0;i<16;i++){auto prefix=root+"/"+(i<10?"0":"")+std::to_string(i);auto u=read(prefix+".unsigned"),m=read(prefix+".message"),body=read(prefix+".body"),net=read(prefix+".network");network=str(net);bool response=i==1||i>=12;need((response?encodeResponseMessage(u,network):encodeRequestMessage(u,network,body))==m);need((response?ynx_ai_mobile_validate_response_message_v6(span(u),span(net),span(m)):ynx_ai_mobile_validate_request_message_v6(span(u),span(net),span(m),span(body)))==0);positives++;auto corrupt=m;corrupt.back()^=1;need((response?ynx_ai_mobile_validate_response_message_v6(span(u),span(net),span(corrupt)):ynx_ai_mobile_validate_request_message_v6(span(u),span(net),span(corrupt),span(body)))!=0);negatives++;}
 auto u=read(root+"/00.unsigned"),b=read(root+"/00.body"),m=read(root+"/00.message"),net=read(root+"/00.network");auto v=c::parseCanonical(u,16384);auto altered=[&](const char*k,c::Value val){auto x=v;x.o[k]=std::move(val);return raw(x);};
 rejects([&]{auto x=v;x.o.erase("audience");encodeRequestMessage(raw(x),network,b);});rejects([&]{auto x=v;x.o["approved"]=value("true");encodeRequestMessage(raw(x),network,b);});rejects([&]{auto x=v;x.o["policyRevision"].type=c::Value::integer;x.o["policyRevision"].n=1;encodeRequestMessage(raw(x),network,b);});
 for(auto change:std::vector<std::pair<const char*,std::string>>{{"version","5"},{"method","GET"},{"path","/api/tasks/evil"},{"nonce","short"},{"expiresAt","2026-11-01T00:00:30.001Z"},{"action","task.handoff"},{"canonicalOwner","0x2222222222222222222222222222222222222222"},{"holder","wrong-device"}})rejects([&]{encodeRequestMessage(altered(change.first,value(change.second)),network,b);});
 rejects([&]{auto x=b;x.push_back(' ');encodeRequestMessage(u,network,x);});rejects([&]{auto x=u;x.insert(x.begin(),{0xef,0xbb,0xbf});encodeRequestMessage(x,network,b);});rejects([&]{auto x=u;x.push_back(' ');encodeRequestMessage(x,network,b);});
 // Hash and size are correctly updated first: these reject malformed raw JSON, not mere digest drift.
 for(auto s:{std::string("{\"conversationId\":\"PUBLIC-conversation\",\"conversationId\":\"PUBLIC-conversation\"}"),std::string("{\"conversationId\":\"\\ud800\"}"),std::string("\xef\xbb\xbf{}")})rejects([&]{Bytes body(s.begin(),s.end());auto x=v;x.o["bodyDigest"]=value(sha(body));x.o["bodyBytes"]=value(std::to_string(body.size()));encodeRequestMessage(raw(x),network,body);});
 auto ru=read(root+"/01.unsigned");auto r=c::parseCanonical(ru,16384);rejects([&]{auto x=r;x.o["status"]=value("200");encodeResponseMessage(raw(x),network);});rejects([&]{auto x=r;x.o["responseIssuer"]=value("bad");encodeResponseMessage(raw(x),network);});rejects([&]{auto x=r;x.o["state"]=value("COMMITTED");x.o["requestRef"]=c::Value{};encodeResponseMessage(raw(x),network);});rejects([&]{encodeResponseMessage(ru,std::string(64,'b'));});
 need(ynx_ai_mobile_validate_request_message_v6(span(u),span(net),{m.data(),16385},span(b))!=0);negatives++;need(ynx_ai_mobile_validate_request_message_v6({nullptr,3},span(net),span(m),span(b))!=0);negatives++;
 auto wrongCount=m;wrongCount[3]=4;need(ynx_ai_mobile_validate_request_message_v6(span(u),span(net),span(wrongCount),span(b))!=0);negatives++;
 auto trailing=m;trailing.push_back(0);need(ynx_ai_mobile_validate_request_message_v6(span(u),span(net),span(trailing),span(b))!=0);negatives++;
 primitiveUnavailable=true;rejects([&]{encodeRequestMessage(u,network,b);});primitiveUnavailable=false;
 // Typed constructor builds exact35/E5 from captured fields, generates actual body digest/length.
 RequestFields f;auto field=[&](const char*k){return v.at(k).text();};f.platform=field("platform");f.sessionBinding=field("sessionBinding");f.account=field("account");f.canonicalOwner=field("canonicalOwner");f.deviceId=field("deviceId");f.deviceRegistrationId=field("deviceRegistrationId");f.deviceRegistrationRevision=field("deviceRegistrationRevision");f.deviceRegistrationDigest=field("deviceRegistrationDigest");f.method=field("method");f.path=field("path");f.nonce=field("nonce");f.issuedAt=field("issuedAt");f.expiresAt=field("expiresAt");f.audience=field("audience");f.action=field("action");f.holder=field("holder");f.operationId=field("operationId");f.policyRevision=field("policyRevision");f.creationConversationId=v.at("creationBinding").at("conversationId").text();auto built=buildRequestDATA(f,network,b);need(built.unsignedOriginal==u&&built.messageOriginal==m);positives++;
 std::cout<<"{\"positive\":"<<positives<<",\"negative\":"<<negatives<<",\"RootAdmission\":false,\"SourceAdmission\":false,\"NativeAdmission\":false,\"SHA256\":\"PUBLIC_SYSTEM_OPENSSL_ADAPTER_ONLY\"}\n";return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
