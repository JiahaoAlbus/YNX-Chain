#pragma once
#include <cstdint>
#include <limits>
namespace ynx::mobilepq {
// Native module lifecycle identity only, never a custody/Root capability or JS
// value. Caller holds bootMutex. Never reuse an invalidated runtime's binding.
class RuntimeBinding final {
 uint64_t last_=0,current_=0;
 public:
 uint64_t acquire(){if(current_||last_==uint64_t(std::numeric_limits<int64_t>::max()))return 0;return current_=++last_;}
 bool selected(uint64_t value)const{return value&&value==current_;}
 bool alreadyClosed(uint64_t value)const{return value&&value<=last_&&value!=current_;}
 bool release(uint64_t value){if(!selected(value))return false;current_=0;return true;}
};
}
