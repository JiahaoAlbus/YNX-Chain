// Storage correlation helpers are inherited exact nullable ABI2 DATA parsing,
// not query authority. No query Source is acquired or given mutation rights.
#include "original-device-finalization-storage-correlation.inc"
namespace {
std::string originalSlot(const DeviceRegisteredFinalizationIntent&i){std::string s="YNX-DEVICE-PROVISION-ONCE/v4";field(s,i.network);field(s,i.stableDeviceIdentity);return hash(s);}
std::string terminalFor(const std::string&op,const std::string&association){std::string r="YNX-DEVICE-PROVISION-OUTCOME/v4";for(const auto&s:{op,std::string("REGISTERED_LOCAL_ASSOCIATION"),association})field(r,s);return r;}
std::string registrationFor(const std::string&op,const RegisteredDeviceAssociation&r){std::string s="YNX-DEVICE-PROVISION-REGISTRATION-OUTCOME/v4";for(const auto&x:{op,std::to_string(r.result),r.registrationOriginal,r.associationOriginal})field(s,x);return s;}
std::string effectFor(const DeviceRegisteredFinalizationIntent&i,const std::string&op,const std::string&staged,const RegisteredDeviceAssociation&r){std::string s="YNX-DEVICE-REGISTERED-LOCAL-FINALIZATION/v4";for(const auto&x:{op,i.generation,i.creationOperationId,staged,r.registrationOriginal,r.associationOriginal})field(s,x);return s;}
bool sameCreationDate(const std::string&a,const std::string&b){
 auto dates=[](const std::string&s)->id{NSData*d=[[NSData alloc]initWithBase64EncodedString:[[NSString alloc]initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding] options:0];return d?[NSPropertyListSerialization propertyListWithData:d options:NSPropertyListImmutable format:nil error:nil]:nil;};
 id x=dates(a),y=dates(b);return[x isKindOfClass:NSArray.class]&&[y isKindOfClass:NSArray.class]&&[x count]==2&&[y count]==2&&[[x firstObject]isKindOfClass:NSDate.class]&&[[y firstObject]isKindOfClass:NSDate.class]&&[[x firstObject]isEqual:[y firstObject]];
}
}
OriginalRegisteredDeviceFinalization::OriginalRegisteredDeviceFinalization(std::shared_ptr<OriginalRegisteredDeviceFinalizationAuthority>s,std::shared_ptr<OriginalRegisteredDeviceFinalizationStore>k):source_(std::move(s)),store_(std::move(k)),actor_(std::this_thread::get_id()),uid_(getuid()),gid_(getgid()){}
void OriginalRegisteredDeviceFinalization::actor(){if(std::this_thread::get_id()!=actor_||!pthread_main_np()||!uid_||getuid()!=uid_||geteuid()!=uid_||getgid()!=gid_||getegid()!=gid_)reject();}
void OriginalRegisteredDeviceFinalization::window(){const auto n=wall(),m=mono();if(!intent_.expiresAtMs||intent_.expiresAtMs<=intent_.issuedAtMs||intent_.expiresAtMs-intent_.issuedAtMs>86400000||n<wallFloor_)reject();if(!deadline_){deadline_=intent_.expiresAtMs;anchorWall_=n;anchorMono_=m;}if(m<anchorMono_||UINT64_MAX-anchorWall_<m-anchorMono_)reject();wallFloor_=n;const auto at=std::max(n,anchorWall_+(m-anchorMono_));if(at<intent_.issuedAtMs||at>=deadline_)reject();}
void OriginalRegisteredDeviceFinalization::fail(){if(!firstException_)firstException_=std::current_exception();failed_=true;outcome_.state="UNKNOWN";outcome_.firstCause="DEVICE_REGISTERED_FINALIZATION_UNAVAILABLE";}
void OriginalRegisteredDeviceFinalization::current(){
 actor();if(failed_||closed_||!source_||!store_)reject();window();source_->assertCurrent();window();const auto n=source_->readOriginalFinalizationIntent();
 if(n.network!=intent_.network||n.stableDeviceIdentity!=intent_.stableDeviceIdentity||n.identityBinding!=intent_.identityBinding||n.generation!=intent_.generation||n.creationOperationId!=intent_.creationOperationId||n.originalRegistrationOperation!=intent_.originalRegistrationOperation||n.issuedAtMs!=intent_.issuedAtMs||n.expiresAtMs!=intent_.expiresAtMs)reject();
 source_->assertOriginalFinalizationBinding(intent_);window();const auto j=source_->readOriginalJournalSelection();if(j.parent!=selection_.parent||j.leaf!=selection_.leaf)reject();source_->assertCurrent();window();if(opened_)journal_.assertCurrent();
}
void OriginalRegisteredDeviceFinalization::openReviewRetained(){
 actor();if(openSelected_||closed_)reject();openSelected_=true;reviewOnly_=true;
 try{@try{if(!source_||!store_)reject();source_->assertCurrent();intent_=source_->readOriginalFinalizationIntent();identity(intent_);window();selection_=source_->readOriginalJournalSelection();current();journal_.openRetained(selection_.parent,selection_.leaf);opened_=true;current();}@catch(id){reject();}}catch(...){fail();throw std::runtime_error("DEVICE_REGISTERED_FINALIZATION_UNAVAILABLE");}
}
DeviceRegisteredFinalizationReviewDATA OriginalRegisteredDeviceFinalization::readOriginalReviewDATA(){
 try{@try{if(!opened_)reject();current();const auto op=originalSlot(intent_);const auto names=journal_.list();std::map<std::string,std::string>raw;
 for(const auto&name:{op+".entered",hash("YNX-DEVICE-PROVISION-CREATE/v4"+op)+".terminal",hash("YNX-DEVICE-PROVISION-STAGED/v4"+op)+".terminal"}){if(!std::binary_search(names.begin(),names.end(),name))reject();raw.emplace(name,journal_.read(name,131072));}
 const auto&entered=raw.at(op+".entered");enteredIdentity(entered,intent_);const auto parts=frame(entered,"YNX-DEVICE-PROVISION-ONCE/v4",3);const auto terms=atomObject(parts[2],16384,true);const auto generation=*terms.at("generation"),creationOperation=*terms.at("operationId");if(!integer<uint64_t>(generation)||(intent_.generation.size()&&generation!=intent_.generation)||(intent_.creationOperationId.size()&&creationOperation!=intent_.creationOperationId))reject();
 if(!creatorComplete(creator(raw.at(hash("YNX-DEVICE-PROVISION-CREATE/v4"+op)+".terminal"),op)))reject();const auto original=stage(raw.at(hash("YNX-DEVICE-PROVISION-STAGED/v4"+op)+".terminal"),op,intent_.network);
 current();const auto observed=store_->readOriginalPublicSameItem(original);if(observed.operation!=op||observed.persistentRef!=original.persistentRef||!samePair(observed.publicPair,original.publicPair)||!sameCreationDate(observed.osIdentity,original.osIdentity))reject();store_->assertIdentity(observed);current();
 if(journal_.list()!=names)reject();for(const auto&[name,bytes]:raw)if(journal_.read(name,131072)!=bytes)reject();store_->assertIdentity(observed);current();
 return{intent_.network,intent_.stableDeviceIdentity,parts[2],generation,creationOperation,intent_.identityBinding,intent_.originalRegistrationOperation,original.publicPair,true,false};
 }@catch(id){reject();}}catch(...){fail();throw std::runtime_error("DEVICE_REGISTERED_FINALIZATION_UNAVAILABLE");}
}
void OriginalRegisteredDeviceFinalization::openRetained(){
 actor();if(openSelected_||closed_)reject();openSelected_=true;
 try{@try{if(!source_||!store_)reject();source_->assertCurrent();intent_=source_->readOriginalFinalizationIntent();identity(intent_);if(!integer<uint64_t>(intent_.generation)||intent_.creationOperationId.size()<8||intent_.creationOperationId.size()>128)reject();for(char c:intent_.creationOperationId)if(!std::isalnum((unsigned char)c)&&c!='.'&&c!='_'&&c!=':'&&c!='-')reject();window();selection_=source_->readOriginalJournalSelection();current();
  // EXISTING namespace, no creation fallback. This is a separate independently
  // admitted finalization writer, NOT the query reader upgraded to a writer.
  journal_.openProductDeviceV4PendingExisting(selection_.parent,selection_.leaf);opened_=true;current();
 }@catch(id){reject();}}catch(...){fail();throw std::runtime_error("DEVICE_REGISTERED_FINALIZATION_UNAVAILABLE");}
}
DeviceRegisteredFinalizationOutcome OriginalRegisteredDeviceFinalization::completeOriginalLocalAssociation(){
 actor();if(selected_){if(!failed_&&outcome_.localAssociationFinalized)assertCompletedCurrent();return outcome_;}selected_=true;
 try{@try{
  if(!opened_||reviewOnly_)reject();current();const auto op=originalSlot(intent_);outcome_.operation=op;outcome_.originalGeneration=intent_.generation;outcome_.originalCreationOperation=intent_.creationOperationId;outcome_.originalRegistrationOperation=intent_.originalRegistrationOperation;
  const auto entered=op+".entered",terminal=op+".terminal",created=hash("YNX-DEVICE-PROVISION-CREATE/v4"+op)+".terminal",staged=hash("YNX-DEVICE-PROVISION-STAGED/v4"+op)+".terminal",registered=hash("YNX-DEVICE-PROVISION-REGISTER/v4"+op)+".terminal",unknown=hash("YNX-DEVICE-PROVISION-UNKNOWN/v4"+op)+".entered",effect=hash("YNX-DEVICE-REGISTERED-LOCAL-FINALIZATION/v4"+op)+".entered";
  auto names=journal_.list();std::map<std::string,std::string>raw;
  for(const auto&name:{entered,terminal,created,staged,registered,unknown,effect})if(std::binary_search(names.begin(),names.end(),name)){current();raw.emplace(name,journal_.read(name,131072));current();}
  if(!raw.count(entered)||!raw.count(created)||!raw.count(staged)){current();return outcome_;}
  enteredIdentity(raw.at(entered),intent_);const auto old=frame(raw.at(entered),"YNX-DEVICE-PROVISION-ONCE/v4",3);const auto terms=atomObject(old[2],16384,true);
  if(terms.at("generation")!=intent_.generation||terms.at("operationId")!=intent_.creationOperationId)reject();
  // Never test/renew old creation times. Fresh registered-finalization Source
  // independently owns its current/window and exact original generation.
  if(!creatorComplete(creator(raw.at(created),op))){current();return outcome_;}
  const auto originalStage=stage(raw.at(staged),op,intent_.network);
  if(raw.count(unknown)){if(raw.at(unknown)!="UNKNOWN")reject();outcome_.historicalUnknownObserved=true;}
  current();const auto root=source_->readOriginalRegisteredDevice(originalStage.publicPair,op,intent_.generation,intent_.creationOperationId);current();
  if(root.result||root.registrationOriginal.empty()||root.associationOriginal.empty()){current();return outcome_;}
  if(root.registrationOriginal.size()>16384||root.associationOriginal.size()>65536)reject();outcome_.association=root.associationOriginal;source_->assertRegisteredCurrent(root,originalStage.publicPair);current();
  const auto registration=registrationFor(op,root),attempt=effectFor(intent_,op,raw.at(staged),root),done=terminalFor(op,root.associationOriginal);
  if(raw.count(registered)&&raw.at(registered)!=registration){current();return outcome_;}
  if(raw.count(effect)&&raw.at(effect)!=attempt)reject();if(raw.count(terminal)&&raw.at(terminal)!=done)reject();
  // Existing exact root registration account is observed first. No catching a
  // generic OS failure as item-absence and no new key/store initialization.
  DeviceAssociationIdentity observed=store_->readOriginalRegisteredOrPendingItem(originalStage,root,*source_);const bool already=!observed.metadata.empty();
  if(!already){
   // Only the exact pending original can authorize a first local update.
   // An existing finalization ENTERED can NEVER retry Update on pending.
   if(raw.count(effect)){outcome_.state="UNKNOWN";outcome_.publicationEntered=true;outcome_.recoveredOriginal=true;current();return outcome_;}
   if(!samePending(observed,originalStage))reject();store_->assertIdentity(observed);current();
  }
  auto registeredIdentity=[&](const DeviceAssociationIdentity&i){if(i.network!=intent_.network||i.operation!=op||i.persistentRef!=originalStage.persistentRef||i.account!="uid:"+std::to_string(uid_)+":network:"+intent_.network+":registration:"+hash(root.registrationOriginal)||i.metadata!=root.associationOriginal||!samePair(i.publicPair,originalStage.publicPair)||!sameCreationDate(i.osIdentity,originalStage.osIdentity))reject();store_->assertIdentity(i);source_->assertRegisteredCurrent(root,i.publicPair);current();};
  const bool hadTerminal=raw.count(terminal);
  auto writeOnce=[&](const std::string&name,const std::string&bytes){current();if(raw.count(name)){if(raw.at(name)!=bytes)reject();return;}journal_.writeProductDeviceV4OnceExclusive(name,bytes);if(journal_.read(name,131072)!=bytes)reject();raw.emplace(name,bytes);names=journal_.list();if(name==terminal){outcome_.terminalObserved=true;outcome_.localAssociationFinalized=true;}current();};
  // Original registration bytes come from the independent registered Source;
  // no register/reissue RPC, creator or caller registered flag is accepted.
  if(already){registeredIdentity(observed);outcome_.recoveredOriginal=true;}
  else{
   writeOnce(registered,registration);writeOnce(effect,attempt);outcome_.publicationEntered=true;
   store_->assertIdentity(observed);source_->assertRegisteredCurrent(root,observed.publicPair);current();
   observed=store_->completeOriginalPendingRegistered(observed,root,*source_);
   registeredIdentity(observed);outcome_.localAssociationObserved=true;
  }
  registeredIdentity(observed);writeOnce(registered,registration);writeOnce(terminal,done);
  // Historical UNKNOWN is preserved; this completes only the observed same
  // registered item/local marker, never replays its old creation operation.
  for(const auto&[name,bytes]:raw)if(journal_.read(name,131072)!=bytes)reject();if(journal_.list()!=names)reject();registeredIdentity(observed);
  outcome_.localAssociationObserved=true;outcome_.terminalObserved=true;outcome_.localAssociationFinalized=true;outcome_.association=root.associationOriginal;outcome_.state=already&&hadTerminal?"ALREADY_FINALIZED_SAME_ORIGINAL":"FINALIZED_LOCAL_ASSOCIATION";return outcome_;
 }@catch(id){reject();}}catch(...){fail();return outcome_;}
}
void OriginalRegisteredDeviceFinalization::assertCompletedCurrent(){
 try{@try{if(!outcome_.localAssociationFinalized||outcome_.operation.empty())reject();current();const auto op=outcome_.operation;const auto receipt=journal_.read(hash("YNX-DEVICE-PROVISION-STAGED/v4"+op)+".terminal",131072);const auto original=stage(receipt,op,intent_.network);const auto root=source_->readOriginalRegisteredDevice(original.publicPair,op,intent_.generation,intent_.creationOperationId);if(root.result||root.associationOriginal!=outcome_.association)reject();source_->assertRegisteredCurrent(root,original.publicPair);current();const auto observed=store_->readOriginalRegisteredOrPendingItem(original,root,*source_);if(observed.persistentRef!=original.persistentRef||observed.operation!=op||observed.metadata!=root.associationOriginal||!samePair(observed.publicPair,original.publicPair)||!sameCreationDate(observed.osIdentity,original.osIdentity))reject();store_->assertIdentity(observed);if(journal_.read(op+".terminal",131072)!=terminalFor(op,root.associationOriginal))reject();source_->assertRegisteredCurrent(root,observed.publicPair);current();}@catch(id){reject();}}catch(...){fail();throw std::runtime_error("DEVICE_REGISTERED_FINALIZATION_UNAVAILABLE");}
}
bool OriginalRegisteredDeviceFinalization::close()noexcept{
 if(std::this_thread::get_id()!=actor_||!pthread_main_np()||getuid()!=uid_||geteuid()!=uid_||getgid()!=gid_||getegid()!=gid_)return false;if(closed_)return closeResult_;closed_=true;
 try{closeResult_=journal_.close();if(closeResult_){source_.reset();store_.reset();}else failed_=true;return closeResult_;}catch(...){if(!firstException_)firstException_=std::current_exception();failed_=true;return closeResult_=false;}
}
}
