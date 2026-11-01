#pragma once
#include <cstdint>
namespace ynx::mobilepq {
enum class PublicRuntimeState : uint32_t {NotInstalled=0,Initializing=1,Ready=2,Retaining=3};
struct PublicInventory {
 uint32_t heldOperations=0,heldCoreUncertain=0,heldOSUncertain=0,heldOSRecorded=0,heldCleanupFaults=0;
 bool workerBusy=false;
};
struct PublicStatus {PublicRuntimeState runtime=PublicRuntimeState::NotInstalled;PublicInventory held;};
inline const char* publicRuntimeName(PublicRuntimeState value){
 switch(value){case PublicRuntimeState::NotInstalled:return "not-installed";case PublicRuntimeState::Initializing:return "initializing";
 case PublicRuntimeState::Ready:return "ready";case PublicRuntimeState::Retaining:return "retaining";}return "retaining";
}
// Passive metadata only. Does not install a runtime, enqueue work, acquire a
// Source, inspect a durable record, read OS credentials or grant permission.
PublicStatus readPublicStatus();
}
