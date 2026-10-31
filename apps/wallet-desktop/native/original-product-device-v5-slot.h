#pragma once
#import <Foundation/Foundation.h>
#include <memory>
#include <string>
#include "original-product-device-v4-slot-record.h"
@class YNXAuthIdentitySourceAuthority;
namespace ynx_auth_private {
class ProductDeviceV5Factory;
// Separate V5 Source/read-lease authority. The registered V4 storage-frame
// parser below is DATA only; no V4 Source/scope/GET permission is acquired.
class ProductDeviceV5Slot final {
    struct Impl; std::unique_ptr<Impl> impl_;
    ProductDeviceV5Slot();
    friend class ProductDeviceV5Factory;
    bool selectOriginalPrivateBorrow(ProductDeviceV4SlotBorrow &,std::string &);
public:
    static std::unique_ptr<ProductDeviceV5Slot> acquire(YNXAuthIdentitySourceAuthority *,std::string &);
    bool assertCurrent(std::string &);
    void retire(); bool close(std::string &);
    ~ProductDeviceV5Slot();
    ProductDeviceV5Slot(const ProductDeviceV5Slot &)=delete;
    ProductDeviceV5Slot &operator=(const ProductDeviceV5Slot &)=delete;
};
}
