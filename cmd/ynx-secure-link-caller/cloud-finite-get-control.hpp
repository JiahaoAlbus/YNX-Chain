#ifndef YNX_LINK_CLOUD_FINITE_GET_CONTROL_HPP
#define YNX_LINK_CLOUD_FINITE_GET_CONTROL_HPP

#include "resource-current-peer.hpp"
#include <chrono>
#include <optional>
#include <vector>

namespace ynx::cloud_finite_get_detail {

// Local identities from the fixed Cloud request owner and its same opaque loan.
// The caller retains both strong owners through independent Auth/remote drain.
// No field here grants admission or represents a serializable closure receipt.
struct OriginalBinding {
    std::shared_ptr<const void> request;
    std::shared_ptr<const void> loan;
    std::array<uint8_t, 32> channel_sha256{}, proof_sha256{};
};

struct ControlFailure {
    std::string detail;
    int system_error = 0;
};

struct ControlLifetime {
    bool descriptor_received = false;
    bool peer_bound = false;
    bool original_bound = false;
    bool read_selected = false;
    bool read_complete = false;
    bool write_selected = false;
    bool write_complete = false;
    bool retired = false;
    bool local_closed = false;
    bool close_unknown = false;
    int close_error = 0;
};

// One serialized native worker owns this object. It borrows the HTTP data FD,
// duplicates it for observation, and exclusively adopts the received control
// FD. Before starting the HTTP reader, the caller must select this as the sole
// SCM reader. Bind the same accepted HTTP request and SDK loan after parsing.
// The caller remains responsible for its original HTTP FD and closure witness.
// Keep the observation duplicate only through final control I/O, then close it
// before waiting for original HTTP/socket teardown. No other worker may read
// the control stream or close these duplicates.
// Frame bytes and the original marker are DATA for the eventual SDK codec.
// Complete I/O and local closure alone cannot acknowledge remote Auth cleanup.
class Control final {
public:
    using Deadline = std::chrono::steady_clock::time_point;
    static constexpr size_t max_frame_bytes = 65536;

    Control();
    ~Control();
    Control(const Control &) = delete;
    Control &operator=(const Control &) = delete;

    bool receive_descriptor(int data_fd, const resource_current_detail::ExpectedProcess &expected, Deadline deadline, uint8_t &marker);
    bool bind_original(const OriginalBinding &binding);
    bool current(const OriginalBinding &binding);
    bool read_frame(const OriginalBinding &binding, size_t size, Deadline deadline, std::vector<uint8_t> &original);
    bool write_frame(const OriginalBinding &binding, const std::vector<uint8_t> &original, Deadline deadline, size_t &written);
    void retire();
    bool close();
    ControlLifetime lifetime() const;
    const std::optional<ControlFailure> &first_failure() const;

private:
    struct Impl;
    std::unique_ptr<Impl> state;
};
}

#endif
