#pragma once
#import <Foundation/Foundation.h>
#include <memory>
#include <string>
#include <vector>
@class YNXAuthIdentitySourceAuthority;
namespace ynx_auth_private {
class ProductDeviceV5Transport;
struct ProductDeviceV5ProofStatusDATA {
    int32_t result; uint32_t cleanup; size_t reportedLength;
    bool primitiveCalled,terminalRecorded,mathCompleted,persistenceFailure;
};
class ProductDeviceV5Factory;
class ProductDeviceV5ProofOperation final {
    struct Impl;std::unique_ptr<Impl> impl_;
    ProductDeviceV5ProofOperation();friend class ProductDeviceV5Factory;
public:
    std::vector<unsigned char>copyOriginalMemberDATA()const;
    NSData *copyOriginalUnsignedDATA()const;
    ProductDeviceV5ProofStatusDATA copyOriginalStatusDATA()const;
    bool assertCurrent(std::string &);
    void retire();bool join(std::string &);bool close(std::string &);
    ~ProductDeviceV5ProofOperation();
    ProductDeviceV5ProofOperation(const ProductDeviceV5ProofOperation&)=delete;
    ProductDeviceV5ProofOperation&operator=(const ProductDeviceV5ProofOperation&)=delete;
};
class ProductDeviceV5Factory final {
    friend class ProductDeviceV5ProofOperation;
    static bool current(ProductDeviceV5ProofOperation&,std::string&);
public:
    // Native-only SAME captured transport and independently qualified Source.
    // No unsigned/hash/nonce/key/path/provider/expected DTO argument exists.
    // Retain any returned nonnull partial BEFORE inspecting error/current.
    static std::unique_ptr<ProductDeviceV5ProofOperation>produce(
        YNXAuthIdentitySourceAuthority*,ProductDeviceV5Transport&,std::string&);
};
}
