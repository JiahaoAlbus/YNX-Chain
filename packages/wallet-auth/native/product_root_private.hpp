#pragma once
#include "product_root_contract_private.hpp"
#include <memory>
namespace ynx_auth_private {class ProductObservedPermission;}
namespace ynx::wallet::product {
class OriginalProductRoot final {
 struct Impl;
 std::unique_ptr<Impl> impl_;
 OriginalProductRoot();
 friend struct ProductRootAccess;
 public:
 ~OriginalProductRoot();
 OriginalProductRoot(const OriginalProductRoot&)=delete;
 OriginalProductRoot&operator=(const OriginalProductRoot&)=delete;
};
struct RootAcquisition {std::shared_ptr<OriginalProductRoot>owner;int32_t error;std::string cause;};
RootAcquisition acquire_original_product_root()noexcept;
int32_t recheck_original_product_root(const std::shared_ptr<OriginalProductRoot>&)noexcept;
int32_t read_original_product_scope(const std::shared_ptr<OriginalProductRoot>&,ProductScopeDATA&)noexcept;
int32_t borrow_original_product_read_permission(const std::shared_ptr<OriginalProductRoot>&,const std::string&operation,const ProductReference*original,std::shared_ptr<ynx_auth_private::ProductObservedPermission>&out)noexcept;
void retire_original_product_root(const std::shared_ptr<OriginalProductRoot>&)noexcept;
int32_t close_original_product_root(const std::shared_ptr<OriginalProductRoot>&)noexcept;
bool original_product_root_closed(const std::shared_ptr<OriginalProductRoot>&)noexcept;
}
