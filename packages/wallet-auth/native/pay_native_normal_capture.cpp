#include "pay_native_producer_private.hpp"
#include "pay_native_main_peer_private.hpp"
#include "pay_native_namespace_bootstrap_private.hpp"
#include "pay_native_actual_context_private.hpp"
#include "pay_native_channel_private.hpp"
#include "pay_root_qualification_private.hpp"
#include "private_client_startup_v1.h"

namespace ynx::wallet::pay {
namespace {
void checked(int32_t status,const char*code){if(status)throw Failure{std::string(code)+"_"+std::to_string(status)};}
napi_value resolved(napi_env e){napi_value p,v;napi_deferred d;napi_create_promise(e,&d,&p);napi_get_undefined(e,&v);napi_resolve_deferred(e,d,v);return p;}
// Actual normal composition, not an installable provider. No key opens,
// signing, registration effect, HTTP endpoint or caller-selected Root exists.
class NormalPayLoan final:public ActorProtectedLoan {
 Binding binding_;bool query_;std::shared_ptr<MainNativeEpoch>epoch_;
 std::shared_ptr<OriginalRootSource>root_;
 std::unique_ptr<MainPeerLoan>main_;
 ynx_wallet_pay_actual_context_v1*context_=nullptr;
 ynx_link_pay_native_startup_v1*startup_=nullptr;
 ynx_wallet_pay_source_lease_v1*source_=nullptr;
 std::unique_ptr<QualifiedPayChannel>channel_;
 std::vector<uint8_t>member_,envelope_;
 std::atomic<bool>retired_{false};bool native_closed_=false;
public:
 NormalPayLoan(const Binding&binding,bool query,std::shared_ptr<MainNativeEpoch>epoch):binding_(binding),query_(query),epoch_(std::move(epoch)){}
 void initialize(napi_env e,napi_value request,napi_value original,napi_value target,napi_value sameOwner){
  validate_binding(binding_);MainNamespaceBorrow ns;
  checked(borrow_initialized_original_main_namespace(e,ns),"PAY_NATIVE_MAIN_NAMESPACE_NOT_CURRENT");
  if(!epoch_||!epoch_->bind_namespace_parent(ns.epoch))throw Failure{"PAY_NATIVE_NAMESPACE_EPOCH_NOT_CURRENT"};
  auto qualification=acquire_original_pay_root_qualification();root_=std::move(qualification.owner);
  if(qualification.error||!root_)throw Failure{qualification.cause.empty()?"PAY_NATIVE_OPERATIONAL_ROOT_NOT_SUPPLIED":qualification.cause};
  if(!root_->matches_original_binding(binding_,query_))throw Failure{"PAY_NATIVE_ROOT_BINDING_MISMATCH"};
  try{MainPeerLoan::capture(e,ns.original,request,original,target,epoch_,&main_);main_->associate_original_native_owner(sameOwner);main_->claim_original_child();}
  catch(...){if(main_&&main_->partial())napi_throw(e,main_->original_failure());throw;}
  member_=main_->member();envelope_=main_->envelope();
  // Actual context independently captures its OWN matching Root transport.
  checked(capture_original_pay_actual_context(root_,epoch_,binding_,query_,&context_),"PAY_NATIVE_ACTUAL_CONTEXT");
  // Both outputs become members before status interpretation. Strong LINK
  // symbols are mandatory; archive is the sole combined Go runtime.
  auto opened=ynx_link_pay_native_startup_open_v1(context_,&startup_);checked(opened,"PAY_NATIVE_GO_STARTUP");
  if(!startup_)throw Failure{"PAY_NATIVE_GO_STARTUP_NULL"};
  auto adopted=ynx_link_pay_native_startup_adopt_source_v1(startup_,&source_);checked(adopted,"PAY_NATIVE_GO_SOURCE_ADOPT");
  if(!source_)throw Failure{"PAY_NATIVE_SOURCE_NULL"};
  ynx_wallet_capture_original_pay_channel_v1(&binding_,query_,source_,&channel_);
  if(!channel_)throw Failure{"PAY_NATIVE_CHANNEL_NULL"};
  checked(recheck_original_pay_root_qualification(root_),"PAY_NATIVE_ROOT_POST_CAPTURE");main_->assert_actor_current();current();
 }
 Binding read_original()const override{return binding_;}
 bool query_only()const noexcept override{return query_;}
 ProtectedPurpose protected_purpose()const noexcept override{return query_?ProtectedPurpose::pay_query:binding_.target.kind==Kind::terms?ProtectedPurpose::invoice_terms:binding_.target.kind==Kind::settlement?ProtectedPurpose::invoice_settlement:ProtectedPurpose::invoice_refund;}
 std::vector<uint8_t>read_original_member()const override{return member_;}
 std::vector<uint8_t>read_original_envelope()const override{return envelope_;}
 void current()override{if(retired_.load(std::memory_order_acquire)||!context_||!source_||!channel_||!epoch_->current())throw Failure{"PAY_NATIVE_NORMAL_NOT_CURRENT"};checked(ynx_wallet_pay_ctx_current_v1(context_),"PAY_NATIVE_CONTEXT_NOT_CURRENT");checked(ynx_wallet_pay_source_lease_current_v1(source_),"PAY_NATIVE_SOURCE_NOT_CURRENT");channel_->current();}
 void recheck()override{throw Failure{"PAY_NATIVE_ORIGINAL_ACTOR_RECHECK_REQUIRED"};}
 napi_value recheck_on_actor(napi_env)override{current();checked(recheck_original_pay_root_qualification(root_),"PAY_NATIVE_ROOT_RECHECK");channel_->recheck();return main_->recheck_actor();}
 void confirm_recheck_on_actor(napi_env)override{checked(recheck_original_pay_root_qualification(root_),"PAY_NATIVE_ROOT_POST_RECHECK");main_->assert_actor_current();channel_->recheck();current();}
 Exchange exchange(Operation op)override{current();return channel_->exchange(op,binding_,method(op)=="POST"?member_:std::vector<uint8_t>{});}
 void retire()override{epoch_->retire();retired_.store(true,std::memory_order_release);if(context_)ynx_wallet_pay_ctx_retire_v1(context_);if(startup_)ynx_link_pay_native_startup_retire_v1(startup_);if(channel_)channel_->retire();if(root_)retire_original_pay_root_qualification(root_);}
 void join()override{if(!retired_)throw Failure{"PAY_NATIVE_RETIRE_REQUIRED"};if(channel_)channel_->join();
  // Go parent Join CANNOT run yet: Source registration borrow is deliberately
  // retained until channel Close and original Source drop in native close.
 }
 void close()override{if(native_closed_)return;if(!retired_)throw Failure{"PAY_NATIVE_RETIRE_REQUIRED"};if(channel_)channel_->close();
  if(source_){auto*source=source_;ynx_wallet_pay_source_lease_drop_v1(source);if(!ynx_wallet_pay_source_lease_drained_v1(source))throw Failure{"PAY_NATIVE_REGISTRATION_RELEASE_UNKNOWN"};source_=nullptr;}
  if(startup_){checked(ynx_link_pay_native_startup_join_v1(startup_,30000),"PAY_NATIVE_GO_JOIN_RETAINED");auto status=ynx_link_pay_native_startup_close_v1(startup_);if(!ynx_link_pay_native_startup_closed_v1(startup_))checked(status?status:1,"PAY_NATIVE_GO_CLOSE_UNKNOWN");checked(status,"PAY_NATIVE_GO_CLOSE_FIRST_CAUSE");checked(ynx_link_pay_native_startup_free_v1(startup_),"PAY_NATIVE_GO_FREE_RETAINED");startup_=nullptr;}
  if(context_){auto status=ynx_wallet_pay_ctx_close_v1(context_);if(!ynx_wallet_pay_ctx_closed_v1(context_))checked(status?status:1,"PAY_NATIVE_CONTEXT_CLOSE_RETAINED");checked(status,"PAY_NATIVE_CONTEXT_CLOSE_FIRST_CAUSE");context_=nullptr;}
  if(root_){checked(close_original_pay_root_qualification(root_),"PAY_NATIVE_ROOT_CLOSE_RETAINED");if(!original_pay_root_qualification_closed(root_))throw Failure{"PAY_NATIVE_ROOT_CLOSE_UNKNOWN"};root_.reset();}native_closed_=true;
 }
 napi_value joined_on_actor(napi_env e)override{return main_?main_->join_actor():resolved(e);}
 napi_value closed_on_actor(napi_env e)override{return main_?main_->close_actor():resolved(e);}
 void confirm_actor_settled_on_actor(napi_env e,bool closed)override{if(closed&&main_)main_->acknowledge_closed_actor();ActorProtectedLoan::confirm_actor_settled_on_actor(e,closed);}
};
}
}
extern "C" void ynx_wallet_capture_original_pay_loan_v1(napi_env e,napi_value request,napi_value original,napi_value target,napi_value owner,const std::shared_ptr<ynx::wallet::pay::MainNativeEpoch>*epoch,const ynx::wallet::pay::Binding*binding,bool query,std::unique_ptr<ynx::wallet::pay::ProtectedLoan>*out){using namespace ynx::wallet::pay;if(!out||*out||!binding||!epoch||!*epoch)throw Failure{"PAY_NATIVE_NORMAL_CAPTURE_ARGUMENT"};auto loan=std::make_unique<NormalPayLoan>(*binding,query,*epoch);auto*same=loan.get();*out=std::move(loan);same->initialize(e,request,original,target,owner);}
