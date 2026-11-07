#include "NativeRegisteredReceiptOwner.h"
#include "NativeAccountPicker.h"
#include "NativeReceiptDirectoryPolicy.h"
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
ReadResult NativeRegisteredReceiptOwner::acquire(std::shared_ptr<NativeRegisteredReceiptOwner>&out)noexcept{
 if(out)return {false,{true,invalid}};
 try{
  auto owner=std::shared_ptr<NativeRegisteredReceiptOwner>(new NativeRegisteredReceiptOwner);
  {std::lock_guard<std::mutex>lock(inventoryMutex);if(inventory.size()>=64)return {false,{true,capacity}};inventory.emplace(owner.get(),owner);out=owner;}
  auto acquired=auth::acquireOriginalRegisteredAccountReceipt();
  {std::lock_guard<std::mutex>lock(owner->childMutex_);owner->receipt_=std::move(acquired.owner);} // adopt BEFORE presence/code
  if(owner->retired_.load())owner->requestRetire();
  if(acquired.failure.present)return {false,owner->fail(acquired.failure)};
  auto receipt=owner->child();if(!receipt)return {false,owner->fail({true,notSupplied})};
  if(owner->retired_.load())return {false,owner->fail({true,retired})};
  if(!acquired.ready){owner->pendingCause_=acquired.pendingCause;return {false,{},true,acquired.pendingCause};}
  auto state=auth::originalReceiptCurrent(receipt);if(state.failure.present)return {false,owner->fail(state.failure)};if(state.ready&&state.notReady)return {false,owner->fail({true,invalid})};
  if(!state.ready){if(!state.notReady)return {false,owner->fail({true,invalid})};owner->pendingCause_=state.pendingCause;return state;}
  ReceiptDATA data;state=auth::readOriginalReceipt(receipt,data);if(state.failure.present)return {false,owner->fail(state.failure)};
  if(!state.ready){if(!state.notReady)return {false,owner->fail({true,invalid})};owner->pendingCause_=state.pendingCause;return state;}
  if(state.notReady||!shape(data))return {false,owner->fail({true,invalid})};
  state=auth::originalReceiptCurrent(receipt);if(state.failure.present)return {false,owner->fail(state.failure)};if(state.ready&&state.notReady)return {false,owner->fail({true,invalid})};
  if(!state.ready){if(!state.notReady)return {false,owner->fail({true,invalid})};owner->pendingCause_=state.pendingCause;return state;}
  if(owner->retired_.load())return {false,owner->fail({true,retired})};
  owner->original_=std::move(data);owner->ready_=true;return {true,{}};
 }catch(...){return {false,out?out->fail({true,notSupplied}):Failure{true,notSupplied}};}
}
ReadResult NativeRegisteredReceiptOwner::resumeOriginalReceipt()noexcept{
 if(actor_!=std::this_thread::get_id())return {false,{true,wrongThread}};
 if(retired_.load()||closed_||released_)return {false,{true,retired}};
 try{auto receipt=child();if(!receipt)return {false,fail({true,notSupplied})};
  ReceiptDATA now;auto state=auth::readOriginalReceipt(receipt,now);if(state.failure.present)return {false,fail(state.failure)};
  if(!state.ready){if(!state.notReady)return {false,fail({true,invalid})};pendingCause_=state.pendingCause;return state;}
  if(state.notReady||!shape(now)||(ready_&&(!same(original_,now)||now.currentEngineHeight<original_.currentEngineHeight)))return {false,fail({true,changed})};
  state=auth::originalReceiptCurrent(receipt);if(state.failure.present)return {false,fail(state.failure)};if(state.ready&&state.notReady)return {false,fail({true,invalid})};
  if(!state.ready){if(!state.notReady)return {false,fail({true,invalid})};pendingCause_=state.pendingCause;return state;}
  if(retired_.load())return {false,fail({true,retired})};
  if(choiceObserved_){uint32_t row=1;auto rc=picker::wait(ticket_.load(),&row);if(rc||row!=0)return {false,fail({true,rc?rc:invalid})};selected_=true;}
  original_=std::move(now);ready_=true;return {true,{}};
 }catch(...){return {false,fail({true,notSupplied})};}
}
Failure NativeRegisteredReceiptOwner::currentSourceFence()noexcept{
 if(actor_!=std::this_thread::get_id())return {true,wrongThread};
 if(retired_.load()||closed_||released_)return {true,retired};
 try{auto receipt=child();if(!receipt)return fail({true,notSupplied});
  auto f=auth::currentOriginalReceiptSourceFence(receipt);if(f.present)return fail(f);
  return retired_.load()?fail({true,retired}):Failure{};
 }catch(...){return fail({true,notSupplied});}
}
ReadResult NativeRegisteredReceiptOwner::current()noexcept{
 if(actor_!=std::this_thread::get_id())return {false,{true,wrongThread}};
 if(retired_.load()||closed_||released_)return {false,{true,retired}};
 if(!ready_){
  // originalReceiptCurrent may readCaptured while pending; fence only here.
  const auto fence=currentSourceFence();
  return fence.present?ReadResult{false,fence}:ReadResult{false,{},true,pendingCause_};
 }
 try{auto receipt=child();if(!receipt)return {false,fail({true,notSupplied})};
  auto state=auth::originalReceiptCurrent(receipt);if(state.failure.present)return {false,fail(state.failure)};if(state.ready&&state.notReady)return {false,fail({true,invalid})};
  if(!state.ready){if(!state.notReady)return {false,fail({true,invalid})};pendingCause_=state.pendingCause;return state;}
  ReceiptDATA now;state=auth::readOriginalReceipt(receipt,now);if(state.failure.present)return {false,fail(state.failure)};
  if(!state.ready){if(!state.notReady)return {false,fail({true,invalid})};pendingCause_=state.pendingCause;return state;}
  if(state.notReady||!shape(now)||!same(original_,now)||now.currentEngineHeight<original_.currentEngineHeight)return {false,fail({true,changed})};
  state=auth::originalReceiptCurrent(receipt);if(state.failure.present)return {false,fail(state.failure)};if(state.ready&&state.notReady)return {false,fail({true,invalid})};
  if(!state.ready){if(!state.notReady)return {false,fail({true,invalid})};pendingCause_=state.pendingCause;return state;}
  if(retired_.load())return {false,fail({true,retired})};
  original_.currentEngineHeight=now.currentEngineHeight;return {true,{}};
 }catch(...){return {false,fail({true,notSupplied})};}
}
ReadResult NativeRegisteredReceiptOwner::selectOriginalAccount(uint32_t timeout)noexcept{
 auto status=current();if(!status.ready||status.failure.present)return status;if(selected_||ticket_.load())return {false,{true,invalid}};
 try{uint64_t selectedTicket=0;auto rc=picker::openRegisteredAccountForCurrentRuntime({{original_.account,original_.networkId}},timeout,&selectedTicket);
  ticket_.store(selectedTicket); // adopt any partial BEFORE rc or cancellation
  if(retired_.load()&&selectedTicket)picker::requestCancel(selectedTicket);
  if(rc)return {false,fail({true,rc})};
  uint32_t row=std::numeric_limits<uint32_t>::max();rc=picker::wait(selectedTicket,&row);if(rc)return {false,fail({true,rc})};
  if(row!=0)return {false,fail({true,invalid})};choiceObserved_=true;status=current();if(!status.ready||status.failure.present)return status;
  selected_=true;return {true,{}};
 }catch(...){return {false,fail({true,notSupplied})};}
}
ReadResult NativeRegisteredReceiptOwner::readForNativeInventory(ReceiptDATA&out)noexcept{
 if(actor_!=std::this_thread::get_id())return {false,{true,wrongThread}};
 if(retired_.load()||closed_||released_)return {false,{true,retired}};
 if(!selected_)return choiceObserved_||!ready_?ReadResult{false,{},true,pendingCause_}:ReadResult{false,{true,notSupplied}};
 auto status=current();if(!status.ready||status.failure.present)return status;
 try{auto copy=original_;status=current();if(!status.ready||status.failure.present)return status;out=std::move(copy);return {true,{}};}catch(...){return {false,fail({true,notSupplied})};}
}
ReadResult NativeRegisteredReceiptOwner::readOriginalSourceSelection(auth::OriginalSourceSelection&out)noexcept{
 if(actor_!=std::this_thread::get_id())return {false,{true,wrongThread}};
 if(!selected_)return {false,{true,notSupplied}};
 auto state=current();if(!state.ready||state.failure.present)return state;
 try{auth::OriginalSourceSelection copy;state=auth::readOriginalSourceSelection(child(),copy);
  if(state.failure.present){observeFailure(state.failure);state.ready=false;return state;}if(!state.ready)return state;
  // Compare Source identity to the same genuine receipt. Source nonce/height/
  // vaultRevision remain their OWN original values, never ledger aliases.
  if(state.notReady||copy.version!=1||copy.mode<1||copy.mode>3||copy.reviewClaimed||copy.account!=original_.account||copy.networkId!=original_.networkId||copy.platform!=original_.platform||copy.registrationDigest!=original_.registrationDigest||copy.keyVersion!=original_.keyVersion||copy.nativeChainID.empty()||copy.reference.empty()||copy.declaredOriginalOperationId.empty()||copy.applicationId.empty()||copy.protectedResourceRef.empty()||copy.vaultRevision.empty()||copy.sourceExecutionHeight.empty()||copy.sourceNonce.empty()||copy.spendingBudgetOriginalDigest.empty()||copy.scopeOriginal.empty()||copy.contextOriginal.empty()||copy.issuedAtMs>=copy.expiresAtMs)return {false,fail({true,changed})};
  state=current();if(!state.ready||state.failure.present)return state;out=std::move(copy);return {true,{}};
 }catch(...){return {false,fail({true,notSupplied})};}
}
auth::DirectoryAcquisition NativeRegisteredReceiptOwner::borrowOriginalDirectory(uint32_t role)noexcept{
 auth::DirectoryAcquisition out;
 if(actor_!=std::this_thread::get_id()){out.failure={true,wrongThread};return out;}
 if(role<1||role>3||!selected_){out.failure={true,invalid};return out;}
 auto state=current();if(!state.ready||state.failure.present){out.failure=state.failure;out.pendingCause=state.pendingCause;return out;}
 try{
  out=auth::borrowOriginalReceiptDirectory(child(),role); // adopt partial first
  if(out.failure.present){observeFailure(out.failure);out.ready=false;return out;}
  if(!out.owner){out.failure=observeFailure({true,notSupplied});out.ready=false;return out;}
  if(!out.ready)return out;
  auth::DirectoryDATA directory;state=auth::readOriginalReceiptDirectory(out.owner,directory);
  if(!state.ready||state.failure.present||state.notReady){out.ready=false;out.failure=observeFailure(state.failure.present?state.failure:state.notReady&&!state.ready?Failure{}:Failure{true,invalid});out.pendingCause=state.pendingCause;return out;}
  auth::OriginalSourceSelection source;state=readOriginalSourceSelection(source);
  if(!state.ready||state.failure.present){out.ready=false;out.failure=state.failure;out.pendingCause=state.pendingCause;return out;}
  if(directory.role!=role||!matchesNativeCompiledReceiptDirectory(source,directory)){
   out.ready=false;out.failure=observeFailure({true,notSupplied});return out;
  }
  state=auth::assertOriginalReceiptDirectoryBinding(out.owner,directory);
  if(!state.ready||state.failure.present||state.notReady){out.ready=false;out.failure=observeFailure(state.failure.present?state.failure:state.notReady&&!state.ready?Failure{}:Failure{true,invalid});out.pendingCause=state.pendingCause;return out;}
  state=current();if(!state.ready||state.failure.present){out.ready=false;out.failure=state.failure;out.pendingCause=state.pendingCause;}
  return out;
 }catch(...){out.failure=observeFailure({true,notSupplied});out.ready=false;return out;}
}
void NativeRegisteredReceiptOwner::requestRetire()noexcept{
 retired_.store(true);const auto ticket=ticket_.load();if(ticket)picker::requestCancel(ticket);
 // The supplier's separate any-thread entry touches only this child's own
 // atomic bit. Revoke it now, including while its actor is awaiting UI/proof.
 // Root/Core retirement and physical cleanup still stay on the actor.
 try{auto receipt=child();if(!receipt)return;auth::requestRevokeOriginalReceipt(receipt);
  if(actor_==std::this_thread::get_id())auth::retireOriginalReceipt(receipt);
 }catch(...){/* original inventory keeps the child */}
}
Failure NativeRegisteredReceiptOwner::close()noexcept{
 if(actor_!=std::this_thread::get_id())return {true,wrongThread};if(closed_)return cleanup_;
 requestRetire();
 try{const auto ticket=ticket_.load();if(ticket){auto rc=picker::close(ticket);if(rc){if(rc!=picker::pending)keepCleanup({true,rc});return {true,rc};}rc=picker::releaseClosed(ticket);if(rc){if(rc!=picker::pending)keepCleanup({true,rc});return {true,rc};}ticket_.store(0);}
  auto receipt=child();if(receipt){keepCleanup(auth::joinOriginalReceipt(receipt));if(!authCloseSelected_){authCloseSelected_=true;keepCleanup(auth::closeOriginalReceipt(receipt));}if(!auth::originalReceiptClosed(receipt))return {true,cleanupPending};}
  {std::lock_guard<std::mutex>lock(childMutex_);receipt_.reset();}closed_=true;return cleanup_;
 }catch(...){keepCleanup({true,notSupplied});return cleanup_;}
}
Failure NativeRegisteredReceiptOwner::releaseClosed()noexcept{
 if(actor_!=std::this_thread::get_id())return {true,wrongThread};if(!closed_)return {true,cleanupPending};if(released_)return {};
 try{std::shared_ptr<NativeRegisteredReceiptOwner>keep;{std::lock_guard<std::mutex>lock(inventoryMutex);auto found=inventory.find(this);if(found==inventory.end())return {true,invalid};keep=found->second;inventory.erase(found);released_=true;}return {};}catch(...){return {true,notSupplied};}
}
}
