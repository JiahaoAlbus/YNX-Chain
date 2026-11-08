#include "PendingReviewOwner.h"
#include <array>
#include <cstring>
#include <limits>
#include <unistd.h>
namespace ynx::mobilepq::android_pending {
namespace {
using Span=ynx_auth_android_provision_bytes_v1;
constexpr uint32_t origin=0x4e50454e;
Failure local(int32_t code){return{1,code,origin,0};}
bool valid(Failure f){return f.present<=1&&(f.present||(!f.code&&!f.origin&&!f.platform_code));}
Failure checked(Failure f){return valid(f)?f:local(2);}
bool inside(Span s,const std::vector<uint8_t>&storage,size_t max,bool nullable=false){
 if(s.length>max)return false;if(!s.bytes)return nullable&&!s.length;
 auto lo=reinterpret_cast<uintptr_t>(storage.data()),at=reinterpret_cast<uintptr_t>(s.bytes);
 return at>=lo&&s.length<=storage.size()&&at-lo<=storage.size()-s.length;
}
std::array<Span,22>fields(const Review&v){return{{v.scope_original,v.registration_original,v.request_original,v.challenge_original,v.pending_id,v.registration_digest,v.request_digest,v.approval_digest,v.source_id,v.instance_id,v.source_generation,v.stable_device_identity,v.device_generation,v.account,v.product_id,v.client_id,v.application_id,v.bundle_id,v.package_id,v.origin,v.callback,v.device_id}};}
// Explicit exact fields, including nullable/present-empty distinction. Never
// reconstruct or parse scope.expected JSON, registration, policy or Source.
bool sameSpan(Span a,Span b){return a.length==b.length&&bool(a.bytes)==bool(b.bytes)&&(!a.length||!std::memcmp(a.bytes,b.bytes,a.length));}
bool shape(const Review&v,const std::vector<uint8_t>&s){
 if(v.version!=1||v.size!=sizeof(v)||v.kind<1||v.kind>2||v.reserved||v.app_reserved||(v.null_mask&~3u)||v.not_before_ms<0||v.expires_at_ms<=v.not_before_ms)return false;
 for(auto x:fields(v))if(!inside(x,s,65536,true))return false;
 if(!v.scope_original.length||v.scope_original.length>65536||!v.registration_original.length||v.registration_original.length>16384||!v.request_original.length||v.request_original.length>16384||v.challenge_original.length>16384||(v.kind==1&&v.challenge_original.length)||(v.kind==2&&!v.challenge_original.length))return false;
 for(auto x:{v.pending_id,v.registration_digest,v.approval_digest})if(x.length!=64)return false;
 if(v.request_digest.length&&v.request_digest.length!=64)return false;
 for(auto x:{v.source_id,v.instance_id,v.source_generation,v.device_generation,v.account,v.product_id,v.client_id,v.application_id,v.callback,v.device_id})if(!x.bytes||!x.length||x.length>2048)return false;
 if(!v.origin.bytes||v.origin.length>2048||v.stable_device_identity.length>2048)return false;
 if(v.null_mask&1){if(v.bundle_id.bytes||v.bundle_id.length)return false;}else if(!v.bundle_id.bytes||v.bundle_id.length>2048)return false;
 if(v.null_mask&2){if(v.package_id.bytes||v.package_id.length)return false;}else if(!v.package_id.bytes||v.package_id.length>2048)return false;
 return true;
}
bool sameReview(const Review&a,const Review&b){
 if(a.version!=b.version||a.size!=b.size||a.kind!=b.kind||a.null_mask!=b.null_mask||a.not_before_ms!=b.not_before_ms||a.expires_at_ms!=b.expires_at_ms||std::memcmp(a.network,b.network,32)||std::memcmp(a.canonical_owner,b.canonical_owner,42)||std::memcmp(a.device_pk_a,b.device_pk_a,2592)||std::memcmp(a.device_pk_b,b.device_pk_b,64))return false;
 auto as=fields(a),bs=fields(b);for(size_t i=0;i<as.size();++i)if(!sameSpan(as[i],bs[i]))return false;return true;
}
}
PendingReviewOwner::PendingReviewOwner(Source*s):pid_(getpid()),uid_(geteuid()),gid_(getegid()),actor_(std::this_thread::get_id()),source_(s){}
bool PendingReviewOwner::sameActor()const noexcept{return pid_==getpid()&&uid_==geteuid()&&gid_==getegid()&&actor_==std::this_thread::get_id();}
Failure PendingReviewOwner::remember(Failure f)noexcept{f=checked(f);if(f.present&&!first_.present)first_=f;return first_;}
Failure PendingReviewOwner::acquire(Source*s,std::shared_ptr<PendingReviewOwner>&out)noexcept{
 if(out||!s)return local(2);try{out=std::shared_ptr<PendingReviewOwner>(new PendingReviewOwner(s));return out->capture();}catch(...){return out?out->remember(local(8)):local(8);}
}
Failure PendingReviewOwner::localFence()const noexcept{
 if(!sameActor())return local(6);if(first_.present)return first_;
 return retired_.load(std::memory_order_acquire)?local(7):Failure{};
}
Failure PendingReviewOwner::capture()noexcept{
 auto gate=localFence();if(gate.present)return gate;
 try{Failure f{};
  gate=localFence();if(gate.present)return gate;
  ynx_auth_android_pending_source_current_v1(source_,&f);
  if(checked(f).present)return remember(f);gate=localFence();if(gate.present)return gate;
  storage_.resize(262144);gate=localFence();if(gate.present)return gate;
  ynx_auth_android_pending_source_copy_review_v1(source_,storage_.data(),storage_.size(),&review_,&f);
  // Keep original returned storage/DATA even on a late original failure. No
  // private authority is published through data left alongside firstFailure.
  // Preserve the foreign paired failure before observing concurrent retire.
  if(checked(f).present)return remember(f);gate=localFence();if(gate.present)return gate;
  if(!shape(review_,storage_))return remember(local(2));captured_=true;
  gate=localFence();if(gate.present)return gate;
  ynx_auth_android_pending_source_current_v1(source_,&f);
  if(checked(f).present)return remember(f);return localFence();
 }catch(...){return remember(local(8));}
}
Failure PendingReviewOwner::current()noexcept{
 auto gate=localFence();if(gate.present)return gate;if(!captured_)return local(7);
 try{Failure f{};
  gate=localFence();if(gate.present)return gate;
  ynx_auth_android_pending_source_current_v1(source_,&f);
  if(checked(f).present)return remember(f);gate=localFence();if(gate.present)return gate;
  std::vector<uint8_t>storage(262144);Review value{};gate=localFence();if(gate.present)return gate;
  ynx_auth_android_pending_source_copy_review_v1(source_,storage.data(),storage.size(),&value,&f);
  if(checked(f).present)return remember(f);gate=localFence();if(gate.present)return gate;
  if(!shape(value,storage)||!sameReview(review_,value))return remember(local(3));
  gate=localFence();if(gate.present)return gate;
  ynx_auth_android_pending_source_current_v1(source_,&f);
  if(checked(f).present)return remember(f);return localFence();
 }catch(...){return remember(local(8));}
}
Failure PendingReviewOwner::requireIndependentApproval()noexcept{
 auto f=current();if(f.present)return f;
 try{approvalStorage_.resize(1048576);Span approval{},policy{};auto gate=localFence();if(gate.present)return gate;
  ynx_auth_android_pending_source_copy_user_approval_v1(source_,approvalStorage_.data(),approvalStorage_.size(),&approval,&policy,&f);
  if(checked(f).present)return remember(f);gate=localFence();if(gate.present)return gate;
  if(!inside(approval,approvalStorage_,196608)||!approval.length||!inside(policy,approvalStorage_,524288)||!policy.length)return remember(local(2));
  return current();
 }catch(...){return remember(local(8));}
}
Failure PendingReviewOwner::selectPrivateBorrowOnce()noexcept{
 auto gate=localFence();if(gate.present)return gate;if(borrowSelected_)return local(9);
 auto f=requireIndependentApproval();if(f.present)return f;
 gate=localFence();if(gate.present)return gate;borrowSelected_=true;
 // Do not undo the once latch if retire races with it. Actual pair production
 // must additionally check its own current immediately before private entry.
 return localFence();
}
const Review*PendingReviewOwner::originalReviewForNative()const noexcept{return sameActor()&&captured_&&!first_.present&&!retired_.load(std::memory_order_acquire)?&review_:nullptr;}
Failure PendingReviewOwner::firstFailureForNative()const noexcept{return sameActor()?first_:local(6);}
}
