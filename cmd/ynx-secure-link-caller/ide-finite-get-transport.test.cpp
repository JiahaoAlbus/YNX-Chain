// Actual loopback PQ transport controls. The two native fence roles below are
// explicitly PUBLIC test owners, never genuine Auth Root/DEVICE qualification.
#ifndef YNX_LINK_IDE_FINITE_GET_PUBLIC_CONTROLS
#error This PUBLIC transport fixture must not be linked into a normal producer
#endif

#include "ide-finite-get-transport.hpp"
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

namespace {
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;
const std::string originalBody = "{\"PUBLIC\":\"finite7-original\",\"n\":7}\n";
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
                    while (!stopping_.load() && request.size() <= 65536 && request.find("\r\n\r\n") == std::string::npos)
                        if (readTLS(ssl.get(), fd, request, until) != 1) break;
                    if (!request.empty()) {
                        { std::lock_guard<std::mutex> lock(mutex_);requests_.push_back(request);condition_.notify_all(); }
                        if (beforeResponse_) beforeResponse_();
                        if (mode_ == ServerMode::stalled) {
                            std::string extra;while (!stopping_.load() && readTLS(ssl.get(), fd, extra, until) == 1) {}
                        } else {
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
    explicit Server(const std::string &certs, ServerMode mode = ServerMode::normal, std::function<void()> hook = {}) : mode_(mode), beforeResponse_(std::move(hook)) {
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

// Test bodies below bind only the transport owner's closed internal API. No
// arbitrary URL/headers, production Source constructor or generic RPC is used.
using ynx::ide_finite_get::Code;
using ynx::ide_finite_get::Material;
using ynx::ide_finite_get::Packet;
using ynx::ide_finite_get::RequestOwner;
using ynx::ide_finite_get::SourceFence;

struct PublicSource final {
    // Separate PUBLIC native roles, not JSON flags or a genuine strong ref.
    std::atomic<bool> rootCurrent{true}, deviceCurrent{true};
    std::atomic<int> currentCalls{0}, borrows{0}, releases{0};
    std::atomic<int> denyCall{0};
    std::mutex mutex;
    std::condition_variable condition;
    bool holdRelease = false, releaseEntered = false, permitRelease = false;
    std::array<int, 3> credentialFDs{{-1, -1, -1}};
    const std::array<off_t, 3> originalOffsets{{17, 23, 11}};
    std::string publicRootPEM, publicClientCertificateSHA;
    explicit PublicSource(const std::string &certs) {
        try {
            const std::array<std::string, 3> names{{"client.pem", "client.key", "root.pem"}};
            for (size_t i = 0; i < names.size(); ++i) {
                credentialFDs[i] = ::open((certs + "/" + names[i]).c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
                check(credentialFDs[i] >= 0 && ::lseek(credentialFDs[i], originalOffsets[i], SEEK_SET) == originalOffsets[i], "owned PUBLIC credential fd unavailable");
            }
            // Only public certificate material is hashed/copied by this fixture.
            // Private key bytes never enter the test's C++ buffers or reports.
            publicRootPEM = fileBytes(certs + "/root.pem");
            publicClientCertificateSHA = hexHash(fileBytes(certs + "/client.cert.der"));
        } catch (...) { for (int fd : credentialFDs) if (fd >= 0) ::close(fd);throw; }
    }
    ~PublicSource() { for (int fd : credentialFDs) if (fd >= 0) ::close(fd); }
    bool originalFDsIntact() const {
        for (size_t i = 0; i < credentialFDs.size(); ++i)
            if (::fcntl(credentialFDs[i], F_GETFD) < 0 || ::lseek(credentialFDs[i], 0, SEEK_CUR) != originalOffsets[i]) return false;
        return true;
    }
    static int32_t current(void *ctx) {
        auto *s = static_cast<PublicSource *>(ctx);
        const int call = s->currentCalls.fetch_add(1) + 1;
        if (s->denyCall.load() == call) s->rootCurrent.store(false);
        return !s->rootCurrent.load() || !s->deviceCurrent.load() ? 73 : 0;
    }
    static int32_t retain(void *ctx) {
        auto *s = static_cast<PublicSource *>(ctx);int expected = 0;
        return s->borrows.compare_exchange_strong(expected, 1) ? 0 : 74;
    }
    static void release(void *ctx) {
        auto *s = static_cast<PublicSource *>(ctx);
        {
            std::unique_lock<std::mutex> lock(s->mutex);
            s->releaseEntered = true;s->condition.notify_all();
            if (s->holdRelease && !s->condition.wait_until(lock, Clock::now() + 3s, [s] { return s->permitRelease; }))
                throw std::runtime_error("PUBLIC release barrier was not opened");
        }
        s->borrows.fetch_sub(1);s->releases.fetch_add(1);
    }
    SourceFence fence() { return {this, current, retain, release}; }
    void unblock() { std::lock_guard<std::mutex> lock(mutex);permitRelease = true;condition.notify_all(); }
    bool waitRelease() {
        std::unique_lock<std::mutex> lock(mutex);
        return condition.wait_until(lock, Clock::now() + 2s, [this] { return releaseEntered; });
    }
};

Material material(const std::string &certs, const Server &server, const std::string &path) {
    Material m;
    m.service_origin = "https://localhost:" + std::to_string(server.port());
    m.local_san = "wallet.ynx.test";m.peer_san = "localhost";
    m.peer_spki_sha256 = hexHash(fileBytes(certs + "/server.spki.der"));
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    m.roots.push_back({hexHash(fileBytes(certs + "/root.cert.der")), now + 60000});
    m.policy_epoch = 1;m.original_operation_id = "PUBLIC_original_op_0001";m.path = path;
    m.proof_header = "PUBLIC-original-device-session-ticket-DATA";m.timeout_ms = 1200;
    m.max_response_body_bytes = 4096;m.max_response_header_bytes = 4096;
    return m;
}

struct Owned final {
    std::shared_ptr<PublicSource> source;
    std::shared_ptr<RequestOwner> owner;
    const Packet *packet = nullptr;
    explicit Owned(const std::string &certs) : source(std::make_shared<PublicSource>(certs)) {}
    ~Owned() {
        source->unblock();
        if (!owner || owner->lifetime().physical_complete) return;
        (void)owner->retire();
        if (!packet) (void)owner->wait_response(1500, &packet);
        if (packet && owner->release_packet(packet) == Code::ok) packet = nullptr;
        bool joined = false, closed = false;
        (void)owner->join(2000, &joined);
        if (joined) (void)owner->close(&closed);
        if (!closed) {
            // Failed/UNKNOWN cleanup must keep its native source memory alive.
            // This process-local PUBLIC debt is deliberately not fake-drained.
            struct Debt { std::shared_ptr<RequestOwner> owner;std::shared_ptr<PublicSource> source; };
            static auto *debts = new std::vector<Debt>;
            debts->push_back({owner, source});
        }
    }
    Material bind(Material m) const {
        m.client_certificate_fd = source->credentialFDs[0];m.client_private_key_fd = source->credentialFDs[1];
        m.root_certificate_pem = source->publicRootPEM;m.client_certificate_sha256 = source->publicClientCertificateSHA;
        m.credential_epoch = 1;
        m.credential_until_unix_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count() + 60000;
        return m;
    }
    Code start(const Material &m) { return RequestOwner::start(bind(m), source->fence(), owner); }
    Code wait(uint32_t ms = 2500) { check(owner != nullptr, "nonnull owner must be adopted first");return owner->wait_response(ms, &packet); }
    void finish() {
        check(owner != nullptr, "cleanup owner missing");(void)owner->retire();
        if (!packet) (void)owner->wait_response(1500, &packet);
        if (packet) { check(owner->release_packet(packet) == Code::ok, "owned packet could not be released");packet = nullptr; }
        bool joined = false;const Code joinCode = owner->join(2000, &joined);
        check(joined && (joinCode == Code::ok || joinCode == owner->first_error().code), "actual worker/socket join did not complete");
        bool closed = false;const Code closeCode = owner->close(&closed);
        check(closed && (closeCode == Code::ok || closeCode == owner->first_error().code), "source physical close did not complete");
        check(source->borrows.load() == 0 && source->releases.load() == 1 && owner->lifetime().physical_complete, "native source borrow not released exactly once");
        check(source->originalFDsIntact(), "transport closed or moved an original borrowed credential fd");
    }
};

const std::string operation = "PUBLIC_original_op_0001";
const std::string prefix = "/api/v1/ide/deployments/" + operation;
std::string packetBody(const Packet &packet) { return {packet.response.body.begin(), packet.response.body.end()}; }
void requireRequest(const std::string &request, const Material &m) {
    check(request.rfind("GET " + m.path + " HTTP/1.1\r\n", 0) == 0, "actual emitted finite GET target changed");
    const auto end = request.find("\r\n\r\n");
    check(end != std::string::npos && end + 4 == request.size(), "finite GET emitted payload bytes");
    check(request.find('?') == std::string::npos && request.find("Transfer-Encoding") == std::string::npos &&
        request.find("Content-Length") == std::string::npos && request.find("Content-Type") == std::string::npos, "empty GET gained query/framing/MIME");
    const std::string proof = "x-ynx-product-session-proof-v4: " + m.proof_header + "\r\n";
    const auto at = request.find(proof);
    check(at != std::string::npos && request.find(proof, at + 1) == std::string::npos, "opaque proof header changed/duplicated");
    check(request.find("Host: " + m.service_origin.substr(8) + "\r\n") != std::string::npos, "actual HTTPS carrier authority changed");
}

void sevenTargets(const std::string &certs) {
    Server server(certs);
    const std::array<std::string, 7> suffixes{{"", "/logs", "/runtime", "/usage", "/usage/records", "/billing/2026-11-07", "/billing/2026-11-07/native-intent"}};
    for (const auto &suffix : suffixes) {
        Owned owned(certs);const auto m = material(certs, server, prefix + suffix);
        check(owned.start(m) == Code::ok, "valid finite7 owner start refused");
        check(owned.wait() == Code::ok && owned.packet != nullptr, "actual PQ GET returned no owned packet");
        const auto &packet = *owned.packet;
        check(packet.response.status_code == 200 && packet.response.body_complete && packetBody(packet) == originalBody &&
            packet.response.headers_original == originalHeaders() && packet.response.trailers_original.empty() &&
            packet.failure.code == Code::ok && packet.dispatch_possible && !packet.unknown, "original complete response/dispatch changed");
        check(packet.peer_spki_sha256 == m.peer_spki_sha256 && packet.peer_spki_sha256 != packet.peer_certificate_sha256 &&
            packet.root_certificate_sha256 == m.roots[0].certificate_sha256 && packet.policy_epoch == 1, "actual SPKI/certificate/root identities conflated");
        owned.finish();
    }
    server.stop();server.healthy();const auto requests = server.requests();
    check(requests.size() == suffixes.size() && server.accepts() == suffixes.size() && server.handshakes() == suffixes.size(), "seven original requests were retried or omitted");
    for (size_t i = 0; i < suffixes.size(); ++i) requireRequest(requests[i], material(certs, server, prefix + suffixes[i]));
}

void wrongPins(const std::string &certs) {
    for (bool certificateInstead : {false, true}) {
        Server server(certs);Owned owned(certs);auto m = material(certs, server, prefix);
        m.peer_spki_sha256 = certificateInstead ? hexHash(fileBytes(certs + "/server.cert.der")) : std::string(64, '0');
        check(owned.start(m) == Code::ok && owned.wait() == Code::spki && owned.packet, "wrong SPKI did not preserve failed owned attempt");
        check(!owned.packet->dispatch_possible && !owned.packet->unknown && owned.packet->response.status_code == 0 && owned.packet->response.body.empty(), "wrong pin dispatched HTTP or fabricated response");
        owned.finish();check(server.waitFinished(1), "rejected SPKI peer was not physically released");server.stop();server.healthy();
        check(server.accepts() == 1 && server.handshakes() == 1 && server.requests().empty(), "wrong SPKI/cert digest emitted HTTP or redialed");
    }
    for (bool wrongCertificateSHA : {true, false}) {
        Server server(certs);Owned owned(certs);auto m = owned.bind(material(certs, server, prefix));
        if (wrongCertificateSHA) m.client_certificate_sha256 = std::string(64, '0');
        else m.client_private_key_fd = owned.source->credentialFDs[0]; // Public cert PEM is not a private key.
        check(RequestOwner::start(m, owned.source->fence(), owned.owner) == Code::ok && owned.wait() == Code::tls && owned.packet,
            "FD credential mismatch did not preserve the failed original owner");
        check(!owned.packet->dispatch_possible && !owned.packet->unknown && owned.packet->response.status_code == 0, "invalid FD credential reached HTTP");
        owned.finish();server.stop();server.healthy();
        check(server.accepts() == 0 && server.handshakes() == 0 && server.requests().empty(), "FD credential mismatch/refusal reached TCP or retried");
    }
}

void sourceFences(const std::string &certs) {
    {
        Server server(certs);Owned owned(certs);
        // The original engine's native Current after the actual PQ handshake
        // is refused. It is a native PUBLIC test owner, not an authority bool.
        owned.source->denyCall.store(2);
        check(owned.start(material(certs, server, prefix)) == Code::ok, "initial current Source unexpectedly failed");
        check(owned.wait() == Code::source_current && owned.packet && owned.packet->failure.native_code == 73, "native prewrite current cause lost");
        check(!owned.packet->dispatch_possible && !owned.packet->unknown, "prewrite Source refusal became possible dispatch");
        owned.finish();check(server.waitFinished(1), "prewrite source refusal kept a peer socket alive");server.stop();server.healthy();
        check(server.accepts() == 1 && server.handshakes() == 1 && server.requests().empty(), "Source was not refused after TLS and before HTTP write");
    }
    {
        Owned owned(certs);Server server(certs, ServerMode::revoke, [&owned] { owned.source->deviceCurrent.store(false); });
        check(owned.start(material(certs, server, prefix + "/logs")) == Code::ok, "late-current owner start failed");
        check(owned.wait() == Code::source_current && owned.packet && owned.packet->failure.native_code == 73, "late device current was not denied");
        check(owned.packet->response.status_code == 200 && owned.packet->response.body_complete && packetBody(*owned.packet) == originalBody &&
            owned.packet->response.headers_original == originalHeaders() &&
            owned.packet->dispatch_possible && owned.packet->unknown, "late Source error lost original response/UNKNOWN");
        owned.finish();server.stop();server.healthy();check(server.accepts() == 1 && server.requests().size() == 1, "late current retried original operation");
    }
}

void uncertainNoReplay(const std::string &certs) {
    for (const auto mode : {ServerMode::partial, ServerMode::stalled}) {
        Server server(certs, mode);Owned owned(certs);auto m = material(certs, server, prefix + "/runtime");m.timeout_ms = 300;
        check(owned.start(m) == Code::ok, "uncertain attempt failed to start");
        check(owned.wait(1500) != Code::ok && owned.packet, "partial/timeout returned success or lost reserved packet");
        check(owned.packet->dispatch_possible && owned.packet->unknown && !owned.packet->response.body_complete, "partial/timeout did not preserve UNKNOWN");
        if (mode == ServerMode::partial) check(owned.packet->response.status_code == 200 && packetBody(*owned.packet) == originalBody &&
            owned.packet->response.headers_original == originalHeaders(true), "partial response prefix/headers were discarded");
        else check(owned.packet->failure.code == Code::timeout, "actual response timeout cause changed");
        owned.finish();server.stop();server.healthy();check(server.accepts() == 1 && server.requests().size() == 1, "uncertain attempt replayed or redialed");
    }
    {
        Server server(certs, ServerMode::stalled);Owned owned(certs);
        check(owned.start(material(certs, server, prefix + "/usage")) == Code::ok && server.waitRequest(), "abort fixture did not reach actual original GET");
        const auto before = Clock::now();(void)owned.owner->abort();
        check(owned.wait(1500) == Code::cancelled && owned.packet && owned.packet->dispatch_possible && owned.packet->unknown, "actual in-flight abort lost UNKNOWN/cause");
        check(Clock::now() - before < 1500ms, "abort did not bound worker IO");
        owned.finish();server.stop();server.healthy();check(server.accepts() == 1 && server.requests().size() == 1, "abort retried original operation");
    }
}

void physicalDebt(const std::string &certs) {
    Server server(certs, ServerMode::stalled);Owned owned(certs);
    check(owned.start(material(certs, server, prefix + "/usage/records")) == Code::ok && server.waitRequest(), "debt fixture missed real in-flight GET");
    (void)owned.owner->retire();
    bool complete = true;
    (void)owned.owner->join(0, &complete);
    check(!complete && owned.source->borrows.load() == 1, "live worker/reserved packet was reported drained");
    check(owned.wait() == Code::cancelled && owned.packet, "retire failed to publish original failed packet");
    complete = true;(void)owned.owner->join(0, &complete);
    check(!complete && owned.source->borrows.load() == 1 && owned.source->releases.load() == 0, "owned packet debt dropped source");
    check(owned.owner->release_packet(owned.packet) == Code::ok, "packet release failed");owned.packet = nullptr;
    (void)owned.owner->join(1500, &complete);check(complete && owned.owner->lifetime().worker_joined, "real worker failed to join after packet release");
    owned.source->holdRelease = true;
    bool closed = false;Code closeCode = Code::ok;
    std::thread closing([&] { closeCode = owned.owner->close(&closed); });
    const bool entered = owned.source->waitRelease();
    const auto during = owned.owner->lifetime();
    bool competing = true;const Code progress = owned.owner->close(&competing);
    owned.source->unblock();closing.join();
    check(entered && during.worker_joined && during.reaper_bookkeeping_complete && during.source_callbacks_inflight == 1 &&
        during.closing && !during.physical_complete && during.source_borrow_held && !competing && progress == Code::draining,
        "closing callback released Source or claimed physical completion early");
    check(closed && (closeCode == Code::ok || closeCode == Code::cancelled) && owned.source->borrows.load() == 0 && owned.source->releases.load() == 1 && owned.source->originalFDsIntact(),
        "physical release did not finish exactly once");
    server.stop();server.healthy();check(server.accepts() == 1, "physical cleanup redialed");
}

void progressIsNotCause(const std::string &certs) {
    Server server(certs);Owned owned(certs);
    check(owned.start(material(certs, server, prefix)) == Code::ok && owned.wait() == Code::ok && owned.packet, "progress fixture original GET failed");
    bool closed = true;check(owned.owner->close(&closed) == Code::draining && !closed && owned.owner->first_error().code == Code::ok,
        "early known close progress poisoned first cause");
    (void)owned.owner->retire();bool joined = true;(void)owned.owner->join(0, &joined);
    check(!joined && owned.owner->first_error().code == Code::ok && owned.source->borrows.load() == 1, "packet progress poisoned first cause or released Source");
    check(owned.owner->release_packet(owned.packet) == Code::ok, "progress packet release failed");owned.packet = nullptr;
    check(owned.owner->join(1500, &joined) == Code::ok && joined, "original worker did not finish");
    owned.source->holdRelease = true;
    std::thread closing([&] { (void)owned.owner->close(&closed); });
    const bool entered = owned.source->waitRelease();const auto before = owned.owner->lifetime();
    bool other = true;const Code otherCode = owned.owner->close(&other);const auto first = owned.owner->first_error();
    owned.source->unblock();closing.join();
    check(entered && before.closing && !before.physical_complete && otherCode == Code::draining && !other && first.code == Code::ok &&
        closed && owned.owner->first_error().code == Code::ok && owned.source->releases.load() == 1 && owned.source->originalFDsIntact(), "close progress was mistaken for error/physical drain");
    server.stop();server.healthy();
}
} // namespace

int main(int argc, char **argv) {
    (void)::signal(SIGPIPE, SIG_IGN);
    try {
        check(argc == 2 || argc == 3, "explicit owned PUBLIC certificate directory and optional exact control name required");
        check(std::string(ynx_runtime_version()).rfind("OpenSSL 3.6.4 ", 0) == 0, "wrong actual native runtime");
        const std::string certs = argv[1];
        const std::array<std::pair<const char *, void (*)(const std::string &)>, 6> controls{{
            {"seven-exact-get-targets-original-body-and-real-pq", sevenTargets},
            {"wrong-spki-and-certificate-digest-refused-before-http-write", wrongPins},
            {"native-source-before-write-refusal-and-late-original-response", sourceFences},
            {"partial-timeout-and-abort-unknown-without-replay", uncertainNoReplay},
            {"packet-worker-socket-source-debt-and-physical-join", physicalDebt},
            {"close-progress-does-not-invent-first-cause", progressIsNotCause},
        }};
        size_t executed = 0;
        for (const auto &control : controls) {
            if (argc == 3 && control.first != std::string(argv[2])) continue;
            try { control.second(certs); }
            catch (const std::exception &error) { std::cerr << control.first << ": " << error.what() << '\n';return 1; }
            std::cout << "{\"control\":\"" << control.first << "\",\"passed\":true}\n" << std::flush;
            ++executed;
        }
        check(executed != 0, "unknown exact control selector");
        std::cout << "{\"summary\":true,\"controls\":" << executed << ",\"fullModule\":" << (argc == 2 ? "true" : "false")
            << ",\"actualPQ\":true,\"actualAuthFence\":false,\"RootAdmission\":false,\"SourceAdmission\":false}\n";
        return 0;
    } catch (const std::exception &error) { std::cerr << error.what() << '\n';return 2; }
}
