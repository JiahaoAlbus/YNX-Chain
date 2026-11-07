#include "ide_finite_get_transport_v1.h"
#include "ide_finite_get_finish_private_v1.h"
#include "ide-finite-get-transport.hpp"
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <climits>
#include <memory>
#include <mutex>
#include <new>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
#include <unistd.h>

// These private handles expose no constructors, target setters or callbacks.
// Inventory lookup precedes every dereference, including packet identities.
struct ynx_link_ide_finite_get_v4_client {};
struct ynx_link_ide_finite_get_v4_packet {};
namespace {
using ynx::ide_finite_get::Code;
using ynx::ide_finite_get::Failure;
using ynx::ide_finite_get::Material;
using ynx::ide_finite_get::Packet;
using ynx::ide_finite_get::RequestOwner;
using ynx::ide_finite_get::SourceFence;
constexpr size_t maximum_clients = 16;
int32_t number(Code code) { return static_cast<int32_t>(code); }

struct Loan final {
    ynx_auth_ide_finite_get_ticket_v1 *ticket = nullptr;
    ynx_auth_ide_finite_get_loan_v1 *value = nullptr;
    std::atomic<int32_t> first_auth{0};
    std::atomic<bool> worker_borrow{false}, release_unknown{false};
    bool base_released = false, freed = false;
    void remember(int32_t code) { if (code) { int32_t zero = 0;first_auth.compare_exchange_strong(zero, code); } }
};
int32_t source_current(void *context) {
    auto &loan = *static_cast<Loan *>(context);
    const int32_t code = ynx_auth_ide_finite_get_prewrite_current_v1(loan.value);
    loan.remember(code);return code;
}
int32_t source_retain(void *context) {
    auto &loan = *static_cast<Loan *>(context);
    const int32_t code = ynx_auth_ide_finite_get_loan_retain_v1(loan.value);
    loan.remember(code);if (!code) loan.worker_borrow.store(true);return code;
}
void source_release(void *context) {
    auto &loan = *static_cast<Loan *>(context);
    uint8_t released = 0;
    const int32_t code = ynx_auth_ide_finite_get_loan_release_v1(loan.value, &released);
    loan.remember(code);
    // The original claim still owns its independent base reference. A failed
    // or surprising acknowledgement is preserved, never released a second time.
    if (code || released) {
        loan.release_unknown.store(true);
        throw std::runtime_error("original Auth worker-borrow release unknown");
    }
    loan.worker_borrow.store(false);
}
struct Record final {
    ynx_link_ide_finite_get_v4_client *handle = nullptr;
    ynx_link_ide_finite_get_v4_packet *packet_handle = nullptr;
    Loan loan;
    std::shared_ptr<RequestOwner> owner;
    const Packet *packet = nullptr;
    const pid_t pid = ::getpid();
    std::mutex mutex;
    Failure failure;
    std::string failure_view;
    int32_t auth_failure = 0;
    size_t calls = 1;
    bool opening = true, close_running = false, closed = false, packet_released = false, open_unknown = false;
    bool finish_running = false, response_observed = false, response_known = false;
    void remember(Code code, const char *message, int32_t auth = 0) {
        if (code == Code::ok || code == Code::draining) return;
        const Failure earlier = owner ? owner->first_error() : Failure{};
        std::lock_guard<std::mutex> lock(mutex);
        if (failure.code == Code::ok) {
            failure = earlier.code == Code::ok ? Failure{code, 0, 0, message} : earlier;
            auth_failure = earlier.code == Code::ok ? auth : loan.first_auth.load();
        }
    }
};
std::mutex inventory_mutex;
std::unordered_map<const ynx_link_ide_finite_get_v4_client *, std::shared_ptr<Record>> inventory;
// Addresses are process-lifetime identities, not recyclable Record addresses.
// Keep only the two tiny tokens after free; large responses and Auth custody
// are still destroyed. Both allocation and maximum identity memory are bounded.
struct Identity final { ynx_link_ide_finite_get_v4_client client;ynx_link_ide_finite_get_v4_packet packet; };
constexpr size_t identities_per_block = 4096, maximum_identity_blocks = 4096;
using IdentityBlock = std::array<Identity, identities_per_block>;
std::vector<std::unique_ptr<IdentityBlock>> identity_blocks;
size_t issued_identities = 0;
Identity *allocate_identity_locked() {
    if (issued_identities == identities_per_block * maximum_identity_blocks) return nullptr;
    const size_t block = issued_identities / identities_per_block, at = issued_identities % identities_per_block;
    if (!at) identity_blocks.push_back(std::make_unique<IdentityBlock>());
    ++issued_identities;return &(*identity_blocks[block])[at];
}
struct Call final {
    std::shared_ptr<Record> record;
    explicit Call(const ynx_link_ide_finite_get_v4_client *handle) {
        std::lock_guard<std::mutex> index(inventory_mutex);
        const auto found = inventory.find(handle);
        if (found == inventory.end() || found->second->pid != ::getpid()) return;
        record = found->second;std::lock_guard<std::mutex> lock(record->mutex);++record->calls;
    }
    ~Call() { if (record) { std::lock_guard<std::mutex> lock(record->mutex);--record->calls; } }
    Call(const Call &) = delete;
    Call &operator=(const Call &) = delete;
};
Code ready(const std::shared_ptr<Record> &record) {
    if (!record) return Code::denied;
    std::lock_guard<std::mutex> lock(record->mutex);
    return record->opening || record->close_running || record->finish_running ? Code::draining : record->closed ? Code::closed : Code::ok;
}
std::string copy(ynx_auth_ide_get_bytes_v1 value, size_t maximum) {
    if (!value.data || !value.size || value.size > maximum) throw std::invalid_argument("original Auth field bound");
    return {reinterpret_cast<const char *>(value.data), value.size};
}
std::string hash(const uint8_t *bytes) {
    static const char digits[] = "0123456789abcdef";std::string out(64, '0');
    for (size_t i = 0; i < 32; ++i) { out[2*i] = digits[bytes[i] >> 4];out[2*i+1] = digits[bytes[i] & 15]; }
    return out;
}
ynx_link_ide_get_bytes_v1 view(const std::string &value) {
    return {reinterpret_cast<const uint8_t *>(value.data()), value.size()};
}
Failure observed(const std::shared_ptr<Record> &record) {
    Failure failure;
    { std::lock_guard<std::mutex> lock(record->mutex);failure = record->failure; }
    if (failure.code == Code::ok && record->owner) failure = record->owner->first_error();
    return failure;
}
Material material(const ynx_auth_ide_finite_get_view_v1 &target,
                  const ynx_auth_ide_finite_get_credential_view_v1 &credential) {
    if (target.version != 1 || target.size != sizeof(target) || target.reserved0 ||
        credential.version != 1 || credential.size != sizeof(credential) || !target.port ||
        !credential.registered_root_epoch || !credential.registered_credential_epoch ||
        credential.registered_root_until_unix_ms > INT64_MAX || credential.registered_credential_until_unix_ms > INT64_MAX)
        throw std::invalid_argument("original Auth native profile/version unavailable");
    // FullRef is independently Source-qualified by Auth; LINK never promotes
    // these five DATA members into target/session permission.
    for (const auto member : {target.registered_cloud.realm, target.registered_cloud.tenant, target.registered_cloud.kind,
                             target.registered_cloud.id, target.registered_cloud.revision}) (void)copy(member, 4096);
    Material out;out.service_origin = copy(target.service_origin, 512);
    const std::string server = copy(target.server_name, 253);
    const std::string canonical = "https://" + server + (target.port == 443 ? "" : ":" + std::to_string(target.port));
    if (out.service_origin != canonical) throw std::invalid_argument("original target origin/server/port mismatch");
    out.local_san = copy(credential.local_san, 253);out.peer_san = copy(credential.peer_san, 253);
    if (out.peer_san != server) throw std::invalid_argument("original target peer SAN mismatch");
    out.client_certificate_fd = credential.client_certificate_fd;out.client_private_key_fd = credential.client_private_key_fd;
    out.root_certificate_pem = copy(credential.root_certificate_pem, 65536);
    out.client_certificate_sha256 = hash(credential.client_certificate_sha256);
    out.credential_epoch = credential.registered_credential_epoch;
    out.credential_until_unix_ms = static_cast<int64_t>(credential.registered_credential_until_unix_ms);
    out.roots.push_back({hash(credential.root_certificate_sha256), static_cast<int64_t>(credential.registered_root_until_unix_ms)});
    out.policy_epoch = credential.registered_root_epoch;
    out.peer_spki_sha256 = hash(target.expected_spki_der_sha256);
    out.original_operation_id = copy(target.original_operation_id, 128);out.path = copy(target.original_path, 512);
    out.proof_header = copy(target.original_v4_proof_header, 196608);
    const auto now = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count());
    const auto wall = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count());
    if (target.expires_monotonic_ns <= now || target.expires_unix_ms <= wall ||
        (target.expires_monotonic_ns - now) / 1000000 == 0) throw std::invalid_argument("original request deadline elapsed");
    out.timeout_ms = static_cast<uint32_t>(std::min<uint64_t>(30000, (target.expires_monotonic_ns - now) / 1000000));
    out.max_response_header_bytes = target.response_header_limit;out.max_response_body_bytes = target.response_entity_limit;
    return out;
}
} // namespace

extern "C" int32_t ynx_link_ide_finite_get_open_original_v1(
    ynx_auth_ide_finite_get_ticket_v1 *ticket, ynx_link_ide_finite_get_v4_client **out) {
    if (!out) return number(Code::denied);*out = nullptr;
    std::shared_ptr<Record> record;
    try {
        record = std::make_shared<Record>();record->loan.ticket = ticket;
        { std::lock_guard<std::mutex> lock(inventory_mutex);
          if (inventory.size() >= maximum_clients) return number(Code::bounds);
          Identity *identity = allocate_identity_locked();if (!identity) return number(Code::bounds);
          record->handle = &identity->client;record->packet_handle = &identity->packet;
          inventory.emplace(record->handle, record); }
        *out = record->handle;
        ynx_auth_ide_finite_get_loan_v1 *loan = nullptr;
        const int32_t claimed = ynx_auth_ide_finite_get_claim_original_v1(ticket, &loan);
        record->loan.value = loan;record->loan.remember(claimed); // nonnull partial FIRST
        if (claimed || !loan) record->remember(Code::source_current, "original Auth ticket claim rejected", claimed);
        else {
            ynx_auth_ide_finite_get_view_v1 target{};ynx_auth_ide_finite_get_credential_view_v1 credential{};
            int32_t code = ynx_auth_ide_finite_get_loan_view_v1(loan, &target);
            if (!code) code = ynx_auth_ide_finite_get_credential_view_v1_read(target.credential, &credential);
            record->loan.remember(code);
            if (code) record->remember(Code::source_current, "original Auth credential view rejected", code);
            else {
                const Material fixed = material(target, credential);
                const SourceFence fence{&record->loan, source_current, source_retain, source_release};
                const Code started = RequestOwner::start(fixed, fence, record->owner);
                if (started != Code::ok && !record->owner) record->remember(started, "original transport start failed before owner publication");
            }
        }
    } catch (const std::invalid_argument &error) {
        if (record && *out) record->remember(Code::bounds, error.what());else return number(Code::bounds);
    } catch (...) {
        if (record && *out) { record->open_unknown = true;record->remember(Code::cleanup_unknown, "original native open interrupted; retain original debt"); }
        else return number(Code::unavailable);
    }
    { std::lock_guard<std::mutex> lock(record->mutex);record->opening = false;--record->calls; }
    return number(observed(record).code);
}
extern "C" int32_t ynx_link_ide_finite_get_current_original_v1(ynx_link_ide_finite_get_v4_client *handle) {
    Call call(handle);const Code state = ready(call.record);if (state != Code::ok) return number(state);
    const int32_t code = ynx_auth_ide_finite_get_current_original_v1(call.record->loan.ticket);call.record->loan.remember(code);
    if (code) {
        call.record->remember(Code::source_current, "original actor Source current rejected", code);
        if (call.record->owner) (void)call.record->owner->retire();
        return number(Code::source_current);
    }
    return call.record->owner ? number(call.record->owner->current_local()) : number(observed(call.record).code);
}
extern "C" int32_t ynx_link_ide_finite_get_wait_original_v1(
    ynx_link_ide_finite_get_v4_client *handle, uint32_t timeout, ynx_link_ide_finite_get_v4_packet **out) {
    if (!out) return number(Code::denied);*out = nullptr;Call call(handle);
    const Code state = ready(call.record);if (state != Code::ok) return number(state);
    if (!call.record->owner) return number(observed(call.record).code);
    const Packet *packet = nullptr;const Code code = call.record->owner->wait_response(timeout, &packet);
    if (packet) { std::lock_guard<std::mutex> lock(call.record->mutex);
        if (call.record->packet_released) return number(Code::closed);
        call.record->response_observed = true;
        call.record->response_known = packet->dispatch_possible && packet->response.body_complete &&
            !packet->unknown && packet->failure.code == Code::ok;
        call.record->packet = packet;*out = call.record->packet_handle; }
    return number(code);
}
extern "C" int32_t ynx_link_ide_finite_get_packet_view_v1_read(
    ynx_link_ide_finite_get_v4_client *handle, const ynx_link_ide_finite_get_v4_packet *packet, ynx_link_ide_get_packet_view_v1 *out) {
    if (!out) return number(Code::denied);*out = {};Call call(handle);if (!call.record) return number(Code::denied);
    std::lock_guard<std::mutex> lock(call.record->mutex);auto &record = *call.record;
    if (packet != record.packet_handle || !record.packet || record.packet_released || record.closed) return number(Code::denied);
    const Packet &value = *record.packet;out->version = 1;out->size = sizeof(*out);out->status_code = value.response.status_code;
    out->body_complete = value.response.body_complete;out->dispatch_possible = value.dispatch_possible;out->unknown = value.unknown;
    out->headers_original = view(value.response.headers_original);out->trailers_original = view(value.response.trailers_original);
    out->entity_original = {value.response.body.data(), value.response.body.size()};
    out->failure.version = 1;out->failure.size = sizeof(out->failure);out->failure.code = number(value.failure.code);
    out->failure.native_code = value.failure.native_code;out->failure.system_errno = value.failure.system_errno;
    out->failure.auth_code = record.loan.first_auth.load();out->failure.message = view(value.failure.message);
    out->peer_spki_sha256 = view(value.peer_spki_sha256);out->peer_certificate_sha256 = view(value.peer_certificate_sha256);
    out->root_certificate_sha256 = view(value.root_certificate_sha256);out->policy_epoch = value.policy_epoch;return 0;
}
extern "C" int32_t ynx_link_ide_finite_get_packet_release_v1(
    ynx_link_ide_finite_get_v4_client *handle, ynx_link_ide_finite_get_v4_packet *packet) {
    Call call(handle);if (!call.record) return number(Code::denied);
    const Packet *value;
    { std::lock_guard<std::mutex> lock(call.record->mutex);
      if (packet != call.record->packet_handle || !call.record->packet || call.record->packet_released || !call.record->owner) return number(Code::denied);
      value = call.record->packet; }
    const Code code = call.record->owner->release_packet(value);
    if (code == Code::ok) { std::lock_guard<std::mutex> lock(call.record->mutex);call.record->packet_released = true;call.record->packet = nullptr; }
    return number(code);
}
extern "C" int32_t ynx_link_ide_finite_get_abort_original_v1(ynx_link_ide_finite_get_v4_client *handle) {
    Call call(handle);const Code state = ready(call.record);if (state != Code::ok) return number(state);
    const int32_t code = ynx_auth_ide_finite_get_abort_original_v1(call.record->loan.ticket);call.record->loan.remember(code);
    const Code retired = call.record->owner ? call.record->owner->retire() : Code::ok;
    if (code) { call.record->remember(Code::source_current, "original Auth abort rejected", code);return number(Code::source_current); }
    return number(retired);
}
extern "C" int32_t ynx_link_ide_finite_get_join_original_v1(
    ynx_link_ide_finite_get_v4_client *handle, uint32_t timeout, uint8_t *completed) {
    if (!completed) return number(Code::denied);*completed = 0;Call call(handle);
    const Code state = ready(call.record);if (state != Code::ok) return number(state);
    const bool unknown = call.record->open_unknown || call.record->loan.release_unknown.load();
    if (!call.record->owner && unknown) {
        const Failure failure = observed(call.record);
        return number(failure.code == Code::ok ? Code::cleanup_unknown : failure.code);
    }
    if (!call.record->owner) { *completed = 1;return number(observed(call.record).code); }
    const Code retired = call.record->owner->retire();if (retired != Code::ok) return number(retired);
    bool done = false;const Code code = call.record->owner->join(timeout, &done);
    const Failure failure = observed(call.record);
    *completed = done && !call.record->open_unknown && !call.record->loan.release_unknown.load();
    return number(failure.code != Code::ok ? failure.code :
        call.record->open_unknown || call.record->loan.release_unknown.load() ? Code::cleanup_unknown : code);
}
namespace {
int32_t close_record(const std::shared_ptr<Record> &record_ptr, uint8_t *completed, bool from_finish) {
    auto &record = *record_ptr;
    bool already_closed = false;
    { std::lock_guard<std::mutex> lock(record.mutex);
      if (record.opening || record.close_running || (!from_finish && record.finish_running) || record.calls != 1) return number(Code::draining);
      if (record.closed) already_closed = true;
      else if (record.open_unknown) return number(Code::cleanup_unknown);
      else record.close_running = true; }
    if (already_closed) { *completed = 1;return number(observed(record_ptr).code); }
    Code code = Code::ok;bool done = !record.owner;
    if (record.owner) { code = record.owner->retire();if (code == Code::ok) code = record.owner->close(&done); }
    if (done && !record.loan.release_unknown.load()) {
        if (record.loan.value && !record.loan.base_released) {
            uint8_t released = 0;const int32_t auth = ynx_auth_ide_finite_get_loan_release_v1(record.loan.value, &released);
            record.loan.remember(auth);
            if (auth || !released) { record.loan.release_unknown.store(true);record.remember(Code::cleanup_unknown, "original Auth claim release unknown", auth);done = false; }
            else record.loan.base_released = true;
        }
        if (done && record.loan.value && !record.loan.freed) {
            const int32_t auth = ynx_auth_ide_finite_get_loan_free_v1(record.loan.value);record.loan.remember(auth);
            if (auth) { record.loan.release_unknown.store(true);record.remember(Code::cleanup_unknown, "original Auth released-loan free unknown", auth);done = false; }
            else record.loan.freed = true;
        }
    } else if (record.loan.release_unknown.load()) done = false;
    const Failure failure = observed(record_ptr);
    { std::lock_guard<std::mutex> lock(record.mutex);record.close_running = false;if (done) record.closed = true; }
    *completed = done;
    return number(failure.code != Code::ok ? failure.code : done ? Code::ok : code == Code::ok ? Code::draining : code);
}
} // namespace
extern "C" int32_t ynx_link_ide_finite_get_close_original_v1(
    ynx_link_ide_finite_get_v4_client *handle, uint8_t *completed) {
    if (!completed) return number(Code::denied);*completed = 0;Call call(handle);if (!call.record) return number(Code::denied);
    return close_record(call.record, completed, false);
}
extern "C" int32_t ynx_link_ide_finite_get_free_original_v1(ynx_link_ide_finite_get_v4_client *handle) {
    std::lock_guard<std::mutex> index(inventory_mutex);const auto found = inventory.find(handle);
    if (found == inventory.end() || found->second->pid != ::getpid()) return number(Code::denied);
    const auto record = found->second;
    { std::lock_guard<std::mutex> lock(record->mutex);
      if (!record->closed || record->calls || record->close_running || record->loan.release_unknown.load()) return number(Code::draining); }
    inventory.erase(found);return 0;
}
extern "C" int32_t ynx_link_ide_finite_get_lifetime_v1_read(
    const ynx_link_ide_finite_get_v4_client *handle, ynx_link_ide_get_lifetime_v1 *out) {
    if (!out) return number(Code::denied);*out = {};Call call(handle);if (!call.record) return number(Code::denied);
    auto &record = *call.record;out->version = 1;out->size = sizeof(*out);
    { std::lock_guard<std::mutex> lock(record.mutex);if (record.opening || record.close_running) return number(Code::draining);
      out->closed = record.closed;out->auth_loan_held = record.loan.value && !record.loan.freed; }
    if (record.owner) { const auto life = record.owner->lifetime();out->started = life.started;out->retired = life.retired;
        out->response_ready = life.response_ready;out->worker_joined = life.worker_joined;out->response_released = life.response_released;
        out->closing = life.closing;out->physical_complete = life.physical_complete && out->closed;
        out->source_borrow_held = life.source_borrow_held;out->cleanup_unknown = life.cleanup_unknown || record.open_unknown || record.loan.release_unknown.load(); }
    else { out->physical_complete = out->closed;out->cleanup_unknown = record.open_unknown || record.loan.release_unknown.load(); }
    return 0;
}
extern "C" int32_t ynx_link_ide_finite_get_first_error_v1(
    ynx_link_ide_finite_get_v4_client *handle, ynx_link_ide_get_failure_v1 *out) {
    if (!out) return number(Code::denied);*out = {};Call call(handle);if (!call.record) return number(Code::denied);
    { std::lock_guard<std::mutex> lock(call.record->mutex);if (call.record->opening) return number(Code::draining); }
    const Failure failure = observed(call.record);std::lock_guard<std::mutex> lock(call.record->mutex);
    call.record->failure_view = failure.message;out->version = 1;out->size = sizeof(*out);out->code = number(failure.code);
    out->native_code = failure.native_code;out->system_errno = failure.system_errno;
    out->auth_code = call.record->auth_failure ? call.record->auth_failure : call.record->loan.first_auth.load();
    out->message = view(call.record->failure_view);return 0;
}

namespace {
void finish_snapshot(const std::shared_ptr<Record> &record, ynx_link_ide_get_finish_status_v1 *out) {
    const Failure first = observed(record);
    std::lock_guard<std::mutex> lock(record->mutex);
    out->version = 1;out->size = sizeof(*out);
    out->first_code = number(first.code);out->native_code = first.native_code;out->system_errno = first.system_errno;
    out->auth_code = record->auth_failure ? record->auth_failure : record->loan.first_auth.load();
    if (record->opening || record->close_running) return;
    out->response_known = record->response_observed && record->response_known;
    out->response_released = record->packet_released;
    out->auth_loan_held = record->loan.value && !record->loan.freed;
    out->cleanup_unknown = record->open_unknown || record->loan.release_unknown.load();
    if (record->owner) {
        const auto life = record->owner->lifetime();out->worker_joined = life.worker_joined;
        out->physical_complete = record->closed && life.physical_complete;
        out->cleanup_unknown = out->cleanup_unknown || life.cleanup_unknown;
    } else out->physical_complete = record->closed;
}
struct FinishScope final {
    std::shared_ptr<Record> record;
    ~FinishScope() { if (record) { std::lock_guard<std::mutex> lock(record->mutex);record->finish_running = false; } }
};
}
extern "C" int32_t ynx_link_ide_finite_get_finish_ticket_original_v1(
    ynx_auth_ide_finite_get_ticket_v1 *ticket, ynx_link_ide_finite_get_v4_client *handle,
    uint32_t timeout, ynx_link_ide_get_finish_status_v1 *out) {
    if (!out) return number(Code::denied);*out = {};out->version = 1;out->size = sizeof(*out);
    if (!ticket || timeout > 30000) return number(Code::denied);
    Call call(handle);if (!call.record) return number(Code::denied);const auto record = call.record;
    Code eligibility = Code::ok;
    {
        std::lock_guard<std::mutex> lock(record->mutex);
        if (record->loan.ticket != ticket) return number(Code::denied);
        if (record->opening || record->close_running || record->finish_running || record->calls != 1) return number(Code::draining);
        if (record->closed || record->loan.base_released || record->loan.freed) eligibility = Code::closed;
        else if (!record->loan.value || !record->owner) eligibility = Code::denied;
        else if (record->open_unknown || record->loan.release_unknown.load()) eligibility = Code::cleanup_unknown;
        else if (!record->response_observed || !record->packet_released) eligibility = Code::draining;
    }
    if (eligibility != Code::ok) { finish_snapshot(record, out);return number(eligibility); }
    // The client identity is process-lifetime unique. A live base claim holds
    // this ticket against Auth free/reuse; never match a closed cached record.
    {
        std::lock_guard<std::mutex> index(inventory_mutex);
        size_t matches = 0;
        for (const auto &entry : inventory) {
            std::lock_guard<std::mutex> lock(entry.second->mutex);
            const auto &candidate = *entry.second;
            // Open publishes its mutable claim/owner only when opening becomes
            // false under this mutex. A failed second claim's cleanup-only
            // partial is NOT another live ticket loan. During actual close,
            // conservatively retain the live-claim slot without reading its
            // mutable base-release/free flags while that cleanup is in flight.
            if (!candidate.opening && candidate.loan.ticket == ticket && !candidate.closed &&
                candidate.loan.value && candidate.owner && (candidate.close_running ||
                (!candidate.loan.base_released && !candidate.loan.freed))) ++matches;
        }
        if (matches != 1) return number(Code::denied);
    }
    {
        std::lock_guard<std::mutex> lock(record->mutex);
        if (record->loan.ticket != ticket) return number(Code::denied);
        if (record->opening || record->close_running || record->finish_running || record->calls != 1) return number(Code::draining);
        if (record->closed || record->loan.base_released || record->loan.freed) return number(Code::closed);
        record->finish_running = true;
    }
    FinishScope finish{record};
    const auto current = [&]() {
        const int32_t auth = ynx_auth_ide_finite_get_current_original_v1(ticket);record->loan.remember(auth);
        if (auth) record->remember(Code::source_current, "same original Auth request finish current rejected", auth);
        return auth;
    };
    (void)current();
    const Code retired = record->owner->retire();
    bool joined = false;
    const Code joined_code = retired == Code::ok ? record->owner->join(timeout, &joined) : retired;
    if (!joined) { finish_snapshot(record, out);return out->first_code ? out->first_code : number(joined_code); }
    uint8_t closed = 0;const int32_t close_code = close_record(record, &closed, true);
    // The actual original actor still owns its original ticket/custody. A full
    // post-cleanup Source/context check is independent from physical cleanup.
    if (closed) (void)current();
    finish_snapshot(record, out);
    out->finished = closed && out->physical_complete && out->response_known && out->response_released &&
        out->worker_joined && !out->auth_loan_held && !out->cleanup_unknown && !out->first_code && !out->auth_code;
    return out->first_code ? out->first_code : close_code;
}
