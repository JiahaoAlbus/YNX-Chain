#pragma once
// The SAME libsodium primitive already linked by Main's fixed collector.
// No replacement SHA implementation, verifier, crypto provider or new library.
#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
extern "C" {
int crypto_hash_sha256(unsigned char*,const unsigned char*,unsigned long long);
std::size_t crypto_hash_sha256_statebytes(void);
int crypto_hash_sha256_init(void*);
int crypto_hash_sha256_update(void*,const unsigned char*,unsigned long long);
int crypto_hash_sha256_final(void*,unsigned char*);
}
namespace ynx::auth::android_capture {
inline bool digest_shape(const char*s){if(!s)return false;for(size_t i=0;i<64;++i){char c=s[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;}return s[64]=='\0';}
inline std::string digest_text(const std::array<unsigned char,32>&v){constexpr char hex[]="0123456789abcdef";std::string out;out.reserve(64);for(auto b:v){out+=hex[b>>4];out+=hex[b&15];}return out;}
inline std::string original_sha256(const std::string&v){std::array<unsigned char,32>d{};if(crypto_hash_sha256(d.data(),reinterpret_cast<const unsigned char*>(v.data()),v.size()))throw 3;return digest_text(d);}
class OriginalSHA256Stream final{
 std::vector<std::max_align_t>state_;bool finished_=false;
public:
 OriginalSHA256Stream(){auto n=crypto_hash_sha256_statebytes();if(!n||n>4096)throw 3;state_.resize((n+sizeof(std::max_align_t)-1)/sizeof(std::max_align_t));if(crypto_hash_sha256_init(state_.data()))throw 3;}
 OriginalSHA256Stream(const OriginalSHA256Stream&)=delete;
 void update(const unsigned char*p,size_t n){if(finished_||crypto_hash_sha256_update(state_.data(),p,n))throw 3;}
 std::string finish(){if(finished_)throw 3;finished_=true;std::array<unsigned char,32>d{};if(crypto_hash_sha256_final(state_.data(),d.data()))throw 3;return digest_text(d);}
};
}
