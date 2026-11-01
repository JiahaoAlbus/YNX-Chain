#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "resource_current_client_v1.h"
#include "resource-current-peer.hpp"
#include "resource-current-json.hpp"
#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fcntl.h>
#include <map>
#include <memory>
#include <mutex>
#include <poll.h>
#include <sstream>
#include <string>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

namespace {
using Clock = std::chrono::steady_clock;
using ynx::resource_current_detail::PeerLease;
constexpr int denied = 1, bounds = 2, unavailable = 3, cancelled = 4, draining = 5, native_current = 6, closed = 7, protocol = 8, timeout = 9;
struct State;
struct Slot {
    std::atomic<int> owner_pid{0}, ready{0}, retired{0}, closed{0}, freed{0}, local_error{0};
    std::mutex mutex;
    std::shared_ptr<State> state;
};
// Cells are never reused. A stale native pointer cannot acquire another owner.
std::array<Slot, 1024> slots;
std::atomic<size_t> next_slot{0};
struct Packet {
    ynx_link_resource_current_packet_v1 view{};
    bool inflight = true; // protected by the owner's mutex, including catch paths
    std::array<uint8_t, 4096> headers{};
    std::array<uint8_t, 16385> body{};
    std::array<char, 81> id{};
    Packet() { view.headers_original = headers.data(); view.body = body.data(); view.request_id = id.data(); }
};
struct State {
    Slot *slot;
    const ynx_link_resource_current_profile_v1 profile;
    const ynx_link_private_client_source_fence_v1 fence;
    std::mutex mutex, first_mutex, fd_lifetime;
    std::condition_variable changed;
    std::atomic<int> fd{-1}, first{0};
    int native_first = 0, errno_first = 0;
    std::atomic<bool> fence_unknown{false}, close_unknown{false};
    bool fence_held = false, busy = true, joined = false, closing = false;
    uint32_t active = 1;
    uint64_t request_serial = 0; // original IPC correlation ID only, never current9 sequence
    std::unique_ptr<PeerLease> peer;
    struct stat directory_stamp{}, socket_stamp{};
    std::map<const ynx_link_resource_current_packet_v1 *, std::unique_ptr<Packet>> packets;
    State(Slot *s, const ynx_link_resource_current_profile_v1 &p, const ynx_link_private_client_source_fence_v1 &f)
        : slot(s), profile(p), fence(f), peer(new PeerLease) {}
    void remember(int code, int original_native = 0, int original_errno = 0) {
        if (!code) return;
        std::lock_guard<std::mutex> guard(first_mutex);
        if (!first.load()) {
            native_first = original_native; errno_first = original_errno;
            first.store(code, std::memory_order_release);
            slot->local_error.store(code, std::memory_order_release);
        }
    }
};
Slot *cell(ynx_link_resource_current_client_v1 *value) {
    const uintptr_t at = reinterpret_cast<uintptr_t>(value), begin = reinterpret_cast<uintptr_t>(slots.data());
    if (at < begin || at - begin >= sizeof(slots) || (at - begin) % sizeof(Slot)) return nullptr;
    return &slots[(at - begin) / sizeof(Slot)];
}
std::shared_ptr<State> pin(ynx_link_resource_current_client_v1 *value) {
    Slot *s = cell(value);
    if (!s || s->owner_pid.load() != ::getpid() || s->freed.load()) return {};
    std::lock_guard<std::mutex> guard(s->mutex);
    return s->state;
}
int local(const std::shared_ptr<State> &s) {
    if (!s || s->slot->owner_pid.load() != ::getpid()) return denied;
    if (s->slot->closed.load() || s->slot->freed.load()) return closed;
    if (s->slot->retired.load()) return s->first.load() ? s->first.load() : cancelled;
    return s->first.load();
}
void stop(const std::shared_ptr<State> &s) {
    s->slot->retired.store(1, std::memory_order_release);
    if (s->slot->owner_pid.load() == ::getpid()) {
        std::lock_guard<std::mutex> lifetime(s->fd_lifetime);
        int fd = s->fd.load();
        if (fd >= 0) (void)::shutdown(fd, SHUT_RDWR);
    }
    s->changed.notify_all();
}
struct Active {
    std::shared_ptr<State> s;
    Packet **packet = nullptr;
    bool *started = nullptr;
    ~Active() {
        if (started && !*started) return;
        std::lock_guard<std::mutex> guard(s->mutex);
        if (packet && *packet) (*packet)->inflight = false;
        --s->active; s->busy = false;
        s->changed.notify_all();
    }
};
bool text(const char *value, size_t capacity) {
    const size_t size = ::strnlen(value, capacity);
    if (!size || size == capacity) return false;
    return ynx::resource_current_detail::json_impl::identity(std::string(value, size));
}
bool path_text(const char *value, size_t capacity) {
    const size_t size = ::strnlen(value, capacity);
    if (size < 2 || size == capacity || value[0] != '/' || !ynx::resource_current_detail::json_impl::utf8(std::string(value, size))) return false;
    for (size_t i = 0; i < size; ++i) if (static_cast<unsigned char>(value[i]) < 0x20 || value[i] == 0x7f) return false;
    const std::string path(value, size);
    return path.find("//") == std::string::npos && path.find("/../") == std::string::npos && path.find("/./") == std::string::npos &&
        path.size() >= 2 && path.substr(path.size() - 2) != "/." && (path.size() < 3 || path.substr(path.size() - 3) != "/..");
}
bool valid_profile(const ynx_link_resource_current_profile_v1 &p) {
    bool digest = false; for (uint8_t b : p.image_sha256) digest = digest || b != 0;
    if (p.version != 1 || p.size != sizeof(p) || p.peer_pid <= 0 || p.peer_uid != ::geteuid() ||
        !p.start_a || !p.image_bytes || p.image_bytes > (128ULL << 20) || !digest || !p.timeout_ms || p.timeout_ms > 10000 ||
        !path_text(p.socket_path, sizeof(p.socket_path)) || !path_text(p.image_path, sizeof(p.image_path)) ||
        !text(p.source_id, sizeof(p.source_id)) || !text(p.instance_id, sizeof(p.instance_id)) || !text(p.resource_key, sizeof(p.resource_key))) return false;
#if defined(__APPLE__)
    return p.start_kind == YNX_LINK_RESOURCE_CURRENT_DARWIN_START_V1 && p.start_b < 1000000;
#else
    return p.start_kind == YNX_LINK_RESOURCE_CURRENT_LINUX_START_V1 && p.start_b == 0;
#endif
}
bool same_endpoint(const struct stat &a, const struct stat &b) {
    return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_uid == b.st_uid && a.st_mode == b.st_mode;
}
bool endpoint(const std::shared_ptr<State> &s, bool first) {
    std::string path(s->profile.socket_path);const size_t slash = path.rfind('/');
    if (!slash || slash == std::string::npos) return false;
    struct stat directory{}, socket{};
    if (::lstat(path.substr(0, slash).c_str(), &directory) || ::lstat(path.c_str(), &socket) || !S_ISDIR(directory.st_mode) ||
        !S_ISSOCK(socket.st_mode) || directory.st_uid != s->profile.peer_uid || socket.st_uid != s->profile.peer_uid ||
        (directory.st_mode & 07777) != 0700 || (socket.st_mode & 07777) != 0600) return false;
    if (first) { s->directory_stamp = directory; s->socket_stamp = socket; return true; }
    return same_endpoint(directory, s->directory_stamp) && same_endpoint(socket, s->socket_stamp);
}
int budget(const std::shared_ptr<State> &s, Clock::time_point end) {
    int code = local(s); if (code) return code;
    return Clock::now() < end ? 0 : timeout;
}
int wait_fd(const std::shared_ptr<State> &s, short event, Clock::time_point end) {
    for (;;) {
        int code = budget(s, end); if (code) return code;
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(end - Clock::now()).count();
        struct pollfd poller{s->fd.load(), event, 0};
        int ready = ::poll(&poller, 1, static_cast<int>(std::max<int64_t>(1, ms)));
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) return unavailable;
        if (!ready) return timeout;
        if (poller.revents & event) return 0;
        if (poller.revents & (POLLERR | POLLHUP | POLLNVAL)) return local(s) ? local(s) : denied;
    }
}
int native_fence(const std::shared_ptr<State> &s) {
    int code = local(s); if (code) return code;
    int original = 0;
    try { original = s->fence.current(s->fence.ctx); }
    catch (...) { s->remember(unavailable); s->fence_unknown = true; return unavailable; }
    if (original) { s->remember(native_current, original); return native_current; }
    return local(s);
}
int actual_current(const std::shared_ptr<State> &s, Clock::time_point end) {
    int code = budget(s, end); if (code) return code;
    if ((code = native_fence(s))) return code;
    if (!endpoint(s, false)) return denied;
    std::string failure;
    if (!s->peer->current(s->fd.load(), failure)) return denied;
    struct pollfd poller{s->fd.load(), POLLIN, 0};
    if (::poll(&poller, 1, 0) < 0 || (poller.revents & (POLLERR | POLLHUP | POLLNVAL))) return denied;
    if (poller.revents & POLLIN) {
        uint8_t byte;ssize_t got = ::recv(s->fd.load(), &byte, 1, MSG_PEEK | MSG_DONTWAIT);
        if (!got || (got < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) return denied;
        // No second request is outstanding: queued bytes here are unsolicited
        // framing/trailing data, never a reusable response for the next read.
        if (got > 0) return protocol;
    }
    return budget(s, end);
}
int receive(const std::shared_ptr<State> &s, uint8_t *to, size_t count, size_t &received, Clock::time_point end) {
    while (received < count) {
        int code = budget(s, end); if (code) return code;
        ssize_t got = ::recv(s->fd.load(), to + received, count - received, 0);
        if (got > 0) { received += static_cast<size_t>(got); continue; }
        if (!got) return denied;
        if (errno == EINTR) continue;
        if (errno != EAGAIN && errno != EWOULDBLOCK) return unavailable;
        if ((code = wait_fd(s, POLLIN, end))) return code;
    }
    return 0;
}
int line(const std::shared_ptr<State> &s, std::string &out, size_t maximum, Clock::time_point end) {
    out.clear();
    while (out.size() < maximum) {
        uint8_t byte = 0;size_t got = 0;int code = receive(s, &byte, 1, got, end);if (code) return code;
        out.push_back(static_cast<char>(byte));
        if (out.size() >= 2 && out.substr(out.size() - 2) == "\r\n") { out.resize(out.size() - 2); return 0; }
    }
    return bounds;
}
std::string lower(std::string value) { for (char &c : value) if (c >= 'A' && c <= 'Z') c += 'a' - 'A'; return value; }
bool decimal(const std::string &value, size_t &out) {
    if (value.empty() || value.size() > 8) return false;
    size_t n = 0;for (char c : value) { if (c < '0' || c > '9') return false; n = n * 10 + static_cast<unsigned>(c - '0'); }
    out = n;return true;
}
int response(const std::shared_ptr<State> &s, Packet &packet, Clock::time_point end) {
    size_t header = 0;
    while (header < packet.headers.size()) {
        size_t got = 0;int code = receive(s, packet.headers.data() + header, 1, got, end);header += got;packet.view.headers_original_size = header;
        if (code) return code;
        if (header >= 4 && std::memcmp(packet.headers.data() + header - 4, "\r\n\r\n", 4) == 0) break;
    }
    if (header == packet.headers.size()) return bounds;
    std::string headers(reinterpret_cast<char *>(packet.headers.data()), header);
    const size_t first = headers.find("\r\n");
    if (first == std::string::npos || first < 12 || headers.compare(0, 9, "HTTP/1.1 ") || headers[9] < '1' || headers[9] > '5' ||
        headers[10] < '0' || headers[10] > '9' || headers[11] < '0' || headers[11] > '9' || (first > 12 && headers[12] != ' ')) return protocol;
    packet.view.status_code = (headers[9] - '0') * 100 + (headers[10] - '0') * 10 + headers[11] - '0';
    packet.view.packet_present = 1;
    bool have_length = false, chunked = false, mime = false;size_t length = 0, at = first + 2;
    std::map<std::string, std::string> fields;
    while (at + 2 < headers.size()) {
        const size_t next = headers.find("\r\n", at);if (next == std::string::npos || next == at) break;
        const size_t colon = headers.find(':', at);if (colon == std::string::npos || colon >= next || colon == at) return protocol;
        std::string name = lower(headers.substr(at, colon - at));
        for (char c : name) if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return protocol;
        size_t begin = colon + 1;while (begin < next && headers[begin] == ' ') ++begin;
        std::string value = headers.substr(begin, next - begin);
        for (char c : value) if (static_cast<unsigned char>(c) < 0x20 || c == 0x7f) return protocol;
        if (!fields.emplace(name, value).second) return protocol;
        at = next + 2;
    }
    if (fields.count("content-length")) { have_length = decimal(fields["content-length"], length);if (!have_length || length > 16384) return bounds; }
    if (fields.count("transfer-encoding")) { chunked = lower(fields["transfer-encoding"]) == "chunked";if (!chunked || have_length) return protocol; }
    if (fields.count("content-encoding")) return protocol;
    mime = fields.count("content-type") && lower(fields["content-type"]) == "application/json";
    if (!mime || (!have_length && !chunked)) return protocol;
    if (have_length) {
        size_t got = 0;int code = receive(s, packet.body.data(), length, got, end);packet.view.body_size = got;packet.view.partial_response_bytes = got;
        if (code) return code;
    } else {
        for (;;) {
            std::string text;int code = line(s, text, 128, end);if (code) return code;
            if (text.empty() || text.size() > 8) return protocol;
            uint64_t size = 0;for (char c : text) {
                int digit = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
                if (digit < 0) return protocol;size = size * 16 + static_cast<unsigned>(digit);
            }
            if (!size) { code = line(s, text, 128, end);if (code) return code;if (!text.empty()) return protocol;break; }
            if (size > 16384 - packet.view.body_size) return bounds;
            size_t got = 0;code = receive(s, packet.body.data() + packet.view.body_size, static_cast<size_t>(size), got, end);
            packet.view.body_size += got;packet.view.partial_response_bytes = packet.view.body_size;if (code) return code;
            code = line(s, text, 2, end);if (code) return code;if (!text.empty()) return protocol;
        }
    }
    packet.view.body_complete = 1;
    return 0;
}
int send_request(const std::shared_ptr<State> &s, Packet &packet, Clock::time_point end) {
    std::string body = "{\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":\"" + std::string(packet.id.data()) + "\",\"operation\":\"resource_current\",\"payload\":{}}";
    std::string request = "POST /v1/call HTTP/1.1\r\nHost: localipc\r\nContent-Type: application/json\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
    int code = actual_current(s, end);if (code) return code;
    // Actual write fence, outside all owner/packet/Source locks. No caller bool.
    if ((code = native_fence(s)) || (code = budget(s, end))) return code;
    packet.view.dispatch_possible = 1;
    size_t at = 0;
    while (at < request.size()) {
        if ((code = budget(s, end))) return code;
#if defined(__linux__)
        constexpr int flags = MSG_NOSIGNAL;
#else
        constexpr int flags = 0;
#endif
        ssize_t sent = ::send(s->fd.load(), request.data() + at, request.size() - at, flags);
        if (sent > 0) { at += static_cast<size_t>(sent);continue; }
        if (sent < 0 && errno == EINTR) continue;
        if (sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) { if ((code = wait_fd(s, POLLOUT, end))) return code;continue; }
        return unavailable;
    }
    return response(s, packet, end);
}
}

extern "C" int32_t ynx_link_resource_current_open_v1(const ynx_link_resource_current_profile_v1 *profile,
    const ynx_link_private_client_source_fence_v1 *fence, ynx_link_resource_current_client_v1 **out) {
    if (!out) return denied;*out = nullptr;
    if (!profile || !fence || !fence->ctx || !fence->retain || !fence->current || !fence->release || !valid_profile(*profile)) return denied;
    std::shared_ptr<State> s;
    try {
        size_t index = next_slot.load();
        while (index < slots.size() && !next_slot.compare_exchange_weak(index, index + 1)) {}
        if (index >= slots.size()) return bounds;
        Slot &slot = slots[index];s = std::make_shared<State>(&slot, *profile, *fence);
        { std::lock_guard<std::mutex> guard(slot.mutex);slot.state = s;slot.owner_pid.store(::getpid()); }
        *out = reinterpret_cast<ynx_link_resource_current_client_v1 *>(&slot);
        Active active{s};
        int retained = 0;
        try { retained = fence->retain(fence->ctx); }
        catch (...) { s->fence_unknown = true;s->remember(unavailable);stop(s);return unavailable; }
        if (retained) { s->remember(native_current, retained);stop(s);return native_current; }
        s->fence_held = true;
        int code = native_fence(s);if (code) { stop(s);return code; }
        if (!endpoint(s, true)) { s->remember(denied, 0, errno);stop(s);return denied; }
        int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
        { std::lock_guard<std::mutex> lifetime(s->fd_lifetime);s->fd.store(fd); }
        if (fd < 0 || ::fcntl(fd, F_SETFD, FD_CLOEXEC) || ::fcntl(fd, F_SETFL, O_NONBLOCK)) { s->remember(unavailable, 0, errno);stop(s);return unavailable; }
#if defined(__APPLE__)
        int one = 1;if (::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one))) { s->remember(unavailable, 0, errno);stop(s);return unavailable; }
#endif
        struct sockaddr_un address{};address.sun_family = AF_UNIX;
        std::memcpy(address.sun_path, profile->socket_path, std::strlen(profile->socket_path) + 1);
        const auto end = Clock::now() + std::chrono::milliseconds(profile->timeout_ms);
        if ((code = budget(s, end))) { s->remember(code);stop(s);return code; }
        if (::connect(fd, reinterpret_cast<sockaddr *>(&address), sizeof(address))) {
            if (errno != EINPROGRESS || (code = wait_fd(s, POLLOUT, end))) { if (!code) code = unavailable;s->remember(code, 0, errno);stop(s);return code; }
            int error = 0;socklen_t size = sizeof(error);
            if (::getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) || error) { s->remember(unavailable, 0, error ? error : errno);stop(s);return unavailable; }
        }
        std::string failure;
        if (!endpoint(s, false) || !s->peer->capture(fd, *profile, failure)) { s->remember(denied, 0, errno);stop(s);return denied; }
        code = budget(s, end);if (!code) code = native_fence(s);
        if (code) { s->remember(code);stop(s); }
        else s->slot->ready.store(1, std::memory_order_release);
        return code;
    } catch (...) { if (s) { s->remember(unavailable);stop(s); }return unavailable; }
}
extern "C" int32_t ynx_link_resource_current_current_local_v1(ynx_link_resource_current_client_v1 *value) {
    Slot *s = cell(value);if (!s || s->owner_pid.load() != ::getpid()) return denied;
    if (s->freed.load() || s->closed.load()) return closed;
    const int first = s->local_error.load();return first ? first : s->retired.load() ? cancelled : !s->ready.load() ? unavailable : 0;
}
extern "C" int32_t ynx_link_resource_current_read_v1(ynx_link_resource_current_client_v1 *value,
    const ynx_link_resource_current_packet_v1 **out) {
    if (!out) return denied;*out = nullptr;
    auto s = pin(value);if (!s) return denied;
    Packet *packet = nullptr;
    bool started = false;
    // Lives outside try: an exception must not publish a writable packet before
    // its catch has preserved the original partial/error DATA.
    Active active{s, &packet, &started};
    try {
        {
            std::lock_guard<std::mutex> guard(s->mutex);
            int code = local(s);if (code) return code;if (s->busy) return draining;
            if (!s->slot->ready.load()) return unavailable;
            if (s->packets.size() >= 32 || s->request_serial == UINT64_MAX) return bounds;
            auto owned = std::make_unique<Packet>();packet = owned.get();
            std::string id = "lrc-" + std::to_string(++s->request_serial);std::memcpy(packet->id.data(), id.c_str(), id.size() + 1);
            s->packets.emplace(&packet->view, std::move(owned));
            ++s->active;started = true;s->busy = true;s->joined = false;*out = &packet->view;
        }
        const auto end = Clock::now() + std::chrono::milliseconds(s->profile.timeout_ms);
        int code = send_request(s, *packet, end);
        if (!code) {
            ynx::resource_current_detail::CurrentData data;
            std::string failure;
            const ynx::resource_current_detail::ResourceIdentity expected{s->profile.source_id, s->profile.instance_id, s->profile.resource_key};
            if (packet->view.status_code != 200 || !ynx::resource_current_detail::decode_response(
                std::string(reinterpret_cast<char *>(packet->body.data()), packet->view.body_size), packet->id.data(), s->profile.peer_uid,
                ::getpid(), expected, data, failure)) code = protocol;
            else {
                auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
                if (now < 0 || data.issued_at_ms > static_cast<uint64_t>(now) || data.expires_at_ms <= static_cast<uint64_t>(now)) code = denied;
            }
        }
        if (!code) code = actual_current(s, end);
        if (!code) code = native_fence(s);
        if (code) { s->remember(code, 0, code == unavailable ? errno : code == timeout ? ETIMEDOUT : 0);stop(s); }
        packet->view.error_code = code;
        { std::lock_guard<std::mutex> guard(s->first_mutex);packet->view.native_current_code = s->native_first;packet->view.system_errno = s->errno_first; }
        packet->view.valid_current_data = code == 0;
        return code;
    } catch (...) {
        s->remember(unavailable);stop(s);
        if (packet) {
            packet->view.error_code = s->first.load();
            std::lock_guard<std::mutex> guard(s->first_mutex);
            packet->view.native_current_code = s->native_first;packet->view.system_errno = s->errno_first;
        }
        return s->first.load();
    }
}
extern "C" int32_t ynx_link_resource_current_release_packet_v1(ynx_link_resource_current_client_v1 *value,
    const ynx_link_resource_current_packet_v1 *packet) {
    auto s = pin(value);if (!s || !packet) return denied;
    std::lock_guard<std::mutex> guard(s->mutex);
    auto found = s->packets.find(packet);if (found == s->packets.end()) return denied;
    if (found->second->inflight) return draining;
    s->packets.erase(found);s->changed.notify_all();return 0;
}
extern "C" int32_t ynx_link_resource_current_retire_v1(ynx_link_resource_current_client_v1 *value) {
    auto s = pin(value);if (!s) return denied;stop(s);return s->first.load();
}
extern "C" int32_t ynx_link_resource_current_join_v1(ynx_link_resource_current_client_v1 *value, uint32_t ms, uint8_t *completed) {
    if (!completed) return denied;*completed = 0;if (ms > 10000) return bounds;
    auto s = pin(value);if (!s) return denied;
    std::unique_lock<std::mutex> guard(s->mutex);
    if (!s->slot->retired.load()) return draining;
    if (s->fence_unknown || s->close_unknown) return s->first.load() ? s->first.load() : unavailable;
    const auto ready = [&] { return s->active == 0 && s->packets.empty() && (!s->closing || s->slot->closed.load()); };
    const auto wake = [&] { return ready() || s->fence_unknown.load() || s->close_unknown.load(); };
    if (!wake() && (!ms || !s->changed.wait_for(guard, std::chrono::milliseconds(ms), wake))) return draining;
    if (s->fence_unknown || s->close_unknown) return s->first.load() ? s->first.load() : unavailable;
    s->joined = true;*completed = 1;return s->first.load();
}
extern "C" int32_t ynx_link_resource_current_close_v1(ynx_link_resource_current_client_v1 *value, uint8_t *completed) {
    if (!completed) return denied;*completed = 0;auto s = pin(value);if (!s) return denied;
    {
        std::lock_guard<std::mutex> guard(s->mutex);
        if (s->slot->closed.load()) { *completed = 1;return s->first.load(); }
        if (s->closing || !s->slot->retired.load() || !s->joined || s->active || !s->packets.empty()) return draining;
        if (s->fence_unknown || s->close_unknown) return s->first.load() ? s->first.load() : unavailable;
        s->closing = true;
    }
    int close_error = 0;
    {
        // Retire cannot use an integer after its original fd is closed/reused.
        std::lock_guard<std::mutex> lifetime(s->fd_lifetime);
        int fd = s->fd.exchange(-1);if (fd >= 0 && ::close(fd)) close_error = errno;
    }
    std::string peer_close_failure;
    if (close_error || (s->peer && !s->peer->close(peer_close_failure))) {
        s->close_unknown = true;s->remember(unavailable, 0, close_error);
        std::lock_guard<std::mutex> guard(s->mutex);s->changed.notify_all();return unavailable;
    }
    s->peer.reset();
    try { if (s->fence_held) { s->fence.release(s->fence.ctx);s->fence_held = false; } }
    catch (...) {
        s->close_unknown = true;s->remember(unavailable);
        std::lock_guard<std::mutex> guard(s->mutex);s->changed.notify_all();return unavailable;
    }
    { std::lock_guard<std::mutex> guard(s->mutex);s->slot->closed.store(1, std::memory_order_release);s->changed.notify_all(); }
    *completed = 1;return s->first.load();
}
extern "C" int32_t ynx_link_resource_current_first_error_v1(ynx_link_resource_current_client_v1 *value, int32_t *native, int32_t *system) {
    if (!native || !system) return denied;*native = *system = 0;auto s = pin(value);if (!s) return denied;
    std::lock_guard<std::mutex> guard(s->first_mutex);*native = s->native_first;*system = s->errno_first;return s->first.load();
}
extern "C" int32_t ynx_link_resource_current_free_v1(ynx_link_resource_current_client_v1 *value) {
    Slot *slot = cell(value);if (!slot || slot->owner_pid.load() != ::getpid()) return denied;
    std::lock_guard<std::mutex> guard(slot->mutex);if (!slot->state || !slot->closed.load()) return draining;
    slot->freed.store(1);slot->state.reset();return 0;
}
