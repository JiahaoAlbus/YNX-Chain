#pragma once
#include "product-session-device-v4-once.h"
#include <memory>
namespace ynx_auth_private {
// DATA conversion stage of the original factory. This type is not a private
// Source brand, device slot or permission. Values must come from the SAME
// expected17 and retained canonical registration20 of the real current owner.
struct ProductDeviceV4ExpectedBindingDATA {
 std::string networkId,sessionBinding,registrationDigest;
};
inline std::array<unsigned char,32>deviceV4Hex32DATA(const std::string&s){
 if(s.size()!=64)throw std::runtime_error("DEVICE_V4_EXPECTED_HEX64_REQUIRED");
 auto nibble=[](char c)->unsigned{if(c>='0'&&c<='9')return(unsigned)(c-'0');if(c>='a'&&c<='f')return(unsigned)(c-'a'+10);throw std::runtime_error("DEVICE_V4_EXPECTED_LOWERCASE_HEX_REQUIRED");};
 std::array<unsigned char,32>out{};for(size_t i=0;i<32;i++)out[i]=(unsigned char)((nibble(s[2*i])<<4)|nibble(s[2*i+1]));return out;
}
inline std::unique_ptr<ProductDeviceV4Once>makeProductDeviceV4OnceFromExpectedDATA(
 HostDirfdJournal&journal,const ProductDeviceV4ExpectedBindingDATA&expected,
 const std::vector<unsigned char>&registration20Original,const std::string&nonce,
 const std::vector<unsigned char>&fixedE5){
 const auto network=deviceV4Hex32DATA(expected.networkId),session=deviceV4Hex32DATA(expected.sessionBinding),registration=deviceV4Hex32DATA(expected.registrationDigest);
 // Hash the original bytes themselves, never UUID padding, a chosen pair hash,
 // parsed/reordered JSON, registration ID, or a caller-selected substitute.
 if(registration20Original.empty()||registration20Original.size()>16384)throw std::runtime_error("DEVICE_V4_REGISTRATION_ORIGINAL_BOUND");
 std::array<unsigned char,32>actual{};
#ifdef __APPLE__
 CC_SHA256(registration20Original.data(),(CC_LONG)registration20Original.size(),actual.data());
#else
 if(!SHA256(registration20Original.data(),registration20Original.size(),actual.data()))throw std::runtime_error("DEVICE_V4_REGISTRATION_HASH_UNKNOWN");
#endif
 if(actual!=registration)throw std::runtime_error("DEVICE_V4_REGISTRATION_ORIGINAL_DIGEST_MISMATCH");
 // Canonical/schema/signature/current validation remains the original SDK49
 // inspector + actual Native Source owner's job; hash equality grants none.
 return std::make_unique<ProductDeviceV4Once>(journal,network,session,registration,nonce,fixedE5);
}
}
