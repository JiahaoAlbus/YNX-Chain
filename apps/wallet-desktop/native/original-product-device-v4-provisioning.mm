#include "original-product-device-v4-provisioning.h"
#include <CommonCrypto/CommonDigest.h>
#include <thread>
#include <chrono>
#include <unistd.h>
#include <pthread.h>
namespace ynx_auth_private {
static void refuse(const char*c){throw std::runtime_error(c);}
static std::string sha(const std::string&s){unsigned char h[32];CC_SHA256(s.data(),(CC_LONG)s.size(),h);const char*x="0123456789abcdef";std::string out;for(auto b:h){out+=x[b>>4];out+=x[b&15];}return out;}
static void field(std::string&out,const std::string&s){if(s.size()>65536)refuse("DEVICE_PROVISION_BOUND");uint32_t n=(uint32_t)s.size();for(int i=24;i>=0;i-=8)out+=(char)(n>>i);out+=s;}
static bool hex64(const std::string&s){return s.size()==64&&std::all_of(s.begin(),s.end(),[](char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');});}
#ifdef YNX_DEVICE_PROVISION_PUBLIC_OS_TEST
extern "C" uint64_t YNXDeviceProvisionPublicWallMS();
static uint64_t wall(){return YNXDeviceProvisionPublicWallMS();}
#else
static uint64_t wall(){const auto n=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();if(n<0)refuse("DEVICE_PROVISION_CLOCK");return(uint64_t)n;}
#endif
void DeviceProvisioningWindowFence::check(const DeviceProvisioningIntent&i){const auto n=wall(),m=(uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();if(!i.expiresAtMs||i.expiresAtMs<=i.issuedAtMs||n<floor_)refuse("DEVICE_PROVISION_WINDOW");if(!deadline_){deadline_=i.expiresAtMs;anchorWall_=n;anchorMono_=m;}deadline_=std::min(deadline_,i.expiresAtMs);if(m<anchorMono_||UINT64_MAX-anchorWall_<m-anchorMono_)refuse("DEVICE_PROVISION_CLOCK");const auto at=std::max(n,anchorWall_+(m-anchorMono_));floor_=n;if(at<i.issuedAtMs||at>=deadline_)refuse("DEVICE_PROVISION_EXPIRED");}
static void actor(){if(!pthread_main_np()||getuid()==0||getuid()!=geteuid()||getgid()!=getegid())refuse("DEVICE_PROVISION_ORIGINAL_ACTOR");}
static std::string publicTerminal(const DeviceProvisioningPublicOutcome&o){std::string raw="YNX-DEVICE-PROVISION-OUTCOME/v4";for(const auto&s:{o.operation,o.state,o.association})field(raw,s);return raw;}
static std::string stagedReceipt(const DeviceAssociationIdentity&i){std::string raw="YNX-DEVICE-PROVISION-STAGED/v4";for(const auto&s:{i.network,i.account,i.persistentRef,i.operation,i.osIdentity})field(raw,s);field(raw,std::string((const char*)i.publicPair.pa.data(),i.publicPair.pa.size()));field(raw,std::string((const char*)i.publicPair.pb.data(),i.publicPair.pb.size()));return raw;}
OriginalDeviceProvisioning::OriginalDeviceProvisioning(HostDirfdJournal&j,std::shared_ptr<OriginalDeviceProvisioningAuthority>s,std::shared_ptr<OriginalDeviceAssociationStore>k,OriginalDeviceOnlyCreator&c):journal_(j),source_(s),store_(k),creator_(c){}
void OriginalDeviceProvisioning::assertIntentCurrent(const DeviceProvisioningIntent&selected){window_.check(selected);source_->assertCurrent();window_.check(selected);const auto now=source_->readOriginalIntent();window_.check(now);if(now.network!=selected.network||now.stableDeviceIdentity!=selected.stableDeviceIdentity||now.approvedTerms!=selected.approvedTerms)refuse("DEVICE_PROVISION_INTENT_CHANGED");source_->assertCurrent();window_.check(now);}
DeviceProvisioningPublicOutcome OriginalDeviceProvisioning::prepare(){
 actor();if(attempted_||retired_)refuse("DEVICE_PROVISION_ONCE");attempted_=true;pair_=std::make_unique<DeviceCreatedPair>();auto&pair=*pair_;std::string intent;bool enteredIntent=false;
 try{@try{if(!source_||!store_)refuse("DEVICE_PROVISION_SOURCE_NOT_SUPPLIED");source_->assertCurrent();const auto selected=source_->readOriginalIntent();window_.check(selected);source_->assertCurrent();window_.check(selected);if(!hex64(selected.network)||selected.stableDeviceIdentity.empty()||selected.stableDeviceIdentity.size()>1024||selected.approvedTerms.empty()||selected.approvedTerms.size()>65536)refuse("DEVICE_PROVISION_INTENT");
  std::string slot="YNX-DEVICE-PROVISION-ONCE/v4";field(slot,selected.network);field(slot,selected.stableDeviceIdentity);outcome_.operation=sha(slot);intent=slot;field(intent,selected.approvedTerms);
  intent_=selected;const auto current=[&](){assertIntentCurrent(selected);};
  source_->verifyOriginalCreationApproval(selected);current();
  const auto names=journal_.list();const auto entered=outcome_.operation+".entered",terminal=outcome_.operation+".terminal";
  if(std::find(names.begin(),names.end(),entered)!=names.end()||std::find(names.begin(),names.end(),terminal)!=names.end()){
   if(journal_.read(entered,131072)!=intent)refuse("DEVICE_PROVISION_EXISTING_INPUT_CONFLICT");
   outcome_.recoveredOriginal=true;refuse("DEVICE_PROVISION_EXISTING_UNKNOWN_NO_REPLAY");
  }
  // Original protected journal fsyncs ENTERED before any KeyGen/private read.
  entered_=enteredIntent=true;journal_.writeProductDeviceV4OnceExclusive(entered,intent);if(journal_.read(entered,131072)!=intent)refuse("DEVICE_PROVISION_ENTERED_READBACK");current();
  outcome_.creator=creator_.create(pair); // retain actual lengths/status FIRST
  std::string created="YNX-DEVICE-PROVISION-CREATOR-OUTCOME/v4";for(const auto&s:{outcome_.operation,std::to_string(outcome_.creator.result),std::to_string(outcome_.creator.cleanup),std::to_string(outcome_.creator.outputState)})field(created,s);for(auto n:outcome_.creator.lengths)field(created,std::to_string(n));journal_.writeProductDeviceV4OnceExclusive(sha("YNX-DEVICE-PROVISION-CREATE/v4"+outcome_.operation)+".terminal",created);
  if(outcome_.creator.result||outcome_.creator.cleanup!=2||outcome_.creator.outputState!=1||outcome_.creator.lengths!=std::array<size_t,4>{54,150,2592,64})refuse("DEVICE_PROVISION_CREATOR_UNKNOWN");current();
  // Private material is secured before registration; an interrupted operation
  // remains its original pending item, never an orphan advertised as ACTIVE.
  const auto pending=store_->stage(selected.network,outcome_.operation,pair);current();store_->assertIdentity(pending);
  const auto receipt=stagedReceipt(pending),receiptName=sha("YNX-DEVICE-PROVISION-STAGED/v4"+outcome_.operation)+".terminal";journal_.writeProductDeviceV4OnceExclusive(receiptName,receipt);if(journal_.read(receiptName,131072)!=receipt)refuse("DEVICE_PROVISION_STAGE_RECEIPT");current();
  staged_=pending;prepared_=true;outcome_.state="PENDING_REGISTRATION";return outcome_;
 }@catch(id){throw std::runtime_error("DEVICE_PROVISION_OBJC_EXCEPTION");}}catch(...){firstException_=std::current_exception();outcome_.state="UNKNOWN";outcome_.firstCause="DEVICE_PROVISION_FAILED_CLOSED";pair.clear();pair_.reset();if(enteredIntent&&!outcome_.operation.empty())try{journal_.writeProductDeviceV4OnceExclusive(sha("YNX-DEVICE-PROVISION-UNKNOWN/v4"+outcome_.operation)+".entered","UNKNOWN");}catch(...){}return outcome_;}
}
DevicePairPublicView OriginalDeviceProvisioning::readPublicPair(){actor();try{@try{if(!prepared_||!pair_||completionSelected_||retired_)refuse("DEVICE_PROVISION_NOT_PREPARED");const auto current=[&](){assertIntentCurrent(intent_);};current();store_->assertIdentity(staged_);const auto view=pair_->publicView();current();return view;}@catch(id){throw std::runtime_error("DEVICE_PROVISION_OBJC_EXCEPTION");}}catch(...){if(!firstException_)firstException_=std::current_exception();retire();refuse("DEVICE_PROVISION_PUBLIC_PAIR_UNAVAILABLE");}}
DeviceProvisioningPublicOutcome OriginalDeviceProvisioning::complete(){
 actor();if(!prepared_||!pair_||completionSelected_)refuse("DEVICE_PROVISION_COMPLETION_ONCE");completionSelected_=true;auto&pair=*pair_;const auto selected=intent_;const auto pending=staged_;bool enteredIntent=true;
 try{@try{
  const auto current=[&](){assertIntentCurrent(selected);};current();store_->assertIdentity(pending);
  // Only read an original authenticated result. The normal async SDK/account
  // approval and registration flow ran between phases; no network dispatch or
  // caller-supplied boolean takes place inside this Native method.
  const auto publicPair=pair.publicView();const auto registered=source_->readOriginalRegisteredDevice(publicPair,outcome_.operation);outcome_.association=registered.associationOriginal;
  if(registered.registrationOriginal.size()>16384||registered.associationOriginal.size()>65536)refuse("DEVICE_PROVISION_REGISTERED_BOUND");
  std::string registrationOutcome="YNX-DEVICE-PROVISION-REGISTRATION-OUTCOME/v4";for(const auto&s:{outcome_.operation,std::to_string(registered.result),registered.registrationOriginal,registered.associationOriginal})field(registrationOutcome,s);
  journal_.writeProductDeviceV4OnceExclusive(sha("YNX-DEVICE-PROVISION-REGISTER/v4"+outcome_.operation)+".terminal",registrationOutcome);
  if(registered.result||registered.registrationOriginal.empty()||registered.associationOriginal.empty())refuse("DEVICE_PROVISION_REGISTRATION_UNKNOWN");
  current();source_->assertRegisteredCurrent(registered,publicPair);store_->assertIdentity(pending);current();
  const auto published=store_->publish(pending,pair,registered);store_->assertIdentity(published);source_->assertRegisteredCurrent(registered,publicPair);current();
  // Publication alone is never authority: readers require the original live
  // registered Source plus the SAME Keychain persistent identity/metadata.
  const auto terminal=outcome_.operation+".terminal";outcome_.state="REGISTERED_LOCAL_ASSOCIATION";journal_.writeProductDeviceV4OnceExclusive(terminal,publicTerminal(outcome_));if(journal_.read(terminal,131072)!=publicTerminal(outcome_))refuse("DEVICE_PROVISION_TERMINAL_READBACK");current();pair.clear();pair_.reset();prepared_=false;return outcome_;
 }@catch(id){throw std::runtime_error("DEVICE_PROVISION_OBJC_EXCEPTION");}}catch(...){firstException_=std::current_exception();outcome_.state="UNKNOWN";outcome_.firstCause="DEVICE_PROVISION_FAILED_CLOSED";pair.clear();
  // Retain the original exception privately; never serialize e.what(), which
  // may originate from a credential/custodian implementation.
  if(enteredIntent&&!outcome_.operation.empty())try{journal_.writeProductDeviceV4OnceExclusive(sha("YNX-DEVICE-PROVISION-UNKNOWN/v4"+outcome_.operation)+".entered","UNKNOWN");}catch(...){}
  pair_.reset();prepared_=false;return outcome_;}
}
DeviceProvisioningPublicOutcome OriginalDeviceProvisioning::provision(){const auto first=prepare();return first.state=="PENDING_REGISTRATION"?complete():first;}
DevicePendingPublicOutcome OriginalDeviceProvisioning::queryOriginalPendingPublic(){
 actor();try{@try{
  if(!source_||!store_||retired_)refuse("DEVICE_PROVISION_SOURCE_NOT_SUPPLIED");source_->assertCurrent();const auto selected=source_->readOriginalIntent();window_.check(selected);source_->verifyOriginalCreationApproval(selected);assertIntentCurrent(selected);
  if(!hex64(selected.network)||selected.stableDeviceIdentity.empty()||selected.stableDeviceIdentity.size()>1024||selected.approvedTerms.empty()||selected.approvedTerms.size()>65536)refuse("DEVICE_PROVISION_INTENT");
  std::string slot="YNX-DEVICE-PROVISION-ONCE/v4";field(slot,selected.network);field(slot,selected.stableDeviceIdentity);const auto op=sha(slot);std::string entered=slot;field(entered,selected.approvedTerms);if(journal_.read(op+".entered",131072)!=entered)refuse("DEVICE_PROVISION_EXISTING_INPUT_CONFLICT");
  const auto pending=store_->readPendingPublic(selected.network,op);if(pending.operation!=op||!pending.metadata.empty())refuse("DEVICE_PROVISION_PENDING_IDENTITY");const auto receipt=journal_.read(sha("YNX-DEVICE-PROVISION-STAGED/v4"+op)+".terminal",131072);if(receipt!=stagedReceipt(pending))refuse("DEVICE_PROVISION_PENDING_SUBSTITUTED");store_->assertIdentity(pending);assertIntentCurrent(selected);return{op,"UNKNOWN",pending.publicPair};
 }@catch(id){throw std::runtime_error("DEVICE_PROVISION_OBJC_EXCEPTION");}}catch(...){throw std::runtime_error("DEVICE_PROVISION_ORIGINAL_QUERY_UNAVAILABLE");}
}
void OriginalDeviceProvisioning::retire()noexcept{if(!pthread_main_np()||getuid()!=geteuid()||getgid()!=getegid())return;if(retired_)return;retired_=true;if(prepared_){outcome_.state="UNKNOWN";if(outcome_.firstCause.empty())outcome_.firstCause="DEVICE_PROVISION_RETIRED";if(entered_)try{const auto key=sha("YNX-DEVICE-PROVISION-UNKNOWN/v4"+outcome_.operation)+".entered";const auto names=journal_.list();if(std::find(names.begin(),names.end(),key)==names.end())journal_.writeProductDeviceV4OnceExclusive(key,"UNKNOWN");}catch(...){closeResult_=false;}}if(pair_)pair_->clear();pair_.reset();prepared_=false;}
bool OriginalDeviceProvisioning::close()noexcept{if(!pthread_main_np()||getuid()!=geteuid()||getgid()!=getegid())return false;if(!closeSelected_){closeSelected_=true;retire();source_.reset();store_.reset();}return closeResult_;}
OriginalDeviceAssociationHeld::OriginalDeviceAssociationHeld(std::shared_ptr<OriginalDeviceProvisioningAuthority>s,std::shared_ptr<OriginalDeviceAssociationStore>k,HostDirfdJournal&j,DeviceAssociationIdentity i,std::shared_ptr<OriginalDeviceSelectedAssetLease>selected):source_(s),store_(k),identity_(std::move(i)),journal_(j),selected_(std::move(selected)){}
void OriginalDeviceAssociationHeld::assertCurrent(){actor();if(!first_.empty())throw std::runtime_error(first_);try{@try{if(retired_||!source_||!store_||!selected_)refuse("DEVICE_ASSOCIATION_RETIRED");selected_->assertCurrent();const auto selected=selected_->readPublicBinding();selected_->assertCurrent();source_->assertCurrent();const auto scope=source_->readOriginalIntent();window_.check(scope);store_->assertIdentity(identity_);if(!hex64(identity_.operation)||identity_.metadata.empty())refuse("DEVICE_ASSOCIATION_NOT_PUBLISHED");const auto names=journal_.list();if(std::find(names.begin(),names.end(),sha("YNX-DEVICE-PROVISION-UNKNOWN/v4"+identity_.operation)+".entered")!=names.end())refuse("DEVICE_ASSOCIATION_ORIGINAL_UNKNOWN");DeviceProvisioningPublicOutcome expected;expected.operation=identity_.operation;expected.state="REGISTERED_LOCAL_ASSOCIATION";expected.association=identity_.metadata;if(journal_.read(identity_.operation+".terminal",131072)!=publicTerminal(expected))refuse("DEVICE_ASSOCIATION_TERMINAL");window_.check(scope);source_->assertSelectedPublicAssociation(identity_.metadata,selected);window_.check(scope);source_->assertCurrent();window_.check(source_->readOriginalIntent());window_.check(scope);store_->assertIdentity(identity_);selected_->assertCurrent();if(selected_->readPublicBinding()!=selected)refuse("DEVICE_ASSOCIATION_SELECTED_CHANGED");selected_->assertCurrent();window_.check(scope);}@catch(id){throw std::runtime_error("DEVICE_ASSOCIATION_OBJC_EXCEPTION");}}catch(...){first_="DEVICE_ASSOCIATION_NOT_CURRENT";throw std::runtime_error(first_);}}
std::string OriginalDeviceAssociationHeld::readPublicAssociation(){assertCurrent();const auto out=identity_.metadata;assertCurrent();return out;}
}
