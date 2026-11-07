#pragma once
#include <MobileAITaskClientC.h>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>
#include <string>
#include <vector>
namespace ynx::mobileai {
using Failure=YNXAIMobileFailureV6;
using Bytes=std::vector<uint8_t>;
enum Code:int32_t {invalid=10801,closed=10802,wrongThread=10803,capacity=10804,notSupplied=10805,retained=10806,actorBusy=10807};
struct OwnerState {uint32_t kind=0;bool closed=false,released=false;Failure originalFailure{},closeFailure{};};
class AIMobileWorker;
class NativeOwner final {
 friend class AIMobileWorker;
 const AIMobileWorker*worker_=nullptr;
 const uint64_t runtime_=0;
 std::atomic<YNXAuthAIMobileOwnerV6*>token_{nullptr};
 uint32_t kind_=0;
 std::shared_ptr<NativeOwner>source_;
 YNXAIMobileSDKPeer*peer_=nullptr;YNXAIMobileSDKContext*context_=nullptr;
 Failure original_{},close_{};bool closeSelected_=false,released_=false,proveEntered_=false;
 mutable std::mutex publicMutex_;OwnerState public_;
 NativeOwner(const AIMobileWorker*w,uint64_t runtime,uint32_t kind):worker_(w),runtime_(runtime),kind_(kind),public_{kind,false,false,{},{}}{}
public:
 NativeOwner(const NativeOwner&)=delete;
 NativeOwner&operator=(const NativeOwner&)=delete;
};
struct OwnedResult {std::shared_ptr<NativeOwner>owner;Failure failure{};};
struct CopyResult {Bytes bytes;Failure failure{};OwnerState state;};
/* Actual Auth C17 actor only. Native pointers/tokens never enter JS. The
 * inventory retains every partial before presence/code inspection and holds
 * it through actual close/release, regardless of JS GC/delivery failure. */
class AIMobileWorker final {
 const uint64_t runtime_;
 std::shared_ptr<std::atomic<bool>>live_=std::make_shared<std::atomic<bool>>(true);
 mutable std::mutex jobsMutex_;std::mutex ownersMutex_,shutdownMutex_;std::condition_variable changed_;
 struct Job {std::function<void()>body,finished;};
 std::deque<Job>jobs_;bool stopping_=false,active_=false;
 std::vector<std::shared_ptr<NativeOwner>>owners_;
 std::thread worker_; // starts only after every queue/mutex is constructed
 bool actor()const noexcept;
 bool known(const std::shared_ptr<NativeOwner>&)const noexcept;
 OwnedResult enter(uint32_t,const std::shared_ptr<NativeOwner>&,
  YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*,const std::function<YNXAuthAIMobileOwnedV6()>&);
 Failure inspect(const std::shared_ptr<NativeOwner>&,OwnerState&);
 Failure requireCurrent(const std::shared_ptr<NativeOwner>&);
 bool drainOne(const std::shared_ptr<NativeOwner>&);
 bool drainAll();
public:
 explicit AIMobileWorker(uint64_t nativeRuntimeBinding);
 ~AIMobileWorker();
 AIMobileWorker(const AIMobileWorker&)=delete;
 AIMobileWorker&operator=(const AIMobileWorker&)=delete;
 void enqueue(std::function<void()>,std::function<void()>finished={});
 bool enqueueIfIdle(std::function<void()>,std::function<void()>finished={}); // bounded DATA only
 bool busy()const;
 OwnedResult acquire();
 OwnedResult prepare(const std::shared_ptr<NativeOwner>&source,YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*);
 OwnedResult prove(const std::shared_ptr<NativeOwner>&source,YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*,const std::shared_ptr<NativeOwner>&sameReview);
 OwnedResult outcome(const std::shared_ptr<NativeOwner>&source,YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*);
 OwnedResult lookupOriginal(const std::shared_ptr<NativeOwner>&source,const std::string&originalOperation,YNXAIMobileSDKContext*);
 Failure current(const std::shared_ptr<NativeOwner>&source);
 Failure state(const std::shared_ptr<NativeOwner>&,OwnerState&);
 OwnerState cachedState(const std::shared_ptr<NativeOwner>&)const; // last completed actor observation
 Failure joinOwner(const std::shared_ptr<NativeOwner>&);
 bool closeOwner(const std::shared_ptr<NativeOwner>&);
 CopyResult copyOriginal(const std::shared_ptr<NativeOwner>&,uint32_t readKind);
 CopyResult copySourceOriginal(const std::shared_ptr<NativeOwner>&review,uint32_t index);
 Failure lookupPhase(const std::shared_ptr<NativeOwner>&,uint32_t&);
 /* Same intrinsic operation + source + peer/context only. Bytes stay Native
  * for the ORIGINAL private SDK transport, never a resubmission DTO. */
 CopyResult memberForOriginalTransport(const std::shared_ptr<NativeOwner>&source,const std::shared_ptr<NativeOwner>&operation,YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*);
 bool closeClient(const std::shared_ptr<NativeOwner>&source); // actor drain
 void requestCancel(const std::shared_ptr<NativeOwner>&)noexcept; // revoke only
 void requestRetire()noexcept;
 bool shutdown(); // false keeps owner/worker alive, never forced destruction
 bool live()const noexcept{return live_->load();}
 std::shared_ptr<std::atomic<bool>>originalRuntimeLife()const noexcept{return live_;} // C++ binding only
 YNXAuthAIMobileOwnerV6*sourceForOriginalProducer(const std::shared_ptr<NativeOwner>&); // actor custody only
 YNXAuthAIMobileOwnerV6*ownerForOriginalProducer(const std::shared_ptr<NativeOwner>&,uint32_t expectedKind); // actor only
 uint64_t nativeRuntimeBinding()const noexcept{return runtime_;} // C++ only
};
}
