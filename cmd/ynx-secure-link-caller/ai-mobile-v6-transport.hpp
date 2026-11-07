#pragma once

#include "ai-mobile-v6-transport-wire.hpp"
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

// PRIVATE implementation DATA, not an installed header or a Source factory.
// Only the original Native/Auth strong-ref adapter may supply normal material/fence.
// There is no C/NAPI/JSON target, credential, PIN or callback installer here.
namespace ynx::ai_mobile_v6::physical {

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
    // Native owns serialization of these original HTTP bytes from the SAME
    // peer/context/Prepared/member. LINK never constructs 35/16/E5 or JSON.
    std::string original_operation_id, method, path, request_head_original;
    std::vector<uint8_t> request_body_original;
    size_t max_request_header_bytes = 262144;
    size_t max_request_body_bytes = 1U << 20;
    uint32_t timeout_ms = 5000;
    size_t max_response_body_bytes = 1U << 20;
    size_t max_response_header_bytes = 262144;
};

// PRIVATE fixed strong Native integration, never a callback/provider setter.
// Only the original Native inventory defines this incomplete attempt type and
// these four strong wrappers using its SAME recognized Peer/Context/Prepared
// and actual Auth target/credential loan. No weak definitions or normal
// constructor exist in LINK. The test-only implementation is compile guarded.
// Retain==0 atomically selects the SAME Native attempt for physical dispatch
// once AND adds one loan; nonzero adds none. This original inventory selection
// remains consumed after UNKNOWN/failure; it is not a reusable Source borrow.
// Current runs outside all LINK
// locks on its worker, so the Native wrapper must be bounded/thread-safe and
// actor-free. Full Auth Source checks remain with the original Native actor.
// Release is cleanup-only, called once after actual transport/packet drain;
// an exception means UNKNOWN retained debt and is never retried.
// read_original_material copies DATA only after retain. It must return SAME
// original request bytes and SAME independently Auth-selected target/profile;
// no request/response field is a Root/Source/approval constructor.
namespace native_loan {
struct OriginalAttempt;
int32_t retain_original(OriginalAttempt *);
int32_t read_original_material(OriginalAttempt *, Material &);
int32_t current_before_write(OriginalAttempt *);
void release_after_physical_join(OriginalAttempt *);
}

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
    // One attempt, with no caller material/header/URL parameter. Only the SAME
    // retained Native attempt supplies the original bytes and Auth target DATA.
    // Adopt nonnull owner before interpreting failure. All packet/reserved
    // storage is allocated before network dispatch; failed getters/allocations
    // retain their partial native loan until explicit physical cleanup.
    static Code start(native_loan::OriginalAttempt *, std::shared_ptr<RequestOwner> &out);
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

} // namespace ynx::ai_mobile_v6::physical
