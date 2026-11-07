// Actual loopback PQ transport controls. The two native fence roles below are
// explicitly PUBLIC test owners, never genuine Auth Root/DEVICE qualification.
#ifndef YNX_LINK_AI_MOBILE_V6_PUBLIC_CONTROLS
#error This PUBLIC transport fixture must not be linked into a normal producer
#endif

#include "ai-mobile-v6-transport.hpp"
extern "C" {
#include "bridge.h"
}
#include <openssl/pem.h>
#include <openssl/evp.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/socket.h>
#include <unistd.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fstream>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <unordered_map>

namespace {
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;
const std::string originalBody = "{\"PUBLIC\":\"ai-mobile-v6-original\",\"n\":7}\n";
std::string originalHeaders(bool partial = false) {
    return std::string("HTTP/1.1 200 Original\r\nContent-Type: application/json\r\nContent-Length: ") +
        std::to_string(originalBody.size() + (partial ? 50 : 0)) + "\r\nConnection: close\r\n\r\n";
}
void check(bool value, const std::string &message) { if (!value) throw std::runtime_error(message); }

std::string fileBytes(const std::string &filename) {
    std::ifstream input(filename, std::ios::binary);
    check(input.good(), "cannot read owned PUBLIC fixture input");
    return std::string(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
}
std::array<uint8_t, 32> hashBytes(const std::string &bytes) {
    std::array<uint8_t, 32> hash{};unsigned size = 0;
    check(EVP_Digest(bytes.data(), bytes.size(), hash.data(), &size, EVP_sha256(), nullptr) == 1 && size == hash.size(), "SHA256 unavailable");
    return hash;
}
std::string hexHash(const std::string &bytes) {
    static const char digits[] = "0123456789abcdef";
    const auto digest = hashBytes(bytes);std::string out;
    for (uint8_t byte : digest) { out += digits[byte >> 4];out += digits[byte & 15]; }
    return out;
}

// All C TLS operations use the original bridge and its private pinned provider.
// Bounded nonblocking poll is IO readiness, not a scheduling sleep/barrier.
bool waitFD(int fd, int code, Clock::time_point until) {
    while (Clock::now() < until) {
        const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(until - Clock::now()).count();
        pollfd p{fd, static_cast<short>(code == 3 ? POLLOUT : POLLIN), 0};
        const int n = ::poll(&p, 1, static_cast<int>(std::max<int64_t>(1, std::min<int64_t>(left, 100))));
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 || (n > 0 && (p.revents & POLLNVAL))) return false;
        if (n > 0) return true;
    }
    return false;
}
bool handshake(SSL *ssl, int fd, Clock::time_point until) {
    for (;;) {
        char error[256]{};const int rc = ynx_handshake(ssl, error, sizeof(error));
        if (rc == 1) return true;
        if ((rc != 2 && rc != 3) || !waitFD(fd, rc, until)) return false;
    }
}
bool writeTLS(SSL *ssl, int fd, const std::string &bytes, Clock::time_point until) {
    size_t at = 0;
    while (at < bytes.size()) {
        size_t n = 0;char error[256]{};
        const int rc = ynx_write(ssl, bytes.data() + at, bytes.size() - at, &n, error, sizeof(error));
        if (rc == 1) { if (!n) return false;at += n;continue; }
        if ((rc != 2 && rc != 3) || !waitFD(fd, rc, until)) return false;
    }
    return true;
}
int readTLS(SSL *ssl, int fd, std::string &bytes, Clock::time_point until) {
    for (;;) {
        char buffer[4096], error[256]{};size_t n = 0;
        const int rc = ynx_read(ssl, buffer, sizeof(buffer), &n, error, sizeof(error));
        if (n) bytes.append(buffer, n);
        if (rc == 1) return 1;
        if (rc != 2 && rc != 3) return 0;
        if (!waitFD(fd, rc, until)) return -1;
    }
}

enum class ServerMode { normal, partial, stalled, revoke };
class Server final {
    SSL_CTX *context_ = nullptr;
    int listener_ = -1, listener6_ = -1, current_ = -1;
    uint16_t port_ = 0;
    std::thread worker_;
    std::atomic<bool> stopping_{false};
    std::mutex fdMutex_, mutex_;
    std::condition_variable condition_;
    std::vector<std::string> requests_;
    size_t accepts_ = 0, handshakes_ = 0, finished_ = 0;
    std::string failure_;
    const ServerMode mode_;
    const size_t expectedBody_;
    std::function<void()> beforeResponse_;
    void serve() noexcept {
        try {
            while (!stopping_.load()) {
                pollfd ready[2]{{listener_, POLLIN, 0}, {listener6_, POLLIN, 0}};const int n = ::poll(ready, 2, 100);
                if (n < 0 && errno == EINTR) continue;
                if (stopping_.load()) break;
                check(n >= 0, "listener poll failed");if (!n) continue;
                const int listening = (ready[0].revents & POLLIN) ? listener_ : listener6_;
                sockaddr_storage address{};socklen_t length = sizeof(address);
                const int fd = ::accept(listening, reinterpret_cast<sockaddr *>(&address), &length);
                if (fd < 0 && (errno == EINTR || errno == EAGAIN)) continue;
                check(fd >= 0, "owned loopback accept failed");
                { std::lock_guard<std::mutex> lock(fdMutex_);current_ = fd; }
                if (stopping_.load()) (void)::shutdown(fd, SHUT_RDWR);
                const int flags = ::fcntl(fd, F_GETFL);
                check(flags >= 0 && ::fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0, "accepted fd not nonblocking");
                { std::lock_guard<std::mutex> lock(mutex_);++accepts_; }
                std::unique_ptr<SSL, decltype(&SSL_free)> ssl(ynx_ssl_new(context_, fd, 1, "wallet.ynx.test"), SSL_free);
                check(ssl != nullptr, "original native server SSL unavailable");
                const auto until = Clock::now() + 4s;
                if (handshake(ssl.get(), fd, until)) {
                    ynx_tls_state state{};char error[256]{};
                    check(ynx_snapshot(ssl.get(), "wallet.ynx.test", 1, &state, error, sizeof(error)) == 1 &&
                        !std::strcmp(state.protocol, "TLSv1.3") && !std::strcmp(state.group, "SecP384r1MLKEM1024") &&
                        !std::strcmp(state.cipher, "TLS_AES_256_GCM_SHA384") && !std::strcmp(state.signature, "mldsa87") &&
                        state.verified && state.mutual && state.chain_pq && !state.resumed, "server observed wrong actual PQ/mTLS profile");
                    { std::lock_guard<std::mutex> lock(mutex_);++handshakes_; }
                    std::string request;
                    bool complete = false;
                    while (!stopping_.load() && request.size() <= (2U << 20) + 262144) {
                        const auto split = request.find("\r\n\r\n");
                        if (split != std::string::npos && request.size() >= split + 4 + expectedBody_) { complete = true;break; }
                        if (readTLS(ssl.get(), fd, request, until) != 1) break;
                    }
                    if (!request.empty()) {
                        { std::lock_guard<std::mutex> lock(mutex_);requests_.push_back(request);condition_.notify_all(); }
                        if (complete && beforeResponse_) beforeResponse_();
                        if (complete && mode_ == ServerMode::stalled) {
                            std::string extra;while (!stopping_.load() && readTLS(ssl.get(), fd, extra, until) == 1) {}
                        } else if (complete) {
                            const auto response = originalHeaders(mode_ == ServerMode::partial) + originalBody;
                            (void)writeTLS(ssl.get(), fd, response, until);
                        }
                    }
                }
                ssl.reset();
                { std::lock_guard<std::mutex> lock(fdMutex_);::close(fd);current_ = -1; }
                { std::lock_guard<std::mutex> lock(mutex_);++finished_; }
                condition_.notify_all();
            }
        } catch (const std::exception &error) {
            { std::lock_guard<std::mutex> lock(mutex_);failure_ = error.what(); }
            { std::lock_guard<std::mutex> lock(fdMutex_);if (current_ >= 0) {::close(current_);current_ = -1;} }
            condition_.notify_all();
        }
    }
public:
    explicit Server(const std::string &certs, ServerMode mode = ServerMode::normal, size_t bodySize = 0, std::function<void()> hook = {}) :
        mode_(mode), expectedBody_(bodySize), beforeResponse_(std::move(hook)) {
      try {
        char error[256]{};
        context_ = ynx_ctx_new((certs + "/server.pem").c_str(), (certs + "/server.key").c_str(), (certs + "/root.pem").c_str(), 1, error, sizeof(error));
        check(context_ != nullptr, std::string("original PQ server context: ") + error);
        listener_ = ::socket(AF_INET, SOCK_STREAM, 0);check(listener_ >= 0, "loopback socket unavailable");
        sockaddr_in address{};address.sin_family = AF_INET;address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        check(::bind(listener_, reinterpret_cast<sockaddr *>(&address), sizeof(address)) == 0 && ::listen(listener_, 8) == 0, "loopback bind/listen failed");
        socklen_t size = sizeof(address);check(::getsockname(listener_, reinterpret_cast<sockaddr *>(&address), &size) == 0, "loopback getsockname failed");
        port_ = ntohs(address.sin_port);
        listener6_ = ::socket(AF_INET6, SOCK_STREAM, 0);check(listener6_ >= 0, "IPv6 loopback socket unavailable");
        const int only = 1;check(::setsockopt(listener6_, IPPROTO_IPV6, IPV6_V6ONLY, &only, sizeof(only)) == 0, "IPv6-only loopback unavailable");
        sockaddr_in6 address6{};address6.sin6_family = AF_INET6;address6.sin6_addr = in6addr_loopback;address6.sin6_port = htons(port_);
        check(::bind(listener6_, reinterpret_cast<sockaddr *>(&address6), sizeof(address6)) == 0 && ::listen(listener6_, 8) == 0, "IPv6 owned loopback bind/listen failed");
        for (const int fd : {listener_, listener6_}) {
            const int flags = ::fcntl(fd, F_GETFL);
            check(flags >= 0 && ::fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0, "loopback listener not nonblocking");
        }
        worker_ = std::thread([this] { serve(); });
      } catch (...) {
        if (listener_ >= 0) ::close(listener_);
        if (listener6_ >= 0) ::close(listener6_);
        if (context_) SSL_CTX_free(context_);
        throw;
      }
    }
    ~Server() { stop();if (context_) SSL_CTX_free(context_); }
    Server(const Server &) = delete;
    Server &operator=(const Server &) = delete;
    uint16_t port() const { return port_; }
    void stop() {
        if (stopping_.exchange(true)) return;
        { std::lock_guard<std::mutex> lock(fdMutex_);if (current_ >= 0) (void)::shutdown(current_, SHUT_RDWR); }
        // Listener poll is bounded at 100ms. Keep its accept queue intact
        // until after worker join, so an extra original dial is observable.
        if (worker_.joinable()) worker_.join();
        // Count any already-queued connection too, rather than hide a second
        // client dial merely because stop won the listener scheduling race.
        for (const int listening : {listener_, listener6_}) {
            if (listening < 0) continue;
            for (;;) {
                const int fd = ::accept(listening, nullptr, nullptr);
                if (fd < 0) { if (errno == EINTR) continue;break; }
                { std::lock_guard<std::mutex> lock(mutex_);++accepts_; }
                ::close(fd);
            }
        }
        if (listener_ >= 0) { ::close(listener_);listener_ = -1; }
        if (listener6_ >= 0) { ::close(listener6_);listener6_ = -1; }
    }
    bool waitRequest() {
        std::unique_lock<std::mutex> lock(mutex_);
        return condition_.wait_until(lock, Clock::now() + 3s, [this] { return !requests_.empty() || !failure_.empty(); }) && !requests_.empty();
    }
    bool waitFinished(size_t count) {
        std::unique_lock<std::mutex> lock(mutex_);
        return condition_.wait_until(lock, Clock::now() + 2s, [this, count] { return finished_ >= count || !failure_.empty(); }) && finished_ >= count;
    }
    std::vector<std::string> requests() { std::lock_guard<std::mutex> lock(mutex_);return requests_; }
    size_t accepts() { std::lock_guard<std::mutex> lock(mutex_);return accepts_; }
    size_t handshakes() { std::lock_guard<std::mutex> lock(mutex_);return handshakes_; }
    void healthy() { std::lock_guard<std::mutex> lock(mutex_);check(failure_.empty(), failure_); }
};

} // namespace

// This type and its four strong bodies exist ONLY in this PUBLIC test image.
// The shipping Native inventory owns its different actual captured attempt.
namespace ynx::ai_mobile_v6::physical::native_loan {
struct OriginalAttempt { uint64_t test_identity = 0; };
}

namespace {
namespace physical = ynx::ai_mobile_v6::physical;
using physical::Code;
using physical::Material;
using physical::Packet;
using physical::RequestOwner;
using Attempt = physical::native_loan::OriginalAttempt;

struct AttemptState final {
    std::array<int, 3> fd{{-1, -1, -1}};
    const std::array<off_t, 3> offsets{{17, 23, 11}};
    Material captured;
    const pid_t pid = ::getpid();
    std::atomic<bool> physicalSelected{false}, rootCurrent{true}, nativeCurrent{true};
    std::atomic<int> borrows{0}, releases{0}, currents{0}, reads{0}, denyCall{0};
    std::mutex mutex;
    std::condition_variable condition;
    bool holdRelease = false, releaseEntered = false, permitRelease = false;
    explicit AttemptState(const std::string &certs) {
        try {
            const std::array<std::string, 3> names{{"client.pem", "client.key", "root.pem"}};
            for (size_t i = 0; i < names.size(); ++i) {
                fd[i] = ::open((certs + "/" + names[i]).c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
                check(fd[i] >= 0 && ::lseek(fd[i], offsets[i], SEEK_SET) == offsets[i], "owned PUBLIC credential fd unavailable");
            }
            captured.client_certificate_fd = fd[0];captured.client_private_key_fd = fd[1];
            captured.root_certificate_pem = fileBytes(certs + "/root.pem");
            captured.client_certificate_sha256 = hexHash(fileBytes(certs + "/client.cert.der"));
        } catch (...) { for (int value : fd) if (value >= 0) ::close(value);throw; }
    }
    ~AttemptState() { for (int value : fd) if (value >= 0) ::close(value); }
    bool fdsIntact() const {
        for (size_t i = 0; i < fd.size(); ++i)
            if (::fcntl(fd[i], F_GETFD) < 0 || ::lseek(fd[i], 0, SEEK_CUR) != offsets[i]) return false;
        return true;
    }
    void unblock() { std::lock_guard<std::mutex> lock(mutex);permitRelease = true;condition.notify_all(); }
    bool waitRelease() {
        std::unique_lock<std::mutex> lock(mutex);
        return condition.wait_until(lock, Clock::now() + 2s, [this] { return releaseEntered; });
    }
};
std::mutex registryMutex;
std::unordered_map<Attempt *, std::shared_ptr<AttemptState>> registry;
std::vector<std::unique_ptr<Attempt>> identities;
std::shared_ptr<AttemptState> lookup(Attempt *attempt) {
    std::lock_guard<std::mutex> lock(registryMutex);
    const auto it = registry.find(attempt);
    return it != registry.end() && it->second->pid == ::getpid() ? it->second : nullptr;
}
Attempt *capture(const std::shared_ptr<AttemptState> &state) {
    auto token = std::make_unique<Attempt>();token->test_identity = identities.size() + 1;
    std::lock_guard<std::mutex> lock(registryMutex);auto *raw = token.get();
    identities.push_back(std::move(token));registry.emplace(raw, state);return raw;
}
} // namespace

namespace ynx::ai_mobile_v6::physical::native_loan {
int32_t retain_original(OriginalAttempt *attempt) {
    const auto s = lookup(attempt);if (!s) return 73;
    bool fresh = false;if (!s->physicalSelected.compare_exchange_strong(fresh, true)) return 73;
    int empty = 0;return s->borrows.compare_exchange_strong(empty, 1) ? 0 : 74;
}
int32_t read_original_material(OriginalAttempt *attempt, Material &out) {
    const auto s = lookup(attempt);if (!s || s->borrows.load() != 1) return 74;
    ++s->reads;out = s->captured;return 0;
}
int32_t current_before_write(OriginalAttempt *attempt) {
    const auto s = lookup(attempt);if (!s || s->borrows.load() != 1) return 73;
    const int call = s->currents.fetch_add(1) + 1;
    if (s->denyCall.load() == call) s->rootCurrent.store(false);
    return s->rootCurrent.load() && s->nativeCurrent.load() ? 0 : 73;
}
void release_after_physical_join(OriginalAttempt *attempt) {
    const auto s = lookup(attempt);if (!s || s->borrows.load() != 1) throw std::runtime_error("PUBLIC native release without own borrow");
    {
        std::unique_lock<std::mutex> lock(s->mutex);s->releaseEntered = true;s->condition.notify_all();
        if (s->holdRelease && !s->condition.wait_until(lock, Clock::now() + 3s, [&] { return s->permitRelease; }))
            throw std::runtime_error("PUBLIC native release barrier was not opened");
    }
    --s->borrows;++s->releases;
}
} // namespace ynx::ai_mobile_v6::physical::native_loan

namespace {
std::vector<uint8_t> binaryBody() { return {0, 255, 128, '\r', '\n', '{', '}', 0, 'A'}; }
std::string asString(const std::vector<uint8_t> &body) { return {body.begin(), body.end()}; }
std::string originalHead(const std::string &method, const std::string &path, const std::string &authority, size_t size) {
    std::string head = method + " " + path + " HTTP/1.1\r\nHost: " + authority +
        "\r\nX-PUBLIC-Original:  Native opaque header bytes\r\nAuthorization: PUBLIC-not-a-real-proof\r\n";
    if (method == "POST") head += "Content-Type: application/octet-stream\r\nContent-Length: " + std::to_string(size) + "\r\n";
    return head + "Connection: close\r\n\r\n";
}
void configure(AttemptState &s, const std::string &certs, const Server &server, const std::string &method,
               const std::string &path, const std::vector<uint8_t> &body) {
    auto &m = s.captured;
    m.service_origin = "https://localhost:" + std::to_string(server.port());m.local_san = "wallet.ynx.test";m.peer_san = "localhost";
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    m.credential_epoch = m.policy_epoch = 1;m.credential_until_unix_ms = now + 60000;
    m.peer_spki_sha256 = hexHash(fileBytes(certs + "/server.spki.der"));
    m.roots.push_back({hexHash(fileBytes(certs + "/root.cert.der")), now + 60000});
    m.original_operation_id = "PUBLIC-original-ai-mobile-v6-operation";m.method = method;m.path = path;
    m.request_body_original = body;m.request_head_original = originalHead(method, path, m.service_origin.substr(8), body.size());
    m.max_request_header_bytes = 262144;m.max_request_body_bytes = 2U << 20;
    m.max_response_header_bytes = 4096;m.max_response_body_bytes = 4096;m.timeout_ms = 1200;
}
struct Owned final {
    std::shared_ptr<AttemptState> source;
    Attempt *attempt = nullptr;
    std::shared_ptr<RequestOwner> owner;
    const Packet *packet = nullptr;
    explicit Owned(const std::string &certs) : source(std::make_shared<AttemptState>(certs)) {}
    ~Owned() {
        source->unblock();bool complete = owner && owner->lifetime().physical_complete;
        if (owner && !complete) {
            (void)owner->retire();if (!packet) (void)owner->wait_response(1500, &packet);
            if (packet && owner->release_packet(packet) == Code::ok) packet = nullptr;
            bool joined = false;(void)owner->join(2000, &joined);if (joined) (void)owner->close(&complete);
        }
        if (!owner || complete) { std::lock_guard<std::mutex> lock(registryMutex);registry.erase(attempt); }
        else {
            struct Debt { std::shared_ptr<RequestOwner> owner;std::shared_ptr<AttemptState> source; };
            static auto *debts = new std::vector<Debt>;debts->push_back({owner, source});
        }
    }
    Code start() { check(!attempt, "test must not mint a replacement native attempt");attempt = capture(source);return RequestOwner::start(attempt, owner); }
    Code wait(uint32_t timeout = 2500) { check(owner != nullptr, "adopt nonnull partial owner first");return owner->wait_response(timeout, &packet); }
    void finish(int releases = 1) {
        check(owner != nullptr, "cleanup owner missing");(void)owner->retire();
        if (!packet) (void)owner->wait_response(1500, &packet);
        if (packet) { check(owner->release_packet(packet) == Code::ok, "original packet release failed");packet = nullptr; }
        bool joined = false;const Code jc = owner->join(2000, &joined);
        check(joined && (jc == Code::ok || jc == owner->first_error().code), "actual worker/native attempt did not join");
        bool done = false;const Code cc = owner->close(&done);
        check(done && (cc == Code::ok || cc == owner->first_error().code) && source->borrows == 0 && source->releases == releases &&
            owner->lifetime().physical_complete && source->fdsIntact(), "native borrow/FD physical close contract failed");
    }
};

const std::string postPath = "/api/tasks/PUBLIC_original_v6/effect?trace=A%2Bb";
const std::string getPath = "/api/tasks/PUBLIC_original_v6?afterCursor=A%2Fb&n=01";
void requireOriginalRequest(Server &server, const AttemptState &source, size_t count = 1) {
    server.stop();server.healthy();const auto rows = server.requests();
    check(server.accepts() == count && rows.size() == count, "original attempt redialed, retried or omitted");
    const auto expected = source.captured.request_head_original + asString(source.captured.request_body_original);
    check(rows.back() == expected, "original Native HTTP head/body bytes changed");
}
void originalPostAndGet(const std::string &certs) {
    const std::string json = " { \"PUBLIC\" : \"original JSON bytes\", \"n\" : 1 }\n";
    const std::array<std::vector<uint8_t>, 3> bodies{{binaryBody(), {json.begin(), json.end()}, {}}};
    for (size_t i = 0; i < bodies.size(); ++i) {
        Server server(certs, ServerMode::normal, bodies[i].size());Owned owned(certs);
        configure(*owned.source, certs, server, i == 2 ? "GET" : "POST", i == 2 ? getPath : postPath, bodies[i]);
        check(owned.start() == Code::ok && owned.wait() == Code::ok && owned.packet, "original POST/GET attempt failed");
        const auto &p = *owned.packet;
        check(p.response.status_code == 200 && p.response.headers_original == originalHeaders() && p.response.body_complete &&
            asString(p.response.body) == originalBody && p.dispatch_possible && !p.unknown && p.failure.code == Code::ok, "original response was rewritten");
        check(p.peer_spki_sha256 == owned.source->captured.peer_spki_sha256 && p.peer_spki_sha256 != p.peer_certificate_sha256 &&
            p.root_certificate_sha256 == owned.source->captured.roots[0].certificate_sha256 && p.policy_epoch == 1 && owned.source->reads == 1,
            "same TLS/FD/held Native material identity changed");
        owned.finish();requireOriginalRequest(server, *owned.source);
    }
}
void pinAndFDRefusals(const std::string &certs) {
    for (int mode = 0; mode < 4; ++mode) {
        Server server(certs, ServerMode::normal, binaryBody().size());Owned owned(certs);
        configure(*owned.source, certs, server, "POST", postPath, binaryBody());
        if (mode == 0) owned.source->captured.peer_spki_sha256 = std::string(64, '0');
        if (mode == 1) owned.source->captured.peer_spki_sha256 = hexHash(fileBytes(certs + "/server.cert.der"));
        if (mode == 2) owned.source->captured.client_certificate_sha256 = std::string(64, '0');
        if (mode == 3) owned.source->captured.client_private_key_fd = owned.source->fd[0];
        check(owned.start() == Code::ok && owned.wait() == (mode < 2 ? Code::spki : Code::tls) && owned.packet,
            "real SPKI/FD mismatch did not preserve failed owned attempt");
        check(!owned.packet->dispatch_possible && !owned.packet->unknown && owned.packet->response.status_code == 0, "SPKI/credential refusal wrote HTTP");
        owned.finish();if (mode < 2) check(server.waitFinished(1), "SPKI refused socket did not release");server.stop();server.healthy();
        check(server.accepts() == (mode < 2 ? 1U : 0U) && server.requests().empty(), "pin/credential refusal redialed or emitted bytes");
    }
}
void currentBoundaries(const std::string &certs) {
    for (int phase : {2, 3}) {
        const auto body = binaryBody();Server server(certs, ServerMode::normal, body.size());Owned owned(certs);
        configure(*owned.source, certs, server, "POST", postPath, body);owned.source->denyCall = phase;
        check(owned.start() == Code::ok && owned.wait() == Code::source_current && owned.packet && owned.packet->failure.native_code == 73,
            "Native header/body prewrite current cause lost");
        check(owned.packet->dispatch_possible == (phase == 3) && owned.packet->unknown == (phase == 3), "head/body uncertain-dispatch boundary changed");
        owned.finish();check(server.waitFinished(1), "prewrite refused socket did not release");server.stop();server.healthy();
        const auto rows = server.requests();
        check(server.accepts() == 1 && server.handshakes() == 1 && rows.size() == (phase == 2 ? 0U : 1U), "prewrite selected wrong TLS/write boundary");
        if (phase == 3) check(rows[0] == owned.source->captured.request_head_original, "body-stage revoke emitted entity bytes or changed head");
    }
    Owned owned(certs);Server server(certs, ServerMode::revoke, binaryBody().size(), [&] { owned.source->nativeCurrent = false; });
    configure(*owned.source, certs, server, "POST", postPath, binaryBody());
    check(owned.start() == Code::ok && owned.wait() == Code::source_current && owned.packet && owned.packet->failure.native_code == 73,
        "late original Native current was not rejected");
    check(owned.packet->response.status_code == 200 && owned.packet->response.headers_original == originalHeaders() &&
        owned.packet->response.body_complete && asString(owned.packet->response.body) == originalBody && owned.packet->unknown,
        "late current lost original response bytes/UNKNOWN");
    owned.finish();requireOriginalRequest(server, *owned.source);
}
void partialTimeoutAbort(const std::string &certs) {
    for (ServerMode mode : {ServerMode::partial, ServerMode::stalled}) {
        Server server(certs, mode, binaryBody().size());Owned owned(certs);configure(*owned.source, certs, server, "POST", postPath, binaryBody());
        owned.source->captured.timeout_ms = 300;
        check(owned.start() == Code::ok && owned.wait(1500) != Code::ok && owned.packet && owned.packet->dispatch_possible && owned.packet->unknown &&
            !owned.packet->response.body_complete, "partial/timeout did not retain original UNKNOWN attempt");
        if (mode == ServerMode::partial) check(owned.packet->response.headers_original == originalHeaders(true) && asString(owned.packet->response.body) == originalBody,
            "partial original response headers/body prefix lost");
        else check(owned.packet->failure.code == Code::timeout, "timeout first cause changed");
        owned.finish();requireOriginalRequest(server, *owned.source);
    }
    Server server(certs, ServerMode::stalled, binaryBody().size());Owned owned(certs);configure(*owned.source, certs, server, "POST", postPath, binaryBody());
    check(owned.start() == Code::ok && server.waitRequest(), "abort did not reach actual original POST");
    (void)owned.owner->abort();check(owned.wait(1500) == Code::cancelled && owned.packet && owned.packet->unknown && owned.packet->dispatch_possible,
        "abort lost original UNKNOWN/cause");owned.finish();requireOriginalRequest(server, *owned.source);
}
void attemptOnce(const std::string &certs) {
    Server server(certs, ServerMode::stalled, binaryBody().size());Owned first(certs);configure(*first.source, certs, server, "POST", postPath, binaryBody());
    check(first.start() == Code::ok && server.waitRequest(), "once fixture missed first actual request");
    std::shared_ptr<RequestOwner> second;const Packet *packet = nullptr;
    check(RequestOwner::start(first.attempt, second) == Code::source_current && second && second->wait_response(0, &packet) == Code::source_current && packet,
        "same Native attempt acquired a second physical borrow");
    check(!packet->dispatch_possible && first.source->borrows == 1 && first.source->releases == 0 && first.source->reads == 1, "failed second selection touched first borrow/material");
    check(second->release_packet(packet) == Code::ok, "second partial packet was not adopted/released");
    (void)second->retire();bool done = false;(void)second->join(1500, &done);check(done, "failed second selection did not join locally");
    (void)second->close(&done);check(done && first.source->borrows == 1 && first.source->releases == 0, "second partial released first Native borrow");
    (void)first.owner->retire();check(first.wait() == Code::cancelled && first.packet, "first attempt abort missing packet");first.finish();
    std::shared_ptr<RequestOwner> third;const Packet *late = nullptr;
    check(RequestOwner::start(first.attempt, third) == Code::source_current && third && third->wait_response(0, &late) == Code::source_current && late,
        "physical Selected reset after UNKNOWN cleanup");
    check(third->release_packet(late) == Code::ok, "late failed selection packet debt lost");(void)third->retire();(void)third->join(1500, &done);check(done, "late rejected selection failed join");
    (void)third->close(&done);check(done && first.source->releases == 1 && first.source->reads == 1, "late rejected selection replayed Native release/getter");
    requireOriginalRequest(server, *first.source);
}
void physicalJoinAndProgress(const std::string &certs) {
    Server server(certs, ServerMode::normal, binaryBody().size());Owned owned(certs);configure(*owned.source, certs, server, "POST", postPath, binaryBody());
    check(owned.start() == Code::ok && owned.wait() == Code::ok && owned.packet, "physical debt fixture failed original POST");
    bool done = true;check(owned.owner->close(&done) == Code::draining && !done && owned.owner->first_error().code == Code::ok,
        "known close progress became first failure");
    (void)owned.owner->retire();(void)owned.owner->join(0, &done);check(!done && owned.source->borrows == 1 && owned.source->releases == 0, "packet debt fabricated Native drain");
    check(owned.owner->release_packet(owned.packet) == Code::ok, "original packet release failed");owned.packet = nullptr;
    check(owned.owner->join(1500, &done) == Code::ok && done, "actual worker/reaper join failed");
    owned.source->holdRelease = true;bool closed = false;
    std::thread closing([&] { (void)owned.owner->close(&closed); });
    const bool entered = owned.source->waitRelease();const auto life = owned.owner->lifetime();
    bool other = true;const Code progress = owned.owner->close(&other);const auto first = owned.owner->first_error();
    owned.source->unblock();closing.join();
    check(entered && life.closing && !life.physical_complete && life.worker_joined && life.reaper_bookkeeping_complete &&
        life.source_callbacks_inflight == 1 && life.source_borrow_held && !other && progress == Code::draining && first.code == Code::ok &&
        closed && owned.source->releases == 1 && owned.source->fdsIntact() && owned.owner->first_error().code == Code::ok, "physical release/progress first-cause boundary violated");
    requireOriginalRequest(server, *owned.source);
}
} // namespace

int main(int argc, char **argv) {
    (void)::signal(SIGPIPE, SIG_IGN);
    try {
        check(argc == 2 || argc == 3, "explicit owned PUBLIC certificate directory and optional exact control required");
        check(std::string(ynx_runtime_version()).rfind("OpenSSL 3.6.4 ", 0) == 0, "actual pinned TLS runtime missing");
        const std::array<std::pair<const char *, void (*)(const std::string &)>, 6> cases{{
            {"original-post-binary-json-and-get-raw-target", originalPostAndGet},
            {"real-spki-and-borrowed-fd-prewrite-refusals", pinAndFDRefusals},
            {"native-current-head-body-and-late-response-boundaries", currentBoundaries},
            {"partial-timeout-and-abort-unknown-no-replay", partialTimeoutAbort},
            {"same-original-attempt-physical-once-no-new-borrow", attemptOnce},
            {"packet-worker-socket-native-release-and-progress", physicalJoinAndProgress},
        }};
        size_t count = 0;
        for (const auto &item : cases) {
            if (argc == 3 && std::string(argv[2]) != item.first) continue;
            try { item.second(argv[1]); } catch (const std::exception &error) { std::cerr << item.first << ": " << error.what() << '\n';return 1; }
            ++count;std::cout << "{\"control\":\"" << item.first << "\",\"passed\":true}\n" << std::flush;
        }
        check(count != 0, "unknown exact control selector");
        std::cout << "{\"summary\":true,\"controls\":" << count << ",\"fullModule\":" << (argc == 2 ? "true" : "false")
            << ",\"actualPQ\":true,\"publicStrongLoanFixture\":true,\"actualNativeSource\":false,\"RootAdmission\":false,\"SourceAdmission\":false}\n";
        return 0;
    } catch (const std::exception &error) { std::cerr << error.what() << '\n';return 2; }
}
