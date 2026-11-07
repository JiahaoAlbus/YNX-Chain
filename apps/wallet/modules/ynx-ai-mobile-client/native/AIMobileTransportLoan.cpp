#include "AIMobileTransportLoanPrivate.hpp"
#include "AIMobileTransportFrame.h"
#include <chrono>
#include <limits>
#include <map>
namespace ynx::mobileai::transport {
struct OriginalRequestLoan {
 std::thread::id actor=std::this_thread::get_id();std::shared_ptr<producer::Producer>parent;
 std::shared_ptr<const RequestDATA>data;std::shared_ptr<producer::Context>context;std::shared_ptr<std::atomic<bool>>runtimeLife;
 uint64_t wall0=0,mono0=0,expiresAtMs=0;std::atomic<bool>cancelled{false};std::atomic<bool>closed{false},released{false};
};
namespace {
thread_local std::shared_ptr<producer::Producer>executing;
std::mutex mutex;std::map<uintptr_t,std::shared_ptr<OriginalRequestLoan>>loans;uintptr_t next=1;
std::shared_ptr<OriginalRequestLoan>get(OriginalRequestLoan*p){std::lock_guard<std::mutex>lock(mutex);auto i=loans.find(reinterpret_cast<uintptr_t>(p));return i==loans.end()?nullptr:i->second;}
Failure failure(int32_t c){return {1,c};}
uint64_t mono(){return uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());}
uint64_t wall(){return uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());}
}
OriginalDispatchFrame::OriginalDispatchFrame(const std::shared_ptr<producer::Producer>&p){if(!p||p->actor!=std::this_thread::get_id()||!p->dispatchEntered||!p->proved||p->first.present)throw std::runtime_error("AI_ORIGINAL_DISPATCH_FRAME");previous_=std::move(executing);executing=p;}
OriginalDispatchFrame::~OriginalDispatchFrame(){executing=std::move(previous_);}
Acquisition acquireOriginalRequestForDispatch()noexcept{Acquisition result;try{auto p=executing;if(!producer::current(p)||!p->dispatchEntered||!p->proved||!p->review||!p->operation||p->finalHead.empty()||p->expiresAtMs<=p->issuedAtMs||p->expiresAtMs-p->issuedAtMs>30000){result.failure=failure(invalid);return result;}auto value=std::make_shared<OriginalRequestLoan>();value->parent=p;value->context=p->context;value->runtimeLife=p->context->life;value->wall0=wall();value->mono0=mono();value->expiresAtMs=std::min(p->expiresAtMs,p->context->expiresAtMs);value->data=std::make_shared<const RequestDATA>(RequestDATA{6,p->intent.method,p->intent.path,p->originURL,p->finalHead,p->intent.body,p->issuedAtMs,p->expiresAtMs});{std::lock_guard<std::mutex>lock(mutex);size_t active=0;for(const auto&[id,x]:loans){(void)id;active+=!x->released.load();}if(active>=64||next==std::numeric_limits<uintptr_t>::max()){result.failure=failure(capacity);return result;}auto id=next++;loans.emplace(id,value);result.owner=reinterpret_cast<OriginalRequestLoan*>(id);++p->children;}auto check=originalRequestCurrent(result.owner);if(check.present)result.failure=check;return result;}catch(...){result.failure=failure(retained);return result;}}
Failure originalRequestCurrent(OriginalRequestLoan*token)noexcept{try{auto value=get(token);if(!value||value->actor!=std::this_thread::get_id())return failure(wrongThread);if(value->closed||value->released||originalRequestCancelled(token))return failure(closed);auto p=value->parent;auto data=std::atomic_load(&value->data);auto at=wall();if(!data||!producer::current(p)||at<data->issuedAtMs||at>=data->expiresAtMs)return failure(closed);YNXAuthAIMobileOwnerStateV6 source{};source.version=6;source.size=sizeof(source);auto rc=ynx_auth_ai_mobile_owner_state_v6(p->source,&source);if(rc)return failure(rc);if(source.kind!=1||source.closed||source.original_failure.present)return source.original_failure.present?source.original_failure:failure(closed);rc=ynx_auth_ai_mobile_client_current_v6(p->source);return rc?failure(rc):Failure{};}catch(...){return failure(retained);}}
Failure readOriginalRequest(OriginalRequestLoan*token,RequestDATA&out)noexcept{try{auto value=get(token);if(!value||value->closed||value->released||value->cancelled)return failure(closed);auto data=std::atomic_load(&value->data);if(!data)return failure(closed);out=*data;return {};}catch(...){return failure(retained);}}
bool originalRequestCancelled(OriginalRequestLoan*token)noexcept{try{auto value=get(token);if(!value||value->closed||value->released||value->cancelled||!value->parent||value->parent->cancelled.load()||!value->context||value->context->cancelled.load()||!value->runtimeLife||!value->runtimeLife->load())return true;auto current=mono();return value->expiresAtMs<=value->wall0||current<value->mono0||current-value->mono0>=value->expiresAtMs-value->wall0;}catch(...){return true;}}
void requestOriginalRequestCancel(OriginalRequestLoan*token)noexcept{try{auto value=get(token);if(value)value->cancelled=true;}catch(...){}}
Failure joinOriginalRequest(OriginalRequestLoan*token)noexcept{try{auto value=get(token);if(!value||value->actor!=std::this_thread::get_id())return failure(wrongThread);if(value->released)return {};if(value->parent->transportChild&&!value->parent->transportPhysicallyClosed)return failure(retained);return {};}catch(...){return failure(retained);}}
Failure closeOriginalRequest(OriginalRequestLoan*token)noexcept{try{auto value=get(token);if(!value||value->actor!=std::this_thread::get_id())return failure(wrongThread);value->cancelled=true;auto pending=joinOriginalRequest(token);if(pending.present)return pending;value->closed=true;return {};}catch(...){return failure(retained);}}
bool originalRequestClosed(OriginalRequestLoan*token)noexcept{try{auto value=get(token);return value&&value->closed.load();}catch(...){return false;}}
Failure releaseClosedOriginalRequest(OriginalRequestLoan*token)noexcept{try{auto value=get(token);if(!value||value->actor!=std::this_thread::get_id())return failure(wrongThread);if(!value->closed)return failure(retained);if(value->released)return {};value->released=true;std::atomic_store(&value->data,std::shared_ptr<const RequestDATA>{});if(value->parent&&value->parent->children)--value->parent->children;return {};}catch(...){return failure(retained);}}
}
