#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
// Local opaque custody storage layout used by original Main's CONTROL adapter.
// Not KEY7 provenance, cryptography, a role or permission. CABI validates DER.
namespace ynx_auth_private {
struct ControlKeyRecordSpan{const std::uint8_t*bytes=nullptr;std::size_t length=0;};
struct ControlKeyRecordView{ControlKeyRecordSpan derA,derB,pkA,pkB;};
inline bool inspectOriginalControlKeyRecord(const void*raw,std::size_t length,ControlKeyRecordView&out)noexcept{
 out={};constexpr char magic[]="YNX-PROJECT-CONTROL-CUSTODY/v1\n";if(!raw||length>4096||length<sizeof(magic)-1+16)return false;
 auto*p=static_cast<const std::uint8_t*>(raw);std::size_t at=sizeof(magic)-1;if(std::memcmp(p,magic,at))return false;
 ControlKeyRecordView v;ControlKeyRecordSpan*fields[]={&v.derA,&v.derB,&v.pkA,&v.pkB};constexpr std::size_t limits[]={54,150,2592,64};
 for(unsigned i=0;i<4;i++){if(length-at<4)return false;std::uint32_t n=0;for(unsigned k=0;k<4;k++)n=(n<<8)|p[at++];if(n!=limits[i]||n>length-at)return false;*fields[i]={p+at,n};at+=n;}if(at!=length)return false;out=v;return true;
}
}
