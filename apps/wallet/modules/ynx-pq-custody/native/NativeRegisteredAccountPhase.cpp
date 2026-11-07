#include "MobileRegisteredAccountPhasePrivate.h"
#include "NativeRegisteredReceiptOwner.h"
#include "NativeReceiptDirectoryPolicy.h"
#include "SelectedDirectoryInventory.h"
#include <atomic>
#include <limits>
#include <map>
#include <mutex>
namespace ynx::mobilepq::registered {
namespace {
namespace auth=ynx::auth::mobile::receipt;
namespace dirs=ynx::mobilepq::directories;
struct Mother {
 const std::thread::id actor=std::this_thread::get_id();
 std::shared_ptr<NativeRegisteredReceiptOwner>receipt;
 std::shared_ptr<auth::ReceiptDirectoryLoan>directory;
 std::shared_ptr<dirs::SelectedDirectoryInventory>pins;
 auth::OriginalSourceSelection source;
 std::atomic<bool>retired{false};
 Failure first,cleanup,pending;
 uint32_t phase=YNX_MOBILE_REGISTERED_NOT_READY_V2;
 bool selectionStarted=false,sourceHeld=false,directoryPending=false,closing=false,closed=false;
 YNXMobilePQSelectedOriginal*token=nullptr;
};
std::mutex mothersMutex;
// Cleanup retention only, not an account/permission/engine lookup registry.
auto&mothers=*new std::map<uintptr_t,std::shared_ptr<Mother>>;
uintptr_t nextMother=1;
void remember(Failure&out,Failure f){if(f.present&&!out.present)out=f;}
YNXMobileRegisteredFailureV2 paired(Failure f){return {uint32_t(f.present),f.code};}
YNXMobileRegisteredPhaseV2 failed(Failure f){return {2,sizeof(YNXMobileRegisteredPhaseV2),YNX_MOBILE_REGISTERED_FAILED_V2,paired(f.present?f:Failure{true,invalid}),{}};}
std::shared_ptr<Mother>get(YNXMobilePQSelectedOriginal*p){std::lock_guard<std::mutex>l(mothersMutex);auto i=mothers.find(reinterpret_cast<uintptr_t>(p));return i==mothers.end()?nullptr:i->second;}
bool actor(const std::shared_ptr<Mother>&p){return p&&p->actor==std::this_thread::get_id();}
YNXMobileRegisteredPhaseV2 status(const std::shared_ptr<Mother>&p){return {2,sizeof(YNXMobileRegisteredPhaseV2),p->phase,p->phase==YNX_MOBILE_REGISTERED_FAILED_V2?paired(p->first):YNXMobileRegisteredFailureV2{},paired(p->pending)};}
YNXMobileRegisteredPhaseV2 fail(const std::shared_ptr<Mother>&p,Failure f){remember(p->first,f.present?f:Failure{true,invalid});p->phase=YNX_MOBILE_REGISTERED_FAILED_V2;p->retired=true;if(p->receipt)p->receipt->requestRetire();if(p->pins)p->pins->retire();return status(p);}
YNXMobileRegisteredPhaseV2 accept(const std::shared_ptr<Mother>&p,ReadResult r){
 if(r.failure.present)return fail(p,r.failure);
 if(r.ready&&r.notReady)return fail(p,{true,invalid});
 if(!r.ready){if(!r.notReady)return fail(p,{true,invalid});p->phase=YNX_MOBILE_REGISTERED_NOT_READY_V2;p->pending=r.pendingCause;}
 return status(p);
}
YNXMobileRegisteredPhaseV2 finishReady(const std::shared_ptr<Mother>&p){
 if(!p->selectionStarted){p->selectionStarted=true;auto r=p->receipt->selectOriginalAccount(30000);if(r.failure.present||!r.ready)return accept(p,r);}
 if(!p->sourceHeld){auto r=p->receipt->readOriginalSourceSelection(p->source);if(r.failure.present||!r.ready)return accept(p,r);if(p->source.mode!=2||p->source.reviewClaimed)return fail(p,{true,invalid});p->sourceHeld=true;}
 if(!p->directory){auto acquired=p->receipt->borrowOriginalDirectory(1);p->directory=std::move(acquired.owner); // partial before presence
  if(acquired.failure.present)return fail(p,acquired.failure);
  if(!acquired.ready){p->directoryPending=bool(p->directory);p->phase=YNX_MOBILE_REGISTERED_NOT_READY_V2;p->pending=acquired.pendingCause;return status(p);}
  if(!p->directory)return fail(p,{true,notSupplied});
 }
 if(p->directoryPending){auto r=auth::resumeOriginalReceiptDirectory(p->directory);if(r.failure.present||!r.ready)return accept(p,r);if(r.notReady)return fail(p,{true,invalid});p->directoryPending=false;}
 auth::DirectoryDATA directory;auto r=auth::readOriginalReceiptDirectory(p->directory,directory);if(r.failure.present||!r.ready)return accept(p,r);
 if(r.notReady||directory.version!=2||directory.role!=1)return fail(p,{true,invalid});
 // A partial that was NOT_READY bypassed the initial borrow's map check.
 // Re-AND the independent Native literals before pinning its resumed FDs.
 if(!matchesNativeCompiledReceiptDirectory(p->source,directory))return fail(p,{true,notSupplied});
 if(!p->pins){dirs::NativeDirectory native{1,directory.rootLocator,directory.leaf,directory.parentFD,directory.borrowedFD};
  const auto rc=dirs::SelectedDirectoryInventory::pinRegisteredSourceOnly(p->token,native,p->pins);
  if(rc)return fail(p,{true,rc});
 }
 r=auth::assertOriginalReceiptDirectoryBinding(p->directory,directory);if(r.failure.present||!r.ready)return accept(p,r);
 if(r.notReady)return fail(p,{true,invalid});
 if(auto rc=p->pins->current())return fail(p,{true,rc});
 r=p->receipt->current();if(r.failure.present||!r.ready)return accept(p,r);
 if(p->retired)return fail(p,{true,retired});
 p->phase=YNX_MOBILE_REGISTERED_READY_V2;return status(p);
}
YNXMobileRegisteredPhaseV2 current(const std::shared_ptr<Mother>&p){
 if(!actor(p))return failed({true,p?wrongThread:invalid});
 if(p->phase==YNX_MOBILE_REGISTERED_FAILED_V2)return status(p);
 if(p->retired||p->closing||p->closed)return fail(p,{true,retired});
 if(!p->receipt)return fail(p,{true,notSupplied});
 if(p->phase==YNX_MOBILE_REGISTERED_NOT_READY_V2){auto f=p->receipt->currentSourceFence();return f.present?fail(p,f):status(p);}
 auto r=p->receipt->current();if(r.failure.present||!r.ready)return accept(p,r);
 if(!p->pins||!p->directory)return fail(p,{true,notSupplied});
 if(auto rc=p->pins->current())return fail(p,{true,rc});
 r=auth::currentOriginalReceiptDirectory(p->directory);if(r.failure.present||!r.ready)return accept(p,r);
 if(r.notReady)return fail(p,{true,invalid});
 r=p->receipt->current();return r.failure.present||!r.ready?accept(p,r):status(p);
}
void retire(const std::shared_ptr<Mother>&p){p->retired=true;if(p->receipt)p->receipt->requestRetire();if(p->pins)p->pins->retire();}
YNXMobileRegisteredDrainV2 drain(const std::shared_ptr<Mother>&p,bool close){
 if(!actor(p))return {2,sizeof(YNXMobileRegisteredDrainV2),0,paired({true,p?wrongThread:invalid}),{}};
 auto result=[&]{return YNXMobileRegisteredDrainV2{2,sizeof(YNXMobileRegisteredDrainV2),uint32_t(p->closed),paired(p->first),paired(p->cleanup)};};
 if(p->closed)return result();
 if(close){p->closing=true;retire(p);}if(!p->closing)return result();
 // Physical Native duplicates and their actual children close before dropping
 // the real Auth directory loan, which in turn closes before its receipt.
 if(p->pins){const auto rc=p->pins->close();if(rc&&rc!=dirs::debt)remember(p->cleanup,{true,rc});if(!p->pins->isClosed())return result();}
 if(p->directory){remember(p->cleanup,auth::closeOriginalReceiptDirectory(p->directory));if(!auth::originalReceiptDirectoryClosed(p->directory))return result();p->directory.reset();}
 if(p->receipt){(void)p->receipt->close();remember(p->cleanup,p->receipt->cleanupFailure());if(!p->receipt->isClosed())return result();auto f=p->receipt->releaseClosed();remember(p->cleanup,f);if(f.present)return result();p->receipt.reset();}
 p->pins.reset();p->closed=true;return result();
}
YNXMobileSelectedPublicSpan span(const std::string&s){return {reinterpret_cast<const uint8_t*>(s.data()),s.size()};}
}
}
using namespace ynx::mobilepq::registered;
extern "C" YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_acquire_v2(YNXMobilePQSelectedOriginal**out){
 if(!out||*out)return failed({true,invalid});std::shared_ptr<Mother>p;
 try{p=std::make_shared<Mother>();{std::lock_guard<std::mutex>l(mothersMutex);if(mothers.size()>=64||nextMother==std::numeric_limits<uintptr_t>::max())return failed({true,capacity});p->token=reinterpret_cast<YNXMobilePQSelectedOriginal*>(nextMother);mothers.emplace(nextMother++,p);*out=p->token;}
  auto r=NativeRegisteredReceiptOwner::acquire(p->receipt);if(r.failure.present||!r.ready)return accept(p,r);return finishReady(p);
 }catch(...){return p&&*out?fail(p,{true,notSupplied}):failed({true,notSupplied});}
}
extern "C" YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_resume_v2(YNXMobilePQSelectedOriginal*t){try{auto p=get(t);if(!actor(p))return failed({true,p?wrongThread:invalid});if(p->phase==YNX_MOBILE_REGISTERED_FAILED_V2||p->retired||p->closing||p->closed)return p->phase==YNX_MOBILE_REGISTERED_FAILED_V2?status(p):fail(p,{true,retired});auto r=p->receipt->resumeOriginalReceipt();if(r.failure.present||!r.ready)return accept(p,r);return finishReady(p);}catch(...){return failed({true,notSupplied});}}
extern "C" YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_current_v2(YNXMobilePQSelectedOriginal*t){try{return current(get(t));}catch(...){return failed({true,notSupplied});}}
extern "C" YNXMobileRegisteredPhaseV2 ynx_mobile_pq_registered_account_read_v2(YNXMobilePQSelectedOriginal*t,YNXMobilePQSelectedOriginalDATA*out){
 try{if(!out||out->version!=1||out->size!=sizeof(*out))return failed({true,invalid});auto p=get(t);auto s=current(p);if(s.phase!=YNX_MOBILE_REGISTERED_READY_V2)return s;const auto&v=p->source;auto copy=YNXMobilePQSelectedOriginalDATA{1,sizeof(*out),2,span(v.reference),span(v.declaredOriginalOperationId),span(v.networkId),span(v.account),span(v.platform),span(v.applicationId),span(v.protectedResourceRef),span(v.nativeChainID),span(v.vaultRevision),span(v.registrationDigest),span(v.keyVersion),span(v.sourceExecutionHeight),span(v.sourceNonce),span(v.spendingBudgetOriginalDigest),v.issuedAtMs,v.expiresAtMs};s=current(p);if(s.phase==YNX_MOBILE_REGISTERED_READY_V2)*out=copy;return s;
 }catch(...){return failed({true,notSupplied});}
}
extern "C" YNXMobileRegisteredFailureV2 ynx_mobile_pq_registered_account_retire_v2(YNXMobilePQSelectedOriginal*t){try{auto p=get(t);if(!actor(p))return paired({true,p?wrongThread:invalid});retire(p);return {};}catch(...){return paired({true,notSupplied});}}
extern "C" YNXMobileRegisteredDrainV2 ynx_mobile_pq_registered_account_join_v2(YNXMobilePQSelectedOriginal*t){try{return drain(get(t),false);}catch(...){return {2,sizeof(YNXMobileRegisteredDrainV2),0,paired({true,notSupplied}),{}};}}
extern "C" YNXMobileRegisteredDrainV2 ynx_mobile_pq_registered_account_close_v2(YNXMobilePQSelectedOriginal*t){try{return drain(get(t),true);}catch(...){return {2,sizeof(YNXMobileRegisteredDrainV2),0,paired({true,notSupplied}),{}};}}
extern "C" YNXMobileRegisteredFailureV2 ynx_mobile_pq_registered_account_release_closed_v2(YNXMobilePQSelectedOriginal*t){try{auto p=get(t);if(!actor(p))return paired({true,p?wrongThread:invalid});if(!p->closed)return paired({true,cleanupPending});std::lock_guard<std::mutex>l(mothersMutex);mothers.erase(reinterpret_cast<uintptr_t>(t));return {};}catch(...){return paired({true,notSupplied});}}
// The existing directory C ABI uses this actual SAME registered mother. No
// general review selector/claim is supplied or forged by this pre-capture TU.
extern "C" int32_t ynx_mobile_pq_selected_original_current_v1(YNXMobilePQSelectedOriginal*t,uint32_t phase){if(phase!=1)return invalid;auto s=ynx_mobile_pq_registered_account_current_v2(t);return s.phase==YNX_MOBILE_REGISTERED_READY_V2?0:s.failure.present&&s.failure.code?s.failure.code:notSupplied;}
namespace ynx::mobilepq::directories {
std::shared_ptr<SelectedDirectoryInventory>selectedDirectoryInventory(YNXMobilePQSelectedOriginal*t){auto p=ynx::mobilepq::registered::get(t);return ynx::mobilepq::registered::actor(p)?p->pins:nullptr;}
int32_t registeredSourceFenceForDirectory(YNXMobilePQSelectedOriginal*t){
 auto p=ynx::mobilepq::registered::get(t);if(!ynx::mobilepq::registered::actor(p))return p?wrongThread:invalid;
 if(p->phase==YNX_MOBILE_REGISTERED_FAILED_V2||p->retired||p->closing||p->closed||!p->receipt||!p->sourceHeld||!p->pins)return closed;
 const auto f=p->receipt->currentSourceFence();if(f.present){ynx::mobilepq::registered::fail(p,f);return f.code?f.code:changed;}return 0;
}
}
