#import "original-auth-identity-source-authority.h"
#include "pay_root_qualification_private.hpp"
#include "pay_root_transport_release_private.hpp"
#include "pay_root_postbuild_private.hpp"
#include <mutex>
#include <vector>
#include <optional>
#include <atomic>
#include <limits>
namespace ynx::wallet::pay {
namespace {
using Clock=std::chrono::steady_clock;
struct SelectedBinding {Binding binding;bool query=false,effect=false;Clock::time_point until;};
std::string str(id x){if(![x isKindOfClass:NSString.class])throw 1;NSData*d=[x dataUsingEncoding:NSUTF8StringEncoding];if(!d)throw 1;return std::string((const char*)d.bytes,d.length);}
std::optional<std::string> optional(id x){if(x==NSNull.null)return {};return str(x);}
uint64_t integer(id x){if(![x isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)x)==CFBooleanGetTypeID())throw 1;double v=[x doubleValue];if(v<0||v>9007199254740991.0||v!=double([x unsignedLongLongValue]))throw 1;return [x unsignedLongLongValue];}
uint64_t wall(){return uint64_t(NSDate.date.timeIntervalSince1970*1000.0);}
// This maps the already authenticated sole SDK scope to private native types.
// No public WIRE decoder/Root verifier is implemented or replaced here.
std::vector<SelectedBinding> selected(NSDictionary*ctx){
 NSDictionary*scope=ctx[@"scope"];id rows=scope[@"bindings"];if(![rows isKindOfClass:NSArray.class]||![rows count]||[rows count]>64)throw 1;
 auto anchor=Clock::now();uint64_t now=wall(),expires=integer(ctx[@"expiresAtMs"]);if(expires<=now||expires-now>30000)throw 1;
 std::vector<SelectedBinding> out;for(id row in rows){id b=row[@"binding"],t=b[@"target"];SelectedBinding r;
 r.binding.network_id=str(b[@"networkId"]);r.binding.account=str(b[@"account"]);r.binding.hash=str(b[@"hash"]);r.binding.member_hash=str(b[@"memberHash"]);r.binding.operation_id=str(b[@"operationId"]);
 r.binding.target.version=uint32_t(integer(t[@"version"]));r.binding.target.service=str(t[@"service"]);r.binding.target.intent_id=optional(t[@"intentId"]);r.binding.target.merchant=optional(t[@"merchant"]);r.binding.target.invoice_id=optional(t[@"invoiceId"]);r.binding.target.request_path=str(t[@"requestPath"]);
 std::string k=str(t[@"kind"]);const char*q=nullptr,*effect=nullptr;
 if(k=="invoice_terms"){r.binding.target.kind=Kind::terms;q="get_intent";effect="post_terms";}
 else if(k=="invoice_settle"){r.binding.target.kind=Kind::settlement;q="get_invoice";effect="post_settlement";}
 else if(k=="invoice_refund"){r.binding.target.kind=Kind::refund;q="get_invoice";effect="post_refund";}else throw 1;
 id ops=row[@"operations"];if(![ops isKindOfClass:NSArray.class])throw 1;for(id op in ops){auto s=str(op);if(s==q)r.query=true;else if(s==effect)r.effect=true;else throw 1;}
 uint64_t until=integer(row[@"untilMs"]);if(until<=now)throw 1;until=std::min(until,expires);r.until=anchor+std::chrono::milliseconds(until-now);out.push_back(std::move(r));
 }return out;
}
class QualifiedPayRoot final:public OriginalRootSource {
public:
 ~QualifiedPayRoot(){if(!closed_)std::terminate();}
 int32_t current_native()noexcept override {
  int32_t first=first_.load(std::memory_order_acquire);if(first)return first;
  auto permission=std::atomic_load_explicit(&permission_,std::memory_order_acquire);
  if(retired_.load(std::memory_order_acquire)||!permission||permission->current_native()!=0||retired_.load(std::memory_order_acquire))return fail(YNX_PAY_SOURCE_DENIED);
  return 0;
 }
 bool matches_original_binding(const Binding&b,bool query)noexcept override{
  if(current_native()!=0)return false;for(const auto&r:bindings_)if(r.binding==b&&(query?r.query:r.effect)&&Clock::now()<r.until)return current_native()==0;fail(YNX_PAY_SOURCE_DENIED);return false;
 }
 int32_t full_current()noexcept{
  try{@autoreleasepool{@try{std::lock_guard<std::mutex>l(mutex_);if(current_native()!=0)return first_.load();NSError*e=nil;
   NSDictionary*ctx=[source_ copyOriginalWalletNativePayClientContext:&e];
   if(e||!ctx||![ctx[@"scope"]isEqual:context_[@"scope"]]||![ctx[@"sourceId"]isEqual:context_[@"sourceId"]]||![ctx[@"subjectOwner"]isEqual:context_[@"subjectOwner"]])return fail(YNX_PAY_SOURCE_DENIED);
   if(!postbuild_||postbuild_->current()!=root_physical::Code::ok||![source_ assertOriginalWalletNativePayClientCurrent:&e]||e)return fail(YNX_PAY_SOURCE_DENIED);
   return current_native();
  }@catch(NSException*){return fail(YNX_PAY_SOURCE_DENIED);}}}catch(...){return fail(YNX_PAY_SOURCE_DENIED);}
 }
 int32_t transport(root_physical::TransportProfile&out)noexcept{
  if(full_current()!=0)return first_.load();
  try{root_physical::TransportProfile tmp;{std::lock_guard<std::mutex>l(mutex_);if(!transport_)return fail(YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED);auto c=transport_->copy_profile(tmp);if(c!=root_physical::Code::ok||current_native()!=0)return fail(YNX_PAY_SOURCE_DENIED);
   // Exact per-slot intersection. Original registered paths never come from
   // caller Binding. The fixed target's own signed requestPath may constrain
   // an enabled effect slot, but cannot create/change that registered route.
   if(current_native()!=0)return first_.load();}
   if(full_current()!=0)return first_.load();out=std::move(tmp);return 0;
  }catch(...){return fail(YNX_PAY_SOURCE_DENIED);}
 }
 void retire()noexcept{retired_.store(true,std::memory_order_release);}
 int32_t transport_for(const Binding&b,bool query,root_physical::TransportProfile&out)noexcept{
  if(!matches_original_binding(b,query))return first_.load();root_physical::TransportProfile tmp;if(transport(tmp)!=0)return first_.load();
  try{const SelectedBinding*row=nullptr;for(const auto&r:bindings_)if(r.binding==b){row=&r;break;}if(!row)return fail(YNX_PAY_SOURCE_DENIED);
   size_t effect=b.target.kind==Kind::terms?0:b.target.kind==Kind::settlement?1:2,get=b.target.kind==Kind::terms?3:4;
   std::string query_path=b.target.kind==Kind::terms?"/v5/pay/invoice-intents/"+b.target.intent_id.value():"/v5/pay/invoices/"+b.target.merchant.value()+"/"+b.target.invoice_id.value();
   if((!query&&row->effect&&(!tmp.routes[effect].enabled||tmp.routes[effect].path!=b.target.request_path))||(row->query&&(!tmp.routes[get].enabled||tmp.routes[get].path!=query_path)))return fail(YNX_PAY_SOURCE_DENIED);
   for(size_t i=0;i<5;i++)tmp.routes[i].enabled=tmp.routes[i].enabled&&((!query&&row->effect&&i==effect)||(row->query&&i==get));
   if(!matches_original_binding(b,query))return first_.load();out=std::move(tmp);return 0;
  }catch(...){return fail(YNX_PAY_SOURCE_DENIED);}
 }
 int32_t main_locator(root_physical::RootMainLocator&out)noexcept{
  if(full_current()!=0)return first_.load();try{root_physical::RootMainLocator tmp;{std::lock_guard<std::mutex>l(mutex_);if(!postbuild_||postbuild_->copy_main_locator(tmp)!=root_physical::Code::ok)return fail(YNX_PAY_SOURCE_DENIED);}if(full_current()!=0)return first_.load();out=std::move(tmp);return 0;}catch(...){return fail(YNX_PAY_SOURCE_DENIED);}
 }
 int32_t close(bool children)noexcept{
  retire();try{@autoreleasepool{@try{std::lock_guard<std::mutex>l(mutex_);if(closed_)return close_cause_;if(children){if(!close_cause_)close_cause_=YNX_PAY_SOURCE_CLOSED;return close_cause_;}
   if(source_)[source_ retire];
   if(postbuild_){postbuild_->close();if(!postbuild_->closed()){if(!close_cause_)close_cause_=YNX_PAY_SOURCE_CLOSED;return close_cause_;}postbuild_.reset();}
   if(transport_){transport_->close();if(!transport_->closed()){if(!close_cause_)close_cause_=YNX_PAY_SOURCE_CLOSED;return close_cause_;}transport_.reset();}
   std::atomic_store_explicit(&permission_,std::shared_ptr<ynx_auth_private::PayObservedPermission>{},std::memory_order_release);NSError*e=nil;if(source_&&![source_ close:&e]){if(!close_cause_)close_cause_=YNX_PAY_SOURCE_CLOSED;return close_cause_;}source_=nil;closed_=true;return close_cause_;
  }@catch(NSException*){if(!close_cause_)close_cause_=YNX_PAY_SOURCE_CLOSED;return close_cause_;}}}catch(...){if(!close_cause_)close_cause_=YNX_PAY_SOURCE_CLOSED;return close_cause_;}
 }
 bool closed()const noexcept{std::lock_guard<std::mutex>l(mutex_);return closed_;}
private:
 QualifiedPayRoot()=default;
 int32_t fail(int32_t e)noexcept{int32_t expected=0;first_.compare_exchange_strong(expected,e,std::memory_order_acq_rel);retire();return first_.load(std::memory_order_acquire);}
 mutable std::mutex mutex_;YNXAuthIdentitySourceAuthority*__strong source_=nil;NSDictionary*__strong context_=nil;
 std::shared_ptr<ynx_auth_private::PayObservedPermission>permission_;
 std::unique_ptr<root_physical::RegisteredTransportOriginal>transport_;
 std::unique_ptr<root_physical::PayPostbuildOriginal>postbuild_;
 std::vector<SelectedBinding>bindings_;std::atomic<int32_t>first_{0};std::atomic<bool>retired_{false};bool closed_=false;int32_t close_cause_=0;
 friend RootQualificationAcquisition ynx::wallet::pay::acquire_original_pay_root_qualification()noexcept;
};
QualifiedPayRoot* original(const std::shared_ptr<OriginalRootSource>&s){return s?dynamic_cast<QualifiedPayRoot*>(s.get()):nullptr;}
}
RootQualificationAcquisition acquire_original_pay_root_qualification()noexcept{
 RootQualificationAcquisition out{{},YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED,{}};
 try{@autoreleasepool{@try{
  auto p=std::shared_ptr<QualifiedPayRoot>(new QualifiedPayRoot);out.owner=p;
  NSError*e=nil;p->source_=[YNXAuthIdentitySourceAuthority acquireOriginalWalletNativePayClientSource:&e];
  if(e||!p->source_){out.cause=e.localizedDescription.UTF8String?:"PAY_NATIVE_SOURCE_NOT_SUPPLIED";p->fail(out.error);return out;}
  p->context_=[p->source_ copyOriginalWalletNativePayClientContext:&e];
  if(e||!p->context_){out.cause=e.localizedDescription.UTF8String?:"PAY_NATIVE_SCOPE_NOT_SUPPLIED";p->fail(out.error);return out;}
  p->bindings_=selected(p->context_);
  std::string ref=str(p->context_[@"scope"][@"protectedResourceRef"]);uint64_t issued=integer(p->context_[@"issuedAtMs"]),expires=integer(p->context_[@"expiresAtMs"]);
  const void*marker=[p->source_ originalWalletNativePaySourceMarker:&e];if(e||!marker){out.cause="PAY_NATIVE_SOURCE_MARKER_NOT_CURRENT";p->fail(out.error);return out;}
  auto image=root_physical::acquire_registered_pay_postbuild_original(ref,str(p->context_[@"sourceId"]),{issued,expires},(const void*)&acquire_original_pay_root_qualification,marker);p->postbuild_=std::move(image.owner);
  if(image.error!=root_physical::Code::ok||!p->postbuild_){out.cause="PAY_NATIVE_ROOT_POSTBUILD_NOT_SUPPLIED";p->fail(out.error);return out;}
  // Permission is privately minted by Source's actual math-success path only.
  p->permission_=[p->source_ borrowOriginalWalletNativePayPermission:&e];
  if(e||!p->permission_||p->permission_->current_native()!=0){out.cause=e.localizedDescription.UTF8String?:"PAY_NATIVE_PERMISSION_NOT_CURRENT";p->fail(out.error);return out;}
  auto t=root_physical::acquire_registered_transport_original(ref,{issued,expires});p->transport_=std::move(t.owner);
  if(t.error!=root_physical::Code::ok||!p->transport_){out.cause="PAY_NATIVE_REGISTERED_TRANSPORT_NOT_SUPPLIED";p->fail(out.error);return out;}
  root_physical::TransportProfile profile;if(p->transport(profile)!=0){out.cause="PAY_NATIVE_TRANSPORT_NOT_CURRENT";p->fail(out.error);return out;}
  out.error=p->current_native();return out;
 }@catch(NSException*){out.cause="PAY_NATIVE_QUALIFICATION_EXCEPTION";if(auto*p=original(out.owner))p->fail(out.error);return out;}}}catch(...){out.cause="PAY_NATIVE_QUALIFICATION_CPP_EXCEPTION";if(auto*p=original(out.owner))p->fail(out.error);return out;}
}
int32_t recheck_original_pay_root_qualification(const std::shared_ptr<OriginalRootSource>&s)noexcept{auto*p=original(s);return p?p->full_current():YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED;}
int32_t read_original_pay_root_transport_profile(const std::shared_ptr<OriginalRootSource>&s,root_physical::TransportProfile&out)noexcept{auto*p=original(s);return p?p->transport(out):YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED;}
int32_t read_original_pay_root_transport_profile(const std::shared_ptr<OriginalRootSource>&s,const Binding&b,bool query,root_physical::TransportProfile&out)noexcept{auto*p=original(s);return p?p->transport_for(b,query,out):YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED;}
int32_t read_original_pay_root_main_locator(const std::shared_ptr<OriginalRootSource>&s,root_physical::RootMainLocator&out)noexcept{auto*p=original(s);return p?p->main_locator(out):YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED;}
void retire_original_pay_root_qualification(const std::shared_ptr<OriginalRootSource>&s)noexcept{if(auto*p=original(s))p->retire();}
int32_t close_original_pay_root_qualification(const std::shared_ptr<OriginalRootSource>&s)noexcept{auto*p=original(s);return p?p->close(s.use_count()>1):YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED;}
bool original_pay_root_qualification_closed(const std::shared_ptr<OriginalRootSource>&s)noexcept{auto*p=original(s);return p&&p->closed();}
}
