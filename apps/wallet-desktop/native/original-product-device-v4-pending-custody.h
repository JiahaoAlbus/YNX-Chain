#pragma once
#import <Foundation/Foundation.h>
#include <memory>
#include <string>
#include "original-product-device-v4-slot-record.h"
@class YNXAuthIdentitySourceAuthority;
namespace ynx_auth_private {
class ProductDeviceV4TypedProducer;
// Original device slot is borrowed, never provisioned/overwritten by a proof.
// A nonnull error partial is custody, NOT usable or automatically retryable.
class ProductDeviceV4PendingCustody final {
 struct Impl;std::unique_ptr<Impl>impl_;
 ProductDeviceV4PendingCustody();friend class ProductDeviceV4TypedProducer;
 bool borrow(ProductDeviceV4SlotBorrow&out,std::string&error);
public:
 static std::unique_ptr<ProductDeviceV4PendingCustody>acquire(YNXAuthIdentitySourceAuthority*source,std::string&error);
 bool assertCurrent(std::string&error);void retire();bool close(std::string&error);
 ~ProductDeviceV4PendingCustody();
 ProductDeviceV4PendingCustody(const ProductDeviceV4PendingCustody&)=delete;
};
}
