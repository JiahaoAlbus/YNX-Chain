#pragma once
#include "original-product-device-v4-provisioning.h"
#include <map>
#include <thread>
#include <exception>
#include <optional>
namespace ynx_auth_private {
inline constexpr uint32_t OriginalDeviceQueryReaderIdentityABI=2;
// nullopt is JSON null, NEVER empty string or the four-byte string "null".
// Current sole SDK 51eb permits null only for bundleId/packageId. Stable8
// remains string-only; all Source/NAPI consumers must compile this exact ABI.
using DeviceQueryIdentityAtom=std::optional<std::string>;
using DeviceQueryIdentityBinding=std::map<std::string,DeviceQueryIdentityAtom>;
// DATA from independently current query-purpose Source, not old creation
// approval/window and not NAPI/request-provided approved=true material.
struct DeviceOriginalQueryIntent {
 std::string network,stableDeviceIdentity;
 DeviceQueryIdentityBinding identityBinding; // exact twelve typed fields
 uint64_t issuedAtMs=0,expiresAtMs=0;
};
struct DeviceOriginalQueryJournalSelection{std::string parent,leaf;};
class OriginalDeviceQueryAuthority {
public:virtual ~OriginalDeviceQueryAuthority()=default;
 virtual void assertCurrent()=0;
 virtual DeviceOriginalQueryIntent readOriginalQueryIntent()=0;
 virtual DeviceOriginalQueryJournalSelection readOriginalJournalSelection()=0;
 // Original independent query Root/current + actual Main selected peer.
 virtual void assertOriginalQueryBinding(const DeviceOriginalQueryIntent&)=0;
 virtual RegisteredDeviceAssociation readOriginalRegisteredDevice(const DevicePairPublicView&,const std::string&originalOperation)=0;
 virtual void assertRegisteredCurrent(const RegisteredDeviceAssociation&,const DevicePairPublicView&)=0;
};
struct DeviceOriginalQueryPublicOutcome {
 std::string operation,state="UNKNOWN";
 bool authority=false,hasPublicPair=false,unknownMarkerObserved=false,localTerminalObserved=false,registeredCurrentObserved=false;
 DevicePairPublicView publicPair{};DeviceCreationOutcome creator{};bool creatorOutcomeObserved=false;
};
class OriginalDeviceQueryReader final {
 std::shared_ptr<OriginalDeviceQueryAuthority>source_;
 std::shared_ptr<OriginalDeviceAssociationStore>store_;HostDirfdJournal journal_;
 DeviceOriginalQueryIntent intent_;DeviceOriginalQueryJournalSelection selection_;
 std::thread::id actor_;uid_t uid_;gid_t gid_;
 uint64_t wallFloor_=0,deadline_=0,anchorWall_=0,anchorMono_=0;
 bool openAttempted_=false,opened_=false,failed_=false,closeSelected_=false,closeResult_=false;
 std::exception_ptr firstException_; // original private cause, never serialized
 void actor();void window();void current();void fail();
public:
 // No IO in construction; parent retains this object BEFORE openRetained so
 // original partial dirfds/failed close cannot be discarded by a throw.
 OriginalDeviceQueryReader(std::shared_ptr<OriginalDeviceQueryAuthority>,std::shared_ptr<OriginalDeviceAssociationStore>);
 OriginalDeviceQueryReader(const OriginalDeviceQueryReader&)=delete;
 OriginalDeviceQueryReader&operator=(const OriginalDeviceQueryReader&)=delete;
 void openRetained();
 DeviceOriginalQueryPublicOutcome queryOriginalPublic();
 // Close only this read journal; Source/store are borrowed shared parents.
 // First close result is frozen; failed partial journal remains retained.
 bool close()noexcept;
 bool unresolved()const{return failed_||journal_.unresolved();}
 // No automatic retry/cleanup in destructor. Owning Native inventory must
 // explicitly close and retain this object whenever close returns false.
};
}
