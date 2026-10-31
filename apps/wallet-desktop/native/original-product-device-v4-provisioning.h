#pragma once
#import <Foundation/Foundation.h>
#include "original-host-dirfd-journal.h"
#include <memory>
#include <string>
#include <vector>
#include <array>
namespace ynx_auth_private {
// Private native composition only. None of these operands is registered by
// NAPI, a request, an asset vault, or a caller-supplied approved=true object.
struct DeviceProvisioningIntent {
 std::string network,stableDeviceIdentity,approvedTerms;
 uint64_t issuedAtMs=0,expiresAtMs=0;
};
// Local pre/post clock fence; no runtime caller-supplied clock or renewal.
class DeviceProvisioningWindowFence{
 uint64_t floor_=0,deadline_=0,anchorWall_=0,anchorMono_=0;
public:void check(const DeviceProvisioningIntent&);
};
struct DevicePairPublicView {std::array<uint8_t,2592>pa{};std::array<uint8_t,64>pb{};};
struct DeviceCreatedPair {
 std::array<uint8_t,54>a{};std::array<uint8_t,150>b{};
 std::array<uint8_t,2592>pa{};std::array<uint8_t,64>pb{};
 DeviceCreatedPair()=default;DeviceCreatedPair(const DeviceCreatedPair&)=delete;
 DeviceCreatedPair&operator=(const DeviceCreatedPair&)=delete;
 DevicePairPublicView publicView()const{return{pa,pb};}
 void clear()noexcept{for(auto p:{std::pair<uint8_t*,size_t>{a.data(),a.size()},{b.data(),b.size()}}){volatile uint8_t*q=p.first;for(size_t i=0;i<p.second;i++)q[i]=0;}}
 ~DeviceCreatedPair(){clear();}
};
struct DeviceCreationOutcome {int32_t result=10;uint32_t cleanup=0,outputState=0;std::array<size_t,4>lengths{};};
class OriginalDeviceOnlyCreator {
public:virtual ~OriginalDeviceOnlyCreator()=default;
 // Fixed device-only Core adapter, no seed/RNG/purpose/path override.
 virtual DeviceCreationOutcome create(DeviceCreatedPair&)=0;
};
// Fixed original Core ABI adapter, one call, no JS/private-output surface.
std::unique_ptr<OriginalDeviceOnlyCreator>openOriginalCoreDeviceOnlyCreator();
struct RegisteredDeviceAssociation {std::string registrationOriginal,associationOriginal;int32_t result=1;};
class OriginalDeviceProvisioningAuthority {
public:virtual ~OriginalDeviceProvisioningAuthority()=default;
 virtual void assertCurrent()=0;
 virtual DeviceProvisioningIntent readOriginalIntent()=0;
 virtual void verifyOriginalCreationApproval(const DeviceProvisioningIntent&)=0;
 // Original registered outcome, never a generated local "active" assertion.
 // May reconcile only the original operation after an unknown response.
 virtual RegisteredDeviceAssociation readOriginalRegisteredDevice(const DevicePairPublicView&,const std::string&originalOperation)=0;
 virtual void assertRegisteredCurrent(const RegisteredDeviceAssociation&,const DevicePairPublicView&)=0;
 virtual void assertSelectedPublicAssociation(const std::string&association,const std::string&selectedAssetBinding)=0;
};
struct DeviceAssociationIdentity {std::string account,network,persistentRef,metadata,operation,osIdentity;DevicePairPublicView publicPair;};
struct DevicePendingPublicOutcome{std::string operation,state="UNKNOWN";DevicePairPublicView publicPair;};
class OriginalDeviceSelectedAssetLease {
public:virtual ~OriginalDeviceSelectedAssetLease()=default;
 virtual void assertCurrent()=0;virtual std::string readPublicBinding()=0;
};
class OriginalDeviceAssociationStore {
public:virtual ~OriginalDeviceAssociationStore()=default;
 virtual DeviceAssociationIdentity stage(const std::string&network,const std::string&operation,const DeviceCreatedPair&)=0;
 virtual DeviceAssociationIdentity publish(const DeviceAssociationIdentity&,const DeviceCreatedPair&,const RegisteredDeviceAssociation&)=0;
 virtual DeviceAssociationIdentity readPublic(const std::string&network,const std::string&registrationDigest)=0;
 virtual DeviceAssociationIdentity readPendingPublic(const std::string&network,const std::string&operation)=0;
 virtual void assertIdentity(const DeviceAssociationIdentity&)=0;
};
class OriginalDeviceAssociationHeld final {
 std::shared_ptr<OriginalDeviceProvisioningAuthority>source_;
 std::shared_ptr<OriginalDeviceAssociationStore>store_;DeviceAssociationIdentity identity_;HostDirfdJournal&journal_;
 std::shared_ptr<OriginalDeviceSelectedAssetLease>selected_;std::string first_;bool retired_=false;
 DeviceProvisioningWindowFence window_;
public:
 OriginalDeviceAssociationHeld(std::shared_ptr<OriginalDeviceProvisioningAuthority>,std::shared_ptr<OriginalDeviceAssociationStore>,HostDirfdJournal&,DeviceAssociationIdentity,std::shared_ptr<OriginalDeviceSelectedAssetLease>);
 void assertCurrent();std::string readPublicAssociation();void retire()noexcept{retired_=true;}
 // Source/store are shared original parents, not closed by this child.
 void close()noexcept{retired_=true;source_.reset();store_.reset();selected_.reset();}
};
struct DeviceProvisioningPublicOutcome {
 std::string operation,state="UNKNOWN",association,firstCause;
 DeviceCreationOutcome creator;bool recoveredOriginal=false;
};
class OriginalDeviceProvisioning final {
 HostDirfdJournal&journal_;std::shared_ptr<OriginalDeviceProvisioningAuthority>source_;
 std::shared_ptr<OriginalDeviceAssociationStore>store_;OriginalDeviceOnlyCreator&creator_;
 DeviceProvisioningPublicOutcome outcome_;bool attempted_=false;
 std::exception_ptr firstException_;
 std::unique_ptr<DeviceCreatedPair>pair_;DeviceProvisioningIntent intent_;
 DeviceAssociationIdentity staged_;bool prepared_=false,completionSelected_=false,entered_=false,retired_=false,closeSelected_=false,closeResult_=true;
 DeviceProvisioningWindowFence window_;
 void assertIntentCurrent(const DeviceProvisioningIntent&);
public:
 OriginalDeviceProvisioning(HostDirfdJournal&,std::shared_ptr<OriginalDeviceProvisioningAuthority>,std::shared_ptr<OriginalDeviceAssociationStore>,OriginalDeviceOnlyCreator&);
 // Normal async path: prepare -> PUBLIC pair -> original account/device
 // approval+registry flow -> complete. No private output or network dispatcher.
 DeviceProvisioningPublicOutcome prepare();DevicePairPublicView readPublicPair();
 DeviceProvisioningPublicOutcome complete();
 // Cold original-result query only. Never reads private data, signs, publishes
 // or invokes the creator; UNKNOWN is not a registered-device association.
 DevicePendingPublicOutcome queryOriginalPendingPublic();
 // Same-process convenience; does not perform the external registration flow.
 DeviceProvisioningPublicOutcome provision();
 void retire()noexcept;bool close()noexcept;~OriginalDeviceProvisioning(){close();}
 const DeviceProvisioningPublicOutcome&originalOutcomeDATA()const{return outcome_;}
};
// Actual Keychain implementation; no provisioning or OS call from a reader.
std::shared_ptr<OriginalDeviceAssociationStore>openOriginalDeviceAssociationKeychainStore();
}
