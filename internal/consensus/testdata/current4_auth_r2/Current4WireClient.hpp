#pragma once
#include "network-consent-policy-current-wire-v1.h"
#include <array>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <vector>

namespace ynx::auth::current4 {
// Internal transport ONLY. The normal inherited-FD owner must first bind the
// actual original peer and principal. Never export this constructor to JS/C ABI.
// It adopts one connected FD, never opens a path/socket/URL, duplicates it,
// starts a process or retries. Destroying transport is NOT remote child drain.
struct Reply {
 int32_t code=0; bool error_present=false,owner_present=false,physical_complete=false;
 uint64_t height=0; std::array<uint8_t,42> owner{}; std::vector<uint8_t> policy;
};
class WireClient final {
public:
 using Deadline=std::chrono::steady_clock::time_point;
 WireClient(int originalOwnedFD,Deadline originalDeadline);
 ~WireClient();
 WireClient(const WireClient&)=delete; WireClient&operator=(const WireClient&)=delete;
 bool capture(const std::array<uint8_t,32>&network,const std::array<uint8_t,42>&owner,Reply&out);
 bool read(uint64_t capacity,Reply&out);
 bool current(Reply&out); bool retire(Reply&out); bool join(Reply&out); bool close(Reply&out);
 bool unknown()const; bool remoteOwnerDebt()const;
private:
 bool exchange(uint8_t op,const std::vector<uint8_t>&body,Reply&out);
 bool io(bool writing,uint8_t*data,size_t count);
 bool fail();
 int fd_=-1; Deadline deadline_,io_deadline_,cleanup_deadline_{}; mutable std::mutex mu_;
 uint64_t next_=1; bool capture_entered_=false,captured_=false,unknown_=false,owner_=false,closed_=false,acquisition_possible_=false,denied_=false;
 std::array<uint8_t,42> selected_owner_{};
};
}
