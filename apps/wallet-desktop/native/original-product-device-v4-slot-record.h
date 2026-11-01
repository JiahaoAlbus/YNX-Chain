#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
namespace ynx_auth_private {
struct ProductDeviceV4SlotSpan{const uint8_t*bytes=nullptr;size_t length=0;};
struct ProductDeviceV4SlotBorrow{ProductDeviceV4SlotSpan registration,derA,derB,pkA,pkB;};
// Private storage frame ONLY. Does not validate KEY7 math, admit a Source or
// authorize a key use. These spans borrow the owning mutable slot buffer and
// never cross NAPI/JS/IPC. Clear every output on any failure/reused output.
inline bool borrowOriginalProductDeviceV4SlotRecord(const void*raw,size_t length,
 const void*registration,size_t registrationLength,const uint8_t*pkA,const uint8_t*pkB,
 ProductDeviceV4SlotBorrow&out)noexcept{
 out={};static const char magic[]="YNX-PRODUCT-DEVICE-PRIVATE/v4\n";
 if(!raw||!registration||!pkA||!pkB||!registrationLength||registrationLength>16384||length>24576||length<sizeof(magic)-1+4)return false;
 const auto*bytes=(const uint8_t*)raw;size_t at=sizeof(magic)-1;if(std::memcmp(bytes,magic,at))return false;
 auto take=[&](size_t exact,ProductDeviceV4SlotSpan&part){if(length-at<4)return false;uint32_t n=0;for(unsigned i=0;i<4;i++)n=(n<<8)|bytes[at++];if(n!=exact||n>length-at)return false;part={bytes+at,n};at+=n;return true;};
 ProductDeviceV4SlotBorrow b;
 if(!take(registrationLength,b.registration)||std::memcmp(b.registration.bytes,registration,registrationLength)||!take(54,b.derA)||!take(150,b.derB)||!take(2592,b.pkA)||!take(64,b.pkB)||at!=length||std::memcmp(b.pkA.bytes,pkA,2592)||std::memcmp(b.pkB.bytes,pkB,64))return false;
 out=b;return true;
}
}
