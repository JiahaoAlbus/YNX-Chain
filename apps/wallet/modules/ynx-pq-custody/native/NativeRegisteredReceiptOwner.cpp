#include "NativeRegisteredReceiptOwner.h"
#include "NativeAccountPicker.h"
#include <limits>
#include <map>
namespace ynx::mobilepq::registered {
namespace auth=ynx::auth::mobile::receipt;
namespace {
// Resource-retention inventory only, never account discovery or authority.
std::mutex inventoryMutex;
std::map<NativeRegisteredReceiptOwner*,std::shared_ptr<NativeRegisteredReceiptOwner>>inventory;
bool shape(const ReceiptDATA&d){return d.version==1&&!d.platform.empty()&&!d.chainId.empty()&&!d.networkId.empty()&&!d.canonicalOwner.empty()&&d.account==d.canonicalOwner&&!d.sourceId.empty()&&!d.instanceId.empty()&&!d.registrationDigest.empty()&&!d.keyVersion.empty()&&d.fullAppHash.size()==32&&d.pkA.size()==2592&&d.pkB.size()==64&&d.height<std::numeric_limits<uint64_t>::max()&&d.originHeight==d.height+1&&d.currentEngineHeight>=d.originHeight;}
bool same(const ReceiptDATA&a,const ReceiptDATA&b){return a.version==b.version&&a.platform==b.platform&&a.chainId==b.chainId&&a.networkId==b.networkId&&a.canonicalOwner==b.canonicalOwner&&a.account==b.account&&a.sourceId==b.sourceId&&a.instanceId==b.instanceId&&a.registrationDigest==b.registrationDigest&&a.keyVersion==b.keyVersion&&a.height==b.height&&a.originHeight==b.originHeight&&a.activeRevision==b.activeRevision&&a.ledgerNonce==b.ledgerNonce&&a.fullAppHash==b.fullAppHash&&a.pkA==b.pkA&&a.pkB==b.pkB;}
}
auto NativeRegisteredReceiptOwner::child()->std::shared_ptr<auth::RegisteredAccountReceipt>{std::lock_guard<std::mutex>lock(childMutex_);return receipt_;}
Failure NativeRegisteredReceiptOwner::fail(Failure f)noexcept{if(f.present&&!first_.present)first_=f;requestRetire();return f;}
void NativeRegisteredReceiptOwner::keepCleanup(Failure f)noexcept{if(f.present&&!cleanup_.present)cleanup_=f;}
Failure NativeRegisteredReceiptOwner::acquire(std::shared_ptr<NativeRegisteredReceiptOwner>&out)noexcept{
 if(out)return {true,invalid};
 try{
  auto owner=std::shared_ptr<NativeRegisteredReceiptOwner>(new NativeRegisteredReceiptOwner);
  {std::lock_guard<std::mutex>lock(inventoryMutex);if(inventory.size()>=64)return {true,capacity};inventory.emplace(owner.get(),owner);out=owner;}
  auto acquired=auth::acquireOriginalRegisteredAccountReceipt();
  {std::lock_guard<std::mutex>lock(owner->childMutex_);owner->receipt_=std::move(acquired.owner);} // adopt BEFORE presence/code
  if(acquired.failure.present)return owner->fail(acquired.failure);
  auto receipt=owner->child();if(!receipt)return owner->fail({true,notSupplied});
  if(owner->retired_.load())return owner->fail({true,retired});
  auto failure=auth::originalReceiptCurrent(receipt);if(failure.present)return owner->fail(failure);
  ReceiptDATA data;failure=auth::readOriginalReceipt(receipt,data);if(failure.present)return owner->fail(failure);
  if(!shape(data))return owner->fail({true,invalid});
  failure=auth::originalReceiptCurrent(receipt);if(failure.present)return owner->fail(failure);
  if(owner->retired_.load())return owner->fail({true,retired});
  owner->original_=std::move(data);owner->ready_=true;return {};
 }catch(...){return out?out->fail({true,notSupplied}):Failure{true,notSupplied};}
}
Failure NativeRegisteredReceiptOwner::current()noexcept{
 if(actor_!=std::this_thread::get_id())return {true,wrongThread};
 if(!ready_||retired_.load()||closed_||released_)return {true,retired};
 try{auto receipt=child();if(!receipt)return fail({true,notSupplied});
  auto failure=auth::originalReceiptCurrent(receipt);if(failure.present)return fail(failure);
  ReceiptDATA now;failure=auth::readOriginalReceipt(receipt,now);if(failure.present)return fail(failure);
  if(!shape(now)||!same(original_,now)||now.currentEngineHeight<original_.currentEngineHeight)return fail({true,changed});
  failure=auth::originalReceiptCurrent(receipt);if(failure.present)return fail(failure);
  if(retired_.load())return fail({true,retired});
  original_.currentEngineHeight=now.currentEngineHeight;return {};
 }catch(...){return fail({true,notSupplied});}
}
Failure NativeRegisteredReceiptOwner::selectOriginalAccount(uint32_t timeout)noexcept{
 auto status=current();if(status.present)return status;if(selected_||ticket_.load())return {true,invalid};
 try{uint64_t selectedTicket=0;auto rc=picker::openRegisteredAccountForCurrentRuntime({{original_.account,original_.networkId}},timeout,&selectedTicket);
  ticket_.store(selectedTicket); // adopt any partial BEFORE rc or cancellation
  if(retired_.load()&&selectedTicket)picker::requestCancel(selectedTicket);
  if(rc)return fail({true,rc});
  uint32_t row=std::numeric_limits<uint32_t>::max();rc=picker::wait(selectedTicket,&row);if(rc)return fail({true,rc});
  if(row!=0)return fail({true,invalid});status=current();if(status.present)return status;
  selected_=true;return {};
 }catch(...){return fail({true,notSupplied});}
}
Failure NativeRegisteredReceiptOwner::readForNativeInventory(ReceiptDATA&out)noexcept{
 if(actor_!=std::this_thread::get_id())return {true,wrongThread};
 if(!selected_)return {true,notSupplied};
 auto status=current();if(status.present)return status;
 try{auto copy=original_;status=current();if(status.present)return status;out=std::move(copy);return {};}catch(...){return fail({true,notSupplied});}
}
void NativeRegisteredReceiptOwner::requestRetire()noexcept{
 retired_.store(true);const auto ticket=ticket_.load();if(ticket)picker::requestCancel(ticket);
 try{auto receipt=child();if(receipt)auth::retireOriginalReceipt(receipt);}catch(...){/* original inventory keeps the child */}
}
Failure NativeRegisteredReceiptOwner::close()noexcept{
 if(actor_!=std::this_thread::get_id())return {true,wrongThread};if(closed_)return cleanup_;
 requestRetire();
 try{const auto ticket=ticket_.load();if(ticket){auto rc=picker::close(ticket);if(rc){if(rc!=picker::pending)keepCleanup({true,rc});return {true,rc};}rc=picker::releaseClosed(ticket);if(rc){if(rc!=picker::pending)keepCleanup({true,rc});return {true,rc};}ticket_.store(0);}
  auto receipt=child();if(receipt){keepCleanup(auth::joinOriginalReceipt(receipt));keepCleanup(auth::closeOriginalReceipt(receipt));if(!auth::originalReceiptClosed(receipt))return {true,cleanupPending};}
  {std::lock_guard<std::mutex>lock(childMutex_);receipt_.reset();}closed_=true;return cleanup_;
 }catch(...){keepCleanup({true,notSupplied});return cleanup_;}
}
Failure NativeRegisteredReceiptOwner::releaseClosed()noexcept{
 if(actor_!=std::this_thread::get_id())return {true,wrongThread};if(!closed_)return {true,cleanupPending};if(released_)return {};
 try{std::shared_ptr<NativeRegisteredReceiptOwner>keep;{std::lock_guard<std::mutex>lock(inventoryMutex);auto found=inventory.find(this);if(found==inventory.end())return {true,invalid};keep=found->second;inventory.erase(found);released_=true;}return {};}catch(...){return {true,notSupplied};}
}
}
