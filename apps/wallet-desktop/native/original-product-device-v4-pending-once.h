#pragma once
#include "original-host-dirfd-journal.h"
#include <array>
#include <thread>
#include <CommonCrypto/CommonDigest.h>
namespace ynx_auth_private {
// Storage/CAS only, never an approval or generic signer. No deletion/replay.
enum class ProductDeviceV4TypedKind:uint32_t{registration=1,challenge=2};
class ProductDeviceV4PendingOnce final {
 HostDirfdJournal&journal_;std::thread::id actor_=std::this_thread::get_id();
 std::string key_,entered_,first_;std::vector<uint8_t>partial_;
 int32_t rc_=10;uint32_t cleanup_=0;size_t reported_=0;bool recovered_=false;
 enum class Phase{fresh,reserved,entered,terminal,unknown};Phase phase_=Phase::fresh;
 static std::string sha(const std::string&s){unsigned char h[32];CC_SHA256(s.data(),(CC_LONG)s.size(),h);const char*x="0123456789abcdef";std::string out;for(auto b:h){out+=x[b>>4];out+=x[b&15];}return out;}
 static void field(std::string&out,const std::string&s){uint32_t n=(uint32_t)s.size();for(int i=24;i>=0;i-=8)out+=(char)(n>>i);out+=s;}
 void actor()const{if(actor_!=std::this_thread::get_id())throw std::runtime_error("PENDING_V4_ORIGINAL_ACTOR");}
 [[noreturn]]void fail(const char*c){phase_=Phase::unknown;if(first_.empty())first_=c;throw std::runtime_error(first_);}
 void recoverPublic(const std::string&raw){
  const std::string magic="YNX-PRODUCT-DEVICE-PENDING-OUTCOME/v4";if(raw.compare(0,magic.size(),magic))fail("PENDING_V4_HISTORY_FORMAT");size_t at=magic.size();
  auto take=[&](size_t cap){if(raw.size()-at<4)fail("PENDING_V4_HISTORY_FORMAT");uint32_t n=0;for(unsigned i=0;i<4;i++)n=(n<<8)|(unsigned char)raw[at++];if(n>cap||n>raw.size()-at)fail("PENDING_V4_HISTORY_BOUND");std::string s=raw.substr(at,n);at+=n;return s;};
  if(take(64)!=sha(entered_))fail("PENDING_V4_HISTORY_BINDING");const auto rs=take(11),cs=take(10),ns=take(20),member=take(98304);if(at!=raw.size())fail("PENDING_V4_HISTORY_TRAILING");
  long long r;unsigned long long c,n;try{size_t used=0;r=std::stoll(rs,&used);if(used!=rs.size()||std::to_string(r)!=rs||r<INT32_MIN||r>INT32_MAX)fail("PENDING_V4_HISTORY_STATUS");c=std::stoull(cs,&used);if(used!=cs.size()||std::to_string(c)!=cs||c>UINT32_MAX)fail("PENDING_V4_HISTORY_STATUS");n=std::stoull(ns,&used);if(used!=ns.size()||std::to_string(n)!=ns||n>SIZE_MAX)fail("PENDING_V4_HISTORY_STATUS");}catch(const std::exception&){fail("PENDING_V4_HISTORY_STATUS");}
  rc_=(int32_t)r;cleanup_=(uint32_t)c;reported_=(size_t)n;partial_.assign(member.begin(),member.end());recovered_=true;
 }
public:
 ProductDeviceV4PendingOnce(HostDirfdJournal&j,ProductDeviceV4TypedKind kind,const std::string&network,const std::string&registration,const std::string&pending,const std::string&scope):journal_(j){
  auto hex=[](const std::string&s){return s.size()==64&&std::all_of(s.begin(),s.end(),[](char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');});};
  if((kind!=ProductDeviceV4TypedKind::registration&&kind!=ProductDeviceV4TypedKind::challenge)||!hex(network)||!hex(registration)||!hex(pending)||scope.empty()||scope.size()>65536)throw std::runtime_error("PENDING_V4_ONCE_BINDING");
  // Same pending+kind cannot change messages/challenge and obtain a new key.
  std::string identity="YNX-PRODUCT-DEVICE-PENDING-ONCE/v4";field(identity,std::to_string((uint32_t)kind));field(identity,network);field(identity,registration);field(identity,pending);key_=sha(identity);entered_="YNX-PRODUCT-DEVICE-PENDING-ENTERED/v4";field(entered_,identity);field(entered_,scope);
 }
 void reserve(){actor();if(phase_!=Phase::fresh)fail("PENDING_V4_ALREADY_SELECTED");phase_=Phase::unknown;try{const auto names=journal_.list();const bool hasEntered=std::find(names.begin(),names.end(),key_+".entered")!=names.end(),hasTerminal=std::find(names.begin(),names.end(),key_+".terminal")!=names.end();if(hasEntered||hasTerminal){if(!hasEntered||journal_.read(key_+".entered",131072)!=entered_)fail("PENDING_V4_EXISTING_INPUT_MISMATCH");if(hasTerminal)recoverPublic(journal_.read(key_+".terminal",131072));fail("PENDING_V4_EXISTING_UNKNOWN_NO_REPLAY");}journal_.writeProductDeviceV4OnceExclusive(key_+".entered",entered_);if(journal_.read(key_+".entered",131072)!=entered_)fail("PENDING_V4_INTENT_READBACK");phase_=Phase::reserved;}catch(const std::exception&e){fail(e.what());}}
 void enter(){actor();if(phase_!=Phase::reserved)fail("PENDING_V4_ENTRY_NOT_FRESH");phase_=Phase::entered;}
 void capture(int32_t rc,uint32_t cleanup,size_t reported,const std::vector<uint8_t>&member){actor();if(phase_!=Phase::entered)fail("PENDING_V4_NOT_ENTERED");phase_=Phase::unknown;if(member.size()>98304)fail("PENDING_V4_MEMBER_BOUND");partial_=member;std::string raw="YNX-PRODUCT-DEVICE-PENDING-OUTCOME/v4";field(raw,sha(entered_));field(raw,std::to_string(rc));field(raw,std::to_string(cleanup));field(raw,std::to_string(reported));field(raw,std::string(member.begin(),member.end()));try{journal_.writeProductDeviceV4OnceExclusive(key_+".terminal",raw);if(journal_.read(key_+".terminal",131072)!=raw)fail("PENDING_V4_TERMINAL_READBACK");if(rc!=0||cleanup!=2||reported!=member.size()||member.empty())fail("PENDING_V4_OUTCOME_UNKNOWN");phase_=Phase::terminal;}catch(const std::exception&e){fail(e.what());}}
 std::vector<uint8_t>copyPartialDATA()const{actor();return partial_;}
 bool terminalDATA()const{actor();return phase_==Phase::terminal;}
 bool recoveredDATA()const{actor();return recovered_;}int32_t resultDATA()const{actor();return rc_;}uint32_t cleanupDATA()const{actor();return cleanup_;}size_t reportedDATA()const{actor();return reported_;}
 const std::string&keyDATA()const{actor();return key_;}
};
}
