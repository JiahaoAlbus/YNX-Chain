#pragma once
#include <atomic>
namespace ynx::wallet::pay {
// Code/namespace retirement only; never Root/account/operation authorization.
// The actual Root-bound startup owns the sole lowering publisher. Operational
// Main epochs may retain it so namespace shutdown also reaches pure C fences.
class NativeStartupEpoch final {
public:void retire()noexcept{retired_.store(true,std::memory_order_release);}
 bool current()const noexcept{return !retired_.load(std::memory_order_acquire);}
private:std::atomic<bool>retired_{false};
};
}
