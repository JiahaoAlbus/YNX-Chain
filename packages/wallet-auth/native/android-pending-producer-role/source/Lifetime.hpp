#pragma once
// Private mechanical lifecycle only. No Root, Source or approval constructor.
#include <cstdint>
#include <chrono>
#include <limits>
namespace ynx::auth::android_device_provisioning {
class Window{
 std::int64_t issued_=0,expires_=0,floor_=0,anchor_wall_=0,anchor_mono_=0,maximum_=30000;bool captured_=false,invalid_=false;
public:
 explicit Window(std::int64_t maximum=30000):maximum_(maximum){}
 static std::int64_t wall()noexcept{return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
 static std::int64_t mono()noexcept{return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
 bool check(std::int64_t issued,std::int64_t expires,std::int64_t now,std::int64_t monotonic)noexcept{
  if(invalid_)return false;
  if(!captured_){if(issued<0||expires<=issued||(maximum_>0&&expires-issued>maximum_)||now<issued||now>=expires||monotonic<0){invalid_=true;return false;}issued_=issued;expires_=expires;floor_=anchor_wall_=now;anchor_mono_=monotonic;captured_=true;}
  if(issued!=issued_||expires!=expires_||now<floor_||now<issued_||now>=expires_||monotonic<anchor_mono_||monotonic-anchor_mono_>=expires_-anchor_wall_){invalid_=true;return false;}floor_=now;return true;
 }
 bool current(std::int64_t issued,std::int64_t expires)noexcept{return check(issued,expires,wall(),mono());}
};
}
