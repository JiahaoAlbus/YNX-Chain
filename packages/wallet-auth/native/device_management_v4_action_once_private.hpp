#pragma once
#include "original-host-dirfd-journal.h"
#include "original-product-device-v4-http-call.h"
#include <CommonCrypto/CommonDigest.h>
#include <thread>
namespace ynx_auth_private {
// Durable mutation admission only: NOT HTTP ACK, session state or permission.
// Unlike HTTP nonce-once, this key is the ORIGINAL mutation operation ID.
// Reacquisition with another nonce/body never re-enters revoke/cancel.
class DeviceManagementV4ActionOnce final{
 HostDirfdJournal&journal_;std::thread::id actor_=std::this_thread::get_id();
 std::string key_,entered_,first_;bool selected_=false,enteredCore_=false,terminal_=false;
 static void field(std::string&o,const std::string&s){uint32_t n=(uint32_t)s.size();for(int shift=24;shift>=0;shift-=8)o+=(char)(n>>shift);o+=s;}
 static std::string sha(const std::string&s){unsigned char h[32];CC_SHA256(s.data(),(CC_LONG)s.size(),h);const char*x="0123456789abcdef";std::string out;for(auto b:h){out+=x[b>>4];out+=x[b&15];}return out;}
 [[noreturn]]void fail(const char*c){if(first_.empty())first_=c;throw std::runtime_error(first_);}
 void actor(){if(actor_!=std::this_thread::get_id())fail("DEVICE_MANAGEMENT_V4_ACTION_ONCE_ACTOR");}
public:
 DeviceManagementV4ActionOnce(HostDirfdJournal&j,const std::string&network,const std::string&session,const std::string&registration,const std::string&action,const std::string&originalOperationId,const std::string&bodyDigest):journal_(j){
  auto hex=[](const std::string&s){return s.size()==64&&std::all_of(s.begin(),s.end(),[](char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');});};
  if(!hex(network)||!hex(session)||!hex(registration)||!hex(bodyDigest)||(action!="session.revoke"&&action!="challenge.cancel")||originalOperationId.size()<8||originalOperationId.size()>128)fail("DEVICE_MANAGEMENT_V4_ACTION_ONCE_BINDING");
  std::string identity="YNX-PRODUCT-DEVICE-MANAGEMENT-OPERATION/v4";for(const auto&s:{network,session,registration,action,originalOperationId})field(identity,s);key_=sha(identity);entered_="YNX-PRODUCT-DEVICE-MANAGEMENT-ENTERED/v4";field(entered_,identity);field(entered_,bodyDigest);
 }
 void assertAbsent(){actor();for(const auto&name:journal_.list())if(name==key_+".entered"||name==key_+".terminal")fail("DEVICE_MANAGEMENT_V4_EXISTING_MUTATION_UNKNOWN_NO_REPLAY");}
 void reserve(const std::string&e5){actor();if(selected_)fail("DEVICE_MANAGEMENT_V4_ACTION_ALREADY_SELECTED");selected_=true;if(e5.empty()||e5.size()>16384)fail("DEVICE_MANAGEMENT_V4_ACTION_E5_BOUND");field(entered_,e5);for(const auto&name:journal_.list())if(name==key_+".entered"||name==key_+".terminal")fail("DEVICE_MANAGEMENT_V4_EXISTING_MUTATION_UNKNOWN_NO_REPLAY");journal_.writeProductDeviceV4OnceExclusive(key_+".entered",entered_);if(journal_.read(key_+".entered",131072)!=entered_)fail("DEVICE_MANAGEMENT_V4_ACTION_READBACK_UNKNOWN");}
 void enter(){actor();if(!selected_||enteredCore_)fail("DEVICE_MANAGEMENT_V4_ACTION_ENTRY_ONCE");enteredCore_=true;}
 void retainProofOutcome(const ProductDeviceV4HTTPOutcomeDATA&outcome){actor();if(!enteredCore_||terminal_)fail("DEVICE_MANAGEMENT_V4_ACTION_OUTCOME_UNKNOWN");std::string raw="YNX-PRODUCT-DEVICE-MANAGEMENT-PROOF-OUTCOME/v4";field(raw,sha(entered_));field(raw,std::to_string(outcome.result));field(raw,std::to_string(outcome.cleanup));field(raw,std::string(outcome.member.begin(),outcome.member.end()));journal_.writeProductDeviceV4OnceExclusive(key_+".terminal",raw);if(journal_.read(key_+".terminal",131072)!=raw)fail("DEVICE_MANAGEMENT_V4_ACTION_OUTCOME_READBACK_UNKNOWN");terminal_=true;}
};
}
