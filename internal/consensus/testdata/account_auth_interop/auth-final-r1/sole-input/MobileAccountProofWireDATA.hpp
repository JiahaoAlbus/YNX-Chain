#pragma once
#include "MobileAccountProofHostPortPrivate.hpp"
#include <limits>
#include <stdexcept>
#include <algorithm>
namespace ynx::sdk::mobile::accountproof::wire {
// Transport tag only, NOT a signature domain. Original LightBlock signatures
// and Go policy bytes remain untouched. No Root/Source or Native constructor.
inline constexpr char tag[]="YNX-MOBILE-ACCOUNT-PROOF-HOST/V1";
inline constexpr size_t maxPayloadBytes=(36u<<20)+(64u<<10);
inline constexpr size_t maxFrameBytes=sizeof(tag)+4+4+4+8+32+4+4+4+maxPayloadBytes;
enum class Status:uint32_t {Request=0,OK=1,NotReady=2,Failed=3,Closed=4};
struct FrameDATA {Operation operation=Operation::Open;Status status=Status::Request;uint64_t sequence=0;std::array<uint8_t,32>reader{};Failure failure;Bytes payload;};
inline void require(bool b){if(!b)throw std::invalid_argument("MOBILE_ACCOUNT_PROOF_WIRE_DATA_INVALID");}
inline bool zero(const std::array<uint8_t,32>&a){return std::all_of(a.begin(),a.end(),[](uint8_t v){return v==0;});}
struct Writer {
 Bytes b;
 void u8(uint8_t v){b.push_back(v);} void u32(uint32_t v){for(int i=3;i>=0;--i)u8(uint8_t(v>>(i*8)));}
 void u64(uint64_t v){for(int i=7;i>=0;--i)u8(uint8_t(v>>(i*8)));}
 void raw(const uint8_t*p,size_t n){require(n<=maxPayloadBytes&&b.size()<=maxFrameBytes-n);if(n)b.insert(b.end(),p,p+n);}
 void bytes(const Bytes&v,size_t cap){require(v.size()<=cap&&v.size()<=std::numeric_limits<uint32_t>::max());u32(uint32_t(v.size()));raw(v.data(),v.size());}
 void text(const std::string&v,size_t cap){require(!v.empty()&&v.size()<=cap);for(unsigned char c:v)require(c>=33&&c<=126);u32(uint32_t(v.size()));raw(reinterpret_cast<const uint8_t*>(v.data()),v.size());}
};
struct ReaderDATA {
 const Bytes&b;size_t i=0;
 void need(size_t n){require(i<=b.size()&&n<=b.size()-i);} uint8_t u8(){need(1);return b[i++];}
 uint32_t u32(){uint32_t n=0;for(int k=0;k<4;++k)n=(n<<8)|u8();return n;}
 uint64_t u64(){uint64_t n=0;for(int k=0;k<8;++k)n=(n<<8)|u8();return n;}
 void raw(uint8_t*p,size_t n){need(n);if(n)std::copy(b.begin()+i,b.begin()+i+n,p);i+=n;}
 Bytes bytes(size_t cap){auto n=u32();require(n<=cap);need(n);Bytes v(b.begin()+i,b.begin()+i+n);i+=n;return v;}
 std::string text(size_t cap){auto n=u32();require(n&&n<=cap);need(n);std::string s(b.begin()+i,b.begin()+i+n);i+=n;for(unsigned char c:s)require(c>=33&&c<=126);return s;}
 bool flag(){auto n=u8();require(n<=1);return n!=0;}
};
inline bool owner(const std::string&s){if(s.size()!=42||s.substr(0,2)!="0x")return false;for(size_t i=2;i<s.size();++i)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return false;return true;}
inline void reg(Writer&w,const std::optional<RegistrationDATA>&r){w.u8(r?1:0);if(!r)return;require(owner(r->owner)&&r->pkA.size()==2592&&r->pkB.size()==64);w.text(r->algorithmVersion,128);w.text(r->owner,42);w.bytes(r->pkA,2592);w.bytes(r->pkB,64);w.u64(r->revision);w.u64(r->registeredAt);w.u64(r->activeFrom);w.u64(r->ledgerNonce);}
inline std::optional<RegistrationDATA> reg(ReaderDATA&r){if(!r.flag())return {};RegistrationDATA v;v.algorithmVersion=r.text(128);v.owner=r.text(42);v.pkA=r.bytes(2592);v.pkB=r.bytes(64);v.revision=r.u64();v.registeredAt=r.u64();v.activeFrom=r.u64();v.ledgerNonce=r.u64();require(owner(v.owner)&&v.pkA.size()==2592&&v.pkB.size()==64);return v;}
inline void checkpoint(Writer&w,const CheckpointDATA&v){require(v.height>=0);w.text(v.chainID,128);w.u64(uint64_t(v.height));w.raw(v.appHash.data(),32);}
inline CheckpointDATA checkpoint(ReaderDATA&r){CheckpointDATA v;v.chainID=r.text(128);auto h=r.u64();require(h<=uint64_t(INT64_MAX));v.height=int64_t(h);r.raw(v.appHash.data(),32);return v;}
inline void account(Writer&w,const AccountDATA&v){require(owner(v.owner)&&v.nativeChainID>0&&v.committedHeight>=0&&!v.policyOriginal.empty());w.text(v.owner,42);w.raw(v.networkID.data(),32);w.u64(uint64_t(v.nativeChainID));w.u64(uint64_t(v.committedHeight));w.u64(v.executionHeight);w.u64(v.ledgerNonce);w.bytes(v.policyOriginal,maxPolicyBytes);w.text(v.committedAuthorizationStatus,128);w.u8(v.committedPQSigningEnabled);w.text(v.authorizationStatus,128);w.u8(v.pqSigningEnabled);if(v.committedRegistration)require(v.committedRegistration->owner==v.owner);if(v.executionRegistration)require(v.executionRegistration->owner==v.owner);reg(w,v.committedRegistration);reg(w,v.executionRegistration);}
inline AccountDATA account(ReaderDATA&r){AccountDATA v;v.owner=r.text(42);require(owner(v.owner));r.raw(v.networkID.data(),32);auto chain=r.u64(),h=r.u64();require(chain>0&&chain<=uint64_t(INT64_MAX)&&h<=uint64_t(INT64_MAX));v.nativeChainID=int64_t(chain);v.committedHeight=int64_t(h);v.executionHeight=r.u64();v.ledgerNonce=r.u64();v.policyOriginal=r.bytes(maxPolicyBytes);require(!v.policyOriginal.empty());v.committedAuthorizationStatus=r.text(128);v.committedPQSigningEnabled=r.flag();v.authorizationStatus=r.text(128);v.pqSigningEnabled=r.flag();v.committedRegistration=reg(r);v.executionRegistration=reg(r);if(v.committedRegistration)require(v.committedRegistration->owner==v.owner);if(v.executionRegistration)require(v.executionRegistration->owner==v.owner);return v;}
inline void viewShape(const CommittedProofViewDATA&v){require(v.proof.height>=0&&v.proof.height<INT64_MAX-1&&v.currentCheckpoint.height>v.proof.height&&v.currentCheckpoint.height<INT64_MAX-1);require(v.proof.chainID==v.currentCheckpoint.chainID&&v.historicalAccount.owner==v.currentAccount.owner&&v.historicalAccount.networkID==v.currentAccount.networkID&&v.historicalAccount.nativeChainID==v.currentAccount.nativeChainID);require(v.historicalAccount.committedHeight==v.proof.height&&v.historicalAccount.executionHeight==uint64_t(v.proof.height)+1&&v.currentAccount.committedHeight==v.currentCheckpoint.height&&v.currentAccount.executionHeight==uint64_t(v.currentCheckpoint.height)+1);require(!v.blockOriginal.empty()&&v.blockOriginal.size()<=maxLightBlockBytes&&!v.successorOriginal.empty()&&v.successorOriginal.size()<=maxLightBlockBytes);}
inline Bytes encodeViewDATA(const CommittedProofViewDATA&v){viewShape(v);Writer w;checkpoint(w,v.proof);account(w,v.historicalAccount);checkpoint(w,v.currentCheckpoint);account(w,v.currentAccount);w.bytes(v.blockOriginal,maxLightBlockBytes);w.bytes(v.successorOriginal,maxLightBlockBytes);require(w.b.size()<=maxPayloadBytes);return std::move(w.b);}
inline CommittedProofViewDATA decodeViewDATA(const Bytes&b){require(b.size()<=maxPayloadBytes);ReaderDATA r{b};CommittedProofViewDATA v;v.proof=checkpoint(r);v.historicalAccount=account(r);v.currentCheckpoint=checkpoint(r);v.currentAccount=account(r);v.blockOriginal=r.bytes(maxLightBlockBytes);v.successorOriginal=r.bytes(maxLightBlockBytes);require(r.i==b.size());viewShape(v);return v;}
inline void frameShape(const FrameDATA&f){auto op=uint32_t(f.operation),st=uint32_t(f.status);require(op>=1&&op<=6&&st<=4&&f.sequence>0&&f.payload.size()<=maxPayloadBytes);if(!f.failure.present)require(f.failure.code==0);if(f.status==Status::Request){require(!f.failure.present&&f.payload.empty());require((f.operation==Operation::Open)==zero(f.reader));return;}if(f.status==Status::NotReady){require((f.operation==Operation::Read||f.operation==Operation::Current)&&!zero(f.reader)&&f.failure.present&&f.payload.empty());return;}if(f.status==Status::Failed){require(f.failure.present&&f.payload.empty());return;}if(f.status==Status::Closed){require(f.operation==Operation::Close&&!zero(f.reader)&&f.payload.empty());return;}require(!f.failure.present&&!zero(f.reader));if(f.operation==Operation::Read||f.operation==Operation::Current){require(f.status==Status::OK);(void)decodeViewDATA(f.payload);}else require(f.payload.empty());}
inline Bytes encodeFrameDATA(const FrameDATA&f){frameShape(f);Writer w;w.raw(reinterpret_cast<const uint8_t*>(tag),sizeof(tag));w.u32(version);w.u32(uint32_t(f.operation));w.u32(uint32_t(f.status));w.u64(f.sequence);w.raw(f.reader.data(),32);w.u32(f.failure.present?1:0);w.u32(static_cast<uint32_t>(f.failure.code));w.bytes(f.payload,maxPayloadBytes);return std::move(w.b);}
inline FrameDATA decodeFrameDATA(const Bytes&b){require(b.size()<=maxFrameBytes);ReaderDATA r{b};for(size_t i=0;i<sizeof(tag);++i)require(r.u8()==uint8_t(tag[i]));require(r.u32()==version);FrameDATA f;f.operation=Operation(r.u32());f.status=Status(r.u32());f.sequence=r.u64();r.raw(f.reader.data(),32);auto e=r.u32();require(e<=1);f.failure.present=e;auto c=r.u32();int64_t signedCode=c<=uint32_t(INT32_MAX)?int64_t(c):int64_t(c)-(int64_t(1)<<32);f.failure.code=int32_t(signedCode);f.payload=r.bytes(maxPayloadBytes);require(r.i==b.size());frameShape(f);return f;}
// Explicit transport sequencing DATA, never a constructor of HostPort/Reader.
// One flight; same private channel+reader inventory must independently AND.
struct SequenceDATA {
 uint64_t next=1,pending=0;Operation operation=Operation::Open;std::array<uint8_t,32>reader{};bool opened=false,terminal=false,retired=false;Failure firstCause;
 void request(const FrameDATA&f){frameShape(f);require(f.status==Status::Request&&pending==0&&f.sequence==next&&next<UINT64_MAX);if(!opened)require(f.operation==Operation::Open&&zero(f.reader));else require(f.reader==reader&&f.operation!=Operation::Open);if(terminal||retired)require(f.operation==Operation::Retire||f.operation==Operation::Join||f.operation==Operation::Close);pending=f.sequence;operation=f.operation;}
 void response(const FrameDATA&f){frameShape(f);require(pending&&f.sequence==pending&&f.operation==operation&&f.status!=Status::Request);if(opened)require(f.reader==reader);else{require(operation==Operation::Open);reader=f.reader;opened=!zero(reader);}pending=0;++next;if(f.status==Status::Failed){terminal=true;if(!firstCause.present)firstCause=f.failure;}if(f.status==Status::Closed&&f.failure.present&&!firstCause.present)firstCause=f.failure;if(operation==Operation::Retire||f.status==Status::Closed)retired=true;}
};
} // namespace
