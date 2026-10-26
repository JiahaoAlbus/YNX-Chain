#pragma once
#import <Foundation/Foundation.h>
#include <memory>
#include <string>
#include <vector>
@class YNXAuthIdentitySourceAuthority;
namespace ynx_auth_private {
class ProductDeviceV4Factory;
// Actual synchronous original-thread effect owner. No generic signer/provider
// or Root constructor is exported. The outer original NAPI bridge must retain
// and fence SAME held/AbortContext before/after this call; it is not optional.
class ProductDeviceV4ProofOperation final{
 struct Impl;std::unique_ptr<Impl>impl_;ProductDeviceV4ProofOperation();
 friend class ProductDeviceV4Factory;
public:
 std::vector<unsigned char>copyOriginalMemberDATA()const;
 bool assertCurrent(std::string&error);
 void retire();bool join(std::string&error);bool close(std::string&error);
 ~ProductDeviceV4ProofOperation();
 ProductDeviceV4ProofOperation(const ProductDeviceV4ProofOperation&)=delete;
 ProductDeviceV4ProofOperation&operator=(const ProductDeviceV4ProofOperation&)=delete;
};
class ProductDeviceV4Factory final{
public:
 // Source comes from the actual private owner, never caller JS/JSON. Returns
 // SAME nonnull operation partial on late error; adopt before interpreting it.
 // No key-use callback/endpoint/path/purpose/policy/RNG argument is accepted.
 static std::unique_ptr<ProductDeviceV4ProofOperation>produce(
  YNXAuthIdentitySourceAuthority*source,NSData*canonicalUnsigned21,std::string&error);
};
}
