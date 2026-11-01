#pragma once
#include "original-auth-identity-native-release.h"
#include "product_root_contract_private.hpp"
namespace ynx::wallet::product {
struct ProductSourceRelease {
 ynx_auth_private::NativeSourceRelease source;
 std::string application_id,product_id,platform,resource_directory;
 uint64_t uid=0;
};
inline const std::vector<ProductSourceRelease>& original_product_source_releases(){
 // Independently reviewed compile-time typed inputs only. The source table
 // is intentionally empty. No ENV, runtime row setter, JSON boolean, WPC row,
 // CodeRoot, public fixture or service DATA can populate this authority.
#ifdef YNX_REVIEWED_PRODUCT_SOURCE_ROWS
 static const std::vector<ProductSourceRelease> rows={YNX_REVIEWED_PRODUCT_SOURCE_ROWS};
#else
 static const std::vector<ProductSourceRelease> rows;
#endif
 return rows;
}
}
