#pragma once
#include <array>
#include <cstdint>
#include <string>
namespace ynx::auth::android_capture {
// Detached sole verified DATA only, never a permission/factory or JSON codec.
inline const char*source_purpose(unsigned k){return k==1?"product-session-device-provisioning-source-v4":k==2?"product-session-device-source-v4":k==3?"product-session-device-query-source-v4":
#ifdef YNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE
 k==4?"product-session-device-pending-source-v4":
#endif
 "";}
inline void normalize_identity(unsigned kind,std::array<std::string,19>&v){
 if(kind<1||kind>3||v[10]!=source_purpose(kind)||v[14].empty()||v[15].empty())throw 1;
 for(unsigned i=0;i<3;++i){if(v[11+i].empty())throw 1;if(!v[4+i].empty()&&v[4+i]!=v[11+i])throw 6;v[4+i]=v[11+i];}
}
inline bool canonical_device_generation(const std::string&s){if(s.empty()||s.size()>20||(s.size()>1&&s[0]=='0'))return false;for(char c:s)if(c<'0'||c>'9')return false;return s.size()<20||s<="18446744073709551615";}
inline bool canonical_owner(const std::string&s){if(s.size()!=42||s.substr(0,2)!="0x")return false;for(size_t i=2;i<s.size();++i)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return false;return true;}
inline void assert_same_snapshot(bool initialized,const std::array<std::string,19>&before,std::int64_t before_not_before,const std::array<std::string,19>&after,std::int64_t after_not_before){
 if(!initialized)return;if(before_not_before!=after_not_before)throw 6;
 // Previous/current watermarks (index18) may advance through sole verified
 // current; original Source/namespace/intent/DEVICE coordinates may not.
 for(size_t i=0;i<18;++i)if(before[i]!=after[i])throw 6;
}
}
