#include "NativeBackupFormat.h"
#include <string_view>
#include <cstring>
namespace ynx::auth::android_ordinary {
namespace {
constexpr auto protocol="YNX-BATCH/v0.1";
constexpr auto suite="ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512";
void reject(bool ok,int32_t code=3){if(!ok)throw Failure(code);}
struct Cursor{
 std::string_view v;size_t at=0;
 void literal(std::string_view s){reject(at<=v.size()&&v.substr(at,s.size())==s);at+=s.size();}
 std::string_view quoted(){auto start=at;while(at<v.size()&&v[at]!='"'){auto c=static_cast<unsigned char>(v[at]);reject(c>=33&&c<=126&&c!='\\');++at;}reject(at<v.size());auto result=v.substr(start,at-start);++at;return result;}
 void end(){reject(at==v.size());}
};
void base64(std::string_view s,uint8_t*out,size_t n){
 reject(s.size()==(n*8+5)/6);uint32_t bits=0,width=0;size_t used=0;
 for(auto c:s){uint32_t d;if(c>='A'&&c<='Z')d=c-'A';else if(c>='a'&&c<='z')d=c-'a'+26;else if(c>='0'&&c<='9')d=c-'0'+52;else if(c=='-')d=62;else if(c=='_')d=63;else throw Failure(3);
  bits=(bits<<6)|d;width+=6;if(width>=8){width-=8;reject(used<n);out[used++]=uint8_t(bits>>width);}bits&=width?((1u<<width)-1):0;
 }reject(used==n&&bits==0);
}
std::vector<uint8_t> public64(std::string_view s,size_t n){std::vector<uint8_t> out(n);base64(s,out.data(),n);return out;}
bool lowerhex(std::string_view s){for(auto c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;return true;}
PublicBinding binding(std::string_view raw){
 Cursor c{raw};c.literal("{\"protocolVersion\":\"");c.literal(protocol);c.literal("\",\"suite\":\"");c.literal(suite);c.literal("\",\"chainId\":\"");auto network=c.quoted();reject(network.size()==64&&lowerhex(network),4);
 c.literal(",\"owner\":\"");auto owner=c.quoted();reject(owner.size()==42&&owner.substr(0,2)=="0x"&&lowerhex(owner.substr(2)),4);
 c.literal(",\"pkA\":\"");auto a=c.quoted();c.literal(",\"pkB\":\"");auto b=c.quoted();c.literal("}");c.end();
 PublicBinding out;out.canonical=std::string(raw);out.owner.assign(owner.begin(),owner.end());out.pkA=public64(a,2592);out.pkB=public64(b,64);
 for(size_t i=0;i<network.size();i+=2){auto digit=[](char x){return x<='9'?x-'0':x-'a'+10;};out.network.push_back(uint8_t(digit(network[i])*16+digit(network[i+1])));}return out;
}
}
OpenedBackup decodeOriginalBackup(const uint8_t*wire,size_t n,const uint8_t*credential,size_t credentialN,const uint8_t*expected,size_t expectedN){
 reject(wire&&n&&n<=196608&&credential&&credentialN==43&&expected&&expectedN&&expectedN<=8192,2);
 auto publicBinding=binding(std::string_view(reinterpret_cast<const char*>(expected),expectedN));
 Cursor outer{std::string_view(reinterpret_cast<const char*>(wire),n)};
 outer.literal("{\"format\":\"YNX-PQ-WALLET-BACKUP/v1\",\"binding\":");outer.literal(publicBinding.canonical);
 outer.literal(",\"kdf\":{\"algorithm\":\"PBKDF2-HMAC-SHA256\",\"iterations\":600000,\"salt\":\"");auto salt=outer.quoted();
 outer.literal("},\"cipher\":{\"algorithm\":\"AES-256-GCM\",\"nonce\":\"");auto nonce=outer.quoted();outer.literal("}");
 const auto endHeader=outer.at;outer.literal(",\"ciphertext\":\"");auto encrypted=outer.quoted();outer.literal("}");outer.end();
 reject(encrypted.size()>20&&encrypted.size()<=253334,2);auto cipher=public64(encrypted,encrypted.size()*6/8);reject(cipher.size()>=16,2);
 auto saltBytes=public64(salt,32),nonceBytes=public64(nonce,12);Secret password(32);base64(std::string_view(reinterpret_cast<const char*>(credential),43),password.bytes.data(),32);
 std::string aad(reinterpret_cast<const char*>(wire),endHeader);aad.push_back('}');
 auto plain=decryptOriginalBackup(password,saltBytes,nonceBytes,aad,cipher);
 // Secret plaintext is parsed in-place by exact literals; never JSON/String.
 Cursor inner{std::string_view(reinterpret_cast<const char*>(plain.bytes.data()),plain.bytes.size())};
 inner.literal("{\"format\":\"YNX-PQ-WALLET-PRIVATE/v1\",\"binding\":");inner.literal(publicBinding.canonical);inner.literal(",\"pkcs8A\":\"");
 auto a=inner.quoted();inner.literal(",\"pkcs8B\":\"");auto b=inner.quoted();inner.literal("}");inner.end();
 Secret keys(204);base64(a,keys.bytes.data(),54);base64(b,keys.bytes.data()+54,150);
 return{std::move(publicBinding),std::move(keys)};
}
}
