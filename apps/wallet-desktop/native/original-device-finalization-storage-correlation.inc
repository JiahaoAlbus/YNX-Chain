#include "original-product-device-v4-registered-finalization.h"
#include <CommonCrypto/CommonDigest.h>
#include <chrono>
#include <charconv>
#include <limits>
#include <pthread.h>
namespace ynx_auth_private {
namespace {
[[noreturn]] void reject(){throw std::runtime_error("DEVICE_REGISTERED_FINALIZATION_UNAVAILABLE");}
static const std::vector<std::string>identityFields={"networkId","canonicalOwner","account","productId","clientId","platform","applicationId","bundleId","packageId","origin","callback","deviceId"};
static const std::vector<std::string>stableFields={"networkId","canonicalOwner","account","productId","clientId","deviceId"};
bool hex64(const std::string&s){return s.size()==64&&std::all_of(s.begin(),s.end(),[](char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');});}
std::string hash(const std::string&s){unsigned char h[32];CC_SHA256(s.data(),(CC_LONG)s.size(),h);const char*x="0123456789abcdef";std::string o;for(auto b:h){o+=x[b>>4];o+=x[b&15];}return o;}
void field(std::string&o,const std::string&s){if(s.size()>65536)reject();for(int i=24;i>=0;i-=8)o+=(char)((uint32_t)s.size()>>i);o+=s;}
std::vector<std::string>frame(const std::string&raw,const std::string&magic,size_t count){
 if(raw.size()>131072||raw.compare(0,magic.size(),magic))reject();size_t at=magic.size();std::vector<std::string>out;
 for(size_t k=0;k<count;k++){if(raw.size()-at<4)reject();uint32_t n=0;for(unsigned i=0;i<4;i++)n=(n<<8)|(uint8_t)raw[at++];if(n>65536||n>raw.size()-at)reject();out.push_back(raw.substr(at,n));at+=n;}
 if(at!=raw.size())reject();return out;
}
// Storage correlation only, not an alternative SDK identity/authority codec.
// Exact canonical nullable-atom JSON rejects duplicate fields, types, aliases
// and trailing bytes; identity semantics still come from the original Source.
std::string quoted(const std::string&s){
 NSString*t=[[NSString alloc]initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];if(!t)reject();
 const char*h="0123456789abcdef";std::string o="\"";for(unsigned char c:s){switch(c){case'"':o+="\\\"";break;case'\\':o+="\\\\";break;case'\b':o+="\\b";break;case'\f':o+="\\f";break;case'\n':o+="\\n";break;case'\r':o+="\\r";break;case'\t':o+="\\t";break;default:if(c<32){o+="\\u00";o+=h[c>>4];o+=h[c&15];}else o+=(char)c;}}return o+'"';
}
bool nullableField(const std::string&key){return key=="bundleId"||key=="packageId";}
std::string canonical(const DeviceQueryIdentityBinding&m){std::string o="{";for(const auto&[k,v]:m){if(o.size()>1)o+=',';o+=quoted(k)+':'+(v?quoted(*v):"null");}return o+'}';}
DeviceQueryIdentityBinding atomObject(const std::string&raw,size_t maximum,bool nullable){
 if(raw.empty()||raw.size()>maximum)reject();NSData*d=[NSData dataWithBytes:raw.data() length:raw.size()];id parsed=[NSJSONSerialization JSONObjectWithData:d options:0 error:nil];if(![parsed isKindOfClass:NSDictionary.class])reject();
 DeviceQueryIdentityBinding out;for(id k in parsed){id v=parsed[k];if(![k isKindOfClass:NSString.class])reject();NSData*kb=[k dataUsingEncoding:NSUTF8StringEncoding];if(!kb||kb.length>128)reject();const std::string key((const char*)kb.bytes,kb.length);if(v==NSNull.null){if(!nullable||!nullableField(key))reject();out.emplace(key,std::nullopt);continue;}if(![v isKindOfClass:NSString.class])reject();NSData*vb=[v dataUsingEncoding:NSUTF8StringEncoding];if(!vb||vb.length>16384)reject();out.emplace(key,std::string((const char*)vb.bytes,vb.length));}
 if(canonical(out)!=raw)reject();return out;
}
void identity(const DeviceOriginalQueryIntent&i){
 if(!hex64(i.network)||i.stableDeviceIdentity.size()>1024||i.identityBinding.size()!=12)reject();for(const auto&k:identityFields){if(!i.identityBinding.count(k))reject();const auto&atom=i.identityBinding.at(k);if(atom?atom->size()>4096:!nullableField(k))reject();}if(i.identityBinding.at("networkId")!=i.network)reject();
 const auto s=atomObject(i.stableDeviceIdentity,1024,false);if(s.size()!=8||s.at("version")!="1"||s.at("domain")!="YNX-PRODUCT-DEVICE-IDENTITY/v1")reject();for(const auto&k:stableFields)if(!s.count(k)||s.at(k)!=i.identityBinding.at(k))reject();
}
void enteredIdentity(const std::string&raw,const DeviceOriginalQueryIntent&i){
 const auto f=frame(raw,"YNX-DEVICE-PROVISION-ONCE/v4",3);if(f[0]!=i.network||f[1]!=i.stableDeviceIdentity)reject();
 const auto terms=atomObject(f[2],16384,true);if(terms.size()!=19||terms.at("version")!="1"||terms.at("domain")!="YNX-PRODUCT-DEVICE-CREATE/v1")reject();
 for(const auto&k:identityFields)if(!terms.count(k)||terms.at(k)!=i.identityBinding.at(k))reject();
 for(const auto&k:{"generation","operationId","nonce","issuedAt","expiresAt"})if(!terms.count(k)||!terms.at(k)||terms.at(k)->empty())reject();
 // Creation's historical approval times are immutable DATA only. The new
 // query-purpose Source/window independently authorizes this read.
}
template<class T>T integer(const std::string&s){T n{};const auto r=std::from_chars(s.data(),s.data()+s.size(),n);if(r.ec!=std::errc()||r.ptr!=s.data()+s.size()||std::to_string(n)!=s)reject();return n;}
DeviceCreationOutcome creator(const std::string&raw,const std::string&op){const auto f=frame(raw,"YNX-DEVICE-PROVISION-CREATOR-OUTCOME/v4",8);if(f[0]!=op)reject();DeviceCreationOutcome c;c.result=integer<int32_t>(f[1]);c.cleanup=integer<uint32_t>(f[2]);c.outputState=integer<uint32_t>(f[3]);for(unsigned k=0;k<4;k++)c.lengths[k]=integer<size_t>(f[4+k]);return c;}
bool creatorComplete(const DeviceCreationOutcome&c){return c.result==0&&c.cleanup==2&&c.outputState==1&&c.lengths==std::array<size_t,4>{54,150,2592,64};}
DeviceAssociationIdentity stage(const std::string&raw,const std::string&op,const std::string&network){
 const auto f=frame(raw,"YNX-DEVICE-PROVISION-STAGED/v4",7);if(f[0]!=network||f[1]!="uid:"+std::to_string(getuid())+":device-provision:"+op||f[2].empty()||f[2].size()>4096||f[3]!=op||f[4].empty()||f[4].size()>4096||f[5].size()!=2592||f[6].size()!=64)reject();
 DeviceAssociationIdentity i;i.network=network;i.account=f[1];i.persistentRef=f[2];i.operation=op;i.osIdentity=f[4];memcpy(i.publicPair.pa.data(),f[5].data(),2592);memcpy(i.publicPair.pb.data(),f[6].data(),64);return i;
}
bool samePair(const DevicePairPublicView&a,const DevicePairPublicView&b){return a.pa==b.pa&&a.pb==b.pb;}
bool samePending(const DeviceAssociationIdentity&a,const DeviceAssociationIdentity&b){return a.network==b.network&&a.account==b.account&&a.persistentRef==b.persistentRef&&a.operation==b.operation&&a.osIdentity==b.osIdentity&&a.metadata.empty()&&b.metadata.empty()&&samePair(a.publicPair,b.publicPair);}
#ifdef YNX_DEVICE_FINALIZATION_PUBLIC_OS_TEST
extern "C" uint64_t YNXDeviceFinalizationPublicWallMS();
uint64_t wall(){return YNXDeviceFinalizationPublicWallMS();}
#else
uint64_t wall(){auto n=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();if(n<0)reject();return(uint64_t)n;}
#endif
uint64_t mono(){auto n=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();if(n<0)reject();return(uint64_t)n;}
}
