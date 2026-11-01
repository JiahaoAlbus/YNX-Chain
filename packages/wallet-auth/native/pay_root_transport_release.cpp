#include "pay_root_transport_release_private.hpp"
#include "pay_root_postbuild_private.hpp"
#include <mutex>
#include <vector>
namespace ynx::wallet::pay::root_physical {
namespace {
struct StableOriginalPin {std::string parent,leaf;Identity parent_identity,original_identity;std::string sha256;uint64_t maximum_bytes;};
struct ReleasedResource {std::string ref;StableOriginalPin original;};
const std::vector<ReleasedResource>& original_transport_resources(){
 // Only an independently reviewed SOURCE release may change this literal.
 // A file's existence, Root0 ownership, signed scope Ref or caller input cannot
 // populate it. No macro/environment/runtime public provider is consulted.
 static const std::vector<ReleasedResource> released={};
 return released;
}
}
RegisteredTransportOriginal::RegisteredTransportOriginal(std::string r,std::unique_ptr<PublicOriginalHold>h):held_(std::move(h)),ref_(std::move(r)){}
RegisteredTransportOriginal::~RegisteredTransportOriginal()=default;
Code RegisteredTransportOriginal::current()noexcept{std::lock_guard<std::mutex>l(mutex_);if(!held_)return Code::not_supplied;Code c=held_->current();return first_==Code::ok?c:first_;}
Code RegisteredTransportOriginal::copy_profile(TransportProfile&out)noexcept{
 std::lock_guard<std::mutex>l(mutex_);if(!held_)return Code::not_supplied;if(first_!=Code::ok)return first_;Code c=read_pay_transport_original_v1(*held_,ref_,out);if(c!=Code::ok)first_=c;return c;
}
void RegisteredTransportOriginal::retire()noexcept{std::lock_guard<std::mutex>l(mutex_);if(held_)held_->retire();}
Code RegisteredTransportOriginal::close()noexcept{std::lock_guard<std::mutex>l(mutex_);Code c=held_?held_->close():Code::ok;return first_==Code::ok?c:first_;}
bool RegisteredTransportOriginal::closed()const noexcept{std::lock_guard<std::mutex>l(mutex_);return !held_||held_->closed();}
RegisteredTransportAcquisition acquire_registered_transport_original(const std::string&ref,OriginalReadWindow window)noexcept{
 RegisteredTransportAcquisition out{nullptr,Code::not_supplied};
 try{
  if(ref.empty()||ref.size()>256)return out;
  const ReleasedResource*selected=nullptr;
  for(const auto&row:original_transport_resources())if(row.ref==ref){if(selected){out.error=Code::identity;return out;}selected=&row;}
  if(!selected)return out;
  out.owner=std::unique_ptr<RegisteredTransportOriginal>(new RegisteredTransportOriginal(ref,nullptr));
  const auto&p=selected->original;
  auto h=hold_original({p.parent,p.leaf,p.parent_identity,p.original_identity,p.sha256,window.not_before_ms,window.expires_ms,p.maximum_bytes});
  out.owner->held_=std::move(h.owner);
  out.error=h.error;if(out.error!=Code::ok||!out.owner)return out;
  TransportProfile ignored;out.error=out.owner->copy_profile(ignored);return out;
 }catch(...){out.error=Code::io;return out;}
}
PostbuildAcquisition acquire_registered_pay_postbuild_original(const std::string&ref,const std::string&source,OriginalReadWindow window,const void*entry,const void*marker)noexcept{
 const ReleasedResource*selected=nullptr;for(const auto&r:original_transport_resources())if(r.ref==ref){if(selected)return{nullptr,Code::identity};selected=&r;}
 if(!selected)return{nullptr,Code::not_supplied};
 return capture_pay_postbuild_original({selected->original.parent,"wallet-native-pay-postbuild.public.json",selected->original.parent_identity,window.not_before_ms,window.expires_ms,4194304},ref,source,entry,marker);
}
}
