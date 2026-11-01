#pragma once
#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
namespace ynx_auth_private {
// The ONLY production definition of this friend is inside the genuine
// SourceAuthority translation unit, downstream of its original verifier.
// No public constructor, approved DTO, callback or setter can mint a permit.
class OriginalPaySourceMathCompletion;
class PayObservedState final {
 std::atomic<uint64_t> epoch_{0},issuer_{0},current_{0},loans_{0};
 std::atomic<bool> retired_{false};
 PayObservedState()=default;
 friend class OriginalPaySourceMathCompletion;
 friend class PayObservedPermission;
};
class PayObservedPermission final {
public:
 ~PayObservedPermission(){state_->loans_.fetch_sub(1,std::memory_order_acq_rel);}
 PayObservedPermission(const PayObservedPermission&)=delete;
 int32_t current_native() noexcept {
  int32_t first=first_.load(std::memory_order_acquire);if(first)return first;
  auto e=state_->epoch_.load(std::memory_order_acquire);
  if(state_->retired_.load(std::memory_order_acquire)||e!=epoch_||
     state_->issuer_.load(std::memory_order_acquire)!=issuer_||
     state_->current_.load(std::memory_order_acquire)!=current_||
     std::chrono::steady_clock::now()>=deadline_||
     state_->epoch_.load(std::memory_order_acquire)!=e){
   int32_t expected=0;first_.compare_exchange_strong(expected,1,std::memory_order_acq_rel);return first_.load(std::memory_order_acquire);
  }return 0;
 }
private:
 PayObservedPermission(std::shared_ptr<PayObservedState>s,std::shared_ptr<void>parent,uint64_t e,uint64_t issuer,uint64_t current,std::chrono::steady_clock::time_point until):state_(std::move(s)),parent_(std::move(parent)),epoch_(e),issuer_(issuer),current_(current),deadline_(until){state_->loans_.fetch_add(1,std::memory_order_acq_rel);}
 std::shared_ptr<PayObservedState> state_;
 std::shared_ptr<void> parent_; // genuine original Source owner, retained to drop
 const uint64_t epoch_,issuer_,current_;
 const std::chrono::steady_clock::time_point deadline_; // never refreshed
 std::atomic<int32_t>first_{0};
 friend class OriginalPaySourceMathCompletion;
};
}
