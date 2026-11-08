#pragma once
#include "ShopMainSessionPrivate.h"
#include "ShopOwnedExchangePrivate.h"
#include <atomic>
#include <array>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
namespace ynx::auth::shop {
using Status=ynx_auth_shop_status_v1;
bool ok(Status) noexcept;
Status denied() noexcept;
class Response;
class ProofLoan;
struct Custody {bool selected=false,unknown=false,physicalDone=false;};
class Client final:public std::enable_shared_from_this<Client> {
 const std::thread::id actor_=std::this_thread::get_id();
 void*const env_;
 ynx_auth_shop_original_client_v1*source_=nullptr;
 ynx_wallet_shop_session_v1*session_=nullptr;
 std::atomic<bool> retired_{false};
 mutable std::mutex mutex_;
 std::size_t pending_=0,responses_=0;
 std::array<std::string,8>pendingOrders_;
 std::array<std::shared_ptr<ProofLoan>,8>pendingProofs_;
 std::array<std::shared_ptr<ProofLoan>,16>proofs_;
 Status first_{};
 bool retireSelected_=false;
 Status retireResult_{};
 bool sessionCloseSelected_=false,sessionDone_=false,sessionReleased_=false;
 bool sourceCloseSelected_=false,sourceDone_=false,sourceReleased_=false;
 bool sessionReleaseSelected_=false,sourceReleaseSelected_=false;
 Status sessionRelease_{},sourceRelease_{};
 Status sessionClose_{},sourceClose_{};
 explicit Client(void*e):env_(e){}
 Status remember(Status) noexcept;
 Status local() noexcept;
 Status drainProofs() noexcept;
 friend class Response;
public:
 static std::shared_ptr<Client> acquire(void*actualEnv,Status&) noexcept;
 bool sameActor(void*actualEnv)const noexcept;
 Status current(void*actualEnv) noexcept;
 Status scope(void*actualEnv,std::vector<unsigned char>&) noexcept;
 Status begin(void*actualEnv,const std::string&originalOrder) noexcept;
 // Exactly one begin debt, selected on the actor before scheduling work.
 // A canceled pre-dispatch operation calls abandon(), never read().
 void abandon(const std::string&originalOrder) noexcept;
 std::shared_ptr<Response> read(const std::string&,Status&) noexcept;
 Status retire(void*actualEnv) noexcept;
 Status join(void*actualEnv) noexcept;
 Status close(void*actualEnv) noexcept;
 bool physicallyDone()const noexcept{return sourceReleased_&&sessionReleased_;}
 bool cleanupSelected()const noexcept;
 Custody custody()const noexcept;
 ~Client(); // Never initiates close/retry. Public buffers only; C inventories retain unknown owners.
};
struct Transport {unsigned status=0;std::vector<unsigned char>method,path,contentType,body;};
class Response final {
 std::shared_ptr<Client>parent_;
 ynx_auth_shop_original_response_v1*raw_=nullptr;
 std::shared_ptr<ProofLoan>proof_;
 Status first_{},release_{};
 bool releaseSelected_=false,transportReleased_=false,released_=false;
 explicit Response(std::shared_ptr<Client>p):parent_(std::move(p)){}
 friend class Client;
public:
 Status copy(void*actualEnv,Transport&) noexcept;
 Status release(void*actualEnv) noexcept;
 bool cleanupSelected()const noexcept;
 Custody custody()const noexcept;
 ~Response(); // No hidden selected-UNKNOWN release retry.
};
}
