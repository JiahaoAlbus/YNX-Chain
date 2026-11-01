#pragma once
#import <Foundation/Foundation.h>
#include <memory>
#include <string>
#include "original-product-device-v4-slot-record.h"
@class YNXAuthIdentitySourceAuthority;
namespace ynx_auth_private {
class ProductDeviceV4Factory;
// Separate device-purpose existing protected slot. No key generation, import,
// namespace/path/provider injection, account/TX/BIRTH fallback or JS export.
// A returned nonnil owner with error is the SAME custody partial; retain and
// close it. Source is borrowed/retained, never closed by this slot.
class ProductDeviceV4Slot final{
 struct Impl;std::unique_ptr<Impl>impl_;
 ProductDeviceV4Slot();
 bool selectOriginalPrivateBorrow(ProductDeviceV4SlotBorrow&out,std::string&error);
 friend class ProductDeviceV4Factory;
public:
 static std::unique_ptr<ProductDeviceV4Slot>acquire(YNXAuthIdentitySourceAuthority*source,std::string&error);
 bool assertCurrent(std::string&error);
 void retire();bool close(std::string&error);
 ~ProductDeviceV4Slot();
 ProductDeviceV4Slot(const ProductDeviceV4Slot&)=delete;
 ProductDeviceV4Slot&operator=(const ProductDeviceV4Slot&)=delete;
};
}
