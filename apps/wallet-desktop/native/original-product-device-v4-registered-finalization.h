#pragma once
#include "original-product-device-v4-query-reader.h"
namespace ynx_auth_private {
// Same V4 family. These DATA values come only from an independently acquired
// registered-finalization Source, never renderer Expected/registered:true.
// Historical generation/operationId are NOT registration revision or a revived
// creation approval. The old creation timestamps remain historical DATA.
struct DeviceRegisteredFinalizationIntent:DeviceOriginalQueryIntent{
 std::string generation,creationOperationId;
 std::optional<std::string>originalRegistrationOperation;
};
class OriginalRegisteredDeviceFinalizationAuthority{
public:virtual ~OriginalRegisteredDeviceFinalizationAuthority()=default;
 virtual void assertCurrent()=0;
 virtual DeviceRegisteredFinalizationIntent readOriginalFinalizationIntent()=0;
 virtual DeviceOriginalQueryJournalSelection readOriginalJournalSelection()=0;
 virtual void assertOriginalFinalizationBinding(const DeviceRegisteredFinalizationIntent&)=0;
 // Must read independently current ORIGINAL registration completion, not send
 // registration, re-use a creation peer or infer it from local terminal DATA.
 virtual RegisteredDeviceAssociation readOriginalRegisteredDevice(const DevicePairPublicView&,const std::string&localOperation,const std::string&originalGeneration,const std::string&creationOperationId)=0;
 virtual void assertRegisteredCurrent(const RegisteredDeviceAssociation&,const DevicePairPublicView&)=0;
};
class OriginalRegisteredDeviceFinalizationStore:public OriginalDeviceAssociationStore{
public:
 // PUBLIC attrs/persistentRef only; used by zero-DTO Source review before Main
 // mints its independent peer. No ReturnData/private read or mutation.
 virtual DeviceAssociationIdentity readOriginalPublicSameItem(const DeviceAssociationIdentity&originalStaged)=0;
 // Same item + actual private frame, only under independent registered Source.
 virtual DeviceAssociationIdentity readOriginalRegisteredOrPendingItem(const DeviceAssociationIdentity&,const RegisteredDeviceAssociation&,OriginalRegisteredDeviceFinalizationAuthority&)=0;
 // Cold local association only. SAME protected pending item, original private
 // bytes stay inside Keychain implementation; no DeviceCreatedPair output,
 // new key, creator, signing, prepare or registration invocation.
 virtual DeviceAssociationIdentity completeOriginalPendingRegistered(const DeviceAssociationIdentity&,const RegisteredDeviceAssociation&,OriginalRegisteredDeviceFinalizationAuthority&)=0;
};
std::shared_ptr<OriginalRegisteredDeviceFinalizationStore>openOriginalRegisteredDeviceFinalizationKeychainStore();
struct DeviceRegisteredFinalizationOutcome{
 std::string operation,state="EVIDENCE_NOT_SUPPLIED",association,firstCause;
 std::string originalGeneration,originalCreationOperation;
 std::optional<std::string>originalRegistrationOperation;
 bool localAssociationFinalized=false,SourceAdmission=false,newSession=false,connected=false,keyGenerated=false,registrationResent=false;
 bool authority=false,historicalUnknownObserved=false,localAssociationObserved=false,terminalObserved=false,publicationEntered=false,recoveredOriginal=false;
};
struct DeviceRegisteredFinalizationReviewDATA{
 std::string network,stableDeviceIdentity,originalCreationTerms,originalGeneration,originalCreationOperation;
 DeviceQueryIdentityBinding identityBinding;
 std::optional<std::string>originalRegistrationOperation;
 DevicePairPublicView publicPair{};bool hasPublicPair=false,SourceAdmission=false;
};
class OriginalRegisteredDeviceFinalization final{
 std::shared_ptr<OriginalRegisteredDeviceFinalizationAuthority>source_;
 std::shared_ptr<OriginalRegisteredDeviceFinalizationStore>store_;HostDirfdJournal journal_;
 DeviceRegisteredFinalizationIntent intent_;DeviceOriginalQueryJournalSelection selection_;
 std::thread::id actor_;uid_t uid_;gid_t gid_;
 uint64_t wallFloor_=0,deadline_=0,anchorWall_=0,anchorMono_=0;
 bool openSelected_=false,opened_=false,failed_=false,selected_=false,closed_=false,closeResult_=false,reviewOnly_=false;
 std::exception_ptr firstException_;DeviceRegisteredFinalizationOutcome outcome_;
 void actor();void window();void current();void fail();
public:
 OriginalRegisteredDeviceFinalization(std::shared_ptr<OriginalRegisteredDeviceFinalizationAuthority>,std::shared_ptr<OriginalRegisteredDeviceFinalizationStore>);
 OriginalRegisteredDeviceFinalization(const OriginalRegisteredDeviceFinalization&)=delete;
 OriginalRegisteredDeviceFinalization&operator=(const OriginalRegisteredDeviceFinalization&)=delete;
 // Retain owner before opening. Existing exclusive namespace only; no mkdir.
 void openRetained();
 // Independent Source public-original review. Parent retains BEFORE opening;
 // caller paths/gen/expected are never arguments. Must close this SH reader
 // before a separately captured Main/Source child opens the existing writer.
 void openReviewRetained();
 DeviceRegisteredFinalizationReviewDATA readOriginalReviewDATA();
 // ZERO DTO. Source/actual originals select the complete branch. Repeated
 // successful call returns only the same current original, never another OS
 // update. UNKNOWN never retries publication; fresh Source may observe an
 // already registered same item and finish only its missing local marker.
 DeviceRegisteredFinalizationOutcome completeOriginalLocalAssociation();
 void assertCompletedCurrent();
 const DeviceRegisteredFinalizationOutcome&originalOutcomeDATA()const{return outcome_;}
 bool close()noexcept;
 bool unresolved()const{return failed_||journal_.unresolved();}
 // No destructor cleanup retry. Native inventory retains failed close partial.
};
}
