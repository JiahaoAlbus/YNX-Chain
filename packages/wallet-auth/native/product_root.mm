#import "original-auth-identity-source-authority.h"
#include "product_root_private.hpp"
#include "product_scope_objc_private.hpp"
#include "pay_root_main_code_private.hpp"
#include <atomic>
#include <mutex>
namespace ynx::wallet::product {
struct OriginalProductRoot::Impl {
 std::mutex mutex;
 YNXAuthIdentitySourceAuthority*__strong source=nil;
 NSDictionary*__strong original_scope=nil;
 ProductScopeDATA scope;
 std::shared_ptr<ynx::wallet::pay::OriginalPayMainCodeRoot> code_root;
 std::atomic<bool>retired{false};
 std::atomic<int32_t>first{0};
 bool closed=false,close_selected=false;
 int32_t close_error=0;
 std::string cause;
 int32_t fail(const std::string&c){int32_t expected=0;if(first.compare_exchange_strong(expected,1,std::memory_order_acq_rel))cause=c;retired.store(true,std::memory_order_release);return first.load(std::memory_order_acquire);}
 int32_t current_locked(){
  if(first.load()||retired.load()||closed)return first.load()?first.load():1;
  NSError*error=nil;
  NSDictionary*context=[source copyOriginalWalletProductContext:&error];
  if(error||!context||![context[@"scope"]isEqual:original_scope])return fail(error.localizedDescription.UTF8String?:"PRODUCT_SOURCE_SCOPE_NOT_CURRENT");
  if(!code_root||ynx::wallet::pay::original_pay_main_code_root_current(code_root)!=0||![source assertOriginalWalletProductCurrent:&error]||error)return fail("PRODUCT_SOURCE_ROOT_OR_CODE_NOT_CURRENT");
  return 0;
 }
};
OriginalProductRoot::OriginalProductRoot():impl_(std::make_unique<Impl>()){}
OriginalProductRoot::~OriginalProductRoot(){
 if(impl_&&!impl_->closed){
  impl_->retired.store(true,std::memory_order_release);
  @try{[impl_->source retire];}@catch(NSException*){}
  // No implicit Source/FD close or retry on GC/exception. Keep original
  // authority+code parent intact if physical cleanup was not confirmed.
  static auto*debt=new std::vector<std::unique_ptr<Impl>>;
  static auto*mutex=new std::mutex;
  std::lock_guard<std::mutex>lock(*mutex);debt->push_back(std::move(impl_));
 }
}
struct ProductRootAccess {
 static RootAcquisition acquire()noexcept{
  RootAcquisition result{{},1,"PRODUCT_SOURCE_NOT_SUPPLIED"};
  try{@autoreleasepool{@try{
   auto root=std::shared_ptr<OriginalProductRoot>(new OriginalProductRoot);result.owner=root;auto&s=*root->impl_;
   NSError*error=nil;s.source=[YNXAuthIdentitySourceAuthority acquireOriginalWalletProductSource:&error];
   if(error||!s.source){result.cause=error.localizedDescription.UTF8String?:"PRODUCT_SOURCE_ORIGINAL_NOT_SUPPLIED";s.fail(result.cause);return result;}
   NSDictionary*context=[s.source copyOriginalWalletProductContext:&error];
   if(error||!context){result.cause="PRODUCT_SOURCE_SCOPE_NOT_SUPPLIED";s.fail(result.cause);return result;}
   s.scope=product_scope_from_verified_projection(context[@"scope"]);s.original_scope=[context[@"scope"]copy];
   // CodeRoot is a separate mandatory CODE provenance AND only. It cannot
   // satisfy the independent Product Source constructor/math above.
   auto code=ynx::wallet::pay::acquire_original_pay_main_code_root();s.code_root=std::move(code.owner);
   if(code.error||!s.code_root){result.cause="PRODUCT_SOURCE_CODE_ROOT_NOT_SUPPLIED";s.fail(result.cause);return result;}
   result.error=s.current_locked();if(result.error)result.cause=s.cause;else result.cause.clear();return result;
  }@catch(NSException*){result.cause="PRODUCT_SOURCE_ROOT_EXCEPTION";if(result.owner)result.owner->impl_->fail(result.cause);return result;}}}catch(...){result.cause="PRODUCT_SOURCE_ROOT_CPP_EXCEPTION";if(result.owner)result.owner->impl_->fail(result.cause);return result;}
 }
 static int32_t current(const std::shared_ptr<OriginalProductRoot>&root)noexcept{
  if(!root||!root->impl_)return 1;auto&s=*root->impl_;
  try{@autoreleasepool{@try{std::lock_guard<std::mutex>lock(s.mutex);return s.current_locked();}@catch(NSException*){return s.fail("PRODUCT_SOURCE_CURRENT_EXCEPTION");}}}catch(...){return s.fail("PRODUCT_SOURCE_CURRENT_CPP_EXCEPTION");}
 }
 static int32_t scope(const std::shared_ptr<OriginalProductRoot>&root,ProductScopeDATA&out)noexcept{
  try{if(current(root)!=0)return 1;ProductScopeDATA copy;
   {std::lock_guard<std::mutex>lock(root->impl_->mutex);copy=root->impl_->scope;}
   if(current(root)!=0)return 1;out=std::move(copy);return 0;
  }catch(...){if(root&&root->impl_)root->impl_->fail("PRODUCT_SOURCE_SCOPE_COPY_FAILED");return 1;}
 }
 static int32_t borrow(const std::shared_ptr<OriginalProductRoot>&root,const std::string&operation,const ProductReference*original,std::shared_ptr<ynx_auth_private::ProductObservedPermission>&out)noexcept{
  if(out||current(root)!=0)return 1;
  auto&s=*root->impl_;
  try{@autoreleasepool{@try{
   std::lock_guard<std::mutex>lock(s.mutex);
   if(std::find(s.scope.operations.begin(),s.scope.operations.end(),operation)==s.scope.operations.end())return s.fail("PRODUCT_SOURCE_OPERATION_NOT_SELECTED");
   if(operation=="readOriginalInvoiceIntent"){
    if(!original||std::find(s.scope.products.begin(),s.scope.products.end(),*original)==s.scope.products.end())return s.fail("PRODUCT_SOURCE_ORIGINAL_NOT_SELECTED");
   }else if(original)return s.fail("PRODUCT_SOURCE_FOREIGN_REFERENCE");
   NSError*error=nil;auto permission=[s.source borrowOriginalWalletProductReadPermission:&error];
   // Retain any genuine partial permission before examining error/current.
   out=std::move(permission);
   if(error||!out||out->current_native()!=0||s.retired.load())return s.fail("PRODUCT_SOURCE_READ_PERMISSION_NOT_CURRENT");
   return 0;
  }@catch(NSException*){return s.fail("PRODUCT_SOURCE_READ_PERMISSION_EXCEPTION");}}}catch(...){return s.fail("PRODUCT_SOURCE_READ_PERMISSION_CPP_EXCEPTION");}
 }
 static void retire(const std::shared_ptr<OriginalProductRoot>&root)noexcept{if(root&&root->impl_){root->impl_->retired.store(true,std::memory_order_release);@try{[root->impl_->source retire];}@catch(NSException*){}}}
 static int32_t close(const std::shared_ptr<OriginalProductRoot>&root)noexcept{
  if(!root||!root->impl_)return 1;retire(root);auto&s=*root->impl_;
  try{@autoreleasepool{@try{std::lock_guard<std::mutex>lock(s.mutex);if(s.closed)return s.close_error;
   NSError*error=nil;if(s.source&&![s.source join:&error])return 1;
   // Source owns its physical close-once ledger; a child-held pre-close is
   // retriable drain, an uncertain selected close is never re-executed there.
   if(s.source&&![s.source closeOriginalWalletProductSource:&error]){if(!s.close_error)s.close_error=1;return s.close_error;}
   if(error&&!s.close_error)s.close_error=1; // physical drain does not erase first close cause
   if(s.code_root){auto status=ynx::wallet::pay::close_original_pay_main_code_root(s.code_root);if(!ynx::wallet::pay::original_pay_main_code_root_closed(s.code_root)){if(!s.close_error)s.close_error=status?status:1;return s.close_error;}s.code_root.reset();}
   s.source=nil;s.original_scope=nil;s.closed=true;return s.close_error;
  }@catch(NSException*){if(!s.close_error)s.close_error=1;return s.close_error;}}}catch(...){if(!s.close_error)s.close_error=1;return s.close_error;}
 }
 static bool closed(const std::shared_ptr<OriginalProductRoot>&root)noexcept{if(!root||!root->impl_)return false;std::lock_guard<std::mutex>lock(root->impl_->mutex);return root->impl_->closed;}
};
RootAcquisition acquire_original_product_root()noexcept{return ProductRootAccess::acquire();}
int32_t recheck_original_product_root(const std::shared_ptr<OriginalProductRoot>&r)noexcept{return ProductRootAccess::current(r);}
int32_t read_original_product_scope(const std::shared_ptr<OriginalProductRoot>&r,ProductScopeDATA&out)noexcept{return ProductRootAccess::scope(r,out);}
int32_t borrow_original_product_read_permission(const std::shared_ptr<OriginalProductRoot>&r,const std::string&op,const ProductReference*original,std::shared_ptr<ynx_auth_private::ProductObservedPermission>&out)noexcept{return ProductRootAccess::borrow(r,op,original,out);}
void retire_original_product_root(const std::shared_ptr<OriginalProductRoot>&r)noexcept{ProductRootAccess::retire(r);}
int32_t close_original_product_root(const std::shared_ptr<OriginalProductRoot>&r)noexcept{return ProductRootAccess::close(r);}
bool original_product_root_closed(const std::shared_ptr<OriginalProductRoot>&r)noexcept{return ProductRootAccess::closed(r);}
}
