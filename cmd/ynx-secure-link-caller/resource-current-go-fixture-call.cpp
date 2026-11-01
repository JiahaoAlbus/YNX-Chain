/* PUBLIC controlled caller only. This main is never part of a Native image,
 * NAPI module or product factory. Its argv are test DATA from the original
 * P09 owner's pinned fixture plus the parent's actual spawned child PID.
 * It exercises the SAME frozen private client/header, not a second protocol
 * implementation, a profile JSON installer or an Auth/Root Source provider.
 */
#ifndef YNX_LINK_RESOURCE_CURRENT_TEST_CALLER
#error Compile this PUBLIC caller only with YNX_LINK_RESOURCE_CURRENT_TEST_CALLER
#endif
#include "resource_current_client_v1.h"
#include "resource-current-peer.hpp"
#include "resource-current-json.hpp"
#include <array>
#include <atomic>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <limits>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

namespace {
struct PublicFence {
    std::atomic<int> borrows{0}, releases{0};
    static int32_t current(void *p) { return static_cast<PublicFence *>(p)->borrows.load() == 1 ? 0 : 61; }
    static int32_t retain(void *p) { int zero = 0;return static_cast<PublicFence *>(p)->borrows.compare_exchange_strong(zero, 1) ? 0 : 62; }
    static void release(void *p) { auto *s = static_cast<PublicFence *>(p);s->releases.fetch_add(1);s->borrows.fetch_sub(1); }
};
bool decimal(const char *text, uint64_t maximum, uint64_t &out) {
    const size_t size = std::strlen(text);if (!size || size > 20 || (size > 1 && text[0] == '0')) return false;
    uint64_t n = 0;for (size_t i = 0; i < size; ++i) {
        const char c = text[i];if (c < '0' || c > '9' || n > (maximum - static_cast<unsigned>(c - '0')) / 10) return false;
        n = n * 10 + static_cast<unsigned>(c - '0');
    }
    if (!n || n > maximum) return false;out = n;return true;
}
bool copy(char *to, size_t capacity, const char *from) {
    size_t size = std::strlen(from);if (!size || size >= capacity) return false;std::memcpy(to, from, size + 1);return true;
}
bool digest(const char *text, uint8_t out[32]) {
    if (std::strlen(text) != 64) return false;
    for (size_t i = 0; i < 32; ++i) {
        unsigned value = 0;for (size_t j = 0; j < 2; ++j) {
            char c = text[2 * i + j];unsigned digit;
            if (c >= '0' && c <= '9') digit = static_cast<unsigned>(c - '0');
            else if (c >= 'a' && c <= 'f') digit = static_cast<unsigned>(c - 'a' + 10);
            else return false;
            value = value * 16 + digit;
        }
        out[i] = static_cast<uint8_t>(value);
    }
    return true;
}
bool persist(int directory, const std::string &name, const uint8_t *bytes, size_t size) {
    int fd = ::openat(directory, name.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return false;
    size_t at = 0;bool ok = true;
    while (at < size) {
        ssize_t written = ::write(fd, bytes + at, size - at);
        if (written > 0) at += static_cast<size_t>(written);
        else if (written < 0 && errno == EINTR) continue;
        else { ok = false;break; }
    }
    const int close_result = ::close(fd);
    return ok && close_result == 0;
}
bool chunked(const ynx_link_resource_current_packet_v1 &p) {
    std::string headers(reinterpret_cast<const char *>(p.headers_original), p.headers_original_size);
    for (char &c : headers) if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
    return headers.find("\r\ntransfer-encoding: chunked\r\n") != std::string::npos;
}
}

int main(int argc, char **argv) {
    if (argc != 11) {
        std::cerr << "PUBLIC fixture only: socket spawnedPID pinnedImage imageBytes imageSHA256 sourceId instanceId resourceKey normal|chunked ownedOutputDirectory\n";
        return 2;
    }
    const std::string mode(argv[9]);
    ynx_link_resource_current_profile_v1 profile{};profile.version = 1;profile.size = sizeof(profile);profile.peer_uid = ::geteuid();profile.timeout_ms = 10000;
    uint64_t pid = 0;
    if (!decimal(argv[2], std::numeric_limits<int32_t>::max(), pid) || !decimal(argv[4], 128ULL << 20, profile.image_bytes) ||
        !digest(argv[5], profile.image_sha256) || !copy(profile.socket_path, sizeof(profile.socket_path), argv[1]) ||
        !copy(profile.image_path, sizeof(profile.image_path), argv[3]) || !copy(profile.source_id, sizeof(profile.source_id), argv[6]) ||
        !copy(profile.instance_id, sizeof(profile.instance_id), argv[7]) || !copy(profile.resource_key, sizeof(profile.resource_key), argv[8]) ||
        (mode != "normal" && mode != "chunked")) return 2;
    profile.peer_pid = static_cast<int32_t>(pid);
    std::string failure;
    ynx::resource_current_detail::ProcessStart start;
    if (!ynx::resource_current_detail::process_start(profile.peer_pid, start, failure)) return 3;
    profile.start_kind = start.kind;profile.start_a = start.a;profile.start_b = start.b;
    uint64_t actual_bytes = 0;std::array<uint8_t, 32> actual_digest{};
    if (!ynx::resource_current_detail::image_digest(profile.image_path, actual_bytes, actual_digest.data(), failure) ||
        actual_bytes != profile.image_bytes || std::memcmp(actual_digest.data(), profile.image_sha256, actual_digest.size())) return 3;
    struct stat info{};
    if (::lstat(argv[10], &info) || !S_ISDIR(info.st_mode) || info.st_uid != ::geteuid() || (info.st_mode & 07777) != 0700) return 3;
    int directory = ::open(argv[10], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);if (directory < 0) return 3;
    // Process-lifetime on purpose: a failing unknown drain cannot destroy the
    // PUBLIC fence context while its actual transport borrow still exists.
    auto *original = new PublicFence;
    const ynx_link_private_client_source_fence_v1 fence{original, PublicFence::current, PublicFence::retain, PublicFence::release};
    ynx_link_resource_current_client_v1 *client = nullptr;
    int code = ynx_link_resource_current_open_v1(&profile, &fence, &client);
    bool ok = code == 0 && client != nullptr, observed_chunked = false;
    std::array<size_t, 2> sizes{};size_t attempts = 0;
    ynx::resource_current_detail::CurrentData before;
    const ynx::resource_current_detail::ResourceIdentity expected{profile.source_id, profile.instance_id, profile.resource_key};
    for (size_t i = 0; ok && i < 2; ++i) {
        ++attempts;
        const ynx_link_resource_current_packet_v1 *packet = nullptr;
        const int rc = ynx_link_resource_current_read_v1(client, &packet);
        // Adopt partial first, including status/header/body on nonzero rc.
        if (packet) {
            const bool body_saved = persist(directory, "response-" + std::to_string(i) + ".body", packet->body, packet->body_size);
            const bool headers_saved = persist(directory, "response-" + std::to_string(i) + ".headers", packet->headers_original, packet->headers_original_size);
            ynx::resource_current_detail::CurrentData data;
            sizes[i] = packet->body_size;observed_chunked = observed_chunked || chunked(*packet);
            ok = rc == 0 && body_saved && headers_saved && packet->packet_present && packet->body_complete && packet->valid_current_data && packet->status_code == 200 &&
                ynx::resource_current_detail::decode_response(std::string(reinterpret_cast<const char *>(packet->body), packet->body_size), packet->request_id,
                    profile.peer_uid, ::getpid(), expected, data, failure);
            if (ok && i) ok = before.epoch == data.epoch && before.sequence == data.sequence && before.head == data.head && before.issued_at_ms <= data.issued_at_ms;
            if (ok && mode == "chunked") ok = packet->body_size > 2048 && chunked(*packet);
            if (ok && !i) before = data;
            if (ynx_link_resource_current_release_packet_v1(client, packet) != 0) ok = false;
        } else ok = false;
        if (rc && !code) code = rc;
    }
    uint8_t joined = 0, physically_closed = 0;
    int first_native = 0, first_errno = 0, first = 0, join_rc = 0, close_rc = 0, free_rc = 5;
    const bool held_before_close = original->borrows.load() == 1 && original->releases.load() == 0;
    if (client) {
        (void)ynx_link_resource_current_retire_v1(client);
        join_rc = ynx_link_resource_current_join_v1(client, 10000, &joined);
        if (joined) close_rc = ynx_link_resource_current_close_v1(client, &physically_closed);
        first = ynx_link_resource_current_first_error_v1(client, &first_native, &first_errno);
        if (physically_closed) free_rc = ynx_link_resource_current_free_v1(client);
    }
    const bool drained = joined && physically_closed && free_rc == 0 && original->borrows.load() == 0 && original->releases.load() == 1;
    if (::close(directory)) ok = false;
    ok = ok && held_before_close && drained && first == 0 && join_rc == 0 && close_rc == 0;
    std::cout << "{\"PUBLIC\":true,\"transportOnly\":true,\"passed\":" << (ok ? "true" : "false")
        << ",\"sameNativeClient\":" << (client ? "true" : "false") << ",\"readCount\":" << attempts << ",\"bodyBytes\":[" << sizes[0] << ',' << sizes[1]
        << "],\"chunkedObserved\":" << (observed_chunked ? "true" : "false") << ",\"readOnlySnapshotEqual\":" << (ok ? "true" : "false")
        << ",\"drained\":" << (drained ? "true" : "false") << ",\"code\":" << code << ",\"firstCode\":" << first
        << ",\"nativeCode\":" << first_native << ",\"systemErrno\":" << first_errno << ",\"nativeReleaseCount\":" << original->releases.load()
        << ",\"actualAuthFence\":false,\"RootAdmission\":false,\"SourceAdmission\":false}\n";
    return ok ? 0 : 1;
}
