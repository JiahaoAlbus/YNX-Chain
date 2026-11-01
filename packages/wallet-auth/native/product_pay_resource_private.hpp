#pragma once
#include "product_root_private.hpp"
#include "pay_root_public_hold_private.hpp"
#include <memory>
namespace ynx::wallet::product {
struct ProductPayResourceProfileDATA {
 std::string resource_ref,network_id,account,epoch,origin,socket,service;
 uint32_t peer_uid=0;int32_t peer_pid=0;
 uint64_t timeout_ms=0,max_header_bytes=0,max_response_bytes=0;
 std::vector<std::string>operations;
};
struct ProductPayResourceRelease {
 std::string protected_resource_ref;
 ynx::wallet::pay::root_physical::RootPublicLocator locator;
};
inline const std::vector<ProductPayResourceRelease>&original_product_pay_resource_releases(){
#ifdef YNX_REVIEWED_PRODUCT_PAY_RESOURCE_ROWS
 static const std::vector<ProductPayResourceRelease>rows={YNX_REVIEWED_PRODUCT_PAY_RESOURCE_ROWS};
#else
 static const std::vector<ProductPayResourceRelease>rows;
#endif
 return rows;
}
class ProductPayResourceRoot final {
 struct Impl;std::unique_ptr<Impl>impl_;explicit ProductPayResourceRoot(std::unique_ptr<Impl>);
 public:~ProductPayResourceRoot();
 ProductPayResourceRoot(const ProductPayResourceRoot&)=delete;
 struct Acquisition {std::unique_ptr<ProductPayResourceRoot>owner;int32_t error;};
 // SAME genuine root; static reviewed locator only, never a caller resource,
 // path/config/URL/JSON/boolean/setter or a second Root factory.
 static Acquisition capture(const std::shared_ptr<OriginalProductRoot>&)noexcept;
 int32_t current()noexcept;
 // Bounded local observation only: no IO, owner lock or permission refresh.
 // Full current still independently reads the held record and original Root.
 int32_t current_no_io()const noexcept;
 int32_t copy_profile_DATA(ProductPayResourceProfileDATA&)noexcept;
 void retire()noexcept;
 int32_t close()noexcept;
 bool closed()const noexcept;
};
}
