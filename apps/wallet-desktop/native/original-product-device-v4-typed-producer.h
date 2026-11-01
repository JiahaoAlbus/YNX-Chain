#pragma once
#import <Foundation/Foundation.h>
#include <memory>
#include <string>
#include <vector>
#include "original-product-device-v4-pending-once.h"
@class YNXAuthIdentitySourceAuthority;
namespace ynx_auth_private {
struct ProductDeviceV4TypedStatusDATA{int32_t result;uint32_t cleanup;size_t reportedLength;bool entered,mathCompleted,recoveredOriginal;};
class ProductDeviceV4TypedOperation final {
 struct Impl;std::unique_ptr<Impl>impl_;ProductDeviceV4TypedOperation();friend class ProductDeviceV4TypedProducer;
public:
 std::vector<uint8_t>copyOriginalMemberDATA()const;ProductDeviceV4TypedStatusDATA copyOriginalStatusDATA()const;
 bool assertCurrent(std::string&error);void retire();bool join(std::string&error);bool close(std::string&error);
 ~ProductDeviceV4TypedOperation();
 ProductDeviceV4TypedOperation(const ProductDeviceV4TypedOperation&)=delete;
};
class ProductDeviceV4TypedProducer final {
 static std::unique_ptr<ProductDeviceV4TypedOperation>produce(YNXAuthIdentitySourceAuthority*,ProductDeviceV4TypedKind,std::string&);
public:
 // No raw message, JSON, purpose, provider, key, approval boolean or path input.
 // Same Source independently selects all originals. Nonnil+error is custody.
 static std::unique_ptr<ProductDeviceV4TypedOperation>registration(YNXAuthIdentitySourceAuthority*s,std::string&e){return produce(s,ProductDeviceV4TypedKind::registration,e);}
 static std::unique_ptr<ProductDeviceV4TypedOperation>challenge(YNXAuthIdentitySourceAuthority*s,std::string&e){return produce(s,ProductDeviceV4TypedKind::challenge,e);}
};
}
