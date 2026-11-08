#include "ShopClientOwner.hpp"
#include "ShopProofLoan.hpp"
#include "ShopProofCarrierPrivate.h"
#include <algorithm>
#include <limits>
namespace ynx::auth::shop {
namespace {
constexpr int Invalid=74101,Pending=74102,Malformed=74103,Internal=74104;
Status error(int n,bool unknown=false)noexcept{return {1,n,unknown?1u:0u,0};}
Status checked(Status s,bool cleanup=false)noexcept {
 if(s.error_present>1||s.unknown>1||s.physical_done>1||(!cleanup&&s.physical_done)||(!s.error_present&&s.first_code!=0))return error(Malformed,true);
 return s;
}
void first(Status&to,Status s)noexcept{if(ok(to)&&!ok(s))to=s;}
bool order(const std::string&s)noexcept{if(s.size()<3||s.size()>128)return false;for(std::size_t i=0;i<s.size();++i){const auto c=static_cast<unsigned char>(s[i]);if(!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||(i&&(c=='.'||c=='_'||c==':'||c=='-'))))return false;}return true;}
bool span(ynx_auth_shop_span_v1 v,std::size_t max,bool empty=false)noexcept{return v.length<=max&&(v.length?v.bytes!=nullptr:empty);}
void copySpan(ynx_auth_shop_span_v1 s,std::vector<unsigned char>&out){if(s.length)out.assign(s.bytes,s.bytes+s.length);else out.clear();}
}
bool ok(Status s)noexcept{return !s.error_present&&!s.unknown&&s.first_code==0;}
Status denied()noexcept{return error(Invalid);}
bool Client::sameActor(void*e)const noexcept{return e&&e==env_&&actor_==std::this_thread::get_id();}
Status Client::remember(Status s)noexcept{std::lock_guard<std::mutex>lock(mutex_);first(first_,checked(s,true));return first_;}
std::shared_ptr<Client>Client::acquire(void*env,Status&r)noexcept{
 std::shared_ptr<Client>p;
 try{
  if(!env){r=denied();return {};}
  p=std::shared_ptr<Client>(new Client(env));
  const auto acquired=ynx_auth_shop_original_client_acquire_v1();
  p->source_=acquired.owner; // adopt before interpreting presence/code0
  r=checked(acquired.status);if(ok(r)&&!p->source_)r=error(Malformed,true);
  if(!ok(r)){p->remember(r);return p;}
  r=checked(ynx_auth_shop_original_client_current_v1(p->source_));
  if(!ok(r)){p->remember(r);return p;}
  const auto session=ynx_wallet_shop_session_acquire_for_source_v1(env,p->source_);
  p->session_=session.owner; // Main partial belongs here even on falsy first cause
  r=checked(session.status);if(ok(r)&&!p->session_)r=error(Malformed,true);
  if(ok(r))r=p->current(env);
  if(!ok(r))p->remember(r);
  return p;
 }catch(...){r=error(Internal,true);if(p)p->remember(r);return p;}
}
Status Client::local()noexcept{
 if(retired_.load(std::memory_order_acquire)||!source_||!session_)return denied();
 return checked(ynx_wallet_shop_session_current_local_v1(session_,source_));
}
Status Client::current(void*env)noexcept{
 if(!sameActor(env))return denied();
 {std::lock_guard<std::mutex>lock(mutex_);if(!ok(first_))return first_;}
 auto r=local();if(ok(r))r=checked(ynx_wallet_shop_session_current_actor_v1(env_,session_,source_));
 if(ok(r))r=checked(ynx_auth_shop_original_client_current_v1(source_));
 if(ok(r))r=checked(ynx_wallet_shop_session_current_actor_v1(env_,session_,source_));
 if(ok(r))r=local();
 if(!ok(r)){remember(r);retired_.store(true,std::memory_order_release);}
 return r;
}
Status Client::scope(void*env,std::vector<unsigned char>&out)noexcept{
 auto r=current(env);if(!ok(r))return r;
 try{ynx_auth_shop_span_v1 s{};r=checked(ynx_auth_shop_original_client_scope_v1(source_,&s));if(!ok(r))return remember(r);if(!span(s,32768))return remember(error(Malformed));std::vector<unsigned char>copy;copySpan(s,copy);r=current(env);if(ok(r))out.swap(copy);return r;}catch(...){return remember(error(Internal,true));}
}
Status Client::begin(void*env,const std::string&id)noexcept{
 if(!order(id))return denied();auto r=current(env);if(!ok(r))return r;
 r=checked(ynx_wallet_shop_session_current_order_actor_v1(env_,session_,source_,{reinterpret_cast<const uint8_t*>(id.data()),id.size()}));if(!ok(r))return remember(r);
 r=current(env);if(!ok(r))return r;
 {std::lock_guard<std::mutex>lock(mutex_);if(retired_.load()||pending_>=8||sourceCloseSelected_)return error(Pending);
 if(std::find(pendingOrders_.begin(),pendingOrders_.end(),id)!=pendingOrders_.end()||std::none_of(proofs_.begin(),proofs_.end(),[](const auto&p){return!p;}))return error(Pending);
 try{for(auto&slot:pendingOrders_)if(slot.empty()){slot=id;++pending_;break;}}catch(...){return error(Internal);}}
 // Reserved child blocks reentrant parent close across actual Main/SDK work.
 auto proof=ProofLoan::capture(env_,session_,source_,id,r);
 {std::lock_guard<std::mutex>lock(mutex_);if(proof){for(auto&slot:proofs_)if(!slot){slot=proof;break;}for(size_t i=0;i<pendingOrders_.size();++i)if(pendingOrders_[i]==id){pendingProofs_[i]=proof;break;}}}
 if(ok(r)&&!proof)r=error(Internal,true);if(ok(r))r=current(env);if(ok(r))r=proof->actor(env);
 if(!ok(r)){abandon(id);return remember(r);}return {};
}
void Client::abandon(const std::string&id)noexcept{std::lock_guard<std::mutex>lock(mutex_);for(size_t i=0;i<pendingOrders_.size();++i)if(pendingOrders_[i]==id){pendingOrders_[i].clear();pendingProofs_[i].reset();if(pending_)--pending_;return;}}
std::shared_ptr<Response>Client::read(const std::string&id,Status&r)noexcept{
 std::shared_ptr<Response>out;std::shared_ptr<ProofLoan>proof;bool accounted=false;
 try{if(!order(id)){r=denied();return {};}
 {std::lock_guard<std::mutex>lock(mutex_);for(size_t i=0;i<pendingOrders_.size();++i)if(pendingOrders_[i]==id){proof=pendingProofs_[i];break;}if(!proof){r=denied();return {};}}
 out=std::shared_ptr<Response>(new Response(shared_from_this()));out->proof_=proof;r=local();if(ok(r))r=proof->local();
 if(ok(r)){auto token=proof->beginBorrow(source_,r);struct End{std::shared_ptr<ProofLoan>p;bool active;~End(){if(active)p->endBorrow();}}end{proof,token!=nullptr};if(ok(r)&&token)r=checked(ynx_auth_shop_original_client_read_with_proof_v1(source_,reinterpret_cast<uint8_t*>(const_cast<char*>(id.data())),id.size(),token,&out->raw_));if(ok(r)&&!out->raw_)r=error(Malformed,true);}
 {std::lock_guard<std::mutex>lock(mutex_);for(size_t i=0;i<pendingOrders_.size();++i)if(pendingOrders_[i]==id){pendingOrders_[i].clear();pendingProofs_[i].reset();if(pending_)--pending_;break;}++responses_;accounted=true;}
 first(out->first_,r);first(out->first_,proof->local());first(out->first_,local());r=out->first_;if(!ok(r))remember(r);return out;
 }catch(...){r=error(Internal,true);remember(r);abandon(id);if(out){first(out->first_,r);if(!accounted){std::lock_guard<std::mutex>lock(mutex_);++responses_;}}return out;}
}
Status Client::retire(void*env)noexcept{
 if(!sameActor(env))return denied();
 retired_.store(true,std::memory_order_release);
 if(retireSelected_)return retireResult_;
 retireSelected_=true;
 std::array<std::shared_ptr<ProofLoan>,16>loans;{std::lock_guard<std::mutex>lock(mutex_);loans=proofs_;}
 Status r{};for(auto&p:loans)if(p)first(r,p->retire());if(session_)first(r,checked(ynx_wallet_shop_session_retire_v1(session_)));
 if(source_)first(r,checked(ynx_auth_shop_original_client_retire_v1(source_)));
 retireResult_=r;if(!ok(r))remember(r);return r;
}
Status Client::join(void*env)noexcept{
 if(!sameActor(env))return denied();
 retire(env);
 {std::lock_guard<std::mutex>lock(mutex_);if(pending_||responses_)return error(Pending);}
 auto proofs=drainProofs();if(!proofs.physical_done)return proofs;
 // bounded native poll, never block the JS actor behind a worker completion
 auto r=source_?checked(ynx_auth_shop_original_client_join_v1(source_,1),true):Status{};
 if(!r.physical_done&&source_)return r;
 std::lock_guard<std::mutex>lock(mutex_);auto result=first_;result.physical_done=1;return result;
}
Status Client::close(void*env)noexcept{
 if(!sameActor(env))return denied();
 retire(env);
 {std::lock_guard<std::mutex>lock(mutex_);if(pending_||responses_)return error(Pending);}
 auto proofs=drainProofs();if(!proofs.physical_done)return proofs;
 // Only pre-selection pending can progress. A selected physical UNKNOWN is
 // cached forever, never reissued by another JS close/finalizer.
 if(!sessionCloseSelected_){sessionCloseSelected_=true;sessionClose_=session_?checked(ynx_wallet_shop_session_close_v1(session_),true):Status{0,0,0,1};sessionDone_=sessionClose_.physical_done;remember(sessionClose_);}
 if(!sessionDone_)return sessionClose_;
 if(!sessionReleased_){if(!sessionReleaseSelected_){sessionReleaseSelected_=true;sessionRelease_=session_?checked(ynx_wallet_shop_session_release_closed_v1(session_),true):Status{0,0,0,1};remember(sessionRelease_);}if(!sessionRelease_.physical_done){auto s=sessionRelease_;s.unknown=1;return s;}sessionReleased_=true;session_=nullptr;}
 if(!sourceCloseSelected_){auto j=source_?checked(ynx_auth_shop_original_client_join_v1(source_,1),true):Status{0,0,0,1};if(!j.physical_done)return j;sourceCloseSelected_=true;sourceClose_=source_?checked(ynx_auth_shop_original_client_close_v1(source_),true):Status{0,0,0,1};sourceDone_=sourceClose_.physical_done;remember(sourceClose_);}
 if(!sourceDone_)return sourceClose_;
 if(!sourceReleased_){if(!sourceReleaseSelected_){sourceReleaseSelected_=true;sourceRelease_=source_?checked(ynx_auth_shop_original_client_release_closed_v1(source_),true):Status{0,0,0,1};remember(sourceRelease_);}if(!sourceRelease_.physical_done){auto s=sourceRelease_;s.unknown=1;return s;}sourceReleased_=true;source_=nullptr;}
 std::lock_guard<std::mutex>lock(mutex_);auto r=first_;r.physical_done=1;return r;
}
Client::~Client()=default;
Status Client::drainProofs()noexcept{std::array<std::shared_ptr<ProofLoan>,16>loans;{std::lock_guard<std::mutex>lock(mutex_);loans=proofs_;}for(auto&p:loans)if(p){auto r=p->close();if(!ok(r))remember(r);if(!r.physical_done)return r;std::lock_guard<std::mutex>lock(mutex_);for(auto&slot:proofs_)if(slot==p)slot.reset();}auto r=remember({});r.physical_done=1;return r;}
bool Client::cleanupSelected()const noexcept{if(sessionCloseSelected_||sourceCloseSelected_)return true;for(auto&p:proofs_)if(p&&p->cleanupSelected())return true;return false;}
bool Response::cleanupSelected()const noexcept{return released_||(!transportReleased_&&releaseSelected_)||(proof_&&proof_->cleanupSelected());}
Custody Client::custody()const noexcept{Custody c;c.selected=cleanupSelected();c.physicalDone=physicallyDone();if(c.physicalDone)return c;c.unknown=(sessionCloseSelected_&&!sessionDone_)||(sourceCloseSelected_&&!sourceDone_)||(sessionReleaseSelected_&&!sessionReleased_)||(sourceReleaseSelected_&&!sourceReleased_);std::lock_guard<std::mutex>lock(mutex_);for(auto&p:proofs_)if(p&&p->cleanupSelected()&&!p->done())c.unknown=true;return c;}
Custody Response::custody()const noexcept{Custody c;c.selected=cleanupSelected();c.physicalDone=released_;c.unknown=!released_&&((!transportReleased_&&releaseSelected_)||(proof_&&proof_->cleanupSelected()&&!proof_->done()));return c;}
Status Response::copy(void*env,Transport&out)noexcept{
 if(!parent_||!parent_->sameActor(env))return denied();
 if(releaseSelected_||!ok(first_))return ok(first_)?denied():first_;
 auto r=parent_->current(env);if(!ok(r))return r;if(!proof_)return denied();if(!ok(r=proof_->actor(env)))return r;
 try{ynx_auth_shop_transport_v1 raw{};raw.version=1;raw.size=sizeof(raw);r=checked(ynx_auth_shop_original_response_copy_v1(raw_,&raw));if(!ok(r)){first(first_,r);return r;}
  if(raw.version!=1||raw.size!=sizeof(raw)||raw.status_code!=200||!span(raw.method,8)||!span(raw.path,256)||!span(raw.content_type,128)||!span(raw.body_original,1<<20))return first_=error(Malformed);
  Transport copy;copy.status=raw.status_code;copySpan(raw.method,copy.method);copySpan(raw.path,copy.path);copySpan(raw.content_type,copy.contentType);copySpan(raw.body_original,copy.body);
  r=parent_->current(env);if(ok(r))r=proof_->actor(env);if(!ok(r)){first(first_,r);return r;}out=std::move(copy);return {};
 }catch(...){first(first_,error(Internal,true));return first_;}
}
Status Response::release(void*env)noexcept{
 if(!parent_||!parent_->sameActor(env))return denied();if(released_){auto r=first_;r.physical_done=1;return r;}
 if(!transportReleased_){
 if(releaseSelected_)return release_;releaseSelected_=true;release_=raw_?checked(ynx_auth_shop_original_response_release_v1(raw_),true):Status{0,0,0,1};
 if(raw_&&!release_.physical_done&&!release_.unknown){uint32_t pending=0;auto probe=checked(ynx_auth_shop_original_response_drain_pending_v1(raw_,&pending));if(ok(probe)&&pending==1){releaseSelected_=false;return release_;}if(!ok(probe))first(first_,probe);}
 first(first_,release_);if(!release_.physical_done){if(release_.unknown){parent_->remember(first_);parent_->retired_.store(true);}return release_;}transportReleased_=true;raw_=nullptr;
 }
 // Proof/Source parent remains held through the SAME physical transport ACK.
 auto cleanup=proof_?proof_->close():Status{0,0,0,1};if(!cleanup.physical_done){auto r=ok(first_)?cleanup:first_;r.unknown|=cleanup.unknown;r.physical_done=0;if(r.unknown){parent_->remember(r);parent_->retired_.store(true);}return r;}first(first_,cleanup);
 released_=true;{std::lock_guard<std::mutex>lock(parent_->mutex_);if(proof_)for(auto&slot:parent_->proofs_)if(slot==proof_)slot.reset();if(parent_->responses_)--parent_->responses_;}
 auto r=first_;r.physical_done=1;return r;
}
Response::~Response()=default;
}
