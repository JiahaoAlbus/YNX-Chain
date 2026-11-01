#pragma once
#include "pay_native_source_lease_private.h"
#include <atomic>
#include <algorithm>
#include <chrono>
#include <memory>
#include "pay_native_kernel.hpp"
#include "pay_native_startup_epoch_private.hpp"
struct ynx_link_private_client_registration_borrow_v1;

namespace ynx::wallet::pay {
// INTERNAL interface to the actual Root-qualified native source owner. The
// normal Root capture/verifier is NOT yet supplied: no class name or metadata
// can mint it. Native factory must reject that specific CODE dependency until
// an actual same-scope verified native owner is present.
class OriginalRootSource {
public:virtual ~OriginalRootSource()=default;virtual int32_t current_native()noexcept=0;
 virtual bool matches_original_binding(const Binding&,bool query_only)noexcept=0;
protected:OriginalRootSource()=default;
};
// Native retirement object owned by the actual Main->Native child bridge.
// Copying Main's JS boolean is prohibited. Publisher must bind retirement to
// the original Main guard/window/account/permission and retain through Join.
class MainNativeEpoch final {
public:
 MainNativeEpoch():until_(ticks(std::chrono::steady_clock::now()+std::chrono::seconds(30))){}
 void retire()noexcept{retired_.store(true,std::memory_order_release);}
 bool bind_namespace_parent(const std::shared_ptr<NativeStartupEpoch>&parent)noexcept{if(!parent)return false;std::shared_ptr<NativeStartupEpoch>empty;if(std::atomic_compare_exchange_strong(&namespace_parent_,&empty,parent))return current();return empty==parent&&current();}
 // INTERNAL genuine-Main producer only. This can ONLY shorten; it cannot
 // activate, refresh, or revive the Source. Actual approval expiry must be
 // independently obtained from the same protected Main capsule/permission.
 void shorten_until(std::chrono::steady_clock::time_point deadline)noexcept{
  const auto bound=ticks(deadline);auto old=until_.load(std::memory_order_acquire);
  while(bound<old&&!until_.compare_exchange_weak(old,bound,std::memory_order_acq_rel,std::memory_order_acquire)){}
 }
 bool shorten_original_unix_ms(int64_t deadline)noexcept{
  const auto mono=std::chrono::steady_clock::now();
  const auto wall=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
  if(deadline<=wall||deadline<=0){retire();return false;}
  auto previous=wall_until_.load(std::memory_order_acquire);while(deadline<previous&&!wall_until_.compare_exchange_weak(previous,deadline,std::memory_order_acq_rel,std::memory_order_acquire)){}
  // Max thirty seconds is an upper bound, never authority or a refresh.
  const auto remaining=std::min<int64_t>(deadline-wall,30000);shorten_until(mono+std::chrono::milliseconds(remaining));return current();
 }
 bool current()const noexcept{auto parent=std::atomic_load(&namespace_parent_);return (!parent||parent->current())&&!retired_.load(std::memory_order_acquire)&&ticks(std::chrono::steady_clock::now())<until_.load(std::memory_order_acquire)&&std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count()<wall_until_.load(std::memory_order_acquire);}
private:
 static int64_t ticks(std::chrono::steady_clock::time_point t)noexcept{return std::chrono::duration_cast<std::chrono::nanoseconds>(t.time_since_epoch()).count();}
 std::atomic<bool>retired_{false};std::atomic<int64_t>until_;std::atomic<int64_t>wall_until_{INT64_MAX};
 std::shared_ptr<NativeStartupEpoch>namespace_parent_;
};
// PRIVATE Auth owner call, no JS/C/Go public constructor or setter. Passing a
// Root holder interface is not itself proof: only the actual normal native
// Root producer may call this after its real verification/custody succeeds.
int32_t borrow_original_pay_source_lease(std::shared_ptr<OriginalRootSource>,std::shared_ptr<MainNativeEpoch>,ynx_wallet_pay_source_lease_v1**out);
// Actual normal Native owner only. A nonnull out adopts this ONE original
// Go-owner registration borrow, even on a later current failure. Null out
// leaves custody with the caller. Never cast the borrow to a registration.
// Release occurs only when the last real Source/channel child drains.
int32_t borrow_original_pay_source_lease(std::shared_ptr<OriginalRootSource>,std::shared_ptr<MainNativeEpoch>,ynx_link_private_client_registration_borrow_v1*,const Binding&,bool query_only,ynx_wallet_pay_source_lease_v1**out);
}
