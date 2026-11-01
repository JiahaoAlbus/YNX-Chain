// Private to this original SourceAuthority TU, never exposed by a public
// SDK/JS setter. Calls occur only after its actual verifier and final FD fence.
namespace ynx_auth_private {
class OriginalPaySourceMathCompletion final {
public:
 static std::shared_ptr<PayObservedState>makeState(){return std::shared_ptr<PayObservedState>(new PayObservedState);}
 static void retire(const std::shared_ptr<PayObservedState>&s)noexcept{if(s)s->retired_.store(true,std::memory_order_release);}
 static bool observe(const std::shared_ptr<PayObservedState>&s,uint64_t issuer,uint64_t current,bool changed)noexcept{
  if(!s||!issuer||!current||s->retired_.load(std::memory_order_acquire))return false;
  uint64_t e=s->epoch_.load(std::memory_order_acquire);if(e==UINT64_MAX){retire(s);return false;}
  if(!e||changed){s->issuer_.store(issuer,std::memory_order_release);s->current_.store(current,std::memory_order_release);s->epoch_.store(e+1,std::memory_order_release);}return true;
 }
 static uint64_t loans(const std::shared_ptr<PayObservedState>&s)noexcept{return s?s->loans_.load(std::memory_order_acquire):0;}
 static std::shared_ptr<PayObservedPermission>mint(const std::shared_ptr<PayObservedState>&s,std::shared_ptr<void>parent,std::chrono::steady_clock::time_point until){
  auto now=std::chrono::steady_clock::now();
  if(!s||!parent||until<=now||until-now>std::chrono::seconds(30)||s->retired_.load(std::memory_order_acquire))return {};
  auto e=s->epoch_.load(std::memory_order_acquire),issuer=s->issuer_.load(std::memory_order_acquire),current=s->current_.load(std::memory_order_acquire);if(!e||!issuer||!current)return {};
  auto loan=std::shared_ptr<PayObservedPermission>(new PayObservedPermission(s,std::move(parent),e,issuer,current,until));
  return loan;
 }
};
}
