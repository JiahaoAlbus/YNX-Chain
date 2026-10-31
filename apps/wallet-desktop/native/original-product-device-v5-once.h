#pragma once
#include "original-host-dirfd-journal.h"
#include "device-v5-protocol/product_session_http_v5.h"
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <exception>
#include <limits>
#include <thread>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#endif
namespace ynx_auth_private {
// Native durable DATA domains only. Core's signed E6/E3 and purpose are not
// defined here. The original factory alone parses canonical unsigned23 and
// supplies its original nonce/session/registration, qualified by current Source.
struct ProductDeviceV5OnceBindingDATA {
 std::array<uint8_t,32> network{},session{},registration{};
 std::string canonicalOwner,nonce;
 std::array<uint8_t,2592> pkA{};
 std::array<uint8_t,64> pkB{};
};
class ProductDeviceV5Once final {
 HostDirfdJournal&journal_;std::thread::id actor_=std::this_thread::get_id();
 ProductDeviceV5OnceBindingDATA binding_;
 std::string key_,entered_,unsigned_,contentType_,first_,terminal_;
 std::array<uint8_t,32> bodyDigest_{};size_t bodyLength_=0;
 std::vector<uint8_t> partial_;
 int32_t result_=YNX_HTTP_V5_INTERNAL;uint32_t cleanup_=YNX_HTTP_V5_CLEANUP_UNKNOWN;size_t reported_=0;
 bool called_=false,recovered_=false,recorded_=false;
 std::exception_ptr persistenceFailure_;
 enum class Phase {fresh,reserved,selected,unknown};Phase phase_=Phase::fresh;
 static constexpr size_t recordCapacity=131072;
 static std::array<uint8_t,32> digest(const void*bytes,size_t length){
  std::array<uint8_t,32> out{};
#ifdef __APPLE__
  if(length>std::numeric_limits<CC_LONG>::max()||!CC_SHA256(bytes,static_cast<CC_LONG>(length),out.data()))throw std::runtime_error("DEVICE_V5_ONCE_HASH_UNKNOWN");
#else
  if(!SHA256(static_cast<const uint8_t*>(bytes),length,out.data()))throw std::runtime_error("DEVICE_V5_ONCE_HASH_UNKNOWN");
#endif
  return out;
 }
 static void u32(std::string&out,uint32_t value){for(int shift=24;shift>=0;shift-=8)out.push_back(static_cast<char>(value>>shift));}
 static void u64(std::string&out,uint64_t value){for(int shift=56;shift>=0;shift-=8)out.push_back(static_cast<char>(value>>shift));}
 static void field(std::string&out,const void*bytes,size_t length){
  if(length>UINT32_MAX)throw std::runtime_error("DEVICE_V5_ONCE_FIELD_BOUND");u32(out,static_cast<uint32_t>(length));if(length)out.append(static_cast<const char*>(bytes),length);
 }
 static void field(std::string&out,const std::string&value){field(out,value.data(),value.size());}
 template<size_t N>static bool nonzero(const std::array<uint8_t,N>&value){uint8_t any=0;for(auto b:value)any|=b;return any!=0;}
 static bool same(YNXProductSessionHTTPBytesV5 span,const void*bytes,size_t length){return span.bytes&&span.length==length&&!std::memcmp(span.bytes,bytes,length);}
 static void span(YNXProductSessionHTTPBytesV5 value,size_t cap){if(!value.bytes||!value.length||value.length>cap)throw std::runtime_error("DEVICE_V5_ONCE_SPAN_BOUND");}
 static bool contentType(const std::string&value){
  const std::string prefix="multipart/form-data; boundary=";
  if(value.compare(0,prefix.size(),prefix)||value.size()<=prefix.size()||value.size()>YNX_PRODUCT_SESSION_HTTP_V5_CONTENT_TYPE_MAX)return false;
  for(size_t i=prefix.size();i<value.size();i++){const unsigned char c=value[i];if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))return false;}return true;
 }
 void actor()const{if(actor_!=std::this_thread::get_id())throw std::runtime_error("DEVICE_V5_ONCE_ORIGINAL_ACTOR_REQUIRED");}
 [[noreturn]]void fail(const char*code){phase_=Phase::unknown;if(first_.empty())first_=code;throw std::runtime_error(first_);}
 void recover(const std::string&raw){
  const std::string magic="YNX-PRODUCT-DEVICE-HTTP-OUTCOME/v5";if(raw.compare(0,magic.size(),magic))fail("DEVICE_V5_ONCE_HISTORY_FORMAT");size_t at=magic.size();
  auto number=[&](size_t bytes){if(bytes>raw.size()-at)fail("DEVICE_V5_ONCE_HISTORY_BOUND");uint64_t value=0;for(size_t i=0;i<bytes;i++)value=(value<<8)|static_cast<unsigned char>(raw[at++]);return value;};
  auto take=[&](size_t cap){const auto n=number(4);if(n>cap||n>raw.size()-at)fail("DEVICE_V5_ONCE_HISTORY_BOUND");const auto value=raw.substr(at,static_cast<size_t>(n));at+=static_cast<size_t>(n);return value;};
  const auto binding=take(32);const auto expected=digest(entered_.data(),entered_.size());
  if(binding.size()!=expected.size()||std::memcmp(binding.data(),expected.data(),expected.size()))fail("DEVICE_V5_ONCE_HISTORY_BINDING");
  const uint32_t bits=static_cast<uint32_t>(number(4));const auto cleanup=number(4),reported=number(8),called=number(4);const auto cause=take(128),member=take(YNX_PRODUCT_SESSION_HTTP_V5_MEMBER_CAPACITY);
  if(at!=raw.size()||called>1||reported>SIZE_MAX)fail("DEVICE_V5_ONCE_HISTORY_FORMAT");
  for(char c:cause)if(!((c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'))fail("DEVICE_V5_ONCE_HISTORY_CAUSE");
  std::memcpy(&result_,&bits,sizeof(bits));cleanup_=static_cast<uint32_t>(cleanup);reported_=static_cast<size_t>(reported);called_=called==1;
  partial_.assign(member.begin(),member.end());first_=cause;recovered_=true;recorded_=true;
 }
public:
 ProductDeviceV5Once(HostDirfdJournal&journal,const ProductDeviceV5OnceBindingDATA&binding,
  YNXProductSessionHTTPBytesV5 registrationOriginal,YNXProductSessionHTTPBytesV5 unsignedOriginal,
  YNXProductSessionHTTPBytesV5 actualBody,YNXProductSessionHTTPBytesV5 actualContentType):journal_(journal),binding_(binding){
  static_assert(sizeof(size_t)<=sizeof(uint64_t),"V5 retained length must fit u64");
  span(registrationOriginal,16384);span(unsignedOriginal,YNX_PRODUCT_SESSION_HTTP_V5_MESSAGE_MAX);span(actualBody,YNX_PRODUCT_SESSION_HTTP_V5_BODY_MAX);span(actualContentType,YNX_PRODUCT_SESSION_HTTP_V5_CONTENT_TYPE_MAX);
  if(!nonzero(binding.network)||!nonzero(binding.session)||!nonzero(binding.registration)||!nonzero(binding.pkA)||!nonzero(binding.pkB)||binding.canonicalOwner.size()!=42||binding.canonicalOwner.compare(0,2,"0x")||binding.nonce.size()<32||binding.nonce.size()>64)throw std::runtime_error("DEVICE_V5_ONCE_BINDING_BOUND");
  for(size_t i=2;i<binding.canonicalOwner.size();i++){const char c=binding.canonicalOwner[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))throw std::runtime_error("DEVICE_V5_ONCE_OWNER_FORMAT");}
  for(char c:binding.nonce)if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))throw std::runtime_error("DEVICE_V5_ONCE_NONCE_FORMAT");
  if(digest(registrationOriginal.bytes,registrationOriginal.length)!=binding.registration)throw std::runtime_error("DEVICE_V5_ONCE_REGISTRATION_ORIGINAL_MISMATCH");
  unsigned_.assign(reinterpret_cast<const char*>(unsignedOriginal.bytes),unsignedOriginal.length);contentType_.assign(reinterpret_cast<const char*>(actualContentType.bytes),actualContentType.length);
  if(!contentType(contentType_))throw std::runtime_error("DEVICE_V5_ONCE_CONTENT_TYPE");bodyLength_=actualBody.length;bodyDigest_=digest(actualBody.bytes,actualBody.length);
  std::string identity="YNX-PRODUCT-DEVICE-HTTP-ONCE/v5";field(identity,"PRODUCT-SESSION-HTTP-PROOF");field(identity,"YNX-PRODUCT-SESSION-HTTP-PROOF/v5");field(identity,binding.network.data(),32);field(identity,binding.session.data(),32);field(identity,binding.registration.data(),32);field(identity,binding.nonce);
  const char*hex="0123456789abcdef";for(auto c:digest(identity.data(),identity.size())){key_+=hex[c>>4];key_+=hex[c&15];}
  entered_="YNX-PRODUCT-DEVICE-HTTP-ENTERED/v5";field(entered_,identity);field(entered_,unsigned_);u64(entered_,bodyLength_);field(entered_,bodyDigest_.data(),bodyDigest_.size());field(entered_,contentType_);field(entered_,binding.canonicalOwner);field(entered_,binding.pkA.data(),binding.pkA.size());field(entered_,binding.pkB.data(),binding.pkB.size());
  // All public result/terminal capacity is allocated before reserve/selection.
  // The complete binary request body remains solely in the Main owner's span.
  partial_.reserve(YNX_PRODUCT_SESSION_HTTP_V5_MEMBER_CAPACITY);terminal_.reserve(recordCapacity);first_.reserve(128);
 }
 ProductDeviceV5Once(const ProductDeviceV5Once&)=delete;ProductDeviceV5Once&operator=(const ProductDeviceV5Once&)=delete;
 void reserve(){
  actor();if(phase_!=Phase::fresh)fail("DEVICE_V5_ONCE_ALREADY_SELECTED");phase_=Phase::unknown;
  try{const auto names=journal_.list();const bool entered=std::find(names.begin(),names.end(),key_+".entered")!=names.end(),terminal=std::find(names.begin(),names.end(),key_+".terminal")!=names.end();
   if(entered||terminal){if(!entered||journal_.read(key_+".entered",recordCapacity)!=entered_)fail("DEVICE_V5_ONCE_EXISTING_INPUT_MISMATCH");if(terminal)recover(journal_.read(key_+".terminal",recordCapacity));fail("DEVICE_V5_ONCE_EXISTING_UNKNOWN_NO_REPLAY");}
   // This pre-existing bounded method is a storage primitive only. Neither
   // the V4 once class nor any V4 E5/domain/GET permission is reused.
   journal_.writeProductDeviceV4OnceExclusive(key_+".entered",entered_);if(journal_.read(key_+".entered",recordCapacity)!=entered_)fail("DEVICE_V5_ONCE_INTENT_READBACK");phase_=Phase::reserved;
  }catch(const std::exception&e){persistenceFailure_=std::current_exception();fail(e.what());}catch(...){persistenceFailure_=std::current_exception();fail("DEVICE_V5_ONCE_RESERVE_UNKNOWN");}
 }
 void selectPrimitiveEntry(){actor();if(phase_!=Phase::reserved)fail("DEVICE_V5_ONCE_ENTRY_REQUIRED");phase_=Phase::selected;}
 void assertOriginalRequestDATA(const YNXProductSessionHTTPRequestV5&request)const{
  actor();if(request.version!=YNX_PRODUCT_SESSION_HTTP_V5_VERSION||request.struct_size!=sizeof(request))throw std::runtime_error("DEVICE_V5_HTTP_LAYOUT_REQUIRED");
  if(!same(request.unsigned_original,unsigned_.data(),unsigned_.size())||!same(request.actual_content_type,contentType_.data(),contentType_.size())||!request.actual_body.bytes||request.actual_body.length!=bodyLength_||digest(request.actual_body.bytes,request.actual_body.length)!=bodyDigest_)throw std::runtime_error("DEVICE_V5_HTTP_ORIGINAL_CHANGED");
  if(!same(request.expected.network_id,binding_.network.data(),binding_.network.size())||!same(request.expected.owner,binding_.canonicalOwner.data(),binding_.canonicalOwner.size())||!same(request.expected.pk_a,binding_.pkA.data(),binding_.pkA.size())||!same(request.expected.pk_b,binding_.pkB.data(),binding_.pkB.size())||!same(request.pk_a,binding_.pkA.data(),binding_.pkA.size())||!same(request.pk_b,binding_.pkB.data(),binding_.pkB.size()))throw std::runtime_error("DEVICE_V5_HTTP_EXPECTED_CHANGED");
 }
 void retainOutcome(int32_t result,uint32_t cleanup,size_t reported,const std::vector<uint8_t>&member,bool primitiveCalled,const std::string&firstCause){
  actor();if(phase_!=Phase::selected)fail("DEVICE_V5_ONCE_NOT_SELECTED");phase_=Phase::unknown;
  if(member.size()>YNX_PRODUCT_SESSION_HTTP_V5_MEMBER_CAPACITY)fail("DEVICE_V5_ONCE_MEMBER_BOUND");
  // Capture every bounded public byte and the actual numeric observations
  // before any rc/cleanup interpretation, allocation or durable terminal IO.
  partial_.assign(member.begin(),member.end());result_=result;cleanup_=cleanup;reported_=reported;called_=primitiveCalled;
  if(firstCause.size()>128)fail("DEVICE_V5_ONCE_CAUSE_BOUND");
  if(!firstCause.empty())first_=firstCause;
  terminal_.assign("YNX-PRODUCT-DEVICE-HTTP-OUTCOME/v5");const auto binding=digest(entered_.data(),entered_.size());field(terminal_,binding.data(),binding.size());u32(terminal_,static_cast<uint32_t>(result));u32(terminal_,cleanup);u64(terminal_,reported);u32(terminal_,primitiveCalled?1:0);field(terminal_,first_);field(terminal_,member.data(),member.size());
  try{journal_.writeProductDeviceV4OnceExclusive(key_+".terminal",terminal_);if(journal_.read(key_+".terminal",recordCapacity)!=terminal_)throw std::runtime_error("DEVICE_V5_ONCE_TERMINAL_READBACK");recorded_=true;}
  catch(const std::exception&e){persistenceFailure_=std::current_exception();fail(e.what());}catch(...){persistenceFailure_=std::current_exception();fail("DEVICE_V5_ONCE_TERMINAL_UNKNOWN");}
 }
 std::vector<uint8_t>copyRetainedOutcomeDATA()const{actor();return partial_;}
 const std::string&recordKeyDATA()const{actor();return key_;}
 const std::string&firstCauseDATA()const{actor();return first_;}
 std::exception_ptr persistenceFailureDATA()const{actor();return persistenceFailure_;}
 int32_t resultDATA()const{actor();return result_;}uint32_t cleanupDATA()const{actor();return cleanup_;}size_t reportedLengthDATA()const{actor();return reported_;}
 bool primitiveCalledDATA()const{actor();return called_;}bool recoveredDATA()const{actor();return recovered_;}bool terminalRecordedDATA()const{actor();return recorded_;}
 static constexpr bool authorized=false,usableHTTP=false;
};
}
