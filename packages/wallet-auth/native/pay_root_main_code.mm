#include "pay_root_main_code_private.hpp"
#include "pay_native_source_code_marker_private.hpp"
#include <atomic>
#include <mutex>
#include <unistd.h>
#include <chrono>
#include <vector>
namespace ynx::wallet::pay {
namespace {
struct CodeRelease {uint64_t process_uid;std::string ref,source_id,parent;root_physical::Identity parent_identity;};
const std::vector<CodeRelease>& original_main_code_releases(){
 // Independent reviewed code release only; no account/Binding/op/grant needed
 // to capture the actual already-admitted Main module's code namespace.
 static const std::vector<CodeRelease> released={};return released;
}
uint64_t wall(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
}
class OriginalPayMainCodeRoot final {
public:
 ~OriginalPayMainCodeRoot(){if(!closed_)std::terminate();}
 int32_t current()noexcept{std::lock_guard<std::mutex>l(mutex_);if(retired_||closed_||first_)return first_?first_:1;if(!postbuild_||postbuild_->reobserve_code_only()!=root_physical::Code::ok){first_=1;retired_=true;return first_;}return 0;}
 int32_t locator(root_physical::RootMainLocator&out,bool loader=false)noexcept{std::lock_guard<std::mutex>l(mutex_);if(retired_||closed_||first_)return first_?first_:1;if(!postbuild_||(loader?postbuild_->copy_node_loader_code_locator(out):postbuild_->copy_main_code_locator(out))!=root_physical::Code::ok){first_=1;retired_=true;return first_;}return 0;}
 void retire()noexcept{std::lock_guard<std::mutex>l(mutex_);retired_=true;}
 int32_t close(bool children)noexcept{std::lock_guard<std::mutex>l(mutex_);retired_=true;if(closed_)return close_cause_;if(children){if(!close_cause_)close_cause_=5;return close_cause_;}if(postbuild_){postbuild_->close();if(!postbuild_->closed()){if(!close_cause_)close_cause_=5;return close_cause_;}postbuild_.reset();}closed_=true;return close_cause_;}
 bool closed()const noexcept{std::lock_guard<std::mutex>l(mutex_);return closed_;}
private:
 OriginalPayMainCodeRoot()=default;mutable std::mutex mutex_;std::unique_ptr<root_physical::PayPostbuildOriginal>postbuild_;bool retired_=false,closed_=false;int32_t first_=0,close_cause_=0;
 friend MainCodeRootAcquisition acquire_original_pay_main_code_root()noexcept;
};
MainCodeRootAcquisition acquire_original_pay_main_code_root()noexcept{
 MainCodeRootAcquisition r{{},3,"PAY_NATIVE_CODE_ROOT_NOT_SUPPLIED"};try{
  if(getuid()!=geteuid()||getgid()!=getegid())return r;
  const CodeRelease*selected=nullptr;for(const auto&row:original_main_code_releases())if(row.process_uid==getuid()){if(selected){r.cause="PAY_NATIVE_CODE_RELEASE_AMBIGUOUS";return r;}selected=&row;}
  if(!selected)return r;
  auto p=std::shared_ptr<OriginalPayMainCodeRoot>(new OriginalPayMainCodeRoot);r.owner=p;
  // This is a new bounded read-only CODE observation, NOT Source current or
  // account authority and cannot extend/revive an existing operational grant.
  auto now=wall();auto a=root_physical::capture_pay_postbuild_original({selected->parent,"wallet-native-pay-postbuild.public.json",selected->parent_identity,now,now+5000,4194304},selected->ref,selected->source_id,(const void*)&acquire_original_pay_main_code_root,ynx_auth_private::original_wallet_pay_source_code_marker());p->postbuild_=std::move(a.owner);
  if(a.error!=root_physical::Code::ok||!p->postbuild_){p->first_=1;p->retired_=true;r.error=1;r.cause="PAY_NATIVE_CODE_POSTBUILD_NOT_CURRENT";return r;}
  r.error=p->current();if(!r.error)r.cause.clear();return r;
 }catch(...){r.error=1;r.cause="PAY_NATIVE_CODE_CAPTURE_EXCEPTION";if(r.owner)r.owner->retire();return r;}
}
int32_t original_pay_main_code_root_current(const std::shared_ptr<OriginalPayMainCodeRoot>&p)noexcept{return p?p->current():3;}
int32_t read_original_pay_main_code_locator(const std::shared_ptr<OriginalPayMainCodeRoot>&p,root_physical::RootMainLocator&out)noexcept{return p?p->locator(out):3;}
int32_t read_original_pay_main_code_node_loader_locator(const std::shared_ptr<OriginalPayMainCodeRoot>&p,root_physical::RootMainLocator&out)noexcept{return p?p->locator(out,true):3;}
void retire_original_pay_main_code_root(const std::shared_ptr<OriginalPayMainCodeRoot>&p)noexcept{if(p)p->retire();}
int32_t close_original_pay_main_code_root(const std::shared_ptr<OriginalPayMainCodeRoot>&p)noexcept{return p?p->close(p.use_count()>1):3;}
bool original_pay_main_code_root_closed(const std::shared_ptr<OriginalPayMainCodeRoot>&p)noexcept{return p&&p->closed();}
}
