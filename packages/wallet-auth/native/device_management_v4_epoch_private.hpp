#pragma once
#include <atomic>
#include <chrono>
#include <memory>
#include <stdexcept>
namespace ynx::device::management {
// Native-only sticky lifecycle gate; NOT a Root/approval constructor. The
// genuine Source/slot owner holds this gate, with independent full current
// checks outside private entry. No callbacks, JS, I/O or caller-set epoch.
class Epoch final {
 std::atomic<bool> retired_{false};
 std::atomic<unsigned> children_{0};
 const std::chrono::steady_clock::time_point deadline_;
public:
 explicit Epoch(std::chrono::steady_clock::time_point d):deadline_(d){}
 bool current() noexcept {if(retired_.load(std::memory_order_acquire))return false;if(std::chrono::steady_clock::now()>=deadline_){retire();return false;}return true;}
 void retire() noexcept {retired_.store(true,std::memory_order_release);}
 bool retain_child() noexcept {if(!current())return false;children_.fetch_add(1,std::memory_order_acq_rel);if(current())return true;release_child();return false;}
 void release_child() noexcept {children_.fetch_sub(1,std::memory_order_acq_rel);}
 unsigned children()const noexcept{return children_.load(std::memory_order_acquire);}
 bool close() noexcept {retire();return children()==0;}
};
class EpochLoan final {
 std::shared_ptr<Epoch> epoch_;bool selected_=false;
public:
 explicit EpochLoan(std::shared_ptr<Epoch> p):epoch_(std::move(p)){if(!epoch_||!epoch_->retain_child())throw std::runtime_error("DEVICE_MANAGEMENT_V4_SOURCE_RETIRED");}
 EpochLoan(const EpochLoan&)=delete;EpochLoan&operator=(const EpochLoan&)=delete;
 ~EpochLoan(){close();}
 bool current()noexcept{return !selected_&&epoch_&&epoch_->current();}
 void close()noexcept{if(selected_)return;selected_=true;if(epoch_)epoch_->release_child();}
};
}
