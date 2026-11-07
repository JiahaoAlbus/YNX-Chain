#pragma once
#include "AIMobileProducer.h"
#include <map>
#include <thread>
namespace ynx::mobileai::producer {
struct NativeTransportState;
struct Context {std::thread::id actor=std::this_thread::get_id();YNXAuthAIMobileOwnerV6*source=nullptr;uint64_t runtime=0;std::shared_ptr<std::atomic<bool>>life;std::atomic<bool>cancelled{false},closed{false},released{false};size_t children=0;uint64_t wall0=0,mono0=0,lastWall=0,expiresAtMs=0;bool ready=false;};
struct Intent {std::string operation,action,method,path,task,revision,generation,step,run,creation;Bytes body;};
struct Producer {
 std::thread::id actor=std::this_thread::get_id();uint32_t kind=0;YNXAuthAIMobileOwnerV6*source=nullptr;
 std::shared_ptr<Context>context;YNXAIMobileSDKContext*contextToken=nullptr;YNXAIMobileProducerV6*token=nullptr;
 Intent intent;std::string originURL,network;
 Bytes unsignedOriginal,messageOriginal,finalHead;uint64_t issuedAtMs=0,expiresAtMs=0;YNXAuthAIMobileOwnerV6*review=nullptr,*operation=nullptr;
 Failure first{},cleanup{};std::atomic<bool>cancelled{false},released{false};bool preparedSelected=false,proved=false,dispatchEntered=false,closeSelected=false,closed=false;size_t children=0;
 // Actual transport child/captured response is implemented in its separate TU.
 std::shared_ptr<NativeTransportState>transportChild;bool transportPhysicallyClosed=true;
};
std::shared_ptr<Context>context(YNXAIMobileSDKContext*);
std::shared_ptr<Producer>get(YNXAIMobileProducerV6*);
std::shared_ptr<Producer>peer(YNXAIMobileSDKPeer*);
bool current(const std::shared_ptr<Context>&)noexcept;
bool current(const std::shared_ptr<Producer>&)noexcept;
void remember(Failure&,Failure)noexcept;
bool closeTransport(const std::shared_ptr<Producer>&)noexcept; // real strong transport TU
void cancelTransport(const std::shared_ptr<Producer>&)noexcept;
void releaseClosedTransportData(const std::shared_ptr<Producer>&)noexcept;
Failure joinTransport(const std::shared_ptr<Producer>&)noexcept;
}
