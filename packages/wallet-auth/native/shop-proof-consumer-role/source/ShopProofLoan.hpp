#pragma once
#include "ShopMainProofPrivate.h"
#include "ShopProofCarrierPrivate.h"
#include <thread>
#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
namespace ynx::auth::shop {
// Only Client's genuine original Main session/Source path invokes capture.
// Private metadata wrapper, never a JS constructor/fromHeader/parser/signer.
class ProofLoan final {
 ynx_wallet_shop_invoice_introspection_proof_v1*raw_=nullptr;
 ynx_wallet_shop_session_v1*session_=nullptr;ynx_auth_shop_original_client_v1*source_=nullptr;
 std::vector<uint8_t>header_;std::int64_t issued_=0,expires_=0,wall_=0,mono_=0;
 std::atomic<bool>retired_{false};mutable std::mutex mutex_;ynx_auth_shop_status_v1 first_{};
 void*token_=nullptr;unsigned borrowed_=0;std::thread::id borrower_;
 bool ready_=false,retire_selected_=false,join_unknown_=false,close_selected_=false,close_done_=false,release_selected_=false,released_=false;
 ynx_auth_shop_status_v1 close_result_{},release_result_{};
 ynx_auth_shop_status_v1 remember(ynx_auth_shop_status_v1)noexcept;
 bool window()const noexcept;
public:
 static std::shared_ptr<ProofLoan>capture(void*,ynx_wallet_shop_session_v1*,ynx_auth_shop_original_client_v1*,const std::string&,ynx_auth_shop_status_v1&)noexcept;
 ynx_auth_shop_status_v1 actor(void*)noexcept;
 ynx_auth_shop_status_v1 local()noexcept;
 ynx_original_product_session_proof_v2_header_data_v1 original()const noexcept{return{header_.data(),header_.size()};}
 ynx_auth_shop_status_v1 retire()noexcept;
 ynx_auth_shop_status_v1 close()noexcept;
 ynx_auth_shop_proof_borrow_v1*beginBorrow(ynx_auth_shop_original_client_v1*,ynx_auth_shop_status_v1&)noexcept;
 void endBorrow()noexcept;
 ynx_auth_shop_status_v1 borrowedCurrent(ynx_auth_shop_original_client_v1*)noexcept;
 ynx_auth_shop_status_v1 borrowedCopy(ynx_auth_shop_original_client_v1*,uint8_t*,size_t,ynx_wallet_shop_invoice_introspection_proof_data_v1*)noexcept;
 bool done()const noexcept{return released_;}
 bool cleanupSelected()const noexcept{return join_unknown_||((close_selected_||release_selected_)&&!released_);}
};
}
