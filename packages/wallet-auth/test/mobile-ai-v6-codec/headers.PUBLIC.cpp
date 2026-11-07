#include "MobileAITaskV6HeaderDATA.hpp"
#include "MobileCanonicalDATA.hpp"
#include "OS43Private.h"
#include <openssl/sha.h>
#include <openssl/evp.h>
#include <fstream>
#include <functional>
#include <iostream>
using namespace ynx::sdk::ai::v6::data;
namespace c=ynx::auth::mobile::qualified::data;
namespace ynx::mobilepq::os43 {int32_t platformSHA256(const uint8_t*p,size_t n,uint8_t*out){return SHA256(p,n,out)?0:9102;}}
Bytes read(const std::string&p){std::ifstream f(p,std::ios::binary);if(!f)throw std::runtime_error("HEADER_FIXTURE_MISSING");return Bytes(std::istreambuf_iterator<char>(f),{});}
std::string str(const Bytes&b){return{b.begin(),b.end()};}void need(bool x){if(!x)throw std::runtime_error("HEADER_CONTROL_FAILED");}
std::string b64(const std::string&b){std::string s((b.size()+2)/3*4,'\0');int n=EVP_EncodeBlock((unsigned char*)s.data(),(const unsigned char*)b.data(),(int)b.size());need(n==(int)s.size());while(!s.empty()&&s.back()=='=')s.pop_back();for(auto&x:s){if(x=='+')x='-';if(x=='/')x='_';}return s;}
int main(int argc,char**argv){try{need(argc==2);std::string root=argv[1],base=root+"/mobile-ai-v6-codec/",headers=root+"/mobile-ai-v6-header/";auto u=read(base+"00.unsigned"),b=read(base+"00.body"),m=read(base+"00.message"),member=read(headers+"request.member"),ru=read(base+"01.unsigned"),rm=read(base+"01.message"),rmember=read(headers+"response.member");auto net=str(read(base+"00.network")),h=str(read(headers+"request.header")),rh=str(read(headers+"response.header"));unsigned positive=0,negative=0;auto reject=[&](const std::function<void()>&f){bool x=false;try{f();}catch(...){x=true;}need(x);negative++;};
 need(encodeRequestHeaderDATA(u,net,b,member)==h);auto q=decodeRequestHeaderDATA(h,net,b);need(q.unsignedOriginal==u&&q.messageOriginal==m&&q.memberOriginal==member);positive++;
 need(encodeResponseHeaderDATA(ru,net,rmember)==rh);auto r=decodeResponseHeaderDATA(rh,net);need(r.unsignedOriginal==ru&&r.messageOriginal==rm&&r.memberOriginal==rmember);positive++;
 reject([&]{decodeRequestHeaderDATA(h+"=",net,b);});reject([&]{decodeRequestHeaderDATA(std::string(196609,'A'),net,b);});reject([&]{encodeRequestHeaderDATA(u,net,b,{});});reject([&]{encodeResponseHeaderDATA(ru,net,Bytes(98305,0));});reject([&]{auto x=b;x.push_back(' ');decodeRequestHeaderDATA(h,net,x);});
 auto v=c::parseCanonical(c::unbase64url(h,147456),147456);c::Value extra;extra.type=c::Value::boolean;extra.b=true;v.o.emplace("approved",extra);reject([&]{decodeRequestHeaderDATA(b64(c::canonical(v)),net,b);});
 // Same raw bytes but forbidden nonzero base64 tail bits, not merely wrong data.
 std::string tiny;for(size_t n=1;n<5;n++){tiny=encodeRequestHeaderDATA(u,net,b,Bytes(n,1));if(tiny.size()%4!=0)break;}need(tiny.size()%4!=0);const std::string alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";auto at=alphabet.find(tiny.back());need(at!=std::string::npos&&at+1<64);tiny.back()=alphabet[at+1];reject([&]{decodeRequestHeaderDATA(tiny,net,b);});
 reject([&]{decodeResponseHeaderDATA(rh,std::string(64,'b'));});
 std::cout<<"{\"positive\":"<<positive<<",\"negative\":"<<negative<<",\"signatureVerified\":false,\"RootAdmission\":false,\"SourceAdmission\":false,\"NativeAdmission\":false}\n";return 0;}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
