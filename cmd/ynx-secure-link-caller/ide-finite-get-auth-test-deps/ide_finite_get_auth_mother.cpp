#include "ide_finite_get_auth_mother_internal.hpp"
#include <atomic>
#include <chrono>
#include <mutex>
#include <thread>
#include <new>
#include <cstring>
namespace{
uint64_t monotonic_ns()noexcept{return uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());}
template<class T,size_t N>struct FixedRegistry{
 std::array<T*,N>entries{};
 size_t count(T*p)const noexcept{for(auto*q:entries)if(q==p&&p)return 1;return 0;}
 bool insert(T*p)noexcept{for(auto&q:entries)if(!q){q=p;return true;}return false;}
 void erase(T*p)noexcept{for(auto&q:entries)if(q==p){q=nullptr;return;}}
};
template<class T,size_t N>struct AtomicRegistry{
 std::array<std::atomic<T*>,N>entries{};
 size_t count(T*p)const noexcept{for(const auto&q:entries)if(q.load(std::memory_order_acquire)==p&&p)return 1;return 0;}
 bool insert(T*p)noexcept{for(auto&q:entries)if(!q.load(std::memory_order_relaxed)){q.store(p,std::memory_order_release);return true;}return false;}
 void erase(T*p)noexcept{for(auto&q:entries)if(q.load(std::memory_order_relaxed)==p){q.store(nullptr,std::memory_order_release);return;}}
};
}
struct ynx_auth_ide_finite_get_credential_v1{
 ynx_auth_ide_finite_get_credential_view_v1 view{};
 std::shared_ptr<ynx::auth::ide_get::OriginalTargetQualification>owner;
};
struct ynx_auth_ide_finite_get_ticket_v1{
 std::shared_ptr<ynx::auth::ide_get::OriginalTargetQualification>target;
 std::shared_ptr<ynx::auth::ide_get::OriginalRequestCustody>request;
 ynx_auth_ide_finite_get_view_v1 view{};ynx_auth_ide_finite_get_credential_v1 credential;
 std::thread::id actor=std::this_thread::get_id();
 std::atomic<bool>sealed{false},claimed{false};std::atomic<int32_t>first{0};
 size_t loans=0;bool closed=false;
};
struct ynx_auth_ide_finite_get_loan_v1{
 ynx_auth_ide_finite_get_ticket_v1*ticket=nullptr;
 std::atomic<bool>sealed{false};size_t refs=1;std::atomic<bool>released{false};
};
namespace{
std::mutex inventory_mutex;
FixedRegistry<ynx_auth_ide_finite_get_ticket_v1,256>tickets;
AtomicRegistry<ynx_auth_ide_finite_get_loan_v1,512>loans;
FixedRegistry<const ynx_auth_ide_finite_get_credential_v1,256>credentials;
void latch(ynx_auth_ide_finite_get_ticket_v1*t,int32_t e)noexcept{if(e){int32_t zero=0;t->first.compare_exchange_strong(zero,e);t->sealed.store(true,std::memory_order_release);}}
bool actor(ynx_auth_ide_finite_get_ticket_v1*t)noexcept{return t->actor==std::this_thread::get_id();}
int32_t full_current(ynx_auth_ide_finite_get_ticket_v1*t)noexcept{
 if(!actor(t)||t->closed||t->sealed.load(std::memory_order_acquire))return YNX_AUTH_IDE_GET_DENIED;
 int32_t e=t->target?t->target->assert_current_original():YNX_AUTH_IDE_GET_NOT_SUPPLIED;
 if(!e)e=t->request?t->request->assert_current_original():YNX_AUTH_IDE_GET_NOT_SUPPLIED;
 if(!e&&monotonic_ns()>=t->view.expires_monotonic_ns)e=YNX_AUTH_IDE_GET_DENIED;
 if(e)latch(t,e);return e;
}
}
namespace ynx::auth::ide_get{
ynx_auth_ide_finite_get_ticket_v1*TicketSource::open_original(std::shared_ptr<OriginalTargetQualification>target,std::shared_ptr<OriginalRequestCustody>request,int32_t*error)noexcept{
 if(error)*error=YNX_AUTH_IDE_GET_NOT_SUPPLIED;
 if(!target||!request)return nullptr;
 auto*t=new(std::nothrow)ynx_auth_ide_finite_get_ticket_v1;if(!t){if(error)*error=YNX_AUTH_IDE_GET_UNKNOWN;return nullptr;}
 t->target=std::move(target);t->request=std::move(request);t->credential.owner=t->target;
 {std::lock_guard<std::mutex>g(inventory_mutex);if(!tickets.insert(t)){delete t;if(error)*error=YNX_AUTH_IDE_GET_PENDING;return nullptr;}if(!credentials.insert(&t->credential)){tickets.erase(t);delete t;if(error)*error=YNX_AUTH_IDE_GET_PENDING;return nullptr;}}
 int32_t e=t->target->assert_current_original();
 if(!e)e=t->request->assert_current_original();
 if(!e)e=t->target->read_native_target_original(&t->view,&t->credential.view);
 if(!e)e=t->request->read_native_request_original(&t->view);
 t->view.credential=&t->credential;
 if(!e&&(t->view.version!=1||t->view.size!=sizeof(t->view)||!t->view.original_path.size||!t->view.original_operation_id.size||!t->view.original_v4_proof_header.size||t->view.original_v4_proof_header.size>196608||!t->view.expires_monotonic_ns||t->credential.view.version!=1||t->credential.view.size!=sizeof(t->credential.view)))e=YNX_AUTH_IDE_GET_DENIED;
 if(!e)e=full_current(t);if(e)latch(t,e);if(error)*error=e;return t; // adopt nonnull partial FIRST
}
int32_t TicketSource::close_original(ynx_auth_ide_finite_get_ticket_v1*t,uint8_t*closed)noexcept{
 if(!closed)return YNX_AUTH_IDE_GET_DENIED;*closed=0;
 std::lock_guard<std::mutex>g(inventory_mutex);if(!tickets.count(t)||!actor(t))return YNX_AUTH_IDE_GET_DENIED;
 t->sealed.store(true,std::memory_order_release);if(t->loans)return YNX_AUTH_IDE_GET_PENDING;
 t->closed=true;*closed=1;return t->first.load(std::memory_order_acquire);
}
int32_t TicketSource::free_original(ynx_auth_ide_finite_get_ticket_v1*t)noexcept{
 std::lock_guard<std::mutex>g(inventory_mutex);if(!tickets.count(t)||!actor(t)||!t->closed||t->loans)return YNX_AUTH_IDE_GET_DENIED;
 credentials.erase(&t->credential);tickets.erase(t);delete t;return 0;
}
}
extern "C" int32_t ynx_auth_ide_finite_get_current_original_v1(ynx_auth_ide_finite_get_ticket_v1*t){
 {std::lock_guard<std::mutex>g(inventory_mutex);if(!tickets.count(t)||!actor(t))return YNX_AUTH_IDE_GET_DENIED;}
 // Actor only: no inventory lock spans Root/FD/math. Actor owns base ticket;
 // worker loans keep it from close/free until actual LINK physical drain.
 return full_current(t);
}
extern "C" int32_t ynx_auth_ide_finite_get_claim_original_v1(ynx_auth_ide_finite_get_ticket_v1*t,ynx_auth_ide_finite_get_loan_v1**out){
 if(!out)return YNX_AUTH_IDE_GET_DENIED;*out=nullptr;
 {std::lock_guard<std::mutex>g(inventory_mutex);if(!tickets.count(t)||!actor(t))return YNX_AUTH_IDE_GET_DENIED;}
 bool expected=false;if(!t->claimed.compare_exchange_strong(expected,true))return YNX_AUTH_IDE_GET_DENIED;
 int32_t e=full_current(t);if(e)return e;
 auto*l=new(std::nothrow)ynx_auth_ide_finite_get_loan_v1;if(!l){latch(t,YNX_AUTH_IDE_GET_UNKNOWN);return YNX_AUTH_IDE_GET_UNKNOWN;}
 l->ticket=t;{std::lock_guard<std::mutex>g(inventory_mutex);if(!loans.insert(l)){delete l;latch(t,YNX_AUTH_IDE_GET_PENDING);return YNX_AUTH_IDE_GET_PENDING;}++t->loans;}*out=l;
 e=full_current(t);if(e)l->sealed.store(true,std::memory_order_release);return e;
}
extern "C" int32_t ynx_auth_ide_finite_get_loan_retain_v1(ynx_auth_ide_finite_get_loan_v1*l){std::lock_guard<std::mutex>g(inventory_mutex);if(!loans.count(l)||l->released||l->refs==SIZE_MAX)return YNX_AUTH_IDE_GET_DENIED;++l->refs;return 0;}
extern "C" int32_t ynx_auth_ide_finite_get_prewrite_current_v1(const ynx_auth_ide_finite_get_loan_v1*l){
 // Caller already owns a retained loan; stale/foreign pointers are checked
 // by LINK at handoff via loan_view. NO owner/inventory lock on worker fence.
 if(!loans.count(const_cast<ynx_auth_ide_finite_get_loan_v1*>(l)))return YNX_AUTH_IDE_GET_DENIED;
 if(l->released.load(std::memory_order_acquire))return YNX_AUTH_IDE_GET_DENIED;
 auto*t=l->ticket;if(l->sealed.load(std::memory_order_acquire)||!t||t->sealed.load(std::memory_order_acquire)||monotonic_ns()>=t->view.expires_monotonic_ns){const_cast<ynx_auth_ide_finite_get_loan_v1*>(l)->sealed.store(true,std::memory_order_release);return YNX_AUTH_IDE_GET_DENIED;}return 0;
}
extern "C" int32_t ynx_auth_ide_finite_get_loan_view_v1(const ynx_auth_ide_finite_get_loan_v1*l,ynx_auth_ide_finite_get_view_v1*out){if(!out)return YNX_AUTH_IDE_GET_DENIED;std::lock_guard<std::mutex>g(inventory_mutex);if(!loans.count(const_cast<ynx_auth_ide_finite_get_loan_v1*>(l))||l->released)return YNX_AUTH_IDE_GET_DENIED;*out=l->ticket->view;return 0;}
extern "C" int32_t ynx_auth_ide_finite_get_credential_view_v1_read(const ynx_auth_ide_finite_get_credential_v1*c,ynx_auth_ide_finite_get_credential_view_v1*out){if(!out)return YNX_AUTH_IDE_GET_DENIED;std::lock_guard<std::mutex>g(inventory_mutex);if(!credentials.count(c))return YNX_AUTH_IDE_GET_DENIED;*out=c->view;return 0;}
extern "C" int32_t ynx_auth_ide_finite_get_abort_original_v1(ynx_auth_ide_finite_get_ticket_v1*t){std::lock_guard<std::mutex>g(inventory_mutex);if(!tickets.count(t))return YNX_AUTH_IDE_GET_DENIED;latch(t,YNX_AUTH_IDE_GET_DENIED);return 0;}
extern "C" int32_t ynx_auth_ide_finite_get_loan_release_v1(ynx_auth_ide_finite_get_loan_v1*l,uint8_t*released){if(!released)return YNX_AUTH_IDE_GET_DENIED;*released=0;std::lock_guard<std::mutex>g(inventory_mutex);if(!loans.count(l)||l->released||!l->refs)return YNX_AUTH_IDE_GET_DENIED;if(--l->refs)return 0;l->sealed.store(true,std::memory_order_release);l->released=true;--l->ticket->loans;*released=1;return 0;}
extern "C" int32_t ynx_auth_ide_finite_get_loan_free_v1(ynx_auth_ide_finite_get_loan_v1*l){std::lock_guard<std::mutex>g(inventory_mutex);if(!loans.count(l)||!l->released||l->refs)return YNX_AUTH_IDE_GET_DENIED;loans.erase(l);delete l;return 0;}
extern "C" int32_t ynx_auth_ide_finite_get_first_error_v1(const ynx_auth_ide_finite_get_ticket_v1*t){std::lock_guard<std::mutex>g(inventory_mutex);if(!tickets.count(const_cast<ynx_auth_ide_finite_get_ticket_v1*>(t)))return YNX_AUTH_IDE_GET_DENIED;return t->first.load(std::memory_order_acquire);}
