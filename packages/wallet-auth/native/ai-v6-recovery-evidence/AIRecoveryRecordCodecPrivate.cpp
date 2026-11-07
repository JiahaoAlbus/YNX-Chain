#include "AIRecoveryRecordCodecPrivate.hpp"
#include "MobileCanonicalDATA.hpp"
#include <algorithm>
namespace ynx::auth::ai::mobile::recovery {
namespace {
namespace data=ynx::auth::mobile::qualified::data;
using V=data::Value;
constexpr int32_t invalid=10401,unknown=10405; // Existing private Auth Code values.
void need(bool b){if(!b)throw invalid;}
V text(const std::string&s){V x;x.type=V::string;x.s=s;return x;}
bool validOperation(const std::string&s){
 if(s.empty()||s.size()>128)return false;
 for(size_t i=0;i<s.size();){unsigned char c=s[i++];if(c<128){if(c<32||c==127)return false;continue;}
  unsigned n=0,lo=0x80,hi=0xbf;
  if(c>=0xc2&&c<=0xdf)n=1;
  else if(c>=0xe0&&c<=0xef){n=2;if(c==0xe0)lo=0xa0;if(c==0xed)hi=0x9f;}
  else if(c>=0xf0&&c<=0xf4){n=3;if(c==0xf0)lo=0x90;if(c==0xf4)hi=0x8f;}else return false;
  if(s.size()-i<n)return false;
  auto first=static_cast<unsigned char>(s[i++]);if(first<lo||first>hi)return false;
  for(unsigned k=1;k<n;k++){auto b=static_cast<unsigned char>(s[i++]);if(b<0x80||b>0xbf)return false;}
 }
 return true;
}
Bytes build(const std::string&op,const std::string&nonce,uint32_t phase,const Parts&p){
 need(validOperation(op)&&phase>=1&&phase<=5);
 if(phase==1)need(nonce.empty());else need(nonce.size()==43&&data::unbase64url(nonce,32).size()==32);
 const std::array<const Bytes*,4>raw={&p.prepared,&p.member,&p.response,&p.receipt};
 for(size_t i=0;i<4;i++){need(raw[i]->size()<=3u*1048576u);if(!p.present[i])need(raw[i]->empty());}
 if(phase==1)need(std::none_of(p.present.begin(),p.present.end(),[](bool b){return b;}));
 else need(p.present[0]&&!p.prepared.empty());
 if(phase==2)need(!p.present[1]&&!p.present[2]&&!p.present[3]);
 if(phase==3)need(!p.present[2]&&!p.present[3]);
 if(phase==4||phase==5)need(p.present[1]&&!p.member.empty());
 if(phase==4)need(!p.present[2]&&!p.present[3]);
 if(phase==5)need(p.present[2]&&p.present[3]&&!p.response.empty());
 V v;v.type=V::object;v.o["version"]=text("YNX-AI-TASK-V6-RECOVERY-EVIDENCE/v1");v.o["operationId"]=text(op);
 v.o["nonce"]=phase==1?V{}:text(nonce);v.o["storagePhase"].type=V::integer;v.o["storagePhase"].n=phase;
 const char*names[]={"prepared","member","signedResponse","businessReceipt"};
 for(size_t i=0;i<4;i++){
  V slot;if(p.present[i]){slot.type=V::object;slot.o["bytes"]=text(std::to_string(raw[i]->size()));
   const auto digest=originalSHA256(*raw[i]);need(data::hex(digest));slot.o["sha256"]=text(digest);}
  v.o[names[i]]=std::move(slot);
 }
 const auto encoded=data::canonical(v);need(!encoded.empty()&&encoded.size()<=maxEvidenceIndexBytesV1);
 return Bytes(encoded.begin(),encoded.end());
}
}
int32_t encodeOriginalRecordV1(const std::string&op,const std::string&nonce,uint32_t phase,const Parts&p,Bytes&out)noexcept{
 try{auto candidate=build(op,nonce,phase,p);out=std::move(candidate);return 0;}catch(int32_t e){return e;}catch(...){return unknown;}
}
int32_t inspectOriginalRecordV1(const Bytes&original,const std::string&op,const std::string&nonce,uint32_t phase,const Parts&p)noexcept{
 try{need(!original.empty()&&original.size()<=maxEvidenceIndexBytesV1);
  // Reconstruct only independently acquired expected DATA, never decoded claims.
  // Comparison does not write, rebuild a file, authorize or replay an operation.
  need(original==build(op,nonce,phase,p));return 0;
 }catch(int32_t e){return e;}catch(...){return unknown;}
}
}
