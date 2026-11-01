#pragma once
#include "CustodySession.h"
#include "PublicStatus.h"
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
namespace ynx::mobilepq {
/* One actual OS thread for Swift's pthread-bound owner, on BOTH platforms.
 * The worker inventory retains failed/GC'd operations until explicit release.
 * join is a queue fence, never proof of cleanup or a permission token. */
class SerialCustodyWorker final {
 public:
  using Job=std::function<void()>;
  SerialCustodyWorker();
  ~SerialCustodyWorker();
  void enqueue(Job job);
  std::shared_ptr<CustodySession> prepare(const std::string&,uint32_t);
  bool closeAll(); // on worker; false retains debt and prevents shutdown
  bool shutdown(); // outside worker, synchronous drain; never called from JSI
  void requestRetire(); // any Native thread; revoke-only, no Source/OS/close
  // Last completed job only. Never queues behind blocked Native UI/Source.
  PublicInventory readPublicInventory() const;
 private:
  void publishPublicInventory(); // worker-only, copies existing metadata
  std::mutex mutex_,shutdownMutex_;std::condition_variable cv_;std::deque<Job> jobs_;
  bool stopping_=false;std::thread worker_;
  std::shared_ptr<std::atomic<bool>> runtimeLive_=std::make_shared<std::atomic<bool>>(true);
  std::vector<std::shared_ptr<CustodySession>> owners_;
  std::mutex ownersMutex_;
  mutable std::mutex publicMutex_;PublicInventory publicInventory_;
  std::atomic<bool> workerBusy_{false};
};
}
