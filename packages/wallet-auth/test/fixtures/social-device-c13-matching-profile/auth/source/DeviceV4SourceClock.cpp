#include "DeviceV4SourceBackendPrivate.hpp"
#include <chrono>
namespace ynx::auth::devicev4 {
uint64_t wallNow()noexcept{return uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());}
uint64_t monoNow()noexcept{return uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());}
}
