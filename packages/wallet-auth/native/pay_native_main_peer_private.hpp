#pragma once
#include "pay_native_producer_private.hpp"
#include <thread>

namespace ynx::wallet::pay {
// Main's genuine same-instance peer is a protected caller loan, NOT Root or
// channel authority. This constructor is private Native composition only: its
// namespace must come from the admitted fixed-image loader, never JS arguments.
class MainPeerLoan final {
public:
 static void capture(napi_env,napi_value admitted_main_namespace,
   napi_value same_request,napi_value same_original,napi_value same_target,
   const std::shared_ptr<MainNativeEpoch>&,
   std::unique_ptr<MainPeerLoan>*out);
 ~MainPeerLoan();
 MainPeerLoan(const MainPeerLoan&)=delete;
 bool partial()const noexcept{return first_!=nullptr;}
 napi_value original_failure(); // Boxed reference preserves false/null/undefined.
 napi_value peer();
 const std::vector<uint8_t>&member()const noexcept{return member_;}
 const std::vector<uint8_t>&envelope()const noexcept{return envelope_;}
 void assert_actor_current(); // Actual Main synchronous current, actor only.
 void claim_original_child(); // Once, never reconsumes mother permission.
 void associate_original_native_owner(napi_value same_inventory_owner);
 napi_value recheck_actor();
 napi_value join_actor();
 napi_value close_actor();
 void retire_native()noexcept; // Never invokes JS; safe at write fence.
 void retire_actor();
 // Called only after the original close Promise actually fulfilled. A rejected
 // or unresolved Promise leaves every original peer/reference retained.
 void acknowledge_closed_actor();
private:
 MainPeerLoan(napi_env,const std::shared_ptr<MainNativeEpoch>&);
 void actor()const;
 napi_value call(const char*);
 void remember_pending();
 napi_env env_;std::thread::id actor_;std::shared_ptr<MainNativeEpoch>epoch_;
 napi_ref namespace_=nullptr,peer_=nullptr,first_=nullptr,snapshot_=nullptr;
 bool claimed_=false,closed_=false;std::vector<uint8_t>member_,envelope_;
};
}
