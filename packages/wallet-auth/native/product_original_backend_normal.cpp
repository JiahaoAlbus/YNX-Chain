#include "product_original_backend_private.hpp"
#include "product_pay_binding_private.hpp"
#include "product_root_private.hpp"
#include "product_main_peer_private.hpp"
#include "product_source_permission_private.hpp"
#include <stdexcept>
namespace ynx::wallet::product::assembly_private {
namespace {
[[noreturn]]void deny(const char*c){throw std::runtime_error(c);}
class ActualPermit final:public Permit {
 std::shared_ptr<ynx_auth_private::ProductObservedPermission>original_;
 public:explicit ActualPermit(std::shared_ptr<ynx_auth_private::ProductObservedPermission>p):original_(std::move(p)){}
 void current()override{if(!original_||original_->current_native()!=0)deny("PRODUCT_ORIGINAL_PERMISSION_NOT_CURRENT");}
};
class NormalBackend final:public Backend {
 napi_env env_;std::shared_ptr<OriginalProductRoot>root_;std::unique_ptr<MainProductPeer>main_;
 ProductScopeDATA scope_;bool retired_=false;std::unique_ptr<ProductPayBinding>pay_;
 public:NormalBackend(napi_env e,std::shared_ptr<OriginalProductRoot>r):env_(e),root_(std::move(r)){}
 void initialize(napi_value owner)override{
  if(!root_||read_original_product_scope(root_,scope_)!=0)deny("PRODUCT_ORIGINAL_SAME_ROOT_NOT_CURRENT");
  MainProductPeer::capture(env_,owner,main_); // partial is retained BEFORE failure
  current();auto c=main_->read_context();
  if(c.network_id!=scope_.network_id||c.account!=scope_.account)deny("PRODUCT_ORIGINAL_MAIN_SCOPE_MISMATCH");
  current();pay_=std::make_unique<ProductPayBinding>(env_);pay_->initialize(root_,owner,*main_);
 }
 ProductScopeDATA scope()override{current();return scope_;}
 void current()override{
  if(retired_||!root_||recheck_original_product_root(root_)!=0)deny("PRODUCT_ORIGINAL_ROOT_NOT_CURRENT");
  if(!main_)deny("PRODUCT_ORIGINAL_MAIN_NOT_CAPTURED");main_->current();auto c=main_->read_context();
  if(c.network_id!=scope_.network_id||c.account!=scope_.account)deny("PRODUCT_ORIGINAL_MAIN_SCOPE_CHANGED");
 }
 std::shared_ptr<Permit>borrow(const std::string&op,const ProductReference*ref)override{
  current();std::shared_ptr<ynx_auth_private::ProductObservedPermission>p;
  // The old exact Root API's product argument belongs only to this operation.
  // Archive/product membership is independently fenced by assembly as well.
  int32_t c=borrow_original_product_read_permission(root_,op,op=="readOriginalInvoiceIntent"?ref:nullptr,p);
  auto held=std::make_shared<ActualPermit>(std::move(p)); // adopt before c
  if(c)deny("PRODUCT_ORIGINAL_ROOT_PERMISSION_DENIED");held->current();return held;
 }
 napi_value invoke(const std::string&op,size_t n,napi_value*args,napi_value guard,const ProductReference*ref)override{
  current();
  if(op=="readOriginalInvoiceIntent"||op=="readOriginalShopNativeInvoiceRequestDATA"){
   if(!ref||ref->product_id!="shop.order")deny("PRODUCT_ORIGINAL_CLOUD_INTENT_GETTER_NOT_SUPPLIED");
   napi_value id;napi_create_string_utf8(env_,ref->source_order.data(),ref->source_order.size(),&id);
   return main_->shop_original(id,guard); // actual original Main/Shop callee
  }
  if(op=="readOriginalCloudBillLocator"){
   if(!ref||ref->product_id!="cloud.ide-usage"||n!=1)deny("PRODUCT_ORIGINAL_CLOUD_REFERENCE_INVALID");
   return main_->cloud_locator(args[0],guard); // locator is NOT full intent
  }
  if(!pay_)deny("PRODUCT_ORIGINAL_PAY_READER_NOT_CAPTURED");
  return pay_->invoke(op,n,args,guard);
 }
 void retire_native_only()noexcept override{retired_=true;if(pay_)pay_->retire_native_only();}
 napi_value retire()override{retired_=true;retire_original_product_root(root_);return pay_?pay_->retire_then_main():main_?main_->retire_on_actor():nullptr;}
 napi_value join()override{return pay_?pay_->join_then_main():main_?main_->join_on_actor():nullptr;}
 napi_value close()override{return pay_?pay_->close_then_main():main_?main_->close_on_actor():nullptr;}
 Completion finish_root_close()override{
  if(pay_&&!pay_->resource_physically_closed())return{false,"PRODUCT_PAY_CHILD_CLOSE_PENDING"};
  int32_t c=close_original_product_root(root_);bool done=original_product_root_closed(root_);
  return{done,c?"PRODUCT_ORIGINAL_ROOT_CLOSE_FIRST_CAUSE":nullptr};
 }
};
}
std::unique_ptr<Backend>make_normal_backend(napi_env e,const std::shared_ptr<OriginalProductRoot>&r){
 return std::make_unique<NormalBackend>(e,r);
}
}
