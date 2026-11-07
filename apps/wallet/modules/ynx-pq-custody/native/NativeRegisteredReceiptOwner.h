#pragma once
#include "MobileRegisteredReceiptPrivate.hpp"
#include <atomic>
#include <mutex>
#include <thread>
namespace ynx::mobilepq::registered {
using Failure=ynx::core::mobile::registered::Failure;
using ReadResult=ynx::core::mobile::registered::ReadResult;
using ReceiptDATA=ynx::auth::mobile::receipt::ReceiptDATA;
enum Code:int32_t {invalid=9701,notSupplied=9702,wrongThread=9703,retired=9704,changed=9705,cleanupPending=9706,capacity=9707};
/* Native resource owner, NOT an account/permission registry or selected7.
 * Its only acquisition calls Auth's NEW zero-input genuine receipt producer.
 * No supplied receipt/DTO/engine/path, old Source loan or public constructor.
 * No reference/op/review or slot/journal/Source metadata is synthesized here.
 * Registry retains every partial until actual close + explicit release, even
 * if the caller drops its shared_ptr. Raw failure presence/code0 is preserved.
 */
class NativeRegisteredReceiptOwner final {
 const std::thread::id actor_=std::this_thread::get_id();
 std::atomic<bool>retired_{false};std::atomic<uint64_t>ticket_{0};
 std::mutex childMutex_;
 std::shared_ptr<ynx::auth::mobile::receipt::RegisteredAccountReceipt>receipt_;
 ReceiptDATA original_;
 bool ready_=false,choiceObserved_=false,selected_=false,closed_=false,released_=false;
 Failure first_,cleanup_;
 Failure pendingCause_;
 NativeRegisteredReceiptOwner()=default;
 Failure fail(Failure)noexcept;
 void keepCleanup(Failure)noexcept;
 std::shared_ptr<ynx::auth::mobile::receipt::RegisteredAccountReceipt>child();
public:
 ~NativeRegisteredReceiptOwner()=default; // registry owns unclosed debt
 NativeRegisteredReceiptOwner(const NativeRegisteredReceiptOwner&)=delete;
 NativeRegisteredReceiptOwner&operator=(const NativeRegisteredReceiptOwner&)=delete;
 static ReadResult acquire(std::shared_ptr<NativeRegisteredReceiptOwner>&outPartial)noexcept;
 ReadResult resumeOriginalReceipt()noexcept; // explicit SAME child later read only
 ReadResult current()noexcept;
 ReadResult selectOriginalAccount(uint32_t timeoutMS)noexcept; // UI DATA only
 ReadResult readForNativeInventory(ReceiptDATA&ownedPublicCopy)noexcept;
 void requestRetire()noexcept; // any thread, same proof/picker only
 Failure close()noexcept;
 bool isClosed()const noexcept{return actor_==std::this_thread::get_id()&&closed_;}
 Failure releaseClosed()noexcept;
 Failure firstFailure()const noexcept{return actor_==std::this_thread::get_id()?first_:Failure{true,wrongThread};}
 Failure cleanupFailure()const noexcept{return actor_==std::this_thread::get_id()?cleanup_:Failure{true,wrongThread};}
 Failure pendingCause()const noexcept{return actor_==std::this_thread::get_id()?pendingCause_:Failure{true,wrongThread};}
};
}
