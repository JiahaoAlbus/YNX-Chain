/* PUBLIC integration control only. Include the original frozen Auth Reader
 * body via the caller-supplied, hash-verified include directory. The actual
 * LINK client/peer TUs are linked without C function mocks. This seam supplies
 * only test transport DATA; it does not exercise an Auth Root/ref factory.
 */
#ifndef YNX_LINK_AUTH_READER_TEST_CALLER
#error Compile this PUBLIC caller only with YNX_LINK_AUTH_READER_TEST_CALLER
#endif
#ifndef YNX_AUTH_READER_PUBLIC_CONTROLS
#error The original Auth PUBLIC transport seam must be explicitly selected
#endif
#include "NetworkPublisherReaderV2.hpp"
#include "resource-current-peer.hpp"
#include "resource-current-held-identity.hpp"
#include <array>
#include <atomic>
#include <cerrno>
#include <cstdlib>
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
    uint64_t n = 0;
    for (size_t i = 0; i < size; ++i) {
        const char c = text[i];if (c < '0' || c > '9' || n > (maximum - static_cast<unsigned>(c - '0')) / 10) return false;
        n = n * 10 + static_cast<unsigned>(c - '0');
    }
    if (!n || n > maximum) return false;out = n;return true;
}
bool copy(char *to, size_t capacity, const char *from) {
    const size_t size = std::strlen(from);if (!size || size >= capacity) return false;
    std::memcpy(to, from, size + 1);return true;
}
bool digest(const char *text, uint8_t out[32]) {
    if (std::strlen(text) != 64) return false;
    for (size_t i = 0; i < 32; ++i) {
        unsigned value = 0;
        for (size_t j = 0; j < 2; ++j) {
            const char c = text[2 * i + j];unsigned digit;
            if (c >= '0' && c <= '9') digit = static_cast<unsigned>(c - '0');
            else if (c >= 'a' && c <= 'f') digit = static_cast<unsigned>(c - 'a' + 10);
            else return false;
            value = value * 16 + digit;
        }
        out[i] = static_cast<uint8_t>(value);
    }
    return true;
}
bool persist(int directory, const std::string &name, const std::vector<uint8_t> &bytes) {
    const int fd = ::openat(directory, name.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return false;
    size_t at = 0;bool ok = true;
    while (at < bytes.size()) {
        const ssize_t written = ::write(fd, bytes.data() + at, bytes.size() - at);
        if (written > 0) at += static_cast<size_t>(written);
        else if (written < 0 && errno == EINTR) continue;
        else { ok = false;break; }
    }
    return ::close(fd) == 0 && ok;
}
}

int main(int argc, char **argv) {
    // The original P09 broker observes this suspended native process itself,
    // registers it in the real Go server, and supplies the actual Go child PID.
    if (argc != 11) {
        std::cerr << "PUBLIC original Auth Reader control: socket spawnedPID pinnedImage imageBytes imageSHA source instance resource normal|chunked ownedOutput\n";
        return 2;
    }
    ynx_link_resource_current_profile_v2 profile{};profile.version = 2;profile.size = sizeof(profile);
    auto &peer = profile.peer;peer.version = 1;peer.size = sizeof(peer);peer.peer_uid = ::geteuid();peer.timeout_ms = 10000;
    uint64_t pid = 0;
    if (!decimal(argv[2], std::numeric_limits<int32_t>::max(), pid) ||
        !decimal(argv[4], 128ULL << 20, peer.image_bytes) || !digest(argv[5], peer.image_sha256) ||
        !copy(peer.socket_path, sizeof(peer.socket_path), argv[1]) || !copy(peer.image_path, sizeof(peer.image_path), argv[3]) ||
        !copy(peer.source_id, sizeof(peer.source_id), argv[6]) || !copy(peer.instance_id, sizeof(peer.instance_id), argv[7]) ||
        !copy(peer.resource_key, sizeof(peer.resource_key), argv[8]) ||
        (std::strcmp(argv[9], "normal") && std::strcmp(argv[9], "chunked"))) return 2;
    peer.peer_pid = static_cast<int32_t>(pid);
    const char *control_env = std::getenv("YNX_LINK_AUTH_READER_CONTROL");
    const std::string control = control_env ? control_env : "current";
    if (control != "current" && control != "prewrite-denial") return 2;
    using namespace ynx::resource_current_detail;
    ProcessStart start;HeldProcessIdentity server;std::string failure;
    if (!process_start(peer.peer_pid, start, failure) || !observe_held_process(peer.peer_pid, server, failure) ||
        server.image_path != peer.image_path || server.image_sha256 != argv[5] || server.uid != peer.peer_uid ||
        !copy(profile.expected_server_start_identity, sizeof(profile.expected_server_start_identity), server.start_identity.c_str())) return 3;
    peer.start_kind = start.kind;peer.start_a = start.a;peer.start_b = start.b;
    uint64_t image_bytes = 0;std::array<uint8_t, 32> image_hash{};
    if (!image_digest(peer.image_path, image_bytes, image_hash.data(), failure) || image_bytes != peer.image_bytes ||
        std::memcmp(image_hash.data(), peer.image_sha256, 32)) return 3;
    if (control == "prewrite-denial") {
        const std::string missing = std::string(peer.socket_path) + ".missing";struct stat absent{};
        if (missing.size() >= sizeof(peer.socket_path) || !::lstat(missing.c_str(), &absent) || errno != ENOENT ||
            !copy(peer.socket_path, sizeof(peer.socket_path), missing.c_str())) return 3;
    }
    struct stat info{};
    if (::lstat(argv[10], &info) || !S_ISDIR(info.st_mode) || info.st_uid != ::geteuid() || (info.st_mode & 07777) != 0700) return 3;
    const int directory = ::open(argv[10], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);if (directory < 0) return 3;

    // Heap lifetime deliberately survives a failed/unknown cleanup. Never drop
    // a parent borrow merely because this PUBLIC test is about to exit.
    auto *fence = new PublicFence;
    ynx_link_private_client_source_fence_v1 source_fence{fence, PublicFence::current, PublicFence::retain, PublicFence::release};
    auto *reader = new ynx::auth::network_publisher::ReaderV2;
    const int open_code = reader->open(profile, source_fence);
    std::array<int, 2> current_codes{{-1, -1}};std::array<size_t, 2> sizes{};size_t reads = 0;bool data_saved = true;
    if (!open_code) {
        for (size_t i = 0; i < 2; ++i) {
            std::vector<uint8_t> body;current_codes[i] = reader->copyCurrent(body);sizes[i] = body.size();
            data_saved = persist(directory, "response-" + std::to_string(i) + ".body", body) && data_saved;
            if (current_codes[i] || body.empty() || (!std::strcmp(argv[9], "chunked") && body.size() <= 2048)) break;
            ++reads;
        }
    }
    const int retire_code = reader->retire();bool completed = false;
    // One caller invocation, not a retry loop or recovery replacement. Reader
    // owns the real Join/Close ACK packets and cached finalization probes.
    const int drain_code = reader->drain(completed);
    const int first_code = reader->firstError();const bool debt = reader->hasDebt();
    const bool physical = completed && !debt && fence->borrows.load() == 0 && fence->releases.load() == 1;
    bool ok;
    if (control == "current") {
        ok = open_code == 0 && reads == 2 && current_codes[0] == 0 && current_codes[1] == 0 &&
            retire_code == 0 && drain_code == 0 && first_code == 0 && physical && data_saved;
    } else {
        // Known missing endpoint is refused before connect/first acquisition.
        // Its original denial remains firstcause after successful local Free;
        // there is no remote session and consequently no remote Close ACK.
        ok = open_code == YNX_LINK_RESOURCE_CURRENT_DENIED_V1 && reads == 0 &&
            retire_code == open_code && drain_code == open_code && first_code == open_code && physical;
    }
    if (::close(directory)) ok = false;
    std::cout << "{\"PUBLIC\":true,\"productionAuthReaderBody\":true,\"realLINKBody\":true,\"mode\":\"" << argv[9]
        << "\",\"control\":\"" << control << "\",\"passed\":" << (ok ? "true" : "false")
        << ",\"readCount\":" << reads << ",\"bodyBytes\":[" << sizes[0] << ',' << sizes[1]
        << "],\"openCode\":" << open_code << ",\"currentCodes\":[" << current_codes[0] << ',' << current_codes[1]
        << "],\"retireCode\":" << retire_code << ",\"drainCode\":" << drain_code << ",\"readerFirstCode\":" << first_code
        << ",\"completed\":" << (completed ? "true" : "false") << ",\"hasDebt\":" << (debt ? "true" : "false")
        << ",\"physicalDrained\":" << (physical ? "true" : "false") << ",\"nativeReleaseCount\":" << fence->releases.load()
        << ",\"actualTypedRoot\":false,\"actualAuthFence\":false,\"RootAdmission\":false,\"SourceAdmission\":false}\n";
    if (!debt) { delete reader;delete fence; }
    return ok ? 0 : 1;
}
