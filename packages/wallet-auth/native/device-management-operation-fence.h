#pragma once
#include "original-host-dirfd-journal.h"
#include <array>
#include <cstdint>
#include <thread>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#endif

namespace ynx_auth_private {
// Private durable DATA fence only: neither a source selector nor authority.
// The future original owner must derive these values from its own verified
// operation and retain its real Source/holder through the entire invocation.
struct ManagementOriginalBinding {
 std::array<unsigned char,32> issuer,operation,actor,session,replayKey,proofDigest,bodyDigest;
 uint64_t expiresMs;
};
class ManagementOperationFence final {
 HostDirfdJournal&journal_;std::thread::id thread_;std::string key_,record_,first_;bool selected_=false;
 static bool nonzero(const std::array<unsigned char,32>&x){unsigned char r=0;for(auto v:x)r|=v;return r!=0;}
 static std::array<unsigned char,32> hash(const std::string&x){std::array<unsigned char,32>out{};
#ifdef __APPLE__
  CC_SHA256(x.data(),static_cast<CC_LONG>(x.size()),out.data());
#else
  if(!SHA256(reinterpret_cast<const unsigned char*>(x.data()),x.size(),out.data()))throw std::runtime_error("MANAGEMENT_FENCE_HASH");
#endif
  return out;
 }
 static void append(std::string&out,const std::array<unsigned char,32>&v){out.append(reinterpret_cast<const char*>(v.data()),v.size());}
 void thread()const{if(thread_!=std::this_thread::get_id())throw std::runtime_error("MANAGEMENT_FENCE_THREAD");}
 [[noreturn]]void fail(const std::string&v){if(first_.empty())first_=v;throw std::runtime_error(first_);}
 public:
 enum class Observation{UNKNOWN,MATCHED_ORIGINAL,MISMATCH};
 ManagementOperationFence(HostDirfdJournal&journal,const ManagementOriginalBinding&b):journal_(journal),thread_(std::this_thread::get_id()){
  if(!nonzero(b.issuer)||!nonzero(b.operation)||!nonzero(b.actor)||!nonzero(b.session)||!nonzero(b.replayKey)||!nonzero(b.proofDigest)||!nonzero(b.bodyDigest)||!b.expiresMs)throw std::runtime_error("MANAGEMENT_FENCE_BINDING");
  // The same issuer+operation always maps to the same file, irrespective of
  // actor, nonce or body: changing any of those cannot allocate a new slot.
  std::string identity="YNX-MANAGEMENT-OPERATION-ID/v1";append(identity,b.issuer);append(identity,b.operation);
  const char*hex="0123456789abcdef";for(auto v:hash(identity)){key_.push_back(hex[v>>4]);key_.push_back(hex[v&15]);}
  record_="YNX-MANAGEMENT-ORIGINAL/v1";append(record_,b.issuer);append(record_,b.operation);append(record_,b.actor);append(record_,b.session);append(record_,b.replayKey);append(record_,b.proofDigest);append(record_,b.bodyDigest);for(int shift=56;shift>=0;shift-=8)record_.push_back(char(b.expiresMs>>shift));
 }
 ManagementOperationFence(const ManagementOperationFence&)=delete;ManagementOperationFence&operator=(const ManagementOperationFence&)=delete;
 // A missing row is never a retry entitlement. Every attempted write, even
 // a failed/ambiguous write, consumes this instance and must remain UNKNOWN.
 void reserve(){thread();if(selected_)fail("MANAGEMENT_FENCE_RECOVER_ONLY");selected_=true;try{for(const auto&n:journal_.list())if(n==key_+".entered"||n==key_+".terminal")fail("MANAGEMENT_FENCE_RECOVER_ONLY");journal_.writeProductDeviceV4OnceExclusive(key_+".entered",record_);if(journal_.read(key_+".entered",131072)!=record_)fail("MANAGEMENT_FENCE_READBACK");}catch(const std::exception&e){fail(e.what());}}
 Observation observe(){thread();try{for(const auto&n:journal_.list())if(n==key_+".entered")return journal_.read(n,131072)==record_?Observation::MATCHED_ORIGINAL:Observation::MISMATCH;return Observation::UNKNOWN;}catch(const std::exception&e){fail(e.what());}}
 const std::string&firstCauseDATA()const{thread();return first_;}
};
}
