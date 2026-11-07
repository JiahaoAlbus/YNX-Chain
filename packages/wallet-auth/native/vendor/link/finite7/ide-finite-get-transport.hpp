#pragma once

#include "ide-finite-get-wire.hpp"
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

// PRIVATE implementation DATA, not an installed header or a Source factory.
// Only the original Auth strong-ref adapter may supply normal material/fence.
// There is no C/NAPI/JSON target, credential, PIN or callback installer here.
namespace ynx::ide_finite_get {

enum class Code : int32_t {
    ok = 0, denied = 1, bounds = 2, unavailable = 3, cancelled = 4,
    draining = 5, source_current = 6, closed = 7, protocol = 8,
    timeout = 9, tls = 10, spki = 11, redirect = 12, cleanup_unknown = 13
};

struct Failure {
    Code code = Code::ok;
    int32_t native_code = 0;
    int system_errno = 0;
    std::string message;
};

struct TrustRoot {
    std::string certificate_sha256;
    int64_t until_unix_ms = 0;
};

struct Material {
    std::string service_origin;
    std::string local_san, peer_san;
    // Borrowed ORIGINAL Native credentials. The actual Auth loan keeps both
    // FDs open until close reports physical completion; this engine never
    // closes/seeks them or resolves a pathname from an FD. No path mode.
    int client_certificate_fd = -1, client_private_key_fd = -1;
    std::string root_certificate_pem, client_certificate_sha256;
    uint64_t credential_epoch = 0;
    int64_t credential_until_unix_ms = 0;
    std::string peer_spki_sha256;
    std::vector<TrustRoot> roots;
    uint64_t policy_epoch = 0;
    std::string original_operation_id, path, proof_header;
    uint32_t timeout_ms = 5000;
    size_t max_response_body_bytes = 1U << 20;
    size_t max_response_header_bytes = 262144;
};

// The normal adapter supplies actual SAME held Source/DEVICE/request context.
// These are native, thread-safe, bounded callbacks: no JS, reentrant transport,
// or throws. No transport/owner mutex is held around any callback. Retain==0
// acquires exactly one borrow; nonzero acquires none. Release drops it once.
// An unexpected throw is UNKNOWN debt, never permission to replay a release.
struct SourceFence {
    void *context = nullptr;
    int32_t (*current)(void *) = nullptr;
    int32_t (*retain)(void *) = nullptr;
    void (*release)(void *) = nullptr;
};

struct Packet {
    wire::Response response;
    Failure failure;
    bool dispatch_possible = false;
    bool unknown = false;
    std::string peer_spki_sha256;
    std::string peer_certificate_sha256, root_certificate_sha256;
    uint64_t policy_epoch = 0;
};

struct Lifecycle {
    bool started = false, retired = false, response_ready = false;
    bool worker_joined = false, response_released = false;
    bool reaper_bookkeeping_complete = false;
    size_t source_callbacks_inflight = 0;
    bool closing = false, physical_complete = false;
    bool source_borrow_held = false, cleanup_unknown = false;
};

class RequestOwner final {
public:
    // One attempt. Adopt nonnull owner before interpreting any failure. The
    // packet/reserved storage is allocated BEFORE retain or network dispatch.
    static Code start(const Material &, const SourceFence &, std::shared_ptr<RequestOwner> &out);
    ~RequestOwner(); // no hidden IO, borrowed-parent close, or assumed drain
    RequestOwner(const RequestOwner &) = delete;
    RequestOwner &operator=(const RequestOwner &) = delete;

    Code current_local() const;
    Code current_source();
    // Wait/probe ONLY. No retry or replacement request is created. Nonnull
    // packet remains owned until release_packet, including alongside an error.
    Code wait_response(uint32_t timeout_ms, const Packet **out);
    Code release_packet(const Packet *);
    Code retire();
    Code abort() { return retire(); }
    // Retire -> actual worker join -> packet release -> close. DRAINING is
    // progress, not a sticky first cause. Uninterruptible DNS/worker work keeps
    // the original native borrow; timeout never claims it has exited.
    Code join(uint32_t timeout_ms, bool *completed);
    Code close(bool *completed);
    Failure first_error() const;
    Lifecycle lifetime() const;

private:
    struct State;
    explicit RequestOwner(std::shared_ptr<State>);
    std::shared_ptr<State> state_;
};

} // namespace ynx::ide_finite_get
