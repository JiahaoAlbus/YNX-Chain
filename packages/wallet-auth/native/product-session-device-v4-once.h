#pragma once
#include "original-host-dirfd-journal.h"
#include <array>
#include <thread>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#endif
namespace ynx_auth_private {
// Durable storage stage ONLY, not a Source/current/pair/key-use capability.
// The future original device factory borrows its OWN registered journal; no
// path, signer callback, account/BIRTH holder or approval boolean is accepted.
class ProductDeviceV4Once final {
 HostDirfdJournal&journal_;std::thread::id thread_;
 std::string key_,entered_,first_;std::vector<unsigned char>retained_;
 enum class Phase{fresh,reserved,entered,terminal,unknown};Phase phase_=Phase::fresh;
 static std::array<unsigned char,32>digest(const std::string&raw){std::array<unsigned char,32>out{};
#ifdef __APPLE__
  CC_SHA256(raw.data(),(CC_LONG)raw.size(),out.data());
#else
  if(!SHA256((const unsigned char*)raw.data(),raw.size(),out.data()))throw std::runtime_error("DEVICE_V4_ONCE_HASH_UNKNOWN");
#endif
  return out;
 }
 static void u32(std::string&out,uint32_t n){for(int shift=24;shift>=0;shift-=8)out.push_back((char)(n>>shift));}
 static void field(std::string&out,const void*p,size_t n){u32(out,(uint32_t)n);if(n)out.append((const char*)p,n);}
 static bool nonzero(const std::array<unsigned char,32>&v){unsigned char any=0;for(auto b:v)any|=b;return any!=0;}
 [[noreturn]]void fail(const char*code){phase_=Phase::unknown;if(first_.empty())first_=code;throw std::runtime_error(first_);}
 void thread()const{if(thread_!=std::this_thread::get_id())throw std::runtime_error("DEVICE_V4_ONCE_THREAD");}
public:
 ProductDeviceV4Once(HostDirfdJournal&journal,const std::array<unsigned char,32>&network,
  const std::array<unsigned char,32>&session,const std::array<unsigned char,32>&registration,
  const std::string&nonce,const std::vector<unsigned char>&e5):journal_(journal),thread_(std::this_thread::get_id()){
  if(!nonzero(network)||!nonzero(session)||!nonzero(registration)||nonce.size()<32||nonce.size()>64||e5.empty()||e5.size()>16384)throw std::runtime_error("DEVICE_V4_ONCE_BOUND");
  for(char c:nonce)if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))throw std::runtime_error("DEVICE_V4_ONCE_NONCE");
  // Purpose/network/session/registration/nonce determine the filename. Do NOT
  // include the message in this key: changing a message must not reuse a nonce.
  std::string identity="YNX-PRODUCT-DEVICE-HTTP-ONCE/v4";
  field(identity,network.data(),32);field(identity,session.data(),32);field(identity,registration.data(),32);field(identity,nonce.data(),nonce.size());
  const char hex[]="0123456789abcdef";for(auto b:digest(identity)){key_+=hex[b>>4];key_+=hex[b&15];}
  entered_="YNX-PRODUCT-DEVICE-HTTP-ENTERED/v4";field(entered_,identity.data(),identity.size());field(entered_,e5.data(),e5.size());
 }
 ProductDeviceV4Once(const ProductDeviceV4Once&)=delete;ProductDeviceV4Once&operator=(const ProductDeviceV4Once&)=delete;
 // No cleanup deletes a reservation. Existing/partial/terminal intent is
 // observation/UNKNOWN, never a reason to invoke a private primitive again.
 void reserve(){
  thread();if(phase_!=Phase::fresh)fail("DEVICE_V4_ONCE_ALREADY_SELECTED");phase_=Phase::unknown;
  try{auto names=journal_.list();for(const auto&n:names)if(n==key_+".entered"||n==key_+".terminal")fail("DEVICE_V4_ONCE_EXISTING_INTENT");
   journal_.writeProductDeviceV4OnceExclusive(key_+".entered",entered_);
   if(journal_.read(key_+".entered",131072)!=entered_)fail("DEVICE_V4_ONCE_READBACK");phase_=Phase::reserved;
  }catch(const std::exception&e){fail(e.what());}
 }
 // Lifecycle latch, NOT signing permission. Original Source/pair authority
 // and fixed transcript checks remain mandatory in the actual private caller.
 void selectPrimitiveEntry(){thread();if(phase_!=Phase::reserved)fail("DEVICE_V4_ONCE_ENTRY_REQUIRED");phase_=Phase::entered;}
 void retainOutcome(int32_t status,uint32_t cleanup,const std::vector<unsigned char>&member){
  thread();if(phase_!=Phase::entered)fail("DEVICE_V4_ONCE_NOT_ENTERED");phase_=Phase::unknown;
  // Bound before copying, then keep even non-success public partials before
  // interpreting status or making any storage callback.
  if(member.size()>98304)fail("DEVICE_V4_ONCE_MEMBER_BOUND");retained_=member;
  std::string terminal="YNX-PRODUCT-DEVICE-HTTP-OUTCOME/v4";const auto binding=digest(entered_);field(terminal,binding.data(),binding.size());u32(terminal,(uint32_t)status);u32(terminal,cleanup);field(terminal,member.data(),member.size());
  try{journal_.writeProductDeviceV4OnceExclusive(key_+".terminal",terminal);if(journal_.read(key_+".terminal",131072)!=terminal)fail("DEVICE_V4_ONCE_TERMINAL_READBACK");
   if(status!=0||cleanup!=2||member.empty())fail("DEVICE_V4_ONCE_OUTCOME_UNKNOWN");phase_=Phase::terminal;
  }catch(const std::exception&e){fail(e.what());}
 }
 std::vector<unsigned char>copyRetainedOutcomeDATA()const{if(thread_!=std::this_thread::get_id())throw std::runtime_error("DEVICE_V4_ONCE_THREAD");return retained_;}
 const std::string&recordKeyDATA()const{thread();return key_;}
 bool terminalRecordedDATA()const{thread();return phase_==Phase::terminal;}
 const std::string&firstCauseDATA()const{thread();return first_;}
};
}
