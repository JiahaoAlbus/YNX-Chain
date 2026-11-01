#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
namespace ynx::auth::android_ordinary {
struct Failure:std::exception{int32_t code;explicit Failure(int32_t v):code(v){}const char*what()const noexcept override{return "AUTH_ANDROID_ORDINARY_REJECTED";}};
inline void wipe(uint8_t*p,size_t n){volatile uint8_t*v=p;while(n--)*v++=0;}
struct Secret{
 std::vector<uint8_t> bytes;
 explicit Secret(size_t n=0):bytes(n){}
 Secret(const Secret&)=delete;Secret&operator=(const Secret&)=delete;
 Secret(Secret&&s)noexcept:bytes(std::move(s.bytes)){}
 ~Secret(){wipe(bytes.data(),bytes.size());}
};
struct PublicBinding{std::string canonical;std::vector<uint8_t> network,owner,pkA,pkB;};
struct OpenedBackup{PublicBinding binding;Secret keys;};
// Fixed Android JCE body; no caller-selected provider/algorithm/round count.
// Only Native owns password/derived/plaintext bytes; never exposed to JS.
Secret decryptOriginalBackup(const Secret&password,const std::vector<uint8_t>&salt,const std::vector<uint8_t>&nonce,const std::string&aad,const std::vector<uint8_t>&ciphertext);
OpenedBackup decodeOriginalBackup(const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t);
}
