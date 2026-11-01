#pragma once
#include "pay_native_kernel.hpp"
#include "pay_native_source_lease_private.hpp"
#include <node_api.h>

namespace ynx::wallet::pay {
// Only genuine Native loans with an actor-side Main child implement this
// extension. The normal stage awaits the ORIGINAL Promise and retains its
// original Native self through settle. None of these run on a worker/fence.
class ActorProtectedLoan:public ProtectedLoan {
public:
 virtual napi_value recheck_on_actor(napi_env)=0;
 virtual napi_value joined_on_actor(napi_env)=0;
 virtual napi_value closed_on_actor(napi_env)=0;
 virtual void confirm_recheck_on_actor(napi_env){}
 void confirm_actor_settled_native(bool closed)noexcept{(closed?actor_closed_:actor_joined_).store(true,std::memory_order_release);}
 virtual void confirm_actor_settled_on_actor(napi_env,bool closed){confirm_actor_settled_native(closed);}
 bool cleanup_debt_retained()const noexcept override{return !actor_joined_.load(std::memory_order_acquire)||!actor_closed_.load(std::memory_order_acquire);}
private:std::atomic<bool>actor_joined_{false},actor_closed_{false};
};
}

// NEW owning-code integration point, NOT an assertion that Main currently
// exports it. P01 must bridge its SAME actual ALS/UI approval/capsule/borrow
// into a native protected child; query must be independent read-only custody.
// Root/Source/LINK registration is additionally mandatory. No keys reopen/sign.
// Native output is adopted even when this function throws or leaves a pending
// JS exception (including false/null/undefined). No JS installer/provider exists.
// selector is DATA only: implementation must obtain and compare actual original
// registered account, signed complete Member+ABCI bytes and exact Pay target.
extern "C" void ynx_wallet_capture_original_pay_loan_v1(
 napi_env,napi_value request,napi_value original,napi_value target,
 napi_value same_native_owner,
 const std::shared_ptr<ynx::wallet::pay::MainNativeEpoch>*same_native_epoch,
 const ynx::wallet::pay::Binding* selector,bool query_only,
 std::unique_ptr<ynx::wallet::pay::ProtectedLoan>* out);

// ProtectedLoan::current/read_original/read_* must be native immutable/atomic,
// thread-safe and may not invoke JS. recheck runs on the Node actor. exchange,
// join,close run on native async workers; retire signals cancellation without
// waiting on exchange. No Root/approval/public transport tuple comes from JSON.
