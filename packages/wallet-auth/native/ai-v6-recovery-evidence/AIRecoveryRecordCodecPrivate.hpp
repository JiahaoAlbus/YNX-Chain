#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>
namespace ynx::auth::ai::mobile {
using Bytes=std::vector<uint8_t>;
// Existing Auth implementation delegates to the original OS43 SHA256 primitive.
// Required strong implementation; this declaration supplies no algorithm/key.
std::string originalSHA256(const Bytes&);
namespace recovery {
inline constexpr size_t maxEvidenceIndexBytesV1=16384;
struct Parts {
 const Bytes &prepared,&member,&response,&receipt;
 const std::array<bool,4>present;
 Parts(const Bytes&p,const Bytes&m,const Bytes&r,const Bytes&b,std::array<bool,4>seen)
 :prepared(p),member(m),response(r),receipt(b),present(seen){}
};
// DATA only. Expected facts originate independently from the SAME journal.
// phase1 has no generated nonce yet: originalNonce==empty encodes JSON null.
// phase2..5 require the SAME original canonical 32-byte nonce, never a new one.
int32_t encodeOriginalRecordV1(const std::string&originalOperation,const std::string&originalNonce,uint32_t phase,const Parts&,Bytes&original)noexcept;
int32_t inspectOriginalRecordV1(const Bytes&original,const std::string&expectedOperation,const std::string&expectedNonce,uint32_t expectedPhase,const Parts&)noexcept;
}
}
