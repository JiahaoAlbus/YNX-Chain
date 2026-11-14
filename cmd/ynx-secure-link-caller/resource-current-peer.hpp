#ifndef YNX_LINK_RESOURCE_CURRENT_PEER_HPP
#define YNX_LINK_RESOURCE_CURRENT_PEER_HPP
#include "resource_current_client_v1.h"
#include <array>
#include <cstdint>
#include <memory>
#include <string>

namespace ynx::resource_current_detail {
struct ProcessStart { uint32_t kind = 0; uint64_t a = 0, b = 0; };
/* Native diagnostic for trusted bootstrap/tests, never an image/Root grant. */
bool process_start(int32_t pid, ProcessStart &out, std::string &failure);
bool image_digest(const std::string &path, uint64_t &bytes, uint8_t digest[32], std::string &failure);

struct ExpectedProcess {
    uint32_t uid = 0;
    int32_t pid = 0;
    ProcessStart start{};
    std::string image_path;
    uint64_t image_bytes = 0;
    std::array<uint8_t, 32> image_sha256{};
};

// The worker owns this lease and serializes all calls. The transport retains
// the actual connected sockets until its workers have returned. The lease
// closes only its process/image descriptors.
class PeerLease final {
public:
    PeerLease();
    ~PeerLease();
    PeerLease(const PeerLease &) = delete;
    PeerLease &operator=(const PeerLease &) = delete;
    bool capture(int socket_fd, const ynx_link_resource_current_profile_v1 &profile, std::string &failure);
    bool prepare(const ExpectedProcess &expected, std::string &failure);
    // A receiver can bind the control FD received from the data peer. An
    // initiator must use the data-only form when it created the socketpair.
    bool bind(int data_fd, int received_control_fd, std::string &failure);
    bool current(int data_fd, int received_control_fd, std::string &failure);
    bool current(int socket_fd, std::string &failure);
    bool close(std::string &failure);
private:
    struct Impl;
    std::unique_ptr<Impl> state;
};
}
#endif
